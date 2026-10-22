import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { createDb } from "./db";
import { rankEntries, schools, sessions, users } from "./db/schema";
import { SCHOOL_ID, SCHOOL_NAME } from "./config";
import {
  generateSessionToken,
  hashPassword,
  hashSessionToken,
  deserializePassword,
  serializePassword,
  verifyPassword,
} from "./auth";
import {
  computeScore,
  formatRank,
  isTier,
  normalizeDivision,
  TIER_LABELS,
  type Tier,
} from "./rank";
import {
  fetchSoloRank,
  formatRiotId,
  parseRiotId,
  RiotApiError,
  DEFAULT_RIOT_API_BASE,
} from "./riot";

const app = new Hono<{ Bindings: Env }>();

const SESSION_COOKIE = "lolrank_session";
const SESSION_DAYS = 30;
const CURRENT_SEASON = 1;

type CookieOptions = {
  httpOnly: true;
  sameSite: "Lax";
  path: "/";
  maxAge: number;
  secure: boolean;
};

function cookieOptions(c: { req: { url: string } }): CookieOptions {
  return {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_DAYS * 24 * 60 * 60,
    secure: new URL(c.req.url).protocol === "https:",
  };
}

function serializeCookie(opts: CookieOptions): string {
  return [
    `Max-Age=${opts.maxAge}`,
    `Path=${opts.path}`,
    "HttpOnly",
    `SameSite=${opts.sameSite}`,
    opts.secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function nicknameError(nickname: string): string | null {
  if (nickname.length < 2) return "닉네임은 2자 이상이어야 합니다.";
  if (nickname.length > 20) return "닉네임은 20자 이하여야 합니다.";
  if (!/^[\p{L}\p{N}_.\- ]+$/u.test(nickname))
    return "닉네임에는 문자, 숫자, 공백, _ . - 만 사용할 수 있습니다.";
  return null;
}

function readSessionToken(c: {
  req: { header: (name: string) => string | undefined };
}): string | null {
  const cookie = c.req.header("Cookie") ?? "";
  const match = cookie.match(new RegExp(`${SESSION_COOKIE}=([^;]+)`));
  return match?.[1] ? decodeURIComponent(match[1]) : null;
}

async function currentUserId(c: {
  req: { header: (name: string) => string | undefined };
  env: Env;
}): Promise<number | null> {
  const token = readSessionToken(c);
  if (!token) return null;

  const tokenHash = await hashSessionToken(token);
  const db = createDb(c.env);
  const rows = await db
    .select({ userId: sessions.userId, expiresAt: sessions.expiresAt })
    .from(sessions)
    .where(eq(sessions.id, tokenHash))
    .limit(1);

  const row = rows[0];
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await db.delete(sessions).where(eq(sessions.id, tokenHash));
    return null;
  }
  return row.userId;
}

// ---------------------------------------------------------------- schools

app.get("/api/schools", async (c) => {
  const db = createDb(c.env);
  const rows = await db
    .select({
      id: schools.id,
      name: schools.name,
      // Drizzle의 테이블/컬럼 템플릿은 카멜케이스 식별자로 렌더링되므로,
      // raw SQL에는 실제 스키마 이름(snake_case)을 직접 쓴다.
      memberCount: sql<number>`(select count(*) from users u where u.school_id = schools.id)`,
    })
    .from(schools)
    .where(eq(schools.id, SCHOOL_ID));

  return c.json({ schools: rows });
});

// ---------------------------------------------------------------- auth

app.post("/api/auth/register", async (c) => {
  const body = await c.req.json<{
    nickname?: string;
    password?: string;
    riotId?: string;
  }>();

  const nickname = (body.nickname ?? "").trim();
  const password = body.password ?? "";
  const riotIdInput = (body.riotId ?? "").trim();

  let riotId: string | null = null;
  if (riotIdInput) {
    const parsed = parseRiotId(riotIdInput);
    if (!parsed)
      return c.json(
        { error: "Riot ID는 '게임이름#태그' 형식이어야 합니다." },
        400,
      );
    riotId = formatRiotId(parsed);
  }

  const nickErr = nicknameError(nickname);
  if (nickErr) return c.json({ error: nickErr }, 400);
  if (password.length < 6)
    return c.json({ error: "비밀번호는 6자 이상이어야 합니다." }, 400);

  const db = createDb(c.env);

  // 학교는 김천고등학교 한 곳뿐이다. 학교가 아직 없으면 자동 생성한다.
  const schoolRows = await db
    .select({ id: schools.id })
    .from(schools)
    .where(eq(schools.id, SCHOOL_ID))
    .limit(1);

  let schoolId = SCHOOL_ID;
  if (!schoolRows[0]) {
    const inserted = await db
      .insert(schools)
      .values({ id: SCHOOL_ID, name: SCHOOL_NAME, createdAt: new Date() })
      .returning({ id: schools.id });
    schoolId = inserted[0].id;
  }

  const existingUser = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.nickname, nickname))
    .limit(1);
  if (existingUser[0])
    return c.json({ error: "이미 사용 중인 닉네임입니다." }, 409);

  const stored = await hashPassword(password);
  const insertedUser = await db
    .insert(users)
    .values({
      nickname,
      riotId,
      passwordHash: serializePassword(stored),
      passwordSalt: stored.salt,
      schoolId,
      createdAt: new Date(),
    })
    .returning({ id: users.id });

  const userId = insertedUser[0].id;
  const token = generateSessionToken();
  await db.insert(sessions).values({
    id: await hashSessionToken(token),
    userId,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
  });

  c.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${serializeCookie(cookieOptions(c))}`,
  );

  return c.json(
    {
      user: { id: userId, nickname },
      school: { id: schoolId, name: SCHOOL_NAME },
    },
    201,
  );
});

app.post("/api/auth/login", async (c) => {
  const body = await c.req.json<{ nickname?: string; password?: string }>();
  const nickname = (body.nickname ?? "").trim();
  const password = body.password ?? "";

  if (!nickname || !password)
    return c.json({ error: "닉네임과 비밀번호를 입력해 주세요." }, 400);

  const db = createDb(c.env);
  const rows = await db
    .select()
    .from(users)
    .where(eq(users.nickname, nickname))
    .limit(1);

  const user = rows[0];
  const stored = user ? deserializePassword(user.passwordHash) : null;

  // 없는 사용자여도 해시 검증을 수행해 응답 시간 차이를 줄인다.
  const ok = stored
    ? await verifyPassword(password, stored)
    : await verifyPassword(password, {
        iterations: 210_000,
        salt: "AAAAAAAAAAAAAAAAAAAAAA==",
        hash: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
      });

  if (!user || !stored || !ok)
    return c.json({ error: "닉네임 또는 비밀번호가 올바르지 않습니다." }, 401);

  const token = generateSessionToken();
  await db.insert(sessions).values({
    id: await hashSessionToken(token),
    userId: user.id,
    expiresAt: new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000),
    createdAt: new Date(),
  });

  c.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=${encodeURIComponent(token)}; ${serializeCookie(cookieOptions(c))}`,
  );

  return c.json({ user: { id: user.id, nickname: user.nickname } });
});

