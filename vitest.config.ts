import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/benchmarks/**"],
    environment: "node",
    pool: "forks",
    reporters: ["default"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
    },
  },
});
