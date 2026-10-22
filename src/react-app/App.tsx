import { useCallback, useEffect, useState } from "react";

type Tier =
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

const TIERS: { value: Tier; label: string }[] = [
	{ value: "IRON", label: "아이언" },
	{ value: "BRONZE", label: "브론즈" },
	{ value: "SILVER", label: "실버" },
	{ value: "GOLD", label: "골드" },
	{ value: "PLATINUM", label: "플래티넘" },
	{ value: "EMERALD", label: "에메랄드" },
	{ value: "DIAMOND", label: "다이아몬드" },
	{ value: "MASTER", label: "마스터" },
	{ value: "GRANDMASTER", label: "그랜드마스터" },
	{ value: "CHALLENGER", label: "챌린저" },
];

/** 마스터 이상은 디비전 개념이 없다. */
const DIVISION_TIERS: Tier[] = [
	"IRON",
	"BRONZE",
	"SILVER",
	"GOLD",
	"PLATINUM",
	"EMERALD",
	"DIAMOND",
];

const SCHOOL_NAME = "김천고등학교";

type LeaderboardEntry = {
	rank: number;
	userId: number;
	nickname: string;
	tier: Tier;
	tierLabel: string;
	division: number | null;
	lp: number;
	score: number;
	source: string;
	display: string;
	updatedAt: string;
};

type SchoolInfo = {
	id: number;
	name: string;
	memberCount: number;
	rankedCount: number;
	bestScore: number | null;
};

type Me = {
	nickname: string;
	schoolId: number;
	schoolName: string;
	ranked: boolean;
	schoolRank: number | null;
};

type MyUser = {
	id: number;
	nickname: string;
	riotId: string | null;
	schoolId: number;
	schoolName: string;
};

async function api<T>(path: string, init?: RequestInit): Promise<T> {
	const res = await fetch(path, {
		...init,
		headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
	});
	const data = await res.json().catch(() => ({}));
	if (!res.ok) {
		throw new Error((data as { error?: string }).error ?? "요청에 실패했습니다.");
	}
	return data as T;
}

