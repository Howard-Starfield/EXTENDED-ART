import { afterEach, describe, expect, it } from "vitest";
import { ALIGNMENT_STAGES, createAlignmentJobRunner } from "../src/alignment.js";

const timerWindow = {
  setTimeout,
  clearTimeout,
};

afterEach(() => {
  delete globalThis.window;
});

describe("alignment job ownership", () => {
  it("reports the real center-fit stages and completes with a non-match status", async () => {
    globalThis.window = timerWindow;
    const progress = [];
    const result = await new Promise((resolve) => {
      createAlignmentJobRunner({
        delay: 1,
        onProgress: (event) => progress.push(event.label),
        onComplete: resolve,
      }).start();
    });

    expect(progress).toEqual(ALIGNMENT_STAGES.map((stage) => stage.label));
    expect(result.status).toBe("CENTERED_NOT_MATCHED");
  });

  it("cancels a stale job before it can complete", async () => {
    globalThis.window = timerWindow;
    let completed = false;
    let cancelled = false;
    const runner = createAlignmentJobRunner({
      delay: 10,
      onComplete: () => { completed = true; },
      onCancel: () => { cancelled = true; },
    });

    runner.start();
    runner.cancel();
    await new Promise((resolve) => setTimeout(resolve, 30));

    expect(cancelled).toBe(true);
    expect(completed).toBe(false);
  });
});
