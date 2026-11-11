import type { StreamEvent } from "../types";

// Progress is advisory. Validated segments and terminal state bypass the timer.
export function createProgressBatch(publish: (event: StreamEvent) => void, delay = 100) {
  let pending: StreamEvent | null = null;
  let timer: ReturnType<typeof setTimeout> | undefined;
  function flush() {
    clearTimeout(timer);
    timer = undefined;
    if (pending) {
      const event = pending;
      pending = null;
      publish(event);
    }
  }
  return {
    push(event: StreamEvent) {
      pending = { ...pending, ...event };
      if (event.type !== "progress") flush();
      else timer ??= setTimeout(flush, delay);
    },
    flush,
    dispose() { clearTimeout(timer); timer = undefined; pending = null; },
  };
}

export function unicodeLength(value: string): number {
  let count = 0;
  for (const _character of value) count++;
  return count;
}