app.post("/api/auth/logout", async (c) => {
  const token = readSessionToken(c);
  if (token) {
    const db = createDb(c.env);
    await db
      .delete(sessions)
      .where(eq(sessions.id, await hashSessionToken(token)));
  }
  c.header(
    "Set-Cookie",
    `${SESSION_COOKIE}=; ${serializeCookie({ ...cookieOptions(c), maxAge: 0 })}`,
  );
  return c.json({ ok: true });
});

app.get("/api/me", async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: "로그인이 필요합니다." }, 401);

  const db = createDb(c.env);
  const rows = await db
    .select({
      id: users.id,
      nickname: users.nickname,
      riotId: users.riotId,
      schoolId: schools.id,
      schoolName: schools.name,
    })
    .from(users)
    .innerJoin(schools, eq(users.schoolId, schools.id))
    .where(eq(users.id, userId))
    .limit(1);

  if (!rows[0]) return c.json({ error: "사용자를 찾을 수 없습니다." }, 404);

  const rank = await db
    .select()
    .from(rankEntries)
    .where(
      and(
        eq(rankEntries.userId, userId),
        eq(rankEntries.season, CURRENT_SEASON),
      ),
    )
    .limit(1);

  return c.json({
    user: {
      id: rows[0].id,
      nickname: rows[0].nickname,
      riotId: rows[0].riotId,
      schoolId: rows[0].schoolId,
      schoolName: rows[0].schoolName,
    },
    rank: rank[0]
      ? {
          tier: rank[0].tier,
          division: rank[0].division,
          lp: rank[0].lp,
          source: rank[0].source,
          updatedAt: rank[0].updatedAt,
        }
      : null,
  });
});

