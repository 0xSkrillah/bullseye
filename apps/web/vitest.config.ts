import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  // anchored here so `vitest run -c apps/web/vitest.config.ts` from the repo root finds the same tests
  root: fileURLToPath(new URL(".", import.meta.url)),
  plugins: [react()],
  test: {
    environment: "jsdom",
    include: ["test/**/*.test.{ts,tsx}", "src/__tests__/**/*.test.{ts,tsx}"],
    css: false,
  },
});
