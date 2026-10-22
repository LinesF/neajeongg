/**
 * 목 Riot API 서버 + Vite dev 서버를 함께 실행한다.
 *
 * 별도 프로세스로 띄우면 백그라운드 셸 종료 시 목 서버만 죽는 문제가 있어,
 * 같은 프로세스 트리에서 관리한다.
 *
 *   npm run dev:mock
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { createServer } from "node:http";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const MOCK_PORT = Number(process.env.MOCK_RIOT_PORT ?? 8787);

// 실제 Riot의 puuid는 특수문자가 없는 문자열이다.
// 특수문자를 섞으면 이중 URL 인코딩이 발생하므로 형식을 그대로 흉내낸다.
const PUUIDS = new Map([
	["hidesmite#kr1", "puuid-aaaabbbbccccddddeeeeffff0000111122223333"],
	["goldfish#kr2", "puuid-1111ffff2222eeee3333dddd4444cccc5555aaaa"],
	["mastermind#kr1", "puuid-9999aaaa8888bbbb7777cccc6666dddd5555eeee"],
	["unranked#kr1", "puuid-0000111122223333444455556666777788889999"],
]);

/** Riot ID별 솔로 랭크. undefined division은 마스터 이상(디비전 없음). */
const RANKS = new Map([
	["hidesmite#kr1", { tier: "DIAMOND", division: "II", leaguePoints: 42 }],
	["goldfish#kr2", { tier: "GOLD", division: "III", leaguePoints: 55 }],
	["mastermind#kr1", { tier: "MASTER", division: undefined, leaguePoints: 231 }],
	["unranked#kr1", null],
]);

function send(res, status, body) {
	const payload = JSON.stringify(body);
	res.writeHead(status, {
		"Content-Type": "application/json",
		"Content-Length": Buffer.byteLength(payload),
	});
	res.end(payload);
}

const mockServer = createServer((req, res) => {
	const url = new URL(req.url, "http://localhost");
	const key = req.headers["x-riot-token"];
	console.log(`[mock-riot] ${req.method} ${url.pathname}`);

	if (!key || key === "INVALID") {
		send(res, 401, { status: { message: "Unknown apikey", status_code: 401 } });
		return;
	}

const accountMatch = url.pathname.match(
		/^\/riot\/account\/v1\/accounts\/by-riot-id\/([^/]+)\/([^/]+)$/,
	);
	if (accountMatch) {
		const riotId = `${decodeURIComponent(accountMatch[1])}#${decodeURIComponent(accountMatch[2])}`;
		const puuid = PUUIDS.get(riotId);
		if (!puuid) {
			send(res, 404, { status: { message: "Not found", status_code: 404 } });
			return;
		}
		send(res, 200, {
			puuid,
			gameName: decodeURIComponent(accountMatch[1]),
			tagLine: decodeURIComponent(accountMatch[2]),
		});
		return;
	}

	if (/^\/lol\/summoner\/v4\/summoners\/by-puuid\//.test(url.pathname)) {
		const puuid = decodeURIComponent(url.pathname.split("/").pop() ?? "");
		const riotId = [...PUUIDS].find(([, p]) => p === puuid)?.[0];
		if (!riotId) {
			send(res, 404, { status: { message: "Not found", status_code: 404 } });
			return;
		}
		send(res, 200, {
			encryptedSummonerId: `sum-${puuid}`,
			puuid,
			accountId: "mock-account-id",
			summonerLevel: 300,
			displayName: riotId.split("#")[0],
		});
		return;
	}

	if (/^\/lol\/league\/v4\/entries\/by-summoner\//.test(url.pathname)) {
		const summonerId = decodeURIComponent(url.pathname.split("/").pop() ?? "");
		const puuid = summonerId.replace(/^sum-/, "");
		const riotId = [...PUUIDS].find(([, p]) => p === puuid)?.[0];
		if (!riotId) {
			send(res, 404, { status: { message: "Not found", status_code: 404 } });
			return;
		}
		const rank = RANKS.get(riotId);
		if (!rank) {
			send(res, 200, []);
			return;
		}
		send(res, 200, [
			{
				queueType: "RANKED_SOLO_5x5",
				tier: rank.tier,
				division: rank.division,
				leaguePoints: rank.leaguePoints,
				wins: 100,
				losses: 50,
			},
			{
				queueType: "RANKED_FLEX_5x5",
				tier: "PLATINUM",
				division: "IV",
				leaguePoints: 10,
				wins: 10,
				losses: 20,
			},
		]);
		return;
	}

	send(res, 404, { status: { message: "Not found", status_code: 404 } });
});

// 목 서버는 모든 인터페이스에 바인딩한다.
// workerd는 루프백(127.0.0.1)으로의 fetch를 차단하므로 LAN IP가 필요하다.
mockServer.listen(MOCK_PORT, "0.0.0.0", () => {
	console.log(`[mock-riot] listening on http://0.0.0.0:${MOCK_PORT}`);

	const vite = spawn("npx", ["vite"], {
		cwd: projectRoot,
		stdio: "inherit",
		env: { ...process.env, CF_LOCAL_CONFIG: "1" },
		shell: true,
	});

	const shutdown = () => {
		mockServer.close();
		if (!vite.killed) vite.kill();
		process.exit(0);
	};

	process.on("SIGINT", shutdown);
	process.on("SIGTERM", shutdown);
	vite.on("exit", (code) => {
		mockServer.close();
		process.exit(code ?? 0);
	});
});
