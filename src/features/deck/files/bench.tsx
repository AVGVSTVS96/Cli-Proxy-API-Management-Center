import { createContext, useContext, useEffect, useEffectEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Below this width the tree slides over the file instead of sitting beside it. */
export const NARROW = 760;

export type Bench = {
  /** The top bar's right end, where the open view puts its controls. */
  slot: HTMLElement | null;
  narrow: boolean;
  treeOpen: boolean;
  setTree: (open: boolean) => void;
};

export const BenchContext = createContext<Bench>({ slot: null, narrow: false, treeOpen: true, setTree: () => {} });

export const useBench = () => useContext(BenchContext);

/** The open view's controls: in the top bar when there's room, otherwise right where they're written. */
export function BarTools({ children }: { children: ReactNode }) {
  const { slot, narrow } = useBench();

  if (narrow) return <div className="bar-tools">{children}</div>;

  return slot ? createPortal(children, slot) : null;
}

/** The tree or list beside the open view; on a narrow screen it slides over it, behind a scrim. */
export function Side({ children }: { children: ReactNode }) {
  const { narrow, treeOpen, setTree } = useBench();

  return (
    <>
      <aside className="bench-side" inert={!treeOpen}>
        {children}
      </aside>
      {narrow && <div className="scrim" aria-hidden onClick={() => setTree(false)} />}
    </>
  );
}

const typing = (target: EventTarget | null) =>
  target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));

/** "/" jumps to the side list's filter, opening the tree first if it's tucked away. */
export function useSlashToFind(enabled: boolean, focus: () => void) {
  const { treeOpen, setTree } = useBench();
  const onKey = useEffectEvent((e: KeyboardEvent) => {
    if (e.key !== '/' || e.metaKey || e.ctrlKey || e.altKey || typing(e.composedPath()[0] ?? e.target)) return;
    e.preventDefault();

    if (!treeOpen) setTree(true);
    requestAnimationFrame(focus);
  });

  useEffect(() => {
    if (!enabled) return;
    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  }, [enabled]);
}
