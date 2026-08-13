import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // Contract tests talk to a real HydraDB node. Running them in parallel with
    // each other would make the bookmark assertions depend on scheduling, so
    // every file gets one worker and runs its cases in order.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 20_000,
    // The contract suite's setup and teardown delete their fixture one vertex at
    // a time over HTTP. Against an empty graph that is quick; against a graph
    // already holding the demo corpus it runs past the ten second default and
    // the suite fails for a reason that has nothing to do with the code.
    hookTimeout: 60_000,
    include: ['tests/**/*.test.ts'],
  },
});
