import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.js'],
    testTimeout: 30_000,
    // Cache.test.js + get-agent.test.js используют общий proxies.json (relative to proxy-manager.js).
    // Параллельный запуск создаёт race condition. Файлы маленькие, последовательный режим стоит ~200ms.
    fileParallelism: false,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['server.js', 'proxy-manager.js', 'trends-client.js'],
      exclude: ['tests/**', 'node_modules/**'],
    },
  },
});
