function defaultWorkerFactory() {
  return new Worker(new URL("./matcher-worker.js", import.meta.url), { type: "module" });
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

  function clearActive(job) {
    if (!job) return;
    timerHost.clearTimeout(job.slowTimer);
    timerHost.clearTimeout(job.timeoutTimer);
    job.worker.terminate?.();
    if (active?.jobId === job.jobId) active = null;
  }

  function cancel() {
    if (!active) return false;
    const job = active;
    clearActive(job);
    onCancel?.({ jobId: job.jobId });
    return true;
  }

  function fail(job, error) {
    if (active?.jobId !== job.jobId) return;
    clearActive(job);
    onError?.(error, job.jobId);
  }

  function start({ artImage, cardImage, profile, baseline, profileVersion = "phase2-profiles-1" }) {
    cancel();
    const jobId = ++nextJobId;
    let worker;
    try {
      worker = workerFactory();
    } catch (error) {
      onError?.(error, jobId);
      return jobId;
    }
    const job = {
      jobId,
      worker,
      slowTimer: timerHost.setTimeout(() => {
        if (active?.jobId !== jobId) return;
        onProgress?.({ jobId, label: "Matching is taking longer than usual", progress: 45 });
      }, slowAt),
      timeoutTimer: timerHost.setTimeout(() => {
        fail(job, new Error("Reference matching timed out after 90 seconds. The center-fit baseline is still available."));
      }, timeout),
    };
    active = job;
    worker.onmessage = (event) => {
      const message = event.data || {};
      if (active?.jobId !== jobId || message.job_id !== jobId) return;
      if (message.type === "progress") {
        onProgress?.({
          jobId,
          label: message.stage,
          progress: message.progress,
          completedWork: message.completed_work,
          totalWork: message.total_work,
          profileVersion: message.profile_version,
        });
        return;
      }
      if (message.type === "complete") {
        clearActive(job);
        onComplete?.({ jobId, ...message.result, profileVersion: message.profile_version });
        return;
      }
      if (message.type === "error") {
        fail(job, new Error(message.message));
      }
    };
    worker.onerror = (event) => fail(job, new Error(event.message || "The local matcher worker failed."));
    const transfer = typeof ImageBitmap !== "undefined"
      ? [artImage, cardImage].filter((image) => image instanceof ImageBitmap)
      : [];
    worker.postMessage({
      type: "match",
      job_id: jobId,
      profile,
      profile_version: profileVersion,
      baseline,
      art_image: artImage,
      card_image: cardImage,
    }, transfer);
    return jobId;
  }

  return { start, cancel, activeJobId: () => active?.jobId || 0 };
}
