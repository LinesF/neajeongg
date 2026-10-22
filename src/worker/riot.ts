/**
 * Riot API 연동.
 *
 * Riot ID(gameName#tagLine)로 다음 3단계를 거쳐 솔로 랭크를 조회한다.
 *   1. Account API  : Riot ID -> puuid
 *   2. Summoner API : puuid -> encryptedSummonerId
 *   3. League API   : encryptedSummonerId -> 랭크 엔트리
 *
 * region(라우팅 값)과 platform은 보통 같지만 KR은 region="kr", platform="KR"이다.
 *
 * 테스트를 위해 RIOT_API_BASE로 베이스 URL을 갈아끼울 수 있게 해두었다.
 * (로컬 테스트에서는 scripts/mock-riot.mjs 를 사용한다)
 */

export const DEFAULT_RIOT_API_BASE = "https://kr.api.riotgames.com";

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
		// 403은 키가 인식되지만 아직 승인/활성화되지 않은 경우에 발생한다.
		throw new RiotApiError(
			"Riot API 접근이 아직 승인되지 않았습니다. 개발자 포털에서 키 활성화 상태를 확인해 주세요.",
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

interface RiotSummoner {
	encryptedSummonerId: string;
}

interface RiotLeagueEntry {
	queueType: string;
	tier?: string;
	division?: string;
	leaguePoints?: number;
}

/**
 * Riot ID로 현재 솔로 랭크를 조회한다.
 * 랭크가 없는 계정(unranked)이나 엔트리가 없으면 null을 반환한다.
 */
export async function fetchSoloRank(
	riotId: RiotId,
	apiKey: string,
	baseUrl: string = DEFAULT_RIOT_API_BASE,
): Promise<RiotRank | null> {
	const account = await riotFetch<RiotAccount>(
		`/riot/account/v1/accounts/by-riot-id/${encodeURIComponent(
			riotId.gameName,
		)}/${encodeURIComponent(riotId.tagLine)}`,
		apiKey,
		baseUrl,
	);

	const summoner = await riotFetch<RiotSummoner>(
		`/lol/summoner/v4/summoners/by-puuid/${encodeURIComponent(account.puuid)}`,
		apiKey,
		baseUrl,
	);

	const entries = await riotFetch<RiotLeagueEntry[]>(
		`/lol/league/v4/entries/by-summoner/${encodeURIComponent(
			summoner.encryptedSummonerId,
		)}`,
		apiKey,
		baseUrl,
	);

	const target = entries.find((e) => e.queueType === TARGET_QUEUE);
	if (!target || !target.tier) return null;

	const tier = target.tier.toUpperCase() as RiotTier;
	const division = parseDivision(target.division);
	const lp = target.leaguePoints ?? 0;

	return { tier, division, lp };
}
