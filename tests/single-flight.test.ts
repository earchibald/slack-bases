import { describe, expect, it } from 'vitest';

import { SingleFlight } from '../src/slack/single-flight';

describe('SingleFlight', () => {
  it('shares one in-flight operation across concurrent callers', async () => {
    const gate = new SingleFlight<number>();
    let calls = 0;

    const [first, second] = await Promise.all([
      gate.run(async () => {
        calls += 1;
        await new Promise((resolve) => setTimeout(resolve, 10));
        return 42;
      }),
      gate.run(async () => {
        calls += 1;
        return 99;
      }),
    ]);

    expect(first).toBe(42);
    expect(second).toBe(42);
    expect(calls).toBe(1);
  });
});
