/**
 * 리그 오브 레전드 랭크 정규화.
 *
 * 티어별 점수 폭을 100000으로 통일해 정수 하나로 정렬 가능하게 만든다.
 *  - 디비전 티어(IRON~DIAMOND): tierIndex*100000 + (4-div)*10000 + lp*50
 *  - 마스터 이상: tierIndex*100000 + lp  (LP가 1000까지 올라갈 수 있음)
 */
export const TIERS = [
  "IRON",
  "BRONZE",
  "SILVER",
  "GOLD",
  "PLATINUM",
  "EMERALD",
  "DIAMOND",
  "MASTER",
  "GRANDMASTER",
  "CHALLENGER",
] as const;

export type Tier = (typeof TIERS)[number];

/** 마스터 이상은 디비전 개념이 없다. */
export const DIVISION_TIERS: readonly Tier[] = TIERS.slice(0, 7);

export const TIER_LABELS: Record<Tier, string> = {
  IRON: "아이언",
  BRONZE: "브론즈",
  SILVER: "실버",
  GOLD: "골드",
  PLATINUM: "플래티넘",
  EMERALD: "에메랄드",
  DIAMOND: "다이아몬드",
  MASTER: "마스터",
  GRANDMASTER: "그랜드마스터",
  CHALLENGER: "챌린저",
};

export function isTier(value: unknown): value is Tier {
  return typeof value === "string" && (TIERS as readonly string[]).includes(value);
}

export function hasDivision(tier: Tier): boolean {
  return DIVISION_TIERS.includes(tier);
}

export function tierIndex(tier: Tier): number {
  return TIERS.indexOf(tier);
}

/**
 * 랭크를 정렬 가능한 정수 점수로 변환.
 * 동점일 때를 위해 LP를 소수점 단위로 반영한다.
 */
export function computeScore(tier: Tier, division: number | null, lp: number): number {
  const base = tierIndex(tier) * 100_000;
  const safeLp = Math.max(0, Math.min(lp, 9999));

  if (!hasDivision(tier)) {
    return base + safeLp;
  }
  const div = Math.max(1, Math.min(division ?? 4, 4));
  return base + (4 - div) * 10_000 + Math.min(safeLp, 99) * 50;
}

/** 입력값 검증용. 디비전 티어면 1~4, 아니면 null이어야 한다. */
export function normalizeDivision(
  tier: Tier,
  division: unknown,
): number | null | "invalid" {
  if (!hasDivision(tier)) {
    return division === null || division === undefined ? null : "invalid";
  }
  const n = Number(division);
  if (!Number.isInteger(n) || n < 1 || n > 4) return "invalid";
  return n;
}

/**
 * Riot API 응답의 디비전 값을 정규화한다.
 * API는 디비전을 주지 않을 수 있으므로(마스터 이상, 또는 새 스키마에서 누락)
 * "invalid" 로 막지 않고 null(미상)로 취급한다.
 */
export function normalizeApiDivision(
  tier: Tier,
  division: number | null,
): number | null {
  if (!hasDivision(tier)) return null;
  if (division === null) return null;
  return Math.max(1, Math.min(division, 4));
}

export function formatRank(tier: Tier, division: number | null, lp: number): string {
  const label = TIER_LABELS[tier];
  if (!hasDivision(tier)) return `${label} ${lp}LP`;
  return `${label} ${division} ${lp}LP`;
}
