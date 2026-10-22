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
npm run setup:local   # wrangler.local.json 생성 (최초 1회)
npm run dev:mock      # 목 Riot API + dev 서버 동시 실행
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
| `RIOT_API_BASE` | Riot API 베이스 URL | `wrangler.json`의 `vars` (운영) / `wrangler.local.json`의 `vars` (로컬) |

### 주의: `.dev.vars` 와 `vars` 는 같은 이름을 공유할 수 없다

`.dev.vars` 는 **secrets 경로**로 로드되고, `wrangler.json` 의 `vars` 는 **vars 경로**로 로드된다.
같은 이름(예: `RIOT_API_BASE`)을 양쪽에 정의하면 `.dev.vars` 쪽 값이 이기고,
`wrangler.local.json` 의 `vars` 설정이 무시된다.

따라서 **`RIOT_API_BASE` 는 `.dev.vars` 에 절대 넣지 않는다.** `vars` 에만 정의한다.

### workerd 는 사설 IP fetch 를 차단한다

Workers 런타임은 `127.0.0.1`, `172.x.x.x` 같은 사설/루프백 주소로의 `fetch` 를 차단한다
(`internal error; reference = ...` 로 실패한다). 로컬 목 서버에 직접 붙으면 연결할 수 없다.

해결책: Vite dev 서버가 중계하도록 프록시를 둔다.

```
Worker → http://127.0.0.1:5173/mock-riot/...  (Vite dev server)
       → http://127.0.0.1:8787/...              (목 Riot API 서버)
```

`vite.config.ts` 의 `server.proxy` 와 `wrangler.local.json` 의 `RIOT_API_BASE` 가 이 경로를 구성한다.
`server.host: "127.0.0.1"` 설정이 있어야 IPv4 로 접근된다(기본은 IPv6 `::1` 만).

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

## 학교: 김천고등학교 단일 운영

현재 **김천고등학교 한 곳만** 운영하는 구조다. 학교 선택 UI와 참가 코드는 제거했다.

- 기준 학교: `schools` 테이블의 `id = 1`, 이름 `김천고등학교`
- 설정은 `src/worker/config.ts` 한 곳에 모아뒀다 (`SCHOOL_ID`, `SCHOOL_NAME`)

학교를 나중에 추가하려면:

1. `schools` 테이블에 행 추가 (id, name, created_at)
2. `src/worker/config.ts` 의 `SCHOOL_ID` 를 새 학교 id로 변경

`schools` 테이블은 그대로 유지하므로 마이그레이션은 필요 없다.
(단일 학교 → 다중 학교로 바꿀 때 사용자 UI의 학교 선택기를 되살리면 된다)

## 데이터 모델

```
schools       (id, name, created_at)
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

## API

| 메서드 | 경로 | 설명 |
|---|---|---|
| GET | `/api/schools` | 학교 정보 + 멤버 수 |
| POST | `/api/auth/register` | 가입 (학교는 김천고등학교 고정) |
| POST | `/api/auth/login` | 로그인 |
| POST | `/api/auth/logout` | 로그아웃 (세션 삭제) |
| GET | `/api/me` | 내 정보 + 등록된 랭크 |
| PUT | `/api/me/riot-id` | Riot ID 등록/변경 |
| PUT | `/api/me/rank` | 랭크 직접 입력/갱신 |
| POST | `/api/me/rank/sync` | Riot API로 실제 랭크 조회 후 갱신 |
| GET | `/api/leaderboard` | 순위표 (`?limit=`) |
| GET | `/api/summary` | 학교 요약 + 내 순위 |

## Riot API 참고

- 조회 큐는 랭킹 게임(5인) `RANKED_SOLO_5x5` 기준
- Riot ID 형식: `게임이름#태그` (태그는 한글/영문/숫자, 5자 이하)
- KR은 region이 `kr`, platform이 `KR`
- rate limit이 있으므로 주기적 전체 동기화보다 사용자가 누르는 방식이 안전하다

### 개발 키는 24시간마다 만료된다

