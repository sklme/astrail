import { defineConfig } from "vitest/config"

export default defineConfig({
  test: {
    coverage: { reporter: ["text", "json", "html"] },
    include: ["packages/**/*.test.ts"],
    testTimeout: 15_000,
  },
})
