export const CENTER_FIT_ALIGNMENT = Object.freeze({
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
  status: "CENTERED_NOT_MATCHED",
});

export const ALIGNMENT_STAGES = Object.freeze([
  { key: "read", label: "Reading images", progress: 20 },
  { key: "normalize", label: "Normalizing scene", progress: 60 },
  { key: "preview", label: "Preparing preview", progress: 100 },
]);

export function createAlignmentJobRunner({ onProgress, onComplete, onCancel, onError, delay = 70, timeout = 10000 }) {
  let currentId = 0;
  let timer = null;
  let timeoutTimer = null;

  function clearTimers() {
    if (timer) window.clearTimeout(timer);
    if (timeoutTimer) window.clearTimeout(timeoutTimer);
    timer = null;
    timeoutTimer = null;
  }

  function cancel() {
    if (!timer && !currentId) return false;
    currentId += 1;
    clearTimers();
    onCancel?.();
    return true;
  }

  function start() {
    clearTimers();
    currentId += 1;
    const jobId = currentId;
    let index = 0;
    const tick = () => {
      if (jobId !== currentId) return;
      try {
        const stage = ALIGNMENT_STAGES[index];
        onProgress?.({ jobId, ...stage });
        if (index === ALIGNMENT_STAGES.length - 1) {
          clearTimers();
          onComplete?.({ jobId, ...CENTER_FIT_ALIGNMENT });
          return;
        }
        index += 1;
        timer = window.setTimeout(tick, delay);
      } catch (error) {
        clearTimers();
        onError?.(error, jobId);
      }
    };
    timer = window.setTimeout(tick, 0);
    timeoutTimer = window.setTimeout(() => {
      if (jobId !== currentId) return;
      clearTimers();
      onError?.(new Error("Alignment took too long. Try the automatic baseline again."), jobId);
    }, timeout);
    return jobId;
  }

  return { start, cancel, currentId: () => currentId };
}
