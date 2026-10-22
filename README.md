# 교내 랭킹 — 학교 단위 LoL 랭크 순위

학교별로 리그 오브 레전드 랭크를 등록하고, 자기 학교 안에서 몇 위인지 확인할 수 있는 사이트.
Riot API로 실제 랭크를 자동으로 가져올 수 있다.

## 기술 스택

| 영역 | 스택 |
|---|---|
| 런타임 | Cloudflare Workers (static assets 포함) |
| 빌드/배포 | Cloudflare Workers Builds (GitHub 연동) |
| 프론트엔드 | React 19 + Vite 7 |
| API | Hono |
| DB | Cloudflare D1 (SQLite) + Drizzle ORM |
| 인증 | 자체 구현 (PBKDF2-SHA256 + 해시 저장 세션 쿠키) |
| 외부 API | Riot API (Account → Summoner → League 3단계 조회) |

## 로컬 개발

```bash
npm install
cp .dev.vars.example .dev.vars   # RIOT_API_KEY 입력
npm run db:migrate:local         # 로컬 D1에 마이그레이션 적용
npm run dev                      # http://localhost:5173
```

Riot API 없이 테스트하려면 목 서버를 함께 띄운다.

```bash
npm run dev:mock                 # 목 Riot API + dev 서버 동시 실행
```

목 서버는 `scripts/run-with-mock.mjs`가 Vite dev 서버와 같은 프로세스 트리에서 관리한다.
(별도 프로세스로 띄우면 셸 종료 시 목 서버만 죽는 문제가 생긴다)

목 서버는 다음 Riot ID들을 지원한다.

| Riot ID | 결과 |
|---|---|
| `hidesmite#kr1` | 다이아몬드 2 42LP |
| `goldfish#kr2` | 골드 3 55LP |
| `mastermind#kr1` | 마스터 231LP (디비전 없음) |
| `unranked#kr1` | 랭크 없음 |
| 그 외 | 404 |

## 환경 변수

| 이름 | 용도 | 설정 위치 |
|---|---|---|
| `RIOT_API_KEY` | Riot API 키 (비밀) | `.dev.vars` (로컬) / `wrangler secret put RIOT_API_KEY` (배포) |
| `RIOT_API_BASE` | Riot API 베이스 URL | `wrangler.json`의 `vars` |

`RIOT_API_BASE`는 `wrangler.json`의 `vars`에 둔다. `.dev.vars`는 secrets 경로로만 로드되므로
같은 이름의 vars를 덮어쓰지 못한다. 로컬에서 목 서버를 쓸 때는 `wrangler.local.json`을 사용한다.

## 배포

1. D1 데이터베이스 생성

```bash
npx wrangler d1 create lol-school-rank
```

2. `wrangler.json`의 `d1_databases[0].database_id`를 생성된 UUID로 교체

3. 원격 마이그레이션 적용

```bash
npm run db:migrate:remote
```

4. Riot API 키 등록

```bash
npx wrangler secret put RIOT_API_KEY
```

5. GitHub 저장소를 Cloudflare Dashboard → Workers & Pages → 해당 Worker → Settings → Builds에서 연결

| 항목 | 값 |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Node version | 24 |

6. 커스텀 도메인은 Cloudflare 네임서버를 쓰는 존에 붙일 수 있다.

## 데이터 모델

```
schools       (id, name, join_code, created_at)
users         (id, nickname, riot_id, password_hash, password_salt, school_id, created_at)
sessions      (id=sha256(token), user_id, expires_at, created_at)
rank_entries  (id, user_id, season, tier, division, lp, score, source, updated_at)
```

### 랭크 점수 계산

`src/worker/rank.ts` — 티어 폭을 100000으로 통일해 정수 하나로 정렬한다.

- 디비전 티어(IRON~DIAMOND): `tierIndex*100000 + (4-division)*10000 + lp*50`
- 마스터 이상: `tierIndex*100000 + lp`

`rank_entries.source`는 `manual`(직접 입력) 또는 `riot`(API 조회)이다.
시즌 전환은 `rank_entries.season` 컬럼만 늘리면 된다.

### 학교 참가 코드

학교를 처음 만든 사용자에게 `XXXX-XXXX` 형식의 코드가 발급된다.
같은 학교에 가입할 때 이 코드를 입력해야 하므로, 다른 학교 학생이 임의로 끼어드는 것을 막는다.

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/schools` | 학교 목록 + 멤버 수 |
| POST | `/api/auth/register` | 가입 (학교 최초 생성 시 참가 코드 발급) |
| POST | `/api/auth/login` | 로그인 |
| POST | `/api/auth/logout` | 로그아웃 (세션 삭제) |
| GET | `/api/me` | 내 정보 + 등록된 랭크 |
| PUT | `/api/me/riot-id` | Riot ID 등록/변경 |
| PUT | `/api/me/rank` | 랭크 직접 입력/갱신 |
| POST | `/api/me/rank/sync` | Riot API로 실제 랭크 조회 후 갱신 |
| GET | `/api/leaderboard` | 순위표 (`?schoolId=` 필터, `?limit=`) |
| GET | `/api/summary` | 학교별 요약 + 내 학교 내 순위 |

## Riot API 참고

- 조회 큐는 랭킹 게임(5인) `RANKED_SOLO_5x5` 기준
- Riot ID 형식: `게임이름#태그` (태그는 한글/영문/숫자, 5자 이하)
- KR은 region이 `kr`, platform이 `KR`
- 새 개발 키는 발급 후 몇 시간간 `Unknown apikey`를 반환하는 알려진 이슈가 있다
- rate limit이 있으므로 주기적 전체 동기화보다 사용자가 누르는 방식이 안전하다

## 다음 단계 아이디어

- **티어 이미지/뱃지**
- **전체 학교 순위**: 학교별 최고 점수를 집계한 학교 순위표
- **학교 관리자**: 학교 대표가 참가 코드를 재발급하거나 멤버를 관리
- **시즌 관리 UI**
- **Cron으로 주기적 랭크 갱신** (rate limit 고려 필요)
