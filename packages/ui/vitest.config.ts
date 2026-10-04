import { defineConfig } from "vitest/config";

// Тесты — по одному файлу за раз: ноутбук владельца не грузим.
export default defineConfig({
  test: {
    include: ["tests/**/*.test.{ts,tsx}"],
    environment: "node",
    fileParallelism: false,
    maxWorkers: 1,
  },
});
