import { defineConfig } from "vitest/config";
import path from "node:path";
import os from "node:os";

export default defineConfig({
  test: {
    environment: "node",
    env: {
      // Isolated per test file — never touches the real dev data.db.
      DATABASE_PATH: ":memory:",
      NODE_ENV: "test",
      DEMO_MODE: "true",
      // Never touches the real dev uploads/ directory.
      UPLOADS_DIR: path.join(os.tmpdir(), "ounda-procure-test-uploads"),
    },
  },
  resolve: {
    alias: {
      "@shared": path.resolve(import.meta.dirname, "shared"),
    },
  },
});