export default function App() {
	const [tab, setTab] = useState<"leaderboard" | "rank" | "account">(
		"leaderboard",
	);
	const [me, setMe] = useState<Me | null>(null);
	const [myUser, setMyUser] = useState<MyUser | null>(null);
	const [myUserId, setMyUserId] = useState<number | null>(null);
	const [school, setSchool] = useState<SchoolInfo | null>(null);
	const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
	const [loading, setLoading] = useState(true);
	// 랭크 저장 등 데이터 변경 후 순위표를 강제로 다시 불러오기 위한 버전 값.
	const [dataVersion, setDataVersion] = useState(0);

	const loadSession = useCallback(async () => {
		// 학교 정보는 로그인 여부와 무관하므로 항상 먼저 불러온다.
		try {
			const summary = await api<{ schools: SchoolInfo[]; me: Me | null }>(
				"/api/summary",
			);
			setSchool(summary.schools[0] ?? null);
			setMe(summary.me);
		} catch {
			setSchool(null);
		}

		try {
			const data = await api<{ user: MyUser }>("/api/me");
			setMyUserId(data.user.id);
			setMyUser(data.user);
		} catch {
			setMyUserId(null);
			setMyUser(null);
		}
	}, []);

	const loadLeaderboard = useCallback(async () => {
		setLoading(true);
		try {
			const data = await api<{ entries: LeaderboardEntry[] }>(
				"/api/leaderboard",
			);
			setEntries(data.entries);
		} catch {
			setEntries([]);
		} finally {
			setLoading(false);
		}
	}, []);

	useEffect(() => {
		void loadSession();
	}, [loadSession]);

	useEffect(() => {
		void loadLeaderboard();
	}, [loadLeaderboard]);

	// 랭크 저장 등 데이터 변경 시 순위표를 강제로 다시 불러온다.
	useEffect(() => {
		if (dataVersion > 0) void loadLeaderboard();
	}, [dataVersion, loadLeaderboard]);

	const onSaved = useCallback(async () => {
		await loadSession();
		setDataVersion((v) => v + 1);
	}, [loadSession]);

	return (
		<>
			<header className="gnb">
				<div className="gnb-inner">
					<a className="brand" href="/">
						<span className="logo">김</span>
						<span>{SCHOOL_NAME} 랭킹</span>
						<span className="sub">LoL Solos</span>
					</a>
					<nav className="gnb-nav">
						<button
							className={tab === "leaderboard" ? "active" : ""}
							onClick={() => setTab("leaderboard")}
						>
							순위표
						</button>
						<button
							className={tab === "rank" ? "active" : ""}
							onClick={() => setTab("rank")}
						>
							내 랭크
						</button>
						<button
							className={tab === "account" ? "active" : ""}
							onClick={() => setTab("account")}
						>
							계정
						</button>
					</nav>
					<div className="gnb-user">
						{me ? (
							<>
								<div className="who">
									<strong>{me.nickname}</strong>
									<span>
										{me.ranked ? `${me.schoolRank}위` : "랭크 미등록"}
									</span>
								</div>
								<button
									className="ghost"
									onClick={async () => {
										await fetch("/api/auth/logout", { method: "POST" });
										await loadSession();
										setTab("account");
									}}
								>
									로그아웃
								</button>
							</>
						) : (
							<button onClick={() => setTab("account")}>로그인 / 가입</button>
						)}
					</div>
				</div>
			</header>

			<main className="shell">
				{tab === "leaderboard" && (
					<>
						<h1 className="page-title">교내 랭킹</h1>
						<p className="page-sub">
							{SCHOOL_NAME} 학생들의 리그 오브 레전드 솔로 랭크 순위
						</p>

						<div className="stat-row">
							<div className="stat">
								<span className="value">{school?.memberCount ?? 0}</span>
								<span className="label">가입 학생</span>
							</div>
							<div className="stat">
								<span className="value">{school?.rankedCount ?? 0}</span>
								<span className="label">랭크 등록</span>
							</div>
							<div className="stat">
								<span className="value">{entries.length}</span>
								<span className="label">현재 순위표</span>
							</div>
							<div className="stat">
								<span className="value">
									{me?.schoolRank ? `${me.schoolRank}위` : "-"}
								</span>
								<span className="label">내 순위</span>
							</div>
						</div>

						<div className="card">
							<h2>전체 순위</h2>
							{loading ? (
								<p className="empty">불러오는 중…</p>
							) : entries.length === 0 ? (
								<p className="empty">
									<strong>아직 랭크를 등록한 학생이 없습니다</strong>
									첫 순위를 등록해 보세요.
								</p>
							) : (
								<RankList
									entries={entries}
									myUserId={myUserId}
									onOpenRank={() => setTab("rank")}
								/>
							)}
						</div>
					</>
				)}

				{tab === "rank" && (
					<>
						<h1 className="page-title">내 랭크</h1>
						<p className="page-sub">
							Riot API로 실제 랭크를 가져오거나 직접 입력할 수 있습니다.
						</p>
						<RankForm me={me} user={myUser} onSaved={onSaved} />
					</>
				)}

				{tab === "account" &&
					(me ? (
						<>
							<h1 className="page-title">계정</h1>
							<p className="page-sub">{me.schoolName}</p>
							<AccountPanel me={me} user={myUser} />
						</>
					) : (
						<>
							<h1 className="page-title">로그인 / 가입</h1>
							<p className="page-sub">
								{SCHOOL_NAME} 학생 계정을 만들거나 로그인하세요.
							</p>
							<AuthPanel onDone={loadSession} />
						</>
					))}
			</main>
		</>
	);
}

