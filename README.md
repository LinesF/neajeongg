# 교내 랭킹 — 학교 단위 LoL 랭크 순위

학교별로 리그 오브 레전드 랭크를 등록하고, 자기 학교 안에서 몇 위인지 확인할 수 있는 사이트.

## 기술 스택

| 영역 | 스택 |
|---|---|
| 런타임 | Cloudflare Workers (static assets 포함) |
| 빌드/배포 | Cloudflare Workers Builds (GitHub 연동) |
| 프론트엔드 | React 19 + Vite 7 |
| API | Hono |
| DB | Cloudflare D1 (SQLite) + Drizzle ORM |
| 인증 | 자체 구현 (PBKDF2-SHA256 + 해시 저장 세션 쿠키) |

## 로컬 개발

```bash
npm install
npm run db:migrate:local   # 로컬 D1에 마이그레이션 적용
npm run dev                # http://localhost:5173
```

## 배포

1. Cloudflare에 D1 데이터베이스 생성

```bash
npx wrangler d1 create lol-school-rank
```

2. `wrangler.json`의 `d1_databases[0].database_id`를 생성된 UUID로 교체

3. 원격 마이그레이션 적용

```bash
npm run db:migrate:remote
```

4. GitHub 저장소를 Cloudflare Dashboard → Workers & Pages → 해당 Worker → Settings → Builds에서 연결

| 항목 | 값 |
|---|---|
| Build command | `npm run build` |
| Deploy command | `npx wrangler deploy` |
| Node version | 24 |

5. 커스텀 도메인은 Cloudflare 네임서버를 쓰는 존에 붙일 수 있다.

## 데이터 모델

```
schools       (id, name, join_code, created_at)
users         (id, nickname, password_hash, password_salt, school_id, created_at)
sessions      (id=sha256(token), user_id, expires_at, created_at)
rank_entries  (id, user_id, season, tier, division, lp, score, source, updated_at)
```

### 랭크 점수 계산

`src/worker/rank.ts` — 티어 폭을 100000으로 통일해 정수 하나로 정렬한다.

- 디비전 티어(IRON~DIAMOND): `tierIndex*100000 + (4-division)*10000 + lp*50`
- 마스터 이상: `tierIndex*100000 + lp`

`rank_entries.source`는 현재 `manual`이고, 나중에 Riot API 동기화를 붙일 때 `riot`으로 구분하면 된다.

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
| PUT | `/api/me/rank` | 내 랭크 등록/갱신 |
| GET | `/api/leaderboard` | 순위표 (`?schoolId=` 필터, `?limit=`) |
| GET | `/api/summary` | 학교별 요약 + 내 학교 내 순위 |

## 다음 단계 아이디어

- **Riot API 자동 동기화**: 닉네임+태그로 실제 랭크를 조회. 개발자 등록이 필요하며 rate limit을 고려해야 한다.
- **티어 이미지/뱃지**
- **시즌 관리**: `rank_entries.season` 컬럼은 이미 있어 있어, 새 시즌으로 전환하는 코드만 추가하면 된다.
- **학교 관리자**: 학교 대표가 참가 코드를 재발급하거나 멤버를 관리하는 기능
- **전체 학교 순위**: 학교별 최고 점수를 집계한 학교 순위표
