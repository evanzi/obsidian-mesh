import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
	test: { include: ["src/**/*.test.ts"] },
	resolve: {
		alias: {
			obsidian: path.resolve(__dirname, "src/__mocks__/obsidian.ts"),
		},
	},
});
