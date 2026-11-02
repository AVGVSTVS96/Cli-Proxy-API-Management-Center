import { useEffect, useEffectEvent, useRef } from 'react';
import type { GitStatusEntry } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { Empty } from '../components';

const ancestors = (path: string) => {
  const parts = path.split('/').slice(0, -1);

  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
};

/**
 * A Pierre file tree over a list of paths, with git status marks. A new list patches the tree in
 * place, so a file appearing or going away keeps what's open and selected.
 */
export function PathTree({
  paths,
  status,
  selected,
  onPick,
  open = false,
}: {
  paths: string[] | null;
  status: GitStatusEntry[];
  selected: string;
  onPick: (path: string) => void;
  /** Start with every folder open, for short lists like a change set. */
  open?: boolean;
}) {
  const known = useRef<Set<string> | null>(null);
  const pick = useRef(onPick);
  const startOpen = useEffectEvent((paths: string[]) =>
    open ? [...new Set(paths.flatMap(ancestors))] : ancestors(selected)
  );

  const { model } = useFileTree({
    paths: [],
    flattenEmptyDirectories: true,
    initialExpansion: open ? 'open' : 'closed',
    search: true,
    density: 'compact',
    onSelectionChange: (picked) => {
      const path = picked[0];

      if (path && known.current?.has(path)) pick.current(path);
    },
  });

  useEffect(() => {
    pick.current = onPick;
  }, [onPick]);

  useEffect(() => {
    if (!paths) return;

    const previous = known.current;
    const next = new Set(paths);

    known.current = next;

    if (!previous) return model.resetPaths(paths, { initialExpandedPaths: startOpen(paths) });

    const added = paths.flatMap((path) => (previous.has(path) ? [] : [{ type: 'add' as const, path }]));
    const removed = [...previous].flatMap((path) =>
      next.has(path) ? [] : [{ type: 'remove' as const, path }]
    );

    if (added.length || removed.length) model.batch([...removed, ...added]);
  }, [model, paths]);

  useEffect(() => {
    model.setGitStatus(status);
  }, [model, status]);

  useEffect(() => {
    if (!paths || !selected) return;

    const folder = !known.current?.has(selected);

    for (const dir of [...ancestors(selected), ...(folder ? [selected] : [])]) {
      const item = model.getItem(dir) ?? model.getItem(`${dir}/`);

      if (item && 'expand' in item && !item.isExpanded()) item.expand();
    }

    const item = folder ? (model.getItem(`${selected}/`) ?? model.getItem(selected)) : model.getItem(selected);

    if (item && !item.isSelected()) {
      item.select();
      model.scrollToPath(item.getPath(), { focus: false, offset: 'nearest' });
    }
  }, [model, paths, selected]);

  if (!paths) return <Empty>Reading files…</Empty>;

  if (!paths.length) return <Empty>No files.</Empty>;

  return <FileTree model={model} className="tree" />;
}
