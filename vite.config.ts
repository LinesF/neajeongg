import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { cloudflare } from "@cloudflare/vite-plugin";

// 로컬에서는 목 Riot API(wrangler.local.json)를 사용할 수 있다.
// CF_LOCAL_CONFIG=1 npm run dev 로 실행하면 해당 설정이 적용된다.
const useLocalConfig = process.env.CF_LOCAL_CONFIG === "1";

export default defineConfig({
	plugins: [
		react(),
		cloudflare(
			useLocalConfig ? { configPath: "./wrangler.local.json" } : {},
		),
	],
});
