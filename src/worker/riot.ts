/**
 * Riot API 연동.
 *
 * Riot ID(gameName#tagLine)로 다음 3단계를 거쳐 솔로 랭크를 조회한다.
 *   1. Account API  : Riot ID -> puuid
 *   2. Summoner API : puuid -> encryptedSummonerId
 *   3. League API   : encryptedSummonerId -> 랭크 엔트리
 *
 * ⚠️ 라우팅 규칙 (Riot 공식 문서 기준) — 헷갈리기 쉬운 부분이다.
 *
 *   Account-V1 은 "대륙" 라우팅을 쓴다: AMERICAS / ASIA / EUROPE (+ SEA)
 *   Summoner/League/Match 는 "플랫폼" 라우팅을 쓴다: kr, na1, euw1 ...
 *
 *   즉 KR 계정 조회도 `kr.api...` 가 아니라 `asia.api...` 로 해야 한다.
 *   `kr.api.riotgames.com` 으로 Account-V1 을 호출하면 403 이 돌아온다.
 *
 *   대륙 라우팅: AMERICAS(NA,BR,LAN,LAS) ASIA(KR,JP) EUROPE(EUNE,EUW,ME1,TR,RU) SEA(OC,SG2,TW2,VN2)
 *
 * 테스트를 위해 RIOT_API_BASE로 베이스 URL을 갈아끼울 수 있게 해두었다.
 * (로컬 테스트에서는 scripts/run-with-mock.mjs 를 사용한다)
 */

/** Account-V1 용 대륙 라우팅 호스트. KR/JP는 ASIA에 속한다. */
export const DEFAULT_RIOT_ACCOUNT_BASE = "https://asia.api.riotgames.com";

/** Summoner/League-V1 등 플랫폼 API 호스트. */
export const DEFAULT_RIOT_PLATFORM_BASE = "https://kr.api.riotgames.com";

/** 기존 호환용 별칭. */
export const DEFAULT_RIOT_API_BASE = DEFAULT_RIOT_PLATFORM_BASE;

/** 조회 대상 큐. 랭킹 게임(5인) 기준. */
const TARGET_QUEUE = "RANKED_SOLO_5x5";

export type RiotTier =
	| "IRON"
	| "BRONZE"
	| "SILVER"
	| "GOLD"
	| "PLATINUM"
	| "EMERALD"
	| "DIAMOND"
	| "MASTER"
	| "GRANDMASTER"
	| "CHALLENGER";

export interface RiotId {
	gameName: string;
	tagLine: string;
}

export interface RiotRank {
	tier: RiotTier;
	division: number | null;
	lp: number;
}

/** "게임이름#태그" 파싱. Riot 태그는 한글/영문/숫자만 허용된다. */
export function parseRiotId(value: string): RiotId | null {
	const trimmed = value.trim();
	const hash = trimmed.indexOf("#");
	if (hash <= 0 || hash === trimmed.length - 1) return null;

	const gameName = trimmed.slice(0, hash).trim();
	const tagLine = trimmed.slice(hash + 1).trim();

	if (!gameName || !tagLine) return null;
	if (gameName.length > 16 || tagLine.length > 5) return null;
	// Riot ID는 공백을 포함할 수 없다.
	if (/\s/.test(gameName) || /\s/.test(tagLine)) return null;
	if (!/^[\p{L}\p{N}._-]+$/u.test(gameName)) return null;
	if (!/^[\p{L}\p{N}]+$/u.test(tagLine)) return null;

	return { gameName, tagLine };
}

export function formatRiotId(id: RiotId): string {
	return `${id.gameName}#${id.tagLine}`;
}

/** Division "I".."IV" -> 1..4. 마스터 이상은 null. */
function parseDivision(value: string | undefined): number | null {
	if (!value) return null;
	const map: Record<string, number> = { I: 1, II: 2, III: 3, IV: 4 };
	return map[value.toUpperCase()] ?? null;
}

/** Hono의 c.json(..., status) 가 받는 HTTP 상태 코드만 허용한다. */
export type RiotErrorStatus = 400 | 401 | 403 | 404 | 429 | 502 | 503;

export class RiotApiError extends Error {
	constructor(
		message: string,
		readonly status: RiotErrorStatus,
	) {
		super(message);
		this.name = "RiotApiError";
	}
}

