import { loadEnv } from "vite";
import { defineConfig } from "vitest/config";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode ?? "test", process.cwd(), "");
  return {
    test: {
      testTimeout: 30_000,
      sequence: {
        concurrent: false,
      },
      globals: false,
      exclude: ["dist/**", "node_modules/**", "output/**", "src/skeletons/*/files/**"],
      env,
    },
  };
});
