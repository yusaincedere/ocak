// Who you're talking to in private during this call. Kept apart from the React side so the rules
// can be tested: one conversation per person (by device, so it survives them reconnecting), and
// only one is expanded at a time so the stack above the chat stays small.

export interface Thread {
  device: string;
  name: string;
  /** closed conversations keep their messages for the rest of the call */
  open: boolean;
  collapsed: boolean;
  unread: number;
  draft: string;
  sending: boolean;
  failed: boolean;
}

export type Threads = Record<string, Thread>;

const blank = (device: string, name: string): Thread => ({
  device,
  name,
  open: false,
  collapsed: true,
  unread: 0,
  draft: '',
  sending: false,
  failed: false,
});

function collapseOthers(threads: Threads, device: string): Threads {
  return Object.fromEntries(
    Object.entries(threads).map(([key, thread]) => [key, key === device ? thread : { ...thread, collapsed: true }]),
  );
}

/** You chose this person: their conversation comes up, ready to type in. */
export function showThread(threads: Threads, device: string, name: string): Threads {
  const thread = threads[device] ?? blank(device, name);
  return { ...collapseOthers(threads, device), [device]: { ...thread, name, open: true, collapsed: false, unread: 0 } };
}

/** They wrote to you: it shows up as a bar with a count rather than opening over your game. */
export function receiveInThread(threads: Threads, device: string, name: string): Threads {
  const thread = threads[device] ?? blank(device, name);
  const reading = thread.open && !thread.collapsed;
  return {
    ...threads,
    [device]: reading
      ? { ...thread, name }
      : { ...thread, name, open: true, collapsed: true, unread: thread.unread + 1 },
  };
}

export function toggleThread(threads: Threads, device: string): Threads {
  const thread = threads[device];
  if (!thread) return threads;
  return thread.collapsed ? showThread(threads, device, thread.name) : { ...threads, [device]: { ...thread, collapsed: true } };
}

export function closeThread(threads: Threads, device: string): Threads {
  const thread = threads[device];
  return thread ? { ...threads, [device]: { ...thread, open: false, collapsed: true, unread: 0 } } : threads;
}

export function patchThread(threads: Threads, device: string, patch: (thread: Thread) => Partial<Thread>): Threads {
  const thread = threads[device];
  return thread ? { ...threads, [device]: { ...thread, ...patch(thread) } } : threads;
}
