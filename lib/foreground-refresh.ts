/**
 * Run `callback` when the page becomes visible again (home-screen / tab resume).
 * Debounced so visibilitychange + focus + pageshow don't triple-fetch.
 */
export function onForeground(
  callback: () => void,
  debounceMs = 500,
): () => void {
  let lastRun = 0;

  const run = () => {
    const now = Date.now();
    if (now - lastRun < debounceMs) return;
    lastRun = now;
    callback();
  };

  const onVisibility = () => {
    if (document.visibilityState === "visible") run();
  };

  document.addEventListener("visibilitychange", onVisibility);
  window.addEventListener("focus", run);
  window.addEventListener("pageshow", run);

  return () => {
    document.removeEventListener("visibilitychange", onVisibility);
    window.removeEventListener("focus", run);
    window.removeEventListener("pageshow", run);
  };
}
