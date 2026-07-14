import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      // Isolated per test file — never touches the real dev data.db.
      DATABASE_PATH: ":memory:",
      NODE_ENV: "test",
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
});
