/**
 * 로컬 전용 wrangler.local.json 생성기.
 *
 * workerd는 사설 IP fetch를 차단하므로, 목 Riot API는 Vite dev 서버의
 * 프록시(/mock-riot)를 통해 접근한다. 이 스크립트는 그 경로를 설정한다.
 *
 *   node scripts/setup-local.mjs
 */
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");

const base = JSON.parse(
	fs.readFileSync(path.join(projectRoot, "wrangler.json"), "utf8"),
);

const MOCK_RIOT_PORT = process.env.MOCK_RIOT_PORT ?? "8787";

// Vite dev 서버가 IPv4로도 떠야 workerd가 127.0.0.1로 접근할 수 있다.
base.vars = {
	RIOT_ACCOUNT_BASE: `http://127.0.0.1:5173/mock-riot`,
	RIOT_PLATFORM_BASE: `http://127.0.0.1:5173/mock-riot`,
};

const outPath = path.join(projectRoot, "wrangler.local.json");
fs.writeFileSync(outPath, JSON.stringify(base, null, 2) + "\n");

const ips = [];
for (const addrs of Object.values(os.networkInterfaces())) {
	for (const a of addrs ?? []) {
		if (a.family === "IPv4" && !a.internal) ips.push(a.address);
	}
}

console.log("wrangler.local.json 생성 완료");
console.log("  RIOT_ACCOUNT_BASE =", base.vars.RIOT_ACCOUNT_BASE);
console.log("  RIOT_PLATFORM_BASE =", base.vars.RIOT_PLATFORM_BASE);
console.log("  (목 서버는 0.0.0.0:" + MOCK_RIOT_PORT + " 에 바인딩)");
if (ips.length) console.log("  호스트 IP:", ips.join(", "));
