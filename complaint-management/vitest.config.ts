import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/worker/workflow.ts", "src/worker/security.ts", "src/worker/permissions.ts"],
      thresholds: {
        statements: 75,
        branches: 70,
        functions: 75,
        lines: 75
      }
    }
  }
});
