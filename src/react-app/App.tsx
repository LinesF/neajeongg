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

const DIVISION_TIERS: Tier[] = [
	"IRON",
	"BRONZE",
	"SILVER",
	"GOLD",
	"PLATINUM",
	"EMERALD",
	"DIAMOND",
];

type LeaderboardEntry = {
	rank: number;
	userId: number;
	nickname: string;
	schoolId: number;
	schoolName: string;
	tier: Tier;
	tierLabel: string;
	division: number | null;
	lp: number;
	score: number;
	display: string;
	updatedAt: string;
};

type SchoolSummary = {
	id: number;
	name: string;
	memberCount: number;
	rankedCount?: number;
	bestScore?: number | null;
};

type Me = {
	nickname: string;
	schoolId: number;
	schoolName: string;
	ranked: boolean;
	schoolRank: number | null;
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
	const [myUserId, setMyUserId] = useState<number | null>(null);
	const [schools, setSchools] = useState<SchoolSummary[]>([]);
	const [selectedSchool, setSelectedSchool] = useState<number | null>(null);
	const [entries, setEntries] = useState<LeaderboardEntry[]>([]);
	const [loading, setLoading] = useState(true);
	// 랭크 저장 등 데이터 변경 후 순위표를 강제로 다시 불러오기 위한 버전 값.
	const [dataVersion, setDataVersion] = useState(0);

	const loadSession = useCallback(async () => {
		// 학교 목록은 로그인 여부와 무관하므로 항상 먼저 불러온다.
		try {
			const summary = await api<{ schools: SchoolSummary[]; me: Me | null }>(
				"/api/summary",
			);
			setSchools(summary.schools);
			setMe(summary.me);
			setSelectedSchool(summary.me?.schoolId ?? null);
		} catch {
			setSchools([]);
		}

		try {
			const data = await api<{ user: { id: number } }>("/api/me");
			setMyUserId(data.user.id);
		} catch {
			setMyUserId(null);
		}
	}, []);

	const loadLeaderboard = useCallback(async () => {
		setLoading(true);
		try {
			const query = selectedSchool ? `?schoolId=${selectedSchool}` : "";
			const data = await api<{ entries: LeaderboardEntry[] }>(
				`/api/leaderboard${query}`,
			);
			setEntries(data.entries);
		} catch {
			setEntries([]);
		} finally {
			setLoading(false);
		}
	}, [selectedSchool]);

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

	return (
		<div className="shell">
			<header className="top">
				<div className="brand">
					<div className="logo">교</div>
					<div>
						<h1>교내 랭킹</h1>
						<p>학교 단위 리그 오브 레전드 랭크 순위</p>
					</div>
				</div>
				{me ? (
					<div style={{ textAlign: "right" }}>
						<div style={{ fontWeight: 700 }}>{me.nickname}</div>
						<div className="muted">
							{me.schoolName}
							{me.schoolRank ? ` · ${me.schoolRank}위` : ""}
						</div>
					</div>
				) : (
					<button onClick={() => setTab("account")}>로그인 / 가입</button>
				)}
			</header>

			<nav className="tabs">
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
					내 랭크 등록
				</button>
				<button
					className={tab === "account" ? "active" : ""}
					onClick={() => setTab("account")}
				>
					{me ? "계정" : "로그인 / 가입"}
				</button>
			</nav>

			{tab === "leaderboard" && (
				<div className="grid two">
					<div className="card">
						<h2>학교 선택</h2>
						<div className="school-list">
							<button
								className={`school-item ${selectedSchool === null ? "selected" : ""}`}
								onClick={() => setSelectedSchool(null)}
								style={{ width: "100%", textAlign: "left" }}
							>
								<span>전체 학교</span>
								<span className="badge">전체</span>
							</button>
							{schools.length === 0 && (
								<p className="muted">아직 등록된 학교가 없습니다.</p>
							)}
							{schools.map((s) => (
								<button
									key={s.id}
									className={`school-item ${selectedSchool === s.id ? "selected" : ""}`}
									onClick={() => setSelectedSchool(s.id)}
									style={{ width: "100%", textAlign: "left" }}
								>
									<span>{s.name}</span>
									<span className="badge">{s.memberCount}명</span>
								</button>
							))}
						</div>
					</div>

					<div className="card">
						<h2>
							{selectedSchool === null
								? "전체 순위"
								: `${schools.find((s) => s.id === selectedSchool)?.name ?? ""} 순위`}
						</h2>
						{loading ? (
							<p className="empty">불러오는 중…</p>
						) : entries.length === 0 ? (
							<p className="empty">
								아직 랭크를 등록한 학생이 없습니다.
								<br />
								첫 순위를 등록해 보세요.
							</p>
						) : (
							<table>
								<thead>
									<tr>
										<th>순위</th>
										<th>닉네임</th>
										<th>학교</th>
										<th>랭크</th>
									</tr>
								</thead>
								<tbody>
									{entries.map((e) => (
										<tr
											key={e.userId}
											className={e.userId === myUserId ? "me" : ""}
										>
											<td
												className={`rank-num rank-${e.rank <= 3 ? e.rank : "n"}`}
											>
												{e.rank}
											</td>
											<td style={{ fontWeight: 600 }}>{e.nickname}</td>
											<td className="muted">{e.schoolName}</td>
											<td>
												<span
													className={`badge tier-${e.tier}`}
													style={{ marginRight: "0.4rem" }}
												>
													{e.tierLabel}
													</span>
												<span className="muted">
													{e.division ? `${e.division} ` : ""}
													{e.lp}LP
												</span>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						)}
					</div>
				</div>
			)}

			{tab === "rank" && (
				<RankForm
					me={me}
					onSaved={async () => {
						await loadSession();
						setDataVersion((v) => v + 1);
					}}
				/>
			)}

			{tab === "account" &&
				(me ? (
					<AccountPanel me={me} onLogout={loadSession} />
				) : (
					<AuthPanel onDone={loadSession} />
				))}
		</div>
	);
}

function RankForm({
	me,
	onSaved,
}: {
	me: Me | null;
	onSaved: () => Promise<void>;
}) {
	const [tier, setTier] = useState<Tier>("GOLD");
	const [division, setDivision] = useState(3);
	const [lp, setLp] = useState(50);
	const [error, setError] = useState<string | null>(null);
	const [saved, setSaved] = useState(false);
	const [busy, setBusy] = useState(false);

	const needsDivision = DIVISION_TIERS.includes(tier);

	if (!me) {
		return (
			<div className="card">
				<p className="empty">로그인 후 랭크를 등록할 수 있습니다.</p>
			</div>
		);
	}

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		try {
			await api("/api/me/rank", {
				method: "PUT",
				body: JSON.stringify({
					tier,
					division: needsDivision ? division : null,
					lp,
				}),
			});
			setSaved(true);
			await onSaved();
		} catch (err) {
			setError((err as Error).message);
		} finally {
			setBusy(false);
		}
	}

	return (
		<div className="card" style={{ maxWidth: 480 }}>
			<h2>내 랭크 등록</h2>
			<p className="muted" style={{ marginTop: 0 }}>
				{me.schoolName} · 현재 {me.ranked ? `${me.schoolRank}위` : "랭크 미등록"}
			</p>
			{saved && (
				<div className="notice">랭크가 저장되었습니다. 순위표를 확인하세요.</div>
			)}
			{error && <div className="error">{error}</div>}
			<form onSubmit={submit}>
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
					<label htmlFor="lp">LP (리그 포인트)</label>
					<input
						id="lp"
						type="number"
						min={0}
						max={9999}
						value={lp}
						onChange={(e) => setLp(Number(e.target.value))}
					/>
				</div>
				<button className="primary" type="submit" disabled={busy}>
					{busy ? "저장 중…" : "저장"}
				</button>
			</form>
		</div>
	);
}

function AuthPanel({ onDone }: { onDone: () => Promise<void> }) {
	const [mode, setMode] = useState<"login" | "register">("register");
	const [nickname, setNickname] = useState("");
	const [password, setPassword] = useState("");
	const [schoolName, setSchoolName] = useState("");
	const [joinCode, setJoinCode] = useState("");
	const [error, setError] = useState<string | null>(null);
	const [issuedCode, setIssuedCode] = useState<string | null>(null);
	const [busy, setBusy] = useState(false);

	async function submit(e: React.FormEvent) {
		e.preventDefault();
		setBusy(true);
		setError(null);
		setIssuedCode(null);
		try {
			if (mode === "register") {
				const res = await api<{ joinCode: string | null }>("/api/auth/register", {
					method: "POST",
					body: JSON.stringify({
						nickname,
						password,
						schoolName,
						joinCode: joinCode || undefined,
					}),
				});
				if (res.joinCode) {
					setIssuedCode(res.joinCode);
					setJoinCode(res.joinCode);
					setSchoolName("");
					setNickname("");
					setPassword("");
				}
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

			{issuedCode && (
				<div className="notice">
					학교가 만들어졌습니다. 아래 참가 코드를 학생들에게 공유하세요.
					<br />
					<code>{issuedCode}</code>
				</div>
			)}
			{error && <div className="error">{error}</div>}

			<form onSubmit={submit}>
				<div className="field">
					<label htmlFor="nick">닉네임</label>
					<input
						id="nick"
						value={nickname}
						onChange={(e) => setNickname(e.target.value)}
						placeholder="예: 하늘왕"
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
					<>
						<div className="field">
							<label htmlFor="school">학교명</label>
							<input
								id="school"
								value={schoolName}
								onChange={(e) => setSchoolName(e.target.value)}
								placeholder="예: OO고등학교"
							/>
						</div>
						<div className="field">
							<label htmlFor="code">학교 참가 코드 (기존 학교일 때)</label>
							<input
								id="code"
								value={joinCode}
								onChange={(e) => setJoinCode(e.target.value.toUpperCase())}
								placeholder="ABCD-1234"
							/>
						</div>
					</>
				)}
				<button className="primary" type="submit" disabled={busy}>
					{busy ? "처리 중…" : mode === "register" ? "가입하기" : "로그인"}
				</button>
			</form>
		</div>
	);
}

function AccountPanel({
	me,
	onLogout,
}: {
	me: Me;
	onLogout: () => Promise<void>;
}) {
	const [busy, setBusy] = useState(false);

	async function logout() {
		setBusy(true);
		await fetch("/api/auth/logout", { method: "POST" });
		await onLogout();
		setBusy(false);
	}

	return (
		<div className="card" style={{ maxWidth: 460 }}>
			<h2>내 계정</h2>
			<div className="stat">
				<span className="value">{me.nickname}</span>
				<span className="label">닉네임</span>
			</div>
			<div className="stat">
				<span className="value">{me.schoolName}</span>
				<span className="label">소속 학교</span>
			</div>
			<div className="stat">
				<span className="value">
					{me.ranked ? `${me.schoolRank}위` : "-"}
				</span>
				<span className="label">학교 내 순위</span>
			</div>
			<button onClick={logout} disabled={busy}>
				로그아웃
			</button>
		</div>
	);
}
