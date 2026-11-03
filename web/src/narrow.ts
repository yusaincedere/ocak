// Below this width the call stacks: chat sits under the people instead of over them, and the
// secondary controls move into a menu. Matches the breakpoint in styles.css.
import { useSyncExternalStore } from 'react';

const NARROW = '(max-width: 860px)';

const subscribe = (onChange: () => void) => {
  const query = window.matchMedia(NARROW);
  query.addEventListener('change', onChange);
  return () => query.removeEventListener('change', onChange);
};

export const useNarrow = () => useSyncExternalStore(subscribe, () => window.matchMedia(NARROW).matches);
