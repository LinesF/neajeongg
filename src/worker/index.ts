import { Hono } from "hono";
import { and, desc, eq, sql } from "drizzle-orm";
import { createDb } from "./db";
import { rankEntries, schools, sessions, users } from "./db/schema";
import {
  generateJoinCode,
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
    .orderBy(desc(schools.createdAt));

  return c.json({ schools: rows });
});

// ---------------------------------------------------------------- auth

app.post("/api/auth/register", async (c) => {
  const body = await c.req.json<{
    nickname?: string;
    password?: string;
    schoolName?: string;
    joinCode?: string;
  }>();

  const nickname = (body.nickname ?? "").trim();
  const password = body.password ?? "";
  const schoolName = (body.schoolName ?? "").trim();
  const joinCode = (body.joinCode ?? "").trim().toUpperCase();

  const nickErr = nicknameError(nickname);
  if (nickErr) return c.json({ error: nickErr }, 400);
  if (password.length < 6)
    return c.json({ error: "비밀번호는 6자 이상이어야 합니다." }, 400);
  if (!schoolName) return c.json({ error: "학교명을 입력해 주세요." }, 400);
  if (schoolName.length > 60)
    return c.json({ error: "학교명이 너무 깁니다." }, 400);

  const db = createDb(c.env);
  const existingSchool = await db
    .select()
    .from(schools)
    .where(eq(schools.name, schoolName))
    .limit(1);

  let schoolId: number;
  let issuedJoinCode: string | null = null;

  if (existingSchool[0]) {
    if (existingSchool[0].joinCode !== joinCode) {
      return c.json({ error: "학교 참가 코드가 올바르지 않습니다." }, 403);
    }
    schoolId = existingSchool[0].id;
  } else {
    if (joinCode) {
      return c.json(
        { error: "존재하지 않는 학교입니다. 참가 코드를 비워 주세요." },
        400,
      );
    }
    issuedJoinCode = generateJoinCode();
    const inserted = await db
      .insert(schools)
      .values({
        name: schoolName,
        joinCode: issuedJoinCode,
        createdAt: new Date(),
      })
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
      school: { name: schoolName },
      // 학교를 처음 만든 경우에만 참가 코드를 돌려준다.
      joinCode: issuedJoinCode,
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
      schoolId: rows[0].schoolId,
      schoolName: rows[0].schoolName,
    },
    rank: rank[0]
      ? {
          tier: rank[0].tier,
          division: rank[0].division,
          lp: rank[0].lp,
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

// ---------------------------------------------------------------- leaderboard

app.get("/api/leaderboard", async (c) => {
  const db = createDb(c.env);
  const schoolIdParam = c.req.query("schoolId");
  const limit = Math.min(Number(c.req.query("limit") ?? 50) || 50, 200);

  const conditions = [eq(rankEntries.season, CURRENT_SEASON)];
  if (schoolIdParam) conditions.push(eq(users.schoolId, Number(schoolIdParam)));

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
      updatedAt: rankEntries.updatedAt,
    })
    .from(rankEntries)
    .innerJoin(users, eq(rankEntries.userId, users.id))
    .innerJoin(schools, eq(users.schoolId, schools.id))
    .where(and(...conditions))
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
    display: formatRank(r.tier as Tier, r.division, r.lp),
    updatedAt: r.updatedAt,
  }));

  return c.json({ entries });
});

/** 학교별 요약 + 내 학교 내 순위 */
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
    .orderBy(desc(schools.createdAt));

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
