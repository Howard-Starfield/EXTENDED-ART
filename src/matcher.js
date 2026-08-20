export const MATCHER_TRANSPORT_VERSION = "alignment-worker-v4";

export const MATCHER_STATUSES = Object.freeze({
  APPLIED: "MATCH_APPLIED",
  UNCERTAIN: "MATCH_UNCERTAIN",
  TIMED_OUT: "TIMED_OUT",
  FAILED: "FAILED",
  CANCELLED: "CANCELLED",
});

export const MATCHER_STAGES = Object.freeze({
  START: `${MATCHER_TRANSPORT_VERSION}:start`,
  DISPATCH: `${MATCHER_TRANSPORT_VERSION}:dispatch`,
  PREPARE_ART: `${MATCHER_TRANSPORT_VERSION}:prepare-art`,
  PREPARE_CARD: `${MATCHER_TRANSPORT_VERSION}:prepare-card`,
  FEATURES: `${MATCHER_TRANSPORT_VERSION}:features`,
  FEATURE_MATCH: `${MATCHER_TRANSPORT_VERSION}:feature-match`,
  FEATURE_RANSAC: `${MATCHER_TRANSPORT_VERSION}:feature-ransac`,
  FEATURE_COVERAGE: `${MATCHER_TRANSPORT_VERSION}:feature-coverage`,
  MATCH: `${MATCHER_TRANSPORT_VERSION}:match`,
  RESULT: `${MATCHER_TRANSPORT_VERSION}:result`,
  SLOW: `${MATCHER_TRANSPORT_VERSION}:slow`,
  TIMEOUT: `${MATCHER_TRANSPORT_VERSION}:timeout`,
  CANCELLED: `${MATCHER_TRANSPORT_VERSION}:cancelled`,
  ERROR: `${MATCHER_TRANSPORT_VERSION}:error`,
});

const DEFAULT_PROFILE_VERSION = "phase2-profiles-2";
const TERMINAL_RESULT_STATUSES = new Set(Object.values(MATCHER_STATUSES));

function defaultWorkerFactory() {
  return new Worker(new URL("./matcher-worker.js", import.meta.url), { type: "module" });
}

function normalizedStatus(value) {
  if (typeof value !== "string") return null;
  return value.trim().toUpperCase().replace(/[\s-]+/g, "_");
}

function transportStatusForResult(result, message = {}) {
  const explicitStatus = [
    result?.resultStatus,
    result?.result_status,
    result?.transportStatus,
    result?.transport_status,
    message.resultStatus,
    message.result_status,
    message.transportStatus,
    message.transport_status,
    result?.status,
    message.status,
  ].map(normalizedStatus).find(Boolean);

  if (explicitStatus === MATCHER_STATUSES.APPLIED || explicitStatus === "MATCHED") {
    return MATCHER_STATUSES.APPLIED;
  }
  if ([MATCHER_STATUSES.UNCERTAIN, "NO_RELIABLE_MATCH", "UNCERTAIN"].includes(explicitStatus)) {
    return MATCHER_STATUSES.UNCERTAIN;
  }
  if (TERMINAL_RESULT_STATUSES.has(explicitStatus)) return explicitStatus;
  if (result?.accepted === true || result?.applied === true || result?.autoApplied === true) {
    return MATCHER_STATUSES.APPLIED;
  }
  if (result?.accepted === false || result?.uncertain === true) return MATCHER_STATUSES.UNCERTAIN;
  return null;
}

function withTransportMetadata(error, {
  status = MATCHER_STATUSES.FAILED,
  stage = MATCHER_STAGES.ERROR,
  reason = "The local matcher failed without a reason.",
  jobId = 0,
  cause,
  lastStage,
} = {}) {
  const transportError = error instanceof Error ? error : new Error(String(error || reason));
  const originalMessage = transportError.message;
  transportError.name = "MatcherTransportError";
  transportError.status = status;
  transportError.stage = stage;
  transportError.reason = reason;
  transportError.jobId = jobId;
  if (lastStage) transportError.lastStage = lastStage;
  if (cause && cause !== transportError) transportError.cause = cause;
  transportError.originalMessage = originalMessage;
  transportError.message = `${status} [${stage}]: ${reason}`;
  return transportError;
}

