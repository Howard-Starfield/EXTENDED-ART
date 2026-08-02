import { afterEach, describe, expect, it, vi } from "vitest";
import { createMatcherJobRunner } from "../src/matcher.js";

class FakeWorker {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
    this.posted = [];
    this.terminate = vi.fn();
  }

  postMessage(message) {
    this.posted.push(message);
  }

  emit(message) {
    this.onmessage?.({ data: message });
  }
}

afterEach(() => vi.restoreAllMocks());

describe("worker matcher ownership", () => {
  it("forwards progress and completes only the active job", () => {
    const worker = new FakeWorker();
    const progress = vi.fn();
    const complete = vi.fn();
    const runner = createMatcherJobRunner({
      workerFactory: () => worker,
      onProgress: progress,
      onComplete: complete,
      slowAt: 10_000,
      timeout: 10_000,
    });
    const jobId = runner.start({ artImage: {}, cardImage: {}, profile: {}, baseline: {} });
    worker.emit({ type: "progress", job_id: jobId, stage: "Matching", progress: 50, profile_version: "test" });
    worker.emit({ type: "complete", job_id: jobId, result: { status: "MATCHED" }, profile_version: "test" });

    expect(progress).toHaveBeenCalledWith(expect.objectContaining({ jobId, label: "Matching", progress: 50 }));
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({ jobId, status: "MATCHED" }));
    expect(worker.terminate).toHaveBeenCalled();
  });

  it("terminates cancelled work and ignores its late result", () => {
    const worker = new FakeWorker();
    const complete = vi.fn();
    const cancelled = vi.fn();
    const runner = createMatcherJobRunner({
      workerFactory: () => worker,
      onComplete: complete,
      onCancel: cancelled,
      slowAt: 10_000,
      timeout: 10_000,
    });
    const jobId = runner.start({ artImage: {}, cardImage: {}, profile: {}, baseline: {} });
    runner.cancel();
    worker.emit({ type: "complete", job_id: jobId, result: { status: "MATCHED" } });

    expect(cancelled).toHaveBeenCalledWith({ jobId });
    expect(complete).not.toHaveBeenCalled();
    expect(runner.activeJobId()).toBe(0);
  });
});
