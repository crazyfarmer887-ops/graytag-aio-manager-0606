import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwind from "@tailwindcss/vite";
import path from "path";
import runableAnalyticsPlugin from "./vite/plugins/runable-analytics-plugin";

export default defineConfig({
	plugins: [react(), runableAnalyticsPlugin(), tailwind()],
	base: "/dashboard/",
	build: {
		outDir: "dist/client",
		emptyOutDir: true,
	},
	resolve: {
		alias: {
			"@": path.resolve(__dirname, "./src/web"),
		},
	},
	server: {
		allowedHosts: true,
	}
});