async function riotFetch<T>(
	path: string,
	apiKey: string,
	baseUrl: string,
): Promise<T> {
	const res = await fetch(`${baseUrl}${path}`, {
		headers: { "X-Riot-Token": apiKey },
	});

	if (res.status === 404) {
		throw new RiotApiError("Riot ID를 찾을 수 없습니다.", 404);
	}
	if (res.status === 401) {
		throw new RiotApiError("Riot API 키가 유효하지 않습니다.", 401);
	}
	if (res.status === 403) {
		// Riot 공식 정의: "An invalid API key was provided" 또는 "A blacklisted API key".
		// 개발 키는 Account-V1(계정 조회)만 허용하고 Summoner/League 같은
		// 플랫폼 API는 403 을 돌려주는 경우가 있다. 이때는 키 갱신이 아니라
		// personal/production key 신청이 필요하다.
		throw new RiotApiError(
			"Riot API 키가 이 엔드포인트에 접근할 수 없습니다. 개발자 포털에서 personal key를 신청하세요.",
			403,
		);
	}
	if (res.status === 429) {
		throw new RiotApiError(
			"Riot API 요청 한도를 초과했습니다. 잠시 후 다시 시도해 주세요.",
			429,
		);
	}
	if (!res.ok) {
		// 그 외 상태코드는 502(상류 오류)로 승격한다.
		throw new RiotApiError(
			`Riot API 요청에 실패했습니다 (HTTP ${res.status}).`,
			502,
		);
	}

	return (await res.json()) as T;
}

interface RiotAccount {
	puuid: string;
}

interface RiotLeagueEntry {
	queueType: string;
	tier?: string;
	/**
	 * 디비전. 새 API 스키마에서는 `rank` 필드로 오고("I","II","III","IV"),
	 * 구버전에서는 `division` 필드로 온다. 둘 다 처리한다.
	 */
	rank?: string;
	division?: string;
	leaguePoints?: number;
}

export interface RiotEndpoints {
	/** Account-V1 (대륙 라우팅). KR/JP는 asia. */
	accountBase: string;
	/** League-V4 (플랫폼 라우팅). KR는 kr. */
	platformBase: string;
}

export const DEFAULT_ENDPOINTS: RiotEndpoints = {
	accountBase: DEFAULT_RIOT_ACCOUNT_BASE,
	platformBase: DEFAULT_RIOT_PLATFORM_BASE,
};

/**
 * Riot ID로 현재 솔로 랭크를 조회한다.
 * 랭크가 없는 계정(unranked)이나 엔트리가 없으면 null을 반환한다.
 *
 * ⚠️ 엔드포인트 선택이 중요하다.
 *   `league/v4/entries/by-summoner/{summonerId}` 는 403 이고,
 *   `league/v4/entries/by-puuid/{puuid}` 는 200 이다.
 *   즉 encryptedSummonerId 를 얻는 Summoner 단계를 아예 건너뛸 수 있다.
 *   (puuid 기반 엔드포인트만 접근 가능한 키가 많다)
 */
export async function fetchSoloRank(
	riotId: RiotId,
	apiKey: string,
	endpoints: RiotEndpoints = DEFAULT_ENDPOINTS,
): Promise<RiotRank | null> {
	// 1단계: Account-V1 (대륙 라우팅) — KR 계정은 asia 호스트를 쓴다.
	const account = await riotFetch<RiotAccount>(
		`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
			riotId.gameName,
		)}/${encodeURIComponent(riotId.tagLine)}`,
		apiKey,
		endpoints.accountBase,
	);

	// 2단계: League-V4 (플랫폼 라우팅) — puuid 로 바로 랭크를 조회한다.
	const entries = await riotFetch<RiotLeagueEntry[]>(
		`/lol/league/v4/entries/by-puuid/${encodeURIComponent(account.puuid)}`,
		apiKey,
		endpoints.platformBase,
	);

	const target = entries.find((e) => e.queueType === TARGET_QUEUE);
	if (!target || !target.tier) return null;

	const tier = target.tier.toUpperCase() as RiotTier;
	// 새 스키마는 `rank`, 구버전은 `division` 에 디비전을 담는다.
	const division = parseDivision(target.rank ?? target.division);
	const lp = target.leaguePoints ?? 0;

	return { tier, division, lp };
}
