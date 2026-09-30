import { ChevronDown, ListTree } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type { OutlineItem, OutlineKind } from "@easy-latex/latex";

interface FileOutlineProps {
  filePath?: string | undefined;
  items: OutlineItem[];
  activeLine?: number | undefined;
  height: number;
  onHeightChange(height: number): void;
  onSelect(item: OutlineItem): void;
}

interface OutlineRow {
  item: OutlineItem;
  key: string;
  depth: number;
  hasChildren: boolean;
}

const OUTLINE_LEVEL: Record<OutlineKind, number> = {
  part: 0,
  chapter: 1,
  section: 2,
  subsection: 3,
  subsubsection: 4
};

const MIN_OUTLINE_HEIGHT = 120;

function labelFor(item: OutlineItem): string {
  return item.title || `Untitled ${item.type}`;
}

export function FileOutline({ filePath, items, activeLine, height, onHeightChange, onSelect }: FileOutlineProps) {
  const [open, setOpen] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [selected, setSelected] = useState<string | null>(null);
  const rows = useMemo<OutlineRow[]>(() => {
    const minimumLevel = items.length > 0 ? Math.min(...items.map((item) => OUTLINE_LEVEL[item.type])) : 0;
    const base = items.map((item) => ({
      item,
      key: `${item.file}:${item.offset}:${item.type}`,
      depth: OUTLINE_LEVEL[item.type] - minimumLevel
    }));
    return base.map((row, index) => ({
      ...row,
      hasChildren: (base[index + 1]?.depth ?? -1) > row.depth
    }));
  }, [items]);
  const visibleRows = useMemo(() => {
    const visible: OutlineRow[] = [];
    let hiddenBelowDepth: number | null = null;
    for (const row of rows) {
      if (hiddenBelowDepth !== null && row.depth > hiddenBelowDepth) continue;
      hiddenBelowDepth = null;
      visible.push(row);
      if (row.hasChildren && collapsed.has(row.key)) hiddenBelowDepth = row.depth;
    }
    return visible;
  }, [collapsed, rows]);
  const activeKey = useMemo(() => {
    if (activeLine === undefined) return selected;
    let current: string | null = null;
    for (const row of rows) {
      if (row.item.line > activeLine) break;
      current = row.key;
    }
    return current;
  }, [activeLine, rows, selected]);

  useEffect(() => {
    const keys = new Set(rows.map((row) => row.key));
    setCollapsed((current) => new Set([...current].filter((key) => keys.has(key))));
    setSelected((current) => current && keys.has(current) ? current : null);
  }, [rows]);

  function toggleRow(key: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function beginResize(event: React.PointerEvent<HTMLDivElement>): void {
    event.preventDefault();
    const explorer = event.currentTarget.closest(".project-explorer");
    if (!(explorer instanceof HTMLElement)) return;
    const bottom = explorer.getBoundingClientRect().bottom;
    const maximum = Math.max(MIN_OUTLINE_HEIGHT, explorer.clientHeight - 150);
    const move = (pointerEvent: PointerEvent): void => {
      onHeightChange(Math.max(MIN_OUTLINE_HEIGHT, Math.min(maximum, bottom - pointerEvent.clientY)));
    };
    const finish = (): void => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", finish);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", finish, { once: true });
  }

  const isLatexFile = Boolean(filePath?.toLowerCase().endsWith(".tex"));

  return (
    <section className={`file-outline-panel${open ? "" : " file-outline-collapsed"}`} style={{ flexBasis: open ? `${height}px` : "36px" }} aria-label="File outline">
      {open ? (
        <div
          className="file-outline-resizer"
          role="separator"
          aria-label="Resize file outline"
          aria-orientation="horizontal"
          tabIndex={0}
          onPointerDown={beginResize}
          onKeyDown={(event) => {
            if (event.key === "ArrowUp") onHeightChange(height + 20);
            if (event.key === "ArrowDown") onHeightChange(Math.max(MIN_OUTLINE_HEIGHT, height - 20));
          }}
        />
      ) : null}
      <button className="file-outline-heading" type="button" onClick={() => setOpen((current) => !current)} aria-expanded={open} aria-label="File outline">
        <ChevronDown className={open ? "" : "tree-chevron-collapsed"} aria-hidden="true" />
        <ListTree aria-hidden="true" />
        <span>File outline</span>
        {isLatexFile && items.length > 0 ? <small>{items.length}</small> : null}
      </button>
      {open ? (
        <div className="file-outline-tree" role="tree" aria-label={filePath ? `Outline of ${filePath}` : "File outline entries"}>
          {!filePath ? <p className="outline-empty">Open a LaTeX file to see its outline.</p> : null}
          {filePath && !isLatexFile ? <p className="outline-empty">Outline is available for .tex files.</p> : null}
          {isLatexFile && items.length === 0 ? <p className="outline-empty">No document sections in this file.</p> : null}
          {visibleRows.map((row) => {
            const isCollapsed = collapsed.has(row.key);
            return (
              <div
                key={row.key}
                className={`outline-row${activeKey === row.key ? " outline-row-selected" : ""}`}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-expanded={row.hasChildren ? !isCollapsed : undefined}
                style={{ paddingLeft: `${7 + row.depth * 14}px` }}
              >
                {row.hasChildren ? (
                  <button className="outline-toggle" type="button" onClick={() => toggleRow(row.key)} aria-label={`${isCollapsed ? "Expand" : "Collapse"} ${labelFor(row.item)}`}>
                    <ChevronDown className={isCollapsed ? "tree-chevron-collapsed" : ""} aria-hidden="true" />
                  </button>
                ) : <span className="outline-spacer" />}
                <button className="outline-item" type="button" aria-label={`${labelFor(row.item)}, line ${row.item.line}`} title={`${labelFor(row.item)} · line ${row.item.line}`} onClick={() => {
                  setSelected(row.key);
                  onSelect(row.item);
                }}>
                  <span>{labelFor(row.item)}</span>
                  <small>{row.item.line}</small>
                </button>
              </div>
            );
          })}
        </div>
      ) : null}
    </section>
  );
}