function RankList({
	entries,
	myUserId,
	onOpenRank,
}: {
	entries: LeaderboardEntry[];
	myUserId: number | null;
	onOpenRank: () => void;
}) {
	return (
		<div className="rank-list">
			<div className="rank-list__head">
				<span style={{ textAlign: "center" }}>순위</span>
				<span>닉네임</span>
				<span>티어</span>
				<span style={{ textAlign: "right" }}>LP</span>
			</div>
			{entries.map((e) => {
				const isMe = e.userId === myUserId;
				return (
					<div
						key={e.userId}
						className={`rank-list__row${isMe ? " is-me" : ""}`}
					>
						<span
							className={`rk${e.rank <= 3 ? ` rk-${e.rank}` : ""}`}
						>
							{e.rank}
						</span>
						<span className="nick">
							{e.nickname}
							{isMe && <span className="me-tag">ME</span>}
						</span>
						<span>
							<span className={`tier tier-${e.tier}`}>
								{e.tierLabel}
								{e.division && <span className="div">{e.division}</span>}
							</span>
						</span>
						<span className="lp">
							{e.lp}
							<span className="unit"> LP</span>
						</span>
					</div>
				);
			})}
			{myUserId === null && (
				<div style={{ marginTop: 16, textAlign: "center" }}>
					<button className="primary" onClick={onOpenRank}>
						내 랭크 등록하러 가기
					</button>
				</div>
			)}
		</div>
	);
}

function RankForm({
	me,
	user,
	onSaved,
}: {
	me: Me | null;
	user: MyUser | null;
	onSaved: () => Promise<void>;
}) {
	const [tier, setTier] = useState<Tier>("GOLD");
	const [division, setDivision] = useState(3);
	const [lp, setLp] = useState(50);
	const [riotId, setRiotId] = useState(user?.riotId ?? "");
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);
	const [syncing, setSyncing] = useState(false);

	const needsDivision = DIVISION_TIERS.includes(tier);

	// 외부에서 Riot ID가 바뀌면 입력칸을 동기화한다.
	useEffect(() => {
		setRiotId(user?.riotId ?? "");
	}, [user?.riotId]);

	if (!me) {
		return (
			<div className="card">
				<p className="empty">
					<strong>로그인이 필요합니다</strong>
					계정 탭에서 로그인한 뒤 랭크를 등록하세요.
				</p>
			</div>
		);
	}

	async function saveRiotId(): Promise<boolean> {
		const value = riotId.trim();
		if (!value) return true;
		if (value === (user?.riotId ?? "")) return true;
		try {
			await api("/api/me/riot-id", {
				method: "PUT",
				body: JSON.stringify({ riotId: value }),
			});
			return true;
		} catch (err) {
			setError((err as Error).message);
			return false;
		}
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		setSaved(null);
		try {
			await api("/api/me/rank", {
				method: "PUT",
				body: JSON.stringify({
					tier,
					division: needsDivision ? division : null,
					lp,
				}),
			});
			setSaved("랭크가 저장되었습니다.");
			await onSaved();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}

	/** Riot API로 실제 랭크를 조회해 순위를 갱신한다. */
	async function syncFromRiot() {
		setSyncing(true);
		setError(null);
		setSaved(null);
		try {
			if (!(await saveRiotId())) return;
			const res = await api<{ rank: { display: string } }>(
				"/api/me/rank/sync",
				{ method: "POST" },
			);
			setSaved(`Riot API에서 랭크를 가져왔습니다: ${res.rank.display}`);
			await onSaved();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setSyncing(false);
		}
	}

	return (
		<div className="card" style={{ maxWidth: 560 }}>
			<h2>Riot API로 랭크 가져오기</h2>
			<div className="field">
				<label htmlFor="riot">Riot ID</label>
				<input
					id="riot"
					value={riotId}
					onChange={(e) => setRiotId(e.target.value)}
					placeholder="게임이름#태그"
				/>
				<p className="hint">
					리그 오브 레전드 닉네임#태그를 입력하면 실제 랭크를 자동으로
					조회합니다.
				</p>
			</div>
			<button
				type="button"
				className="primary"
				onClick={syncFromRiot}
				disabled={syncing || !riotId.trim()}
				style={{ width: "100%", marginBottom: 24 }}
			>
				{syncing ? "조회 중…" : "랭크 가져오기"}
			</button>

			<h3>직접 입력</h3>
			{saved && <div className="notice">{saved}</div>}
			{error && <div className="error">{error}</div>}
			<form onSubmit={submit}>
				<div className="row">
					<div className="field">
						<label htmlFor="tier">티어</label>
						<select
							id="tier"
							value={tier}
							onChange={(e) => setTier(e.target.value as Tier)}
						>
							{TIERS.map((t) => (
								<option key={t.value} value={t.value}>
									{t.label}
								</option>
							))}
						</select>
					</div>
					{needsDivision && (
						<div className="field">
							<label htmlFor="div">디비전</label>
							<select
								id="div"
								value={division}
								onChange={(e) => setDivision(Number(e.target.value))}
							>
								{[1, 2, 3, 4].map((d) => (
									<option key={d} value={d}>
										{d}디비전
									</option>
								))}
							</select>
						</div>
					)}
					<div className="field">
						<label htmlFor="lp">LP</label>
						<input
							id="lp"
							type="number"
							min={0}
							max={9999}
							value={lp}
							onChange={(e) => setLp(Number(e.target.value))}
						/>
					</div>
				</div>
				<button className="primary" type="submit" disabled={busy}>
					{busy ? "저장 중…" : "랭크 저장"}
				</button>
			</form>
		</div>
	);
}

