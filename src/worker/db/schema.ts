import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * 학교 테이블.
 *
 * 현재는 김천고등학교 한 곳만 운영하지만, 나중에 학교를 추가할 수 있도록
 * 테이블은 그대로 유지한다. 학교를 추가하려면 이 테이블에 행을 넣고
 * src/worker/config.ts 의 SCHOOL_ID 를 갱신하면 된다.
 */
export const schools = sqliteTable(
  "schools",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [uniqueIndex("schools_name_idx").on(t.name)],
);

export const users = sqliteTable(
  "users",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    nickname: text("nickname").notNull(),
    // Riot ID (gameName#tagLine). 랭크 자동 동기화에 사용한다.
    riotId: text("riot_id"),
    passwordHash: text("password_hash").notNull(),
    passwordSalt: text("password_salt").notNull(),
    schoolId: integer("school_id")
      .notNull()
      .references(() => schools.id, { onDelete: "cascade" }),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    uniqueIndex("users_nickname_idx").on(t.nickname),
    index("users_school_idx").on(t.schoolId),
  ],
);

export const sessions = sqliteTable(
  "sessions",
  {
    // sha256(raw token) — DB가 유출되어도 세션 토큰으로 바로 로그인 불가.
    id: text("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: integer("expires_at", { mode: "timestamp" }).notNull(),
    createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [index("sessions_user_idx").on(t.userId)],
);

export const rankEntries = sqliteTable(
  "rank_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    season: integer("season").notNull().default(1),
    tier: text("tier").notNull(),
    // 마스터 이상은 디비전이 없으므로 null 허용.
    division: integer("division"),
    lp: integer("lp").notNull().default(0),
    // 정렬용 정규화 점수. 랭크 입력/동기화 시점에 계산해 저장.
    score: integer("score").notNull().default(0),
    source: text("source").notNull().default("manual"),
    updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  },
  (t) => [
    uniqueIndex("rank_entries_user_season_idx").on(t.userId, t.season),
    index("rank_entries_score_idx").on(t.season, t.score),
  ],
);

export type School = typeof schools.$inferSelect;
export type User = typeof users.$inferSelect;
export type RankEntry = typeof rankEntries.$inferSelect;
