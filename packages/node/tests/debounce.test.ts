import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { debounce } from '../src/utils/debounce.js';

describe('debounce', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('coalesces bursts and fires once on the trailing edge', () => {
    const fn = vi.fn();
    const d = debounce(fn, 50);
    d('a');
    d('b');
    d('c');
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(50);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith('c');
  });

  it('cancel() suppresses the pending call', () => {
    const fn = vi.fn();
    const d = debounce(fn, 50);
    d(1);
    d.cancel();
    vi.advanceTimersByTime(100);
    expect(fn).not.toHaveBeenCalled();
  });

  it('flush() invokes the pending call synchronously', () => {
    const fn = vi.fn();
    const d = debounce(fn, 50);
    d(42);
    d.flush();
    expect(fn).toHaveBeenCalledWith(42);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
