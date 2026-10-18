import { describe, expect, it } from "vitest";

import { createThrottle } from "./throttle";

describe("createThrottle", () => {
  it("lets the first call pass and spaces the following ones", async () => {
    let now = 1000;
    const slept: number[] = [];
    const wait = createThrottle(
      700,
      () => now,
      async (ms) => {
        slept.push(ms);
        now += ms;
      },
    );
    await wait();
    await wait();
    await wait();
    expect(slept).toEqual([700, 700]);
  });

  it("does not sleep when enough time has passed", async () => {
    let now = 0;
    const slept: number[] = [];
    const wait = createThrottle(
      500,
      () => now,
      async (ms) => void slept.push(ms),
    );
    await wait();
    now = 2000;
    await wait();
    expect(slept).toEqual([]);
  });

  it("gives concurrent callers consecutive slots", async () => {
    const slept: number[] = [];
    const wait = createThrottle(
      100,
      () => 0,
      async (ms) => void slept.push(ms),
    );
    await Promise.all([wait(), wait(), wait()]);
    expect(slept.sort((a, b) => a - b)).toEqual([100, 200]);
  });

  it("is off with an interval of 0", async () => {
    const slept: number[] = [];
    const wait = createThrottle(
      0,
      () => 0,
      async (ms) => void slept.push(ms),
    );
    await wait();
    await wait();
    expect(slept).toEqual([]);
  });
});
