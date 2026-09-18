import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["apps/api/test/**/*.test.ts", "packages/domain/test/**/*.test.ts"],
    environment: "node",
    testTimeout: 20_000,
  },
});
