import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Contract tests talk to a real HydraDB node. Running them in parallel with
    // each other would make the bookmark assertions depend on scheduling, so
    // every file gets one worker and runs its cases in order.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 20_000,
    include: ['tests/**/*.test.ts'],
  },
});
