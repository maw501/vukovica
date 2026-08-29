import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` -> `./*` path mapping in tsconfig.json so tests can
    // import modules the same way application code does.
    alias: {
      '@': rootDir,
    },
  },
  test: {
    include: ['**/__tests__/**/*.test.ts'],
    exclude: ['**/node_modules/**', '**/dist/**'],
    environment: 'node',
    env: {
      // Pinned to a non-UTC zone on purpose. The streak is bucketed by LOCAL
      // calendar day, and under TZ=UTC those tests would pass just as happily
      // against a UTC-bucketing implementation -- the local-day guard would
      // stop being load-bearing. Belgrade (UTC+1/+2) is also where the app's
      // one user is learning Serbian to talk to people.
      TZ: 'Europe/Belgrade',
    },
  },
});
