import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  // tsconfig has jsx:"preserve" (Next needs it); tell vite's oxc transform to compile JSX for tests.
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    include: ["tests/**/*.test.ts", "tests/**/*.test.tsx"],
    environment: "node",
    globals: false,
  },
  resolve: { alias: { "@": path.resolve(__dirname, ".") } },
});