function isTransferableArrayBuffer(value) {
  if (typeof ArrayBuffer === "undefined" || !(value instanceof ArrayBuffer)) return false;
  return value.byteLength >= 0;
}

function addTransferable(value, transfer, seen) {
  if (!value) return;
  if (typeof ImageBitmap !== "undefined" && value instanceof ImageBitmap) {
    if (!seen.has(value)) {
      seen.add(value);
      transfer.push(value);
    }
    return;
  }
  if (isTransferableArrayBuffer(value)) {
    if (!seen.has(value)) {
      seen.add(value);
      transfer.push(value);
    }
    return;
  }
  if (ArrayBuffer.isView?.(value)) {
    addTransferable(value.buffer, transfer, seen);
    return;
  }
  if (typeof value !== "object") return;
  for (const key of ["data", "pixels", "pixelData", "pixel_data", "pixelBuffer", "pixel_buffer"]) {
    addTransferable(value[key], transfer, seen);
  }
}

function transferablesForImages(images) {
  const transfer = [];
  const seen = new Set();
  for (const image of images) addTransferable(image, transfer, seen);
  return transfer;
}

function createCancellationBuffer() {
  if (typeof SharedArrayBuffer === "undefined" || typeof Int32Array === "undefined") return null;
  if (typeof crossOriginIsolated !== "undefined" && !crossOriginIsolated) return null;
  try {
    return new SharedArrayBuffer(Int32Array.BYTES_PER_ELEMENT);
  } catch {
    return null;
  }
}

function requestCancellation(job) {
  if (!job.cancelView) return;
  try {
    Atomics.store(job.cancelView, 0, 1);
  } catch {
    // Termination below is the hard cancellation fallback.
  }
}

function clearTimer(timerHost, timer) {
  if (timer !== null && timer !== undefined) timerHost.clearTimeout(timer);
}

