import { useEffect, useRef } from 'react';

export function usePolling(
  task: () => Promise<void> | void,
  intervalMs: number,
  enabled: boolean,
  resetKey = '',
): void {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    if (!enabled) return;

    let timer: number | undefined;
    let cancelled = false;
    let running = false;

    const tick = async () => {
      if (cancelled || document.hidden || running) return;
      running = true;
      try {
        await taskRef.current();
      } catch {
        // callers surface their own errors
      } finally {
        running = false;
      }
    };

    const start = () => {
      if (timer !== undefined) return;
      void tick();
      timer = window.setInterval(() => void tick(), intervalMs);
    };

    const stop = () => {
      if (timer === undefined) return;
      window.clearInterval(timer);
      timer = undefined;
    };

    const onVisibility = () => {
      if (document.hidden) stop();
      else start();
    };

    if (!document.hidden) start();
    document.addEventListener('visibilitychange', onVisibility);

    return () => {
      cancelled = true;
      stop();
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [enabled, intervalMs, resetKey]);
}