Riot 공식 문서 기준, 개발자 포털에서 받는 **development API key는 24시간마다 비활성화**된다.
매일 포털에서 키를 새로 발급받아 `RIOT_API_KEY`를 갱신해야 한다.
실서비스를 공개하려면 production key를 신청해야 하며, 아래는 신청 요건이다.

- **Personal key**: 개인 프로젝트/프로토타입용. 비교적 간단히 발급된다.
- **Production key**: 실제 서비스 공개용. **동작하는 웹사이트가 있어야** 승인된다.
  - 사이트 도메인 소유권 증명을 위한 `riot.txt` 업로드가 필요하다.
  - 리뷰는 주간 단위로 진행되며, 최대 3주가 걸릴 수 있다.
  - rate limit이 personal key보다 훨씬 높다 (10초당 500 req).

### 학교 와이파이에서 Riot API가 막히는 경우

`kr.api.riotgames.com` 접속이 TLS 단계에서 끊기면(`SSL routines:: unexpected eof`,
curl exit 35) 키 문제가 아니라 **네트워크 차단**이다. 확인할 방법:

```bash
curl -s -w "HTTP=%{http_code}\n" -H "X-Riot-Token: $RIOT_API_KEY" \
  "https://kr.api.riotgames.com/riot/account/v1/accounts/by-riot-id/hide/onbush"
```

- `HTTP=401 Unknown apikey` → 키가 만료되었거나 아직 인식되지 않음. 포털에서 재발급.
- `HTTP=403 Forbidden` → 키는 인식되지만 아직 승인/활성화 대기 중.
- `curl exit 35` / `HTTP=000` → **네트워크 차단**. 학교 와이파이가 riotgames.com을 막은 경우.

이 경우 세 가지 대안이 있다.

1. **개인(핸드폰) 테더링** 등 Riot API를 통과하는 네트워크에서 테스트.
2. **목 서버로 개발**: `npm run dev:mock` — 실 API와 동일한 응답 형식을 재현한다.
3. **Cloudflare Workers 배포 후 확인**: Workers의 아웃바운드는 학교 와이파이를 거치지 않으므로,
   배포된 환경에서는 정상 동작한다. (로컬만 막히는 경우)

## 디자인

op.gg(https://op.gg) 레퍼런스 기반. 색상 토큰은 Wayback Machine 스냅샷
(2025-01-13, `s-lol-web.op.gg/_next/static/css/`)에서 실제 값을 추출했다.

| 역할 | 값 |
|---|---|
| GNB 배경 | `#1c1c1f` |
| 표면 (카드) | `#202d37` |
| 보조 표면 | `#263340` / `#2d3b49` |
| 액센트 블루 | `#5383e8` |
| 골드 액센트 | `#ffb900` / `#eb9c00` |
| 본문 텍스트 | `#ebeef1` |
| 보조 텍스트 | `#9aa4af` / `#6d7a86` |
| 폰트 | Roboto + Pretendard |

티어 색상은 LoL 공식 팔레트를 따른다 (아이언 `#7d8791` … 챌린저 `#f7e58c`).

주요 요소:
- 상단 48px GNB (op.gg DesktopGNB 규격) — 로고/내비/사용자 정보
- 통계 카드 4개 (가입 학생 / 랭크 등록 / 순위표 / 내 순위)
- 순위 리스트: `순위 | 닉네임 | 티어 | LP` 4열, 1~3위 금/은/동
- 티어 뱃지는 어두운 배경 + 색상 왼쪽 바 + 티어색 텍스트
- 내 행은 파란 왼쪽 바 + `ME` 태그

## 다음 단계 아이디어

- **티어 이미지/에블럼**: op.gg는 티어 이미지를 SVG로 제공하는데, 현재는 색상 뱃지로 대체했다
- **여러 학교 지원**: 학교 선택 UI를 되살리고 학교별 순위표 추가
- **시즌 관리 UI**
- **Cron으로 주기적 랭크 갱신** (rate limit 고려 필요)
- **전체 학교 순위**: 학교별 최고 점수를 집계한 순위표
- **학교 관리자**: 학교 대표가 멤버를 관리하는 기능
