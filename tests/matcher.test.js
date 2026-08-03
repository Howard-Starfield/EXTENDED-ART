import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createMatcherJobRunner,
  MATCHER_STATUSES,
  MATCHER_STAGES,
  MATCHER_TRANSPORT_VERSION,
} from "../src/matcher.js";

class FakeWorker {
  constructor() {
    this.onmessage = null;
    this.onerror = null;
    this.posted = [];
    this.transfers = [];
    this.terminate = vi.fn();
  }

  postMessage(message, transfer = []) {
    this.posted.push(message);
    this.transfers.push(transfer);
  }

  emit(message) {
    this.onmessage?.({ data: message });
  }

  emitError(message) {
    this.onerror?.({ message });
  }
}

function startInput(overrides = {}) {
  return {
    artImage: {},
    cardImage: {},
    profile: {},
    baseline: {},
    ...overrides,
  };
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("worker matcher ownership", () => {
  it("forwards versioned progress and maps a legacy match to MATCH_APPLIED", () => {
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
    const jobId = runner.start(startInput({ profileVersion: "test-profile" }));

    expect(worker.posted[0]).toMatchObject({
      type: "match",
      job_id: jobId,
      transport_version: MATCHER_TRANSPORT_VERSION,
      profile_version: "test-profile",
    });
    worker.emit({
      type: "progress",
      job_id: jobId,
      stage: `${MATCHER_TRANSPORT_VERSION}:match-coarse`,
      stage_key: "match-coarse",
      stage_version: MATCHER_TRANSPORT_VERSION,
      stage_label: "Matching coarse transforms",
      progress: 50,
      profile_version: "test-profile",
    });
    worker.emit({
      type: "complete",
      job_id: jobId,
      result: { status: "MATCHED", bestScore: 0.9 },
      profile_version: "test-profile",
      stage: MATCHER_STAGES.RESULT,
      stage_version: MATCHER_TRANSPORT_VERSION,
    });

    expect(progress).toHaveBeenCalledWith(expect.objectContaining({
      jobId,
      stage: `${MATCHER_TRANSPORT_VERSION}:match-coarse`,
      stageVersion: MATCHER_TRANSPORT_VERSION,
      label: "Matching coarse transforms",
      progress: 50,
    }));
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      jobId,
      status: MATCHER_STATUSES.APPLIED,
      resultStatus: MATCHER_STATUSES.APPLIED,
      coreStatus: "MATCHED",
      accepted: true,
      profileVersion: "test-profile",
    }));
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(runner.activeJobId()).toBe(0);
  });

  it("maps upgraded uncertainty schemas to MATCH_UNCERTAIN without applying", () => {
    const worker = new FakeWorker();
    const complete = vi.fn();
    const runner = createMatcherJobRunner({
      workerFactory: () => worker,
      onComplete: complete,
      slowAt: 10_000,
      timeout: 10_000,
    });
    const jobId = runner.start(startInput());

    worker.emit({
      type: "complete",
      job_id: jobId,
      result: { result_status: "MATCH_UNCERTAIN", accepted: false, scoreMargin: 0.01 },
      profile_version: "phase2-profiles-2",
    });

    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      jobId,
      status: MATCHER_STATUSES.UNCERTAIN,
      resultStatus: MATCHER_STATUSES.UNCERTAIN,
      accepted: false,
      profileVersion: "phase2-profiles-2",
    }));
  });

  it("maps timeout to TIMED_OUT with stage and reason, then ignores late completion", () => {
    vi.useFakeTimers();
    const worker = new FakeWorker();
    const complete = vi.fn();
    const onError = vi.fn();
    const runner = createMatcherJobRunner({
      workerFactory: () => worker,
      onComplete: complete,
      onError,
      slowAt: 1_000,
      timeout: 250,
    });
    const jobId = runner.start(startInput());

    vi.advanceTimersByTime(250);
    worker.emit({ type: "complete", job_id: jobId, result: { status: "MATCHED" } });

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      status: MATCHER_STATUSES.TIMED_OUT,
      stage: MATCHER_STAGES.TIMEOUT,
      reason: expect.stringContaining("250ms"),
      jobId,
    }), jobId);
    expect(onError.mock.calls[0][0].message).toContain(MATCHER_STAGES.TIMEOUT);
    expect(complete).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(runner.activeJobId()).toBe(0);
  });

  it("maps worker failures to FAILED and preserves stage and reason", () => {
    const worker = new FakeWorker();
    const onError = vi.fn();
    const runner = createMatcherJobRunner({
      workerFactory: () => worker,
      onError,
      slowAt: 10_000,
      timeout: 10_000,
    });
    const jobId = runner.start(startInput());
    worker.emit({
      type: "progress",
      job_id: jobId,
      stage: `${MATCHER_TRANSPORT_VERSION}:prepare-art`,
      stage_version: MATCHER_TRANSPORT_VERSION,
      stage_label: "Preparing artwork pixels",
      progress: 5,
    });
    worker.emitError("bitmap decode failed");

    expect(onError).toHaveBeenCalledWith(expect.objectContaining({
      status: MATCHER_STATUSES.FAILED,
      stage: `${MATCHER_TRANSPORT_VERSION}:prepare-art`,
      reason: "bitmap decode failed",
      jobId,
    }), jobId);
    expect(onError.mock.calls[0][0].message).toContain("bitmap decode failed");
    expect(worker.terminate).toHaveBeenCalledTimes(1);
  });

  it("hard-cancels the disposable worker, signals cooperative cancellation, and ignores late results", () => {
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
    const jobId = runner.start(startInput());
    const cancellationReason = "The artwork was replaced.";

    expect(runner.cancel(cancellationReason)).toBe(true);
    worker.emit({ type: "complete", job_id: jobId, result: { status: "MATCHED" } });

    expect(worker.posted[1]).toMatchObject({
      type: "cancel",
      job_id: jobId,
      reason: cancellationReason,
    });
    expect(cancelled).toHaveBeenCalledWith(expect.objectContaining({
      jobId,
      status: MATCHER_STATUSES.CANCELLED,
      stage: MATCHER_STAGES.CANCELLED,
      reason: cancellationReason,
    }));
    const cancelBuffer = worker.posted[0].cancel_buffer;
    if (cancelBuffer instanceof SharedArrayBuffer) {
      expect(Atomics.load(new Int32Array(cancelBuffer), 0)).toBe(1);
    }
    expect(complete).not.toHaveBeenCalled();
    expect(worker.terminate).toHaveBeenCalledTimes(1);
    expect(runner.activeJobId()).toBe(0);
  });

  it("invalidates a replaced job before its stale worker can win", () => {
    const firstWorker = new FakeWorker();
    const secondWorker = new FakeWorker();
    const workers = [firstWorker, secondWorker];
    const complete = vi.fn();
    const cancelled = vi.fn();
    const runner = createMatcherJobRunner({
      workerFactory: () => workers.shift(),
      onComplete: complete,
      onCancel: cancelled,
      slowAt: 10_000,
      timeout: 10_000,
    });
    const firstJobId = runner.start(startInput());
    const secondJobId = runner.start(startInput());

    firstWorker.emit({ type: "complete", job_id: firstJobId, result: { status: "MATCHED" } });
    secondWorker.emit({
      type: "complete",
      job_id: secondJobId,
      result: { status: "MATCHED" },
    });

    expect(cancelled).toHaveBeenCalledWith(expect.objectContaining({
      jobId: firstJobId,
      status: MATCHER_STATUSES.CANCELLED,
    }));
    expect(complete).toHaveBeenCalledTimes(1);
    expect(complete).toHaveBeenCalledWith(expect.objectContaining({
      jobId: secondJobId,
      status: MATCHER_STATUSES.APPLIED,
    }));
    expect(firstWorker.terminate).toHaveBeenCalledTimes(1);
    expect(secondWorker.terminate).toHaveBeenCalledTimes(1);
  });

  it("transfers typed RGBA buffers while retaining the image payload shape", () => {
    const worker = new FakeWorker();
    const artPixels = new Uint8ClampedArray(2 * 2 * 4);
    const cardPixels = new Uint8ClampedArray(2 * 2 * 4);
    const runner = createMatcherJobRunner({
      workerFactory: () => worker,
      slowAt: 10_000,
      timeout: 10_000,
    });

    runner.start(startInput({
      artImage: { width: 2, height: 2, data: artPixels },
      cardImage: { width: 2, height: 2, pixels: cardPixels },
    }));

    expect(worker.posted[0].art_image.data).toBe(artPixels);
    expect(worker.posted[0].card_image.pixels).toBe(cardPixels);
    expect(worker.transfers[0]).toEqual(expect.arrayContaining([artPixels.buffer, cardPixels.buffer]));
  });
});