// ---------------------------------------------------------------- rank

app.put("/api/me/rank", async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: "로그인이 필요합니다." }, 401);

  const body = await c.req.json<{
    tier?: string;
    division?: number | null;
    lp?: number;
  }>();

  if (!isTier(body.tier))
    return c.json({ error: "올바른 티어가 아닙니다." }, 400);

  const tier = body.tier as Tier;
  const division = normalizeDivision(tier, body.division);
  if (division === "invalid")
    return c.json({ error: "디비전은 1~4 사이의 숫자여야 합니다." }, 400);

  const lp = Number(body.lp ?? 0);
  if (!Number.isInteger(lp) || lp < 0 || lp > 9999)
    return c.json({ error: "LP 값이 올바르지 않습니다." }, 400);

  const score = computeScore(tier, division, lp);
  const db = createDb(c.env);

  await db
    .insert(rankEntries)
    .values({
      userId,
      season: CURRENT_SEASON,
      tier,
      division,
      lp,
      score,
      source: "manual",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [rankEntries.userId, rankEntries.season],
      set: { tier, division, lp, score, source: "manual", updatedAt: new Date() },
    });

  return c.json({ ok: true, score });
});

// ---------------------------------------------------------------- riot sync

/**
 * Riot API로 실제 랭크를 조회해 순위를 갱신한다.
 * 수동 입력보다 신뢰도가 높으므로 source를 'riot'으로 기록한다.
 */
app.post("/api/me/rank/sync", async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: "로그인이 필요합니다." }, 401);

  const apiKey = c.env.RIOT_API_KEY;
  if (!apiKey)
    return c.json(
      { error: "Riot API 키가 설정되지 않았습니다. 수동으로 랭크를 입력해 주세요." },
      503,
    );

  const db = createDb(c.env);
  const rows = await db
    .select({ riotId: users.riotId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  const riotId = rows[0]?.riotId;
  if (!riotId)
    return c.json(
      { error: "등록된 Riot ID가 없습니다. 계정에서 Riot ID를 먼저 입력해 주세요." },
      400,
    );

  const parsed = parseRiotId(riotId);
  if (!parsed)
    return c.json({ error: "저장된 Riot ID 형식이 올바르지 않습니다." }, 400);

  let rank;
  const baseUrl = c.env.RIOT_API_BASE || DEFAULT_RIOT_API_BASE;
  try {
    rank = await fetchSoloRank(parsed, apiKey, baseUrl);
  } catch (err) {
    if (err instanceof RiotApiError)
      return c.json({ error: err.message }, err.status);
    return c.json({ error: "Riot API 호출에 실패했습니다." }, 502);
  }

  if (!rank)
    return c.json(
      { error: "랭크 정보를 찾을 수 없습니다. 랭크가 있는 계정인지 확인해 주세요." },
      404,
    );

  const tier = rank.tier as Tier;
  const division = normalizeDivision(tier, rank.division);
  if (division === "invalid")
    return c.json({ error: "Riot API에서 잘못된 디비전 값이 왔습니다." }, 502);

  const score = computeScore(tier, division, rank.lp);
  await db
    .insert(rankEntries)
    .values({
      userId,
      season: CURRENT_SEASON,
      tier,
      division,
      lp: rank.lp,
      score,
      source: "riot",
      updatedAt: new Date(),
    })
    .onConflictDoUpdate({
      target: [rankEntries.userId, rankEntries.season],
      set: {
        tier,
        division,
        lp: rank.lp,
        score,
        source: "riot",
        updatedAt: new Date(),
      },
    });

  return c.json({
    ok: true,
    rank: { tier, division, lp: rank.lp, display: formatRank(tier, division, rank.lp) },
    score,
  });
});