export function createMatcherJobRunner({
  workerFactory = defaultWorkerFactory,
  onProgress,
  onComplete,
  onCancel,
  onError,
  slowAt = 30_000,
  timeout = 90_000,
} = {}) {
  let nextJobId = 0;
  let active = null;
  const timerHost = typeof window !== "undefined" ? window : globalThis;

  function isActive(job) {
    return active === job && !job.settled;
  }

  function terminateWorker(job) {
    if (!job?.worker) return;
    job.worker.onmessage = null;
    job.worker.onerror = null;
    try {
      job.worker.terminate?.();
    } catch {
      // A worker that is already terminating is still considered stopped.
    }
  }

  function retire(job) {
    if (!job || job.settled) return;
    clearTimer(timerHost, job.slowTimer);
    clearTimer(timerHost, job.timeoutTimer);
    job.slowTimer = null;
    job.timeoutTimer = null;
    job.settled = true;
    if (active === job) active = null;
    job.worker.onmessage = null;
    job.worker.onerror = null;
  }

  function deactivate(job) {
    retire(job);
    terminateWorker(job);
  }

  function emitError(job, details = {}) {
    if (!isActive(job)) return false;
    const requestedStatus = normalizedStatus(details.status);
    const status = requestedStatus === MATCHER_STATUSES.TIMED_OUT
      ? MATCHER_STATUSES.TIMED_OUT
      : requestedStatus === MATCHER_STATUSES.CANCELLED
        ? MATCHER_STATUSES.CANCELLED
        : MATCHER_STATUSES.FAILED;
    const stage = details.stage || job.stage || MATCHER_STAGES.ERROR;
    const reason = details.reason || details.message || "The local matcher could not process these images.";
    const error = withTransportMetadata(details.error, {
      status,
      stage,
      reason,
      jobId: job.jobId,
      cause: details.error,
      lastStage: details.lastStage || job.stage,
    });
    deactivate(job);
    onError?.(error, job.jobId);
    return true;
  }

  function emitCancellation(job, reason = "Cancellation requested by caller.") {
    if (!isActive(job)) return false;
    requestCancellation(job);
    job.cancelRequested = true;
    const cancellationMessage = {
      type: "cancel",
      job_id: job.jobId,
      transport_version: MATCHER_TRANSPORT_VERSION,
      profile_version: job.profileVersion,
      stage: MATCHER_STAGES.CANCELLED,
      stage_version: MATCHER_TRANSPORT_VERSION,
      reason,
    };
    // Invalidate the runner synchronously, then give a yielding worker a
    // cooperative cancellation signal before the hard stop.
    retire(job);
    try {
      job.worker.postMessage(cancellationMessage);
    } catch {
      // The worker may have already exited; the caller still receives CANCELLED.
    }
    terminateWorker(job);
    onCancel?.({
      jobId: job.jobId,
      status: MATCHER_STATUSES.CANCELLED,
      stage: MATCHER_STAGES.CANCELLED,
      stageVersion: MATCHER_TRANSPORT_VERSION,
      reason,
    });
    return true;
  }

  function cancel(reason) {
    return active ? emitCancellation(active, reason) : false;
  }

  function emitProgress(job, message) {
    if (!isActive(job)) return;
    job.stage = message.stage || job.stage || MATCHER_STAGES.MATCH;
    job.stageVersion = message.stage_version || MATCHER_TRANSPORT_VERSION;
    const progress = Number.isFinite(message.progress)
      ? Math.max(0, Math.min(100, message.progress))
      : 0;
    onProgress?.({
      jobId: job.jobId,
      stage: job.stage,
      stageKey: message.stage_key,
      stageVersion: job.stageVersion,
      label: message.stage_label || message.stage || "Matching images",
      progress,
      completedWork: message.completed_work,
      totalWork: message.total_work,
      profileVersion: message.profile_version || job.profileVersion,
      detail: message.detail,
    });
  }

  function complete(job, message) {
    if (!isActive(job)) return;
    const result = message.result && typeof message.result === "object"
      ? message.result
      : (message.status || message.result_status ? message : null);
    const status = transportStatusForResult(result, message);
    if (!result || !status) {
      emitError(job, {
        status: MATCHER_STATUSES.FAILED,
        stage: message.stage || MATCHER_STAGES.RESULT,
        reason: "The matcher returned no recognized result status.",
      });
      return;
    }
    if (status === MATCHER_STATUSES.CANCELLED) {
      emitCancellation(job, message.reason || "The matcher cancelled this job.");
      return;
    }
    if (status === MATCHER_STATUSES.TIMED_OUT || status === MATCHER_STATUSES.FAILED) {
      emitError(job, {
        status,
        stage: message.stage || MATCHER_STAGES.RESULT,
        reason: message.reason || result.reason || result.message || `The matcher returned ${status}.`,
      });
      return;
    }
    const profileVersion = message.profile_version || result.profileVersion || job.profileVersion;
    const normalizedResult = {
      ...result,
      jobId: job.jobId,
      status,
      resultStatus: status,
      accepted: typeof result.accepted === "boolean" ? result.accepted : status === MATCHER_STATUSES.APPLIED,
      profileVersion,
      stage: message.stage || MATCHER_STAGES.RESULT,
      stageVersion: message.stage_version || MATCHER_TRANSPORT_VERSION,
    };
    if (result.status && result.status !== status) normalizedResult.coreStatus = result.status;
    deactivate(job);
    onComplete?.(normalizedResult);
  }

  function handleMessage(job, event) {
    if (!isActive(job)) return;
    const message = event?.data || {};
    if (message.job_id !== job.jobId) return;
    try {
      if (message.type === "progress") {
        emitProgress(job, message);
        return;
      }
      if (message.type === "complete" || message.type === "result") {
        complete(job, message);
        return;
      }
      if (message.type === "cancelled") {
        emitCancellation(job, message.reason || "The matcher cancelled this job.");
        return;
      }
      if (message.type === "error") {
        emitError(job, {
          error: new Error(message.message || message.reason || "The local matcher worker failed."),
          status: message.status || MATCHER_STATUSES.FAILED,
          stage: message.stage || job.stage || MATCHER_STAGES.ERROR,
          reason: message.reason || message.message || "The local matcher worker failed.",
          lastStage: message.last_stage,
        });
      }
    } catch (error) {
      emitError(job, {
        error,
        status: MATCHER_STATUSES.FAILED,
        stage: MATCHER_STAGES.ERROR,
        reason: "The matcher transport could not handle a worker message.",
      });
    }
  }

  function start({
    artImage,
    cardImage,
    profile,
    baseline,
    profileVersion = DEFAULT_PROFILE_VERSION,
  } = {}) {
    cancel("A newer matcher job replaced this one.");
    const jobId = ++nextJobId;
    let worker;
    try {
      worker = workerFactory();
      if (!worker || typeof worker.postMessage !== "function") {
        throw new Error("The matcher worker factory did not return a usable Worker.");
      }
    } catch (error) {
      const transportError = withTransportMetadata(error, {
        status: MATCHER_STATUSES.FAILED,
        stage: MATCHER_STAGES.START,
        reason: error?.message || "The matcher worker could not be created.",
        jobId,
        cause: error,
      });
      onError?.(transportError, jobId);
      return jobId;
    }

    const cancelBuffer = createCancellationBuffer();
    const job = {
      jobId,
      worker,
      profileVersion,
      stage: MATCHER_STAGES.START,
      stageVersion: MATCHER_TRANSPORT_VERSION,
      slowTimer: null,
      timeoutTimer: null,
      cancelBuffer,
      cancelView: cancelBuffer ? new Int32Array(cancelBuffer) : null,
      cancelRequested: false,
      settled: false,
    };
    active = job;
    worker.onmessage = (event) => handleMessage(job, event);
    worker.onerror = (event) => {
      emitError(job, {
        error: new Error(event?.message || "The local matcher worker failed."),
        status: MATCHER_STATUSES.FAILED,
        stage: job.stage || MATCHER_STAGES.ERROR,
        reason: event?.message || "The local matcher worker failed.",
      });
    };
    job.slowTimer = timerHost.setTimeout(() => {
      if (!isActive(job)) return;
      job.stage = MATCHER_STAGES.SLOW;
      onProgress?.({
        jobId,
        stage: MATCHER_STAGES.SLOW,
        stageKey: "slow",
        stageVersion: MATCHER_TRANSPORT_VERSION,
        label: "Matching is taking longer than usual",
        progress: 45,
        profileVersion,
        reason: "The worker has not completed within the expected slow-progress window.",
      });
    }, slowAt);
    job.timeoutTimer = timerHost.setTimeout(() => {
      if (!isActive(job)) return;
      requestCancellation(job);
      try {
        worker.postMessage({
          type: "cancel",
          job_id: job.jobId,
          transport_version: MATCHER_TRANSPORT_VERSION,
          profile_version: job.profileVersion,
          stage: MATCHER_STAGES.TIMEOUT,
          stage_version: MATCHER_TRANSPORT_VERSION,
          reason: "The timeout limit was reached.",
        });
      } catch {
        // Termination below is the hard timeout fallback.
      }
      emitError(job, {
        status: MATCHER_STATUSES.TIMED_OUT,
        stage: MATCHER_STAGES.TIMEOUT,
        reason: `The matcher worker exceeded the ${timeout}ms limit while in ${job.stage}. The center-fit baseline is still available.`,
        lastStage: job.stage,
      });
    }, timeout);

    const payload = {
      type: "match",
      job_id: jobId,
      transport_version: MATCHER_TRANSPORT_VERSION,
      profile,
      profile_version: profileVersion,
      baseline,
      cancel_buffer: cancelBuffer,
      art_image: artImage,
      card_image: cardImage,
    };
    try {
      worker.postMessage(payload, transferablesForImages([artImage, cardImage]));
    } catch (error) {
      emitError(job, {
        error,
        status: MATCHER_STATUSES.FAILED,
        stage: MATCHER_STAGES.DISPATCH,
        reason: error?.message || "The matcher input could not be transferred to the worker.",
      });
    }
    return jobId;
  }

  return { start, cancel, activeJobId: () => active?.jobId || 0 };
}
