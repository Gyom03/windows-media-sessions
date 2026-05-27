/**
 * Trailing-edge debounce. We only need the trailing edge because the backend
 * already debounces bursts on its side — this is a second safety net to
 * coalesce snapshots that briefly differ before the dust settles.
 */
export function debounce<Args extends unknown[]>(
  fn: (...args: Args) => void,
  waitMs: number,
): ((...args: Args) => void) & { cancel: () => void; flush: () => void } {
  let timer: NodeJS.Timeout | null = null;
  let lastArgs: Args | null = null;

  const wrapped = (...args: Args): void => {
    lastArgs = args;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      timer = null;
      if (lastArgs) {
        const a = lastArgs;
        lastArgs = null;
        fn(...a);
      }
    }, waitMs);
  };

  wrapped.cancel = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    lastArgs = null;
  };

  wrapped.flush = (): void => {
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }
    if (lastArgs) {
      const a = lastArgs;
      lastArgs = null;
      fn(...a);
    }
  };

  return wrapped;
}
