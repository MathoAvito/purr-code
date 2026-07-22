import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["packages/*/test/**/*.test.ts"],
    environment: "node",
    coverage: {
      provider: "v8",
      include: ["packages/cli/src/**"],
      reporter: ["text-summary", "lcov"],
    },
  },
});
