import { useEffect, useEffectEvent, useRef } from 'react';
import type { FileTreeRowDecoration, GitStatusEntry } from '@pierre/trees';
import { FileTree, useFileTree } from '@pierre/trees/react';
import { Empty } from '../components';
import { useSlashToFind } from './bench';

/** The tree's filter box as a bar, as tall as the bar beside it, so the two rule one line. */
const SEARCH_BAR = `
  [data-file-tree-search-container] {
    box-sizing: border-box;
    height: 41px;
    margin-bottom: 4px;
    padding: 6px 8px;
    border-bottom: 1px solid var(--trees-border-color-override, currentColor);
  }
  [data-file-tree-search-input] {
    box-sizing: border-box;
    height: 28px;
    border-radius: 7px;
  }
`;

/** Past this many files a change set starts folded, so a few hundred untracked logs stay one click away. */
const OPEN_LIMIT = 300;

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
  decorate,
  search = true,
  main = false,
}: {
  paths: string[] | null;
  status: GitStatusEntry[];
  selected: string;
  onPick: (path: string) => void;
  /** Start with every folder open, for short lists like a change set, or the folders of these paths. */
  open?: boolean | string[];
  /** Text at the end of a file's row, such as its line counts. */
  decorate?: (path: string) => FileTreeRowDecoration | null;
  /** A filter box over the tree; worth it past a screenful of files. */
  search?: boolean;
  /** The page's main tree, whose filter "/" jumps to. */
  main?: boolean;
}) {
  const decorations = useRef(decorate);
  const known = useRef<Set<string> | null>(null);
  const pick = useRef(onPick);
  const current = useRef(selected);
  const startOpen = useEffectEvent((paths: string[]) => {
    const shown = Array.isArray(open) ? open : open && paths.length <= OPEN_LIMIT ? paths : [];

    return [...new Set([...shown, selected].flatMap(ancestors))];
  });

  const { model } = useFileTree({
    paths: [],
    flattenEmptyDirectories: true,
    initialExpansion: 'closed',
    search,
    fileTreeSearchMode: 'hide-non-matches',
    density: 'compact',
    unsafeCSS: SEARCH_BAR,
    renderRowDecoration: ({ row }) => (row.kind === 'file' ? (decorations.current?.(row.path) ?? null) : null),
    onSelectionChange: (picked) => {
      const path = picked[0];

      if (path && path !== current.current && known.current?.has(path)) pick.current(path);
    },
  });

  useEffect(() => {
    pick.current = onPick;
    current.current = selected;
    decorations.current = decorate;
  }, [onPick, selected, decorate]);

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

  useSlashToFind(main && search, () => model.openSearch());

  useEffect(() => {
    model.setGitStatus(status);
  }, [model, status]);

  useEffect(() => {
    if (!paths) return;

    const folder = selected !== '' && !known.current?.has(selected);
    const item = !selected
      ? null
      : folder
        ? (model.getItem(`${selected}/`) ?? model.getItem(selected))
        : model.getItem(selected);

    // The URL picks one file: whatever else is still selected would read as a second pick.
    for (const path of model.getSelectedPaths()) {
      if (path !== item?.getPath()) model.getItem(path)?.deselect();
    }

    if (!selected) return;

    for (const dir of [...ancestors(selected), ...(folder ? [selected] : [])]) {
      const parent = model.getItem(dir) ?? model.getItem(`${dir}/`);

      if (parent && 'expand' in parent && !parent.isExpanded()) parent.expand();
    }

    if (item && !item.isSelected()) {
      item.select();
      model.scrollToPath(item.getPath(), { focus: false, offset: 'nearest' });
    }
  }, [model, paths, selected]);

  if (!paths) return <Empty>Reading files…</Empty>;

  if (!paths.length) return <Empty>No files.</Empty>;

  return <FileTree model={model} className="tree" />;
}
