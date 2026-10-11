import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
    // Pin HOME to a temp dir before any module computes `os.homedir()`-based defaults.
    setupFiles: ["test/setup-isolation.ts"],
  },
});