/** Riot ID 등록/변경 */
app.put("/api/me/riot-id", async (c) => {
  const userId = await currentUserId(c);
  if (!userId) return c.json({ error: "로그인이 필요합니다." }, 401);

  const body = await c.req.json<{ riotId?: string }>();
  const parsed = parseRiotId((body.riotId ?? "").trim());
  if (!parsed)
    return c.json(
      { error: "Riot ID는 '게임이름#태그' 형식이어야 합니다." },
      400,
    );

  const riotId = formatRiotId(parsed);
  const db = createDb(c.env);
  await db.update(users).set({ riotId }).where(eq(users.id, userId));
  return c.json({ ok: true, riotId });
});

// ---------------------------------------------------------------- leaderboard

app.get("/api/leaderboard", async (c) => {
  const db = createDb(c.env);
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);

  const rows = await db
    .select({
      userId: users.id,
      nickname: users.nickname,
      schoolId: schools.id,
      schoolName: schools.name,
      tier: rankEntries.tier,
      division: rankEntries.division,
      lp: rankEntries.lp,
      score: rankEntries.score,
      source: rankEntries.source,
      updatedAt: rankEntries.updatedAt,
    })
    .from(rankEntries)
    .innerJoin(users, eq(rankEntries.userId, users.id))
    .innerJoin(schools, eq(users.schoolId, schools.id))
    .where(
      and(
        eq(rankEntries.season, CURRENT_SEASON),
        eq(users.schoolId, SCHOOL_ID),
      ),
    )
    .orderBy(desc(rankEntries.score))
    .limit(limit);

  const entries = rows.map((r, i) => ({
    rank: i + 1,
    userId: r.userId,
    nickname: r.nickname,
    schoolId: r.schoolId,
    schoolName: r.schoolName,
    tier: r.tier,
    tierLabel: TIER_LABELS[r.tier as Tier] ?? r.tier,
    division: r.division,
    lp: r.lp,
    score: r.score,
    source: r.source,
    display: formatRank(r.tier as Tier, r.division, r.lp),
    updatedAt: r.updatedAt,
  }));

  return c.json({ entries });
});

/** 서비스 요약: 학교 정보 + 내 순위 */
app.get("/api/summary", async (c) => {
  const userId = await currentUserId(c);
  const db = createDb(c.env);

  const schoolRows = await db
    .select({
      id: schools.id,
      name: schools.name,
      memberCount: sql<number>`(select count(*) from users u where u.school_id = schools.id)`,
      rankedCount: sql<number>`(select count(*) from rank_entries r join users u on u.id = r.user_id where u.school_id = schools.id and r.season = ${CURRENT_SEASON})`,
      bestScore: sql<number | null>`(select max(r.score) from rank_entries r join users u on u.id = r.user_id where u.school_id = schools.id and r.season = ${CURRENT_SEASON})`,
    })
    .from(schools)
    .where(eq(schools.id, SCHOOL_ID));

  let me = null;
  if (userId) {
    const my = await db
      .select({
        nickname: users.nickname,
        schoolId: schools.id,
        schoolName: schools.name,
        score: rankEntries.score,
      })
      .from(users)
      .innerJoin(schools, eq(users.schoolId, schools.id))
      .leftJoin(
        rankEntries,
        and(
          eq(rankEntries.userId, users.id),
          eq(rankEntries.season, CURRENT_SEASON),
        ),
      )
      .where(eq(users.id, userId))
      .limit(1);

    if (my[0]) {
      const score = my[0].score ?? 0;
      const higher = await db
        .select({ count: sql<number>`count(*)` })
        .from(rankEntries)
        .innerJoin(users, eq(rankEntries.userId, users.id))
        .where(
          and(
            eq(rankEntries.season, CURRENT_SEASON),
            eq(users.schoolId, my[0].schoolId),
            sql`${rankEntries.score} > ${score}`,
          ),
        );
      me = {
        nickname: my[0].nickname,
        schoolId: my[0].schoolId,
        schoolName: my[0].schoolName,
        ranked: my[0].score !== null,
        schoolRank: my[0].score === null ? null : Number(higher[0].count) + 1,
      };
    }
  }

  return c.json({ schools: schoolRows, me });
});

export default app;
