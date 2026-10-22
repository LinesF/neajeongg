import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// 로컬에서는 목 Riot API(wrangler.local.json)를 사용할 수 있다.
// CF_LOCAL_CONFIG=1 npm run dev 로 실행하면 해당 설정이 적용된다.
const useLocalConfig = process.env.CF_LOCAL_CONFIG === "1";

const MOCK_RIOT_PORT = process.env.MOCK_RIOT_PORT ?? "8787";

export default defineConfig({
	plugins: [
		react(),
		cloudflare(
			useLocalConfig ? { configPath: "./wrangler.local.json" } : {},
		),
	],
	// workerd는 사설 IP(127.0.0.1, 172.x 등)로의 fetch를 차단한다.
	// 로컬 목 서버는 Vite dev 서버가 대신 중계하도록 프록시를 둔다.
	// Worker는 http://localhost:5173/mock-riot 로 요청하고, Vite가 실제 목 서버로 전달한다.
	server: useLocalConfig
		? {
				host: "127.0.0.1",
				proxy: {
					"/mock-riot": {
						target: `http://127.0.0.1:${MOCK_RIOT_PORT}`,
						changeOrigin: true,
						rewrite: (path) => path.replace(/^\/mock-riot/, ""),
					},
				},
			}
		: undefined,
});