function AuthPanel({ onDone }: { onDone: () => Promise<void> }) {
	const [mode, setMode] = useState<"login" | "register">("register");
	const [nickname, setNickname] = useState("");
	const [password, setPassword] = useState("");
	const [riotId, setRiotId] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			if (mode === "register") {
				await api("/api/auth/register", {
					method: "POST",
					body: JSON.stringify({
						nickname,
						password,
						riotId: riotId || undefined,
					}),
				});
			} else {
				await api("/api/auth/login", {
					method: "POST",
					body: JSON.stringify({ nickname, password }),
				});
			}
			await onDone();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="card" style={{ maxWidth: 460 }}>
			<div className="tabs">
				<button
					className={mode === "register" ? "active" : ""}
					onClick={() => setMode("register")}
				>
					가입
				</button>
				<button
					className={mode === "login" ? "active" : ""}
					onClick={() => setMode("login")}
				>
					로그인
				</button>
			</div>

			{error && <div className="error">{error}</div>}

			<form onSubmit={submit}>
				<div className="field">
					<label htmlFor="nick">닉네임</label>
					<input
						id="nick"
						value={nickname}
						onChange={(e) => setNickname(e.target.value)}
						placeholder="닉네임"
						autoComplete="username"
					/>
				</div>
				<div className="field">
					<label htmlFor="pw">비밀번호</label>
					<input
						id="pw"
						type="password"
						value={password}
						onChange={(e) => setPassword(e.target.value)}
						placeholder="6자 이상"
						autoComplete={
							mode === "register" ? "new-password" : "current-password"
						}
					/>
				</div>
				{mode === "register" && (
					<div className="field">
						<label htmlFor="regriot">Riot ID (선택)</label>
						<input
							id="regriot"
							value={riotId}
							onChange={(e) => setRiotId(e.target.value)}
							placeholder="게임이름#태그"
						/>
						<p className="hint">
							입력하면 실제 랭크를 자동으로 조회할 수 있습니다.
						</p>
					</div>
				)}
				<button className="primary" type="submit" disabled={busy}>
					{busy ? "처리 중…" : mode === "register" ? "가입하기" : "로그인"}
				</button>
			</form>
		</div>
	);
}

function AccountPanel({ me, user }: { me: Me; user: MyUser | null }) {
	return (
		<div className="card" style={{ maxWidth: 460 }}>
			<div className="stat-row">
				<div className="stat">
					<span className="value">{me.nickname}</span>
					<span className="label">닉네임</span>
				</div>
				<div className="stat">
					<span className="value">
						{me.ranked ? `${me.schoolRank}위` : "-"}
					</span>
					<span className="label">학교 내 순위</span>
				</div>
			</div>
			<div className="field">
				<label>소속 학교</label>
				<p style={{ margin: 0 }}>{me.schoolName}</p>
			</div>
			<div className="field">
				<label>Riot ID</label>
				<p style={{ margin: 0 }}>{user?.riotId ?? "등록되지 않음"}</p>
			</div>
		</div>
	);
}
