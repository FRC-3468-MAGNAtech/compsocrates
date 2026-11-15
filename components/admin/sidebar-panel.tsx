"use client";

import { useMemo, useState, type CSSProperties } from "react";
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragMoveEvent,
  type DragOverEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
} from "@dnd-kit/core";
import { SortableContext, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Folder, FolderPlus, GripVertical, Pencil, RefreshCw, RotateCcw, Trash2 } from "lucide-react";
import { PROGRAMS, PROGRAM_IDS, isUnavailableInProgram } from "@/config/programs";
import type { ProgramId } from "@/config/programs/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GlassSkeletonCard } from "@/components/ui/glass-skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { describeFirestoreError, reportFirestoreError } from "@/lib/firestore-errors";
import type { NavItem } from "@/lib/nav";
import { useProgram } from "@/lib/program/context";
import { FOOTER_DIVIDER_ID, flattenRows, projectDrop } from "@/lib/sidebar/dnd";
import {
  canHide,
  createGroup,
  deleteGroup,
  isItemCustomized,
  moveEntry,
  moveTargets,
  moveTo,
  rename,
  resetAll,
  resetItem,
  sameLayout,
  saveBlocker,
  setHidden,
  setIcon,
  toConfig,
  workingCopy,
} from "@/lib/sidebar/edit";
import { SIDEBAR_ICON_KEYS, SIDEBAR_ICONS, isSidebarIconKey } from "@/lib/sidebar/icons";
import { pageById, pageLabel } from "@/lib/sidebar/layout";
import { resolveSidebar, type SidebarNode } from "@/lib/sidebar/resolve";
import { SidebarConflictError, SidebarSyncError, pullSidebarLayout, pushSidebarLayout, saveSidebarConfig, useSidebarConfig } from "@/lib/sidebar/store";
import { FOOTER_ZONE, MAX_LABEL_LENGTH, type SidebarEntry } from "@/lib/sidebar/types";
import { cn } from "@/lib/utils";

/**
 * Session F: Admin Panel > Sidebar. An admin arranges the pages the code defines (order, groups, labels, icons, hidden) for their team and program.
 * Visibility here is cosmetic: it never grants or blocks access to a page (page access and the route guard decide that).
 *
 * The builder is drag and drop (@dnd-kit): the sidebar is shown as one list, the way it looks, and a row is dragged by its handle: up and down to reorder,
 * sideways to put a page inside the group above it or take it out (`lib/sidebar/dnd.ts` turns the drag into a place). The same drag works by touch and by
 * keyboard (handle, Space, arrow keys, Space), and "Location" in the edit dialog is a plain way to move a page without dragging.
 */

const DEFAULT_ICON = "__default";
const KEEP_PLACE = "__keep";
/** One level of indentation, in pixels: the width the row is drawn indented by and the sideways drag that asks for one level. */
const INDENT_WIDTH = 32;
const iconButton = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--glass-border)] text-[var(--foreground)] transition-colors hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-35 pointer-coarse:h-11 pointer-coarse:w-11";

/** Arrow keys move the picked-up row up and down the list (dnd-kit); Left and Right ask for one level out or in. */
const builderKeyboardCoordinates: KeyboardCoordinateGetter = (event, args) => {
  if (event.code === "ArrowRight" || event.code === "ArrowLeft") {
    event.preventDefault();
    const { x, y } = args.currentCoordinates;
    return { x: x + (event.code === "ArrowRight" ? INDENT_WIDTH : -INDENT_WIDTH), y };
  }
  return sortableKeyboardCoordinates(event, args);
};

// --- the editor: pure over the entry list ----------------------------------------------------------------------------------------

type EditorProps = {
  entries: SidebarEntry[];
  onChange: (next: SidebarEntry[]) => void;
  labelOf: (item: NavItem) => string;
  program: ProgramId;
  disabled?: boolean;
};

/** `level` is the sideways drag in whole indentation steps (rounded), so the state, and the re-render, only change when the wanted level does. */
type DragState = { activeId: string; overId: string; level: number };

type RowProps = {
  entry: SidebarEntry;
  /** Where the row really is: 1 for a page inside a group. Drawn with a margin, which must NOT change while the row is dragged (dnd-kit treats a layout shift as movement). */
  depth: 0 | 1;
  /** While this row is dragged: the level it would land at (0 or 1), else null. Drawn with a transform, which dnd-kit ignores, plus a hint. */
  dropDepth: 0 | 1 | null;
  /** While this row is dragged: where it would land, in words. */
  dropHint: string | null;
  name: string;
  defaultName: string | null;
  program: ProgramId;
  customized: boolean;
  disabled: boolean;
  onEdit: () => void;
  onReset: () => void;
  onDelete: () => void;
  onHidden: (hidden: boolean) => void;
  childCount: number;
};

function EntryRow({ entry: e, depth, dropDepth, dropHint, name, defaultName, program, customized, disabled, onEdit, onReset, onDelete, onHidden, childCount }: RowProps) {
  const { setNodeRef, setActivatorNodeRef, attributes, listeners, transform, transition, isDragging } = useSortable({ id: e.id, disabled });
  const page = e.kind === "page" ? pageById(e.id) : null;
  const Icon = isSidebarIconKey(e.icon) ? SIDEBAR_ICONS[e.icon] : (page?.icon ?? Folder);
  const hideable = canHide(e.id);
  // Only the vertical movement follows the pointer; the sideways one chooses the level, shown by sliding the row one level (a transform, never a margin).
  const slide = dropDepth === null ? 0 : (dropDepth - depth) * INDENT_WIDTH;
  const style: CSSProperties = { transform: CSS.Transform.toString({ x: slide, y: transform?.y ?? 0, scaleX: 1, scaleY: 1 }), transition: slide === 0 ? transition : undefined, marginLeft: depth * INDENT_WIDTH };
  return (
    <li
      ref={setNodeRef}
      style={style}
      data-entry={e.id}
      data-depth={depth}
      data-drop-depth={dropDepth ?? undefined}
      className={cn("flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--glass-border)] bg-white/4 p-2 sm:flex-nowrap", e.kind === "group" && "bg-white/8", isDragging && "relative z-10 opacity-85 shadow-lg ring-2 ring-white/40")}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        {...attributes}
        {...listeners}
        disabled={disabled}
        aria-label={`Drag ${name}`}
        title="Drag to move"
        className={cn(iconButton, "cursor-grab touch-none border-transparent active:cursor-grabbing")}
      >
        <GripVertical className="h-4 w-4" aria-hidden />
      </button>
      <Icon className="h-[18px] w-[18px] shrink-0 text-[var(--muted-foreground)]" aria-hidden />
      <div className="min-w-0 flex-1 basis-32">
        <div className={cn("truncate text-sm", e.kind === "group" ? "font-semibold" : "font-medium", e.hidden && "text-[var(--muted-foreground)] line-through decoration-1")}>{name}</div>
        <div className="flex flex-wrap gap-x-2 text-[11px] text-[var(--muted-foreground)]">
          {dropHint && <span className="font-medium text-[var(--foreground)]">{dropHint}</span>}
          {e.kind === "group" && <span>{childCount === 0 ? "Empty group: drag a page under it, then right" : `Group of ${childCount}`}</span>}
          {e.hidden && <span>Hidden from the sidebar</span>}
          {page && isUnavailableInProgram(program, page.href) && <span>Greyed out: not in this program yet</span>}
          {e.label && defaultName && <span>Renamed (was {defaultName})</span>}
        </div>
      </div>
      <div className="flex items-center gap-1.5">
        <button type="button" className={iconButton} aria-label={`Rename, change the icon or move ${name}`} title="Rename, icon, location" disabled={disabled} onClick={onEdit}>
          <Pencil className="h-4 w-4" aria-hidden />
        </button>
        {e.kind === "page" && (
          <button type="button" className={iconButton} aria-label={`Reset ${name} to its default`} title="Reset this item" disabled={disabled || !customized} onClick={onReset}>
            <RotateCcw className="h-4 w-4" aria-hidden />
          </button>
        )}
        {e.kind === "group" && (
          <button type="button" className={iconButton} aria-label={`Delete the group ${name}`} title="Delete the group (its pages stay)" disabled={disabled} onClick={onDelete}>
            <Trash2 className="h-4 w-4" aria-hidden />
          </button>
        )}
        <label className="ml-1 inline-flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
          <Switch checked={!e.hidden} disabled={disabled || !hideable} onCheckedChange={(shown) => onHidden(!shown)} aria-label={e.kind === "group" ? `Show the group ${name} in the sidebar` : `Show ${name} in the sidebar`} />
          <span className="w-[4.75rem]">{hideable ? (e.hidden ? "Hidden" : "Shown") : "Always shown"}</span>
        </label>
      </div>
    </li>
  );
}

/** The line between the main list and the bottom block: not draggable, but a place to drop on. */
function DividerRow() {
  const { setNodeRef, transform, transition } = useSortable({ id: FOOTER_DIVIDER_ID, disabled: { draggable: true, droppable: false } });
  return (
    <li ref={setNodeRef} style={{ transform: CSS.Transform.toString(transform ? { ...transform, x: 0, scaleX: 1, scaleY: 1 } : null), transition }} data-divider className="flex items-center gap-3 py-1.5">
      <span className="h-px flex-1 bg-[var(--glass-border)]" />
      <span className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Bottom block (pages below this line)</span>
      <span className="h-px flex-1 bg-[var(--glass-border)]" />
    </li>
  );
}

export function SidebarEditor({ entries, onChange, labelOf, program, disabled = false }: EditorProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState("");
  const [drag, setDrag] = useState<DragState | null>(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 4 } }), useSensor(KeyboardSensor, { coordinateGetter: builderKeyboardCoordinates }));

  const entryName = (e: SidebarEntry): string => e.label ?? (e.kind === "page" ? labelOf(pageById(e.id) as NavItem) : "Group");
  const nameOfId = (id: string): string => {
    if (id === FOOTER_DIVIDER_ID) return "the start of the bottom block";
    const e = entries.find((x) => x.id === id);
    return e ? entryName(e) : "item";
  };
  const editingEntry = editing ? entries.find((e) => e.id === editing) : undefined;
  const deletingEntry = deleting ? entries.find((e) => e.id === deleting) : undefined;

  const active = drag ? entries.find((e) => e.id === drag.activeId) : undefined;
  const rows = useMemo(() => flattenRows(entries, active?.kind === "group" ? active.id : null), [entries, active]);
  const projection = useMemo(() => (drag ? projectDrop({ entries, activeId: drag.activeId, overId: drag.overId, offsetX: drag.level * INDENT_WIDTH, indentWidth: INDENT_WIDTH }) : null), [entries, drag]);
  const hintFor = (parent: string | null): string => (parent === null ? "Will land: main list" : parent === FOOTER_ZONE ? "Will land: bottom block" : `Will land: inside ${nameOfId(parent)}`);
  const childCountOf = (id: string) => entries.filter((x) => x.parent === id).length;

  const addGroup = () => {
    const { entries: next, id } = createGroup(entries, newGroup);
    if (id) {
      onChange(next);
      setNewGroup("");
    }
  };

  const onDragStart = (ev: DragStartEvent) => setDrag({ activeId: String(ev.active.id), overId: String(ev.active.id), level: 0 });
  const onDragMove = (ev: DragMoveEvent) => {
    const level = Math.round(ev.delta.x / INDENT_WIDTH);
    setDrag((d) => (d && d.level !== level ? { ...d, level } : d));
  };
  const onDragOver = (ev: DragOverEvent) => {
    const over = ev.over ? String(ev.over.id) : null;
    if (over) setDrag((d) => (d && d.overId !== over ? { ...d, overId: over } : d));
  };
  const onDragEnd = (ev: DragEndEvent) => {
    const activeId = String(ev.active.id);
    const landed = projectDrop({ entries, activeId, overId: ev.over ? String(ev.over.id) : (drag?.overId ?? activeId), offsetX: ev.delta.x, indentWidth: INDENT_WIDTH });
    setDrag(null);
    if (!landed) return;
    const next = moveEntry(entries, activeId, landed.parent, landed.index);
    if (!sameLayout(next, entries)) onChange(next);
  };

  const announcements: Announcements = {
    onDragStart: ({ active: a }) => `Picked up ${nameOfId(String(a.id))}. Arrow up and down move it, left and right put it inside or outside a group, space drops it, escape cancels.`,
    onDragOver: ({ active: a, over }) => (over ? `${nameOfId(String(a.id))} is over ${nameOfId(String(over.id))}.` : undefined),
    onDragEnd: ({ active: a }) => `Dropped ${nameOfId(String(a.id))}.`,
    onDragCancel: ({ active: a }) => `Moving ${nameOfId(String(a.id))} was cancelled.`,
  };

  return (
    <div className="flex flex-col gap-5" data-testid="sidebar-editor">
      <form
        className="flex flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(ev) => {
          ev.preventDefault();
          addGroup();
        }}
      >
        <label className="flex flex-1 flex-col gap-1 text-xs text-[var(--muted-foreground)]">
          New group
          <Input value={newGroup} maxLength={MAX_LABEL_LENGTH} placeholder="Group name, for example Strategy" disabled={disabled} onChange={(ev) => setNewGroup(ev.target.value)} />
        </label>
        <Button type="submit" variant="glass" disabled={disabled || newGroup.trim() === ""}>
          <FolderPlus className="h-4 w-4" aria-hidden /> Create group
        </Button>
      </form>

      <p className="text-xs text-[var(--muted-foreground)]">
        Drag a row by its handle. Up and down reorder it. Drag it right to put a page inside the group above it, or left to take it out. Drag a group to move it with its pages. On a keyboard: Tab to a handle, Space to pick up, arrow keys to move, Space to drop.
      </p>

      <section aria-label="Sidebar order" className="flex flex-col gap-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Main list</h4>
        <DndContext
          id="sidebar-builder"
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragStart={onDragStart}
          onDragMove={onDragMove}
          onDragOver={onDragOver}
          onDragEnd={onDragEnd}
          onDragCancel={() => setDrag(null)}
          accessibility={{ announcements, screenReaderInstructions: { draggable: "To move this item, press space, use the arrow keys, and press space again to drop it. Left and right arrows put it outside or inside a group." } }}
        >
          <SortableContext items={rows.map((r) => r.id)} strategy={verticalListSortingStrategy} disabled={disabled}>
            <ul className="flex flex-col gap-2">
              {rows.map((r) => {
                if (r.kind === "divider") return <DividerRow key={r.id} />;
                const e = entries.find((x) => x.id === r.id);
                if (!e) return null;
                const page = e.kind === "page" ? pageById(e.id) : null;
                return (
                  <EntryRow
                    key={e.id}
                    entry={e}
                    depth={r.depth}
                    dropDepth={drag?.activeId === e.id && projection ? projection.depth : null}
                    dropHint={drag?.activeId === e.id && projection ? hintFor(projection.parent) : null}
                    name={entryName(e)}
                    defaultName={page ? labelOf(page) : null}
                    program={program}
                    customized={isItemCustomized(entries, e.id)}
                    disabled={disabled}
                    childCount={e.kind === "group" ? childCountOf(e.id) : 0}
                    onEdit={() => setEditing(e.id)}
                    onReset={() => onChange(resetItem(entries, e.id))}
                    onDelete={() => setDeleting(e.id)}
                    onHidden={(hidden) => onChange(setHidden(entries, e.id, hidden))}
                  />
                );
              })}
            </ul>
          </SortableContext>
        </DndContext>
      </section>

      <EditDialog
        key={editing ?? "none"}
        entry={editingEntry}
        name={editingEntry ? entryName(editingEntry) : ""}
        defaultLabel={editingEntry && editingEntry.kind === "page" ? labelOf(pageById(editingEntry.id) as NavItem) : ""}
        targets={editingEntry ? moveTargets(entries, editingEntry.id).filter((t) => (t.value === "@main" ? editingEntry.parent !== null : t.value !== editingEntry.parent)) : []}
        onClose={() => setEditing(null)}
        onApply={(label, icon, place) => {
          if (editingEntry) {
            const named = setIcon(rename(entries, editingEntry.id, label), editingEntry.id, icon);
            onChange(place ? moveTo(named, editingEntry.id, place) : named);
          }
          setEditing(null);
        }}
      />

      <Dialog open={!!deletingEntry} onOpenChange={(open) => !open && setDeleting(null)}>
        <DialogContent className="glass-overlay w-[min(94vw,440px)]">
          <DialogTitle>Delete the group {deletingEntry ? `"${entryName(deletingEntry)}"` : ""}?</DialogTitle>
          <DialogDescription>Its pages stay in the sidebar, in the place the group was. Nothing is saved until you press Save.</DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setDeleting(null)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                if (deletingEntry) onChange(deleteGroup(entries, deletingEntry.id));
                setDeleting(null);
              }}
            >
              Delete group
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EditDialog({
  entry,
  name,
  defaultLabel,
  targets,
  onClose,
  onApply,
}: {
  entry: SidebarEntry | undefined;
  name: string;
  defaultLabel: string;
  targets: { value: string; label: string }[];
  onClose: () => void;
  onApply: (label: string, icon: string | undefined, place: string | null) => void;
}) {
  const [label, setLabel] = useState(entry?.label ?? "");
  const [icon, setIconKey] = useState<string>(entry?.icon ?? DEFAULT_ICON);
  const [place, setPlace] = useState<string>(KEEP_PLACE);
  const isGroup = entry?.kind === "group";
  return (
    <Dialog open={!!entry} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="glass-overlay w-[min(94vw,440px)]">
        <DialogTitle>Edit {name}</DialogTitle>
        <DialogDescription>{isGroup ? "Name the group and pick its icon." : "Leave the name empty to use the default. Only the sidebar text changes, never the page."}</DialogDescription>
        <div className="mt-4 flex flex-col gap-3">
          <label className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
            Name
            <Input value={label} maxLength={MAX_LABEL_LENGTH} placeholder={isGroup ? "Group name" : defaultLabel} onChange={(ev) => setLabel(ev.target.value)} />
          </label>
          <div className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
            <span id="sidebar-icon-label">Icon</span>
            <Select value={icon} onValueChange={setIconKey}>
              <SelectTrigger aria-labelledby="sidebar-icon-label">
                <SelectValue>{icon === DEFAULT_ICON ? "Default icon" : icon}</SelectValue>
              </SelectTrigger>
              <SelectContent>
                {!isGroup && <SelectItem value={DEFAULT_ICON}>Default icon</SelectItem>}
                {SIDEBAR_ICON_KEYS.map((key) => {
                  const Glyph = SIDEBAR_ICONS[key];
                  return (
                    <SelectItem key={key} value={key}>
                      <span className="inline-flex items-center gap-2">
                        <Glyph className="h-4 w-4" aria-hidden /> {key}
                      </span>
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
          </div>
          {targets.length > 0 && (
            <div className="flex flex-col gap-1 text-xs text-[var(--muted-foreground)]">
              <span id="sidebar-place-label">Location (or just drag it)</span>
              <Select value={place} onValueChange={setPlace}>
                <SelectTrigger aria-labelledby="sidebar-place-label">
                  <SelectValue>{place === KEEP_PLACE ? "Keep where it is" : (targets.find((t) => t.value === place)?.label ?? "Keep where it is")}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={KEEP_PLACE}>Keep where it is</SelectItem>
                  {targets.map((t) => (
                    <SelectItem key={t.value} value={t.value}>
                      {t.label} (at the end)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onApply(label, icon === DEFAULT_ICON ? undefined : icon, place === KEEP_PLACE ? null : place)} disabled={isGroup && label.trim() === "" && !entry?.label}>
            Apply
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// --- the preview: the same resolver the sidebar uses ----------------------------------------------------------------------------

function PreviewNode({ node, child = false }: { node: SidebarNode; child?: boolean }) {
  const Icon = node.icon;
  return (
    <li>
      <div className={cn("flex items-center gap-2.5 rounded-xl px-2.5 py-1.5 text-sm", child && "ml-5", node.kind === "group" ? "font-medium text-[var(--foreground)]" : "text-[var(--muted-foreground)]", node.unavailable && "opacity-45")}>
        <Icon className="h-4 w-4 shrink-0" aria-hidden />
        <span className="truncate">{node.label}</span>
      </div>
      {node.children && (
        <ul>
          {node.children.map((c) => (
            <PreviewNode key={c.id} node={c} child />
          ))}
        </ul>
      )}
    </li>
  );
}

export function SidebarPreview({ entries, program, labelOf }: { entries: SidebarEntry[]; program: ProgramId; labelOf: (item: NavItem) => string }) {
  const resolved = useMemo(() => resolveSidebar({ program, isAdmin: true, can: null, config: toConfig(entries, 0), labelOf }), [entries, program, labelOf]);
  return (
    <nav aria-label="Sidebar preview" className="glass-card flex flex-col gap-1 p-3" data-testid="sidebar-preview">
      <ul className="flex flex-col gap-0.5">
        {resolved.main.map((n) => (
          <PreviewNode key={n.id} node={n} />
        ))}
      </ul>
      {resolved.footer.length > 0 && <div className="my-1.5 h-px bg-[var(--glass-border)]" />}
      <ul className="flex flex-col gap-0.5">
        {resolved.footer.map((n) => (
          <PreviewNode key={n.id} node={n} />
        ))}
      </ul>
      {resolved.ignoredConfig && <p className="mt-2 text-xs text-amber-200">This layout would lock an admin out, so the sidebar would ignore it and show the default.</p>}
    </nav>
  );
}

// --- sync with the other program ------------------------------------------------------------------------------------------------

export type SidebarSync = {
  /** The other program's short name, for the buttons. */
  otherName: string;
  busy: boolean;
  message: { ok: boolean; text: string } | null;
  /** Copy the saved layout of this program to the other. */
  onSend: () => void;
  /** Load the other program's layout here as unsaved changes. */
  onPull: () => void;
};

function SyncCard({ sync, dirty, conflict, saving }: { sync: SidebarSync; dirty: boolean; conflict: boolean; saving: boolean }) {
  const [confirm, setConfirm] = useState<"send" | "pull" | null>(null);
  const locked = sync.busy || saving;
  return (
    <div className="glass-card flex flex-col gap-3 p-4 text-sm" data-testid="sidebar-sync">
      <div className="flex flex-col gap-1">
        <h3 className="flex items-center gap-2 text-base font-semibold">
          <RefreshCw className="h-4 w-4" aria-hidden /> Sync with {sync.otherName}
        </h3>
        <p className="text-[var(--muted-foreground)]">
          {sync.otherName} keeps its own sidebar layout. Copy this one across so both match, or bring {sync.otherName}&apos;s layout here.
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="glass" disabled={locked || dirty || conflict} onClick={() => setConfirm("send")}>
          Send this layout to {sync.otherName}
        </Button>
        <Button variant="outline" disabled={locked} onClick={() => (dirty ? setConfirm("pull") : sync.onPull())}>
          Copy {sync.otherName}&apos;s layout here
        </Button>
        {dirty && <span className="text-xs text-[var(--muted-foreground)]">Save your changes first to send them.</span>}
      </div>
      {sync.message && (
        <p role={sync.message.ok ? "status" : "alert"} className={cn("text-sm", sync.message.ok ? "text-emerald-300" : "rounded-2xl border border-red-400/40 bg-red-400/10 p-3")}>
          {sync.message.text}
        </p>
      )}
      <Dialog open={confirm !== null} onOpenChange={(open) => !open && setConfirm(null)}>
        <DialogContent className="glass-overlay w-[min(94vw,440px)]">
          <DialogTitle>{confirm === "send" ? `Replace the ${sync.otherName} sidebar?` : `Replace your unsaved changes?`}</DialogTitle>
          <DialogDescription>
            {confirm === "send"
              ? `Your saved layout is copied to your team in ${sync.otherName}, replacing the layout it has now. Its members see it after they reload.`
              : `Your unsaved changes here are dropped and replaced by the ${sync.otherName} layout. Nothing is saved until you press Save.`}
          </DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirm(null)}>
              Cancel
            </Button>
            <Button
              variant={confirm === "send" ? "danger" : "primary"}
              onClick={() => {
                const which = confirm;
                setConfirm(null);
                if (which === "send") sync.onSend();
                else sync.onPull();
              }}
            >
              {confirm === "send" ? `Send to ${sync.otherName}` : "Replace"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// --- the panel -----------------------------------------------------------------------------------------------------------------

export type SidebarPanelViewProps = {
  loaded: boolean;
  /** A failed read of the team's layout (shown here only, never in the sidebar). */
  loadError: string | null;
  entries: SidebarEntry[];
  program: ProgramId;
  labelOf: (item: NavItem) => string;
  dirty: boolean;
  saving: boolean;
  /** Someone else saved a newer layout since this screen loaded. */
  conflict: boolean;
  saveError: string | null;
  notice: string | null;
  /** Copying a layout to or from the other program; absent when there is no other program. */
  sync?: SidebarSync;
  onChange: (next: SidebarEntry[]) => void;
  onSave: () => void;
  onDiscard: () => void;
  onResetAll: () => void;
  onReloadLatest: () => void;
};

export function SidebarPanelView(props: SidebarPanelViewProps) {
  const { loaded, loadError, entries, program, labelOf, dirty, saving, conflict, saveError, notice, sync } = props;
  const [confirmReset, setConfirmReset] = useState(false);
  const blocker = saveBlocker(entries);
  if (!loaded) return <GlassSkeletonCard />;
  return (
    <div className="flex flex-col gap-5" data-testid="sidebar-panel">
      <div className="glass-card flex flex-col gap-2 p-4 text-sm">
        <h3 className="text-base font-semibold">Sidebar layout</h3>
        <p className="text-[var(--muted-foreground)]">
          Arrange the sidebar everyone on your team sees in this program. Members see changes after they reload, or within a short time while the app is open. Hiding a page only removes it from the sidebar: it does not block the page, and showing a page never gives anyone access to it (Page Access decides that).
        </p>
      </div>

      {loadError && (
        <p role="alert" className="rounded-2xl border border-amber-300/40 bg-amber-300/10 p-3 text-sm">
          {loadError}
        </p>
      )}
      {conflict && (
        <div role="alert" className="flex flex-col gap-2 rounded-2xl border border-amber-300/40 bg-amber-300/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
          <span>Someone else changed the sidebar since you opened this screen. Saving now would overwrite their change, so it is blocked.</span>
          <Button size="sm" variant="glass" onClick={props.onReloadLatest}>
            Load the latest layout (drops your changes)
          </Button>
        </div>
      )}
      {saveError && !conflict && (
        <p role="alert" className="rounded-2xl border border-red-400/40 bg-red-400/10 p-3 text-sm">
          {saveError}
        </p>
      )}

      <div className="grid gap-5 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-4">
          <SidebarEditor entries={entries} onChange={props.onChange} labelOf={labelOf} program={program} disabled={saving} />
        </div>
        <div className="flex flex-col gap-2">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">Preview (what members see, for the pages they can open)</h4>
          <SidebarPreview entries={entries} program={program} labelOf={labelOf} />
        </div>
      </div>

      {blocker && dirty && <p className="text-sm text-amber-200">{blocker}</p>}
      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={props.onSave} disabled={!dirty || saving || conflict || blocker !== null}>
          {saving ? "Saving..." : "Save"}
        </Button>
        <Button variant="ghost" onClick={props.onDiscard} disabled={!dirty || saving}>
          Discard changes
        </Button>
        <Button variant="outline" onClick={() => setConfirmReset(true)} disabled={saving}>
          Reset everything to default
        </Button>
        {dirty && <span className="text-sm text-[var(--muted-foreground)]">Unsaved changes</span>}
        <span role="status" aria-live="polite" className="text-sm text-emerald-300">
          {notice}
        </span>
      </div>

      {sync && <SyncCard sync={sync} dirty={dirty} conflict={conflict} saving={saving} />}

      <Dialog open={confirmReset} onOpenChange={setConfirmReset}>
        <DialogContent className="glass-overlay w-[min(94vw,440px)]">
          <DialogTitle>Reset the whole sidebar?</DialogTitle>
          <DialogDescription>Order, groups, names, icons and hidden pages go back to the default layout (all form pages in a &quot;Forms&quot; group). Nothing is saved until you press Save.</DialogDescription>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setConfirmReset(false)}>
              Cancel
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                props.onResetAll();
                setConfirmReset(false);
              }}
            >
              Reset to default
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Admin Panel > Sidebar. Holds the draft; the pure view above renders it. */
export function SidebarPanel() {
  const { user, profile } = useAuth();
  const program = useProgram();
  const { config, loaded, error } = useSidebarConfig();
  const liveRev = config?.rev ?? 0;
  const base = useMemo(() => workingCopy(config), [config]);
  const other = PROGRAM_IDS.find((id) => id !== program) ?? null;

  // `draft` exists once the admin has edited; `rev` is the stored revision it started from (what the save is checked against).
  const [draft, setDraft] = useState<{ entries: SidebarEntry[]; rev: number } | null>(null);
  // Just saved: shown until the live config catches up, so the screen never flashes the old layout.
  const [justSaved, setJustSaved] = useState<{ entries: SidebarEntry[]; rev: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictHit, setConflictHit] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [syncBusy, setSyncBusy] = useState(false);
  const [syncMessage, setSyncMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const shown = draft ? draft.entries : justSaved && justSaved.rev > liveRev ? justSaved.entries : base;
  const dirty = draft !== null && !sameLayout(draft.entries, base);
  const conflict = conflictHit || (draft !== null && draft.rev !== liveRev);

  const edit = (next: SidebarEntry[]) => {
    setNotice(null);
    setSaveError(null);
    setSyncMessage(null);
    setDraft({ entries: next, rev: draft?.rev ?? liveRev });
  };
  const reload = () => {
    setDraft(null);
    setConflictHit(false);
    setSaveError(null);
  };

  const save = async () => {
    if (!draft || !user || !profile?.teamId || saving) return;
    setSaving(true);
    setSaveError(null);
    setSyncMessage(null);
    try {
      const stored = await saveSidebarConfig({ teamId: profile.teamId, uid: user.uid, name: profile.name }, draft.entries, draft.rev, program);
      setJustSaved({ entries: stored.entries, rev: stored.rev });
      setDraft(null);
      setConflictHit(false);
      setNotice("Saved. Members see the new layout after they reload, or within a short time.");
    } catch (err) {
      if (err instanceof SidebarConflictError) {
        setConflictHit(true);
      } else {
        reportFirestoreError("sidebar save failed", err, `teams/${profile.teamId}/settings/sidebar`);
        setSaveError("Could not save the sidebar. Check your connection and try again; if it keeps failing, an admin may need to deploy the latest database rules.");
      }
    } finally {
      setSaving(false);
    }
  };

  const otherName = other ? PROGRAMS[other].brand.label : "";
  const syncFailure = (err: unknown): string => {
    if (err instanceof SidebarSyncError) return err.message;
    const code = describeFirestoreError("sidebar sync", err).code;
    if (code === "permission-denied") return `${otherName} refused it. Only an admin of your team in ${otherName} can change its sidebar, and the latest database rules must be deployed.`;
    return `Could not reach ${otherName} (${code}). Check your connection and try again.`;
  };
  const send = async () => {
    if (!user || !other || syncBusy) return;
    setSyncBusy(true);
    setSyncMessage(null);
    try {
      await pushSidebarLayout({ uid: user.uid, name: profile?.name ?? "" }, shown, program, other);
      setSyncMessage({ ok: true, text: `Sent. Your team in ${otherName} now has this layout; its members see it after they reload.` });
    } catch (err) {
      reportFirestoreError("sidebar sync (send) failed", err, `teams/*/settings/sidebar`);
      setSyncMessage({ ok: false, text: syncFailure(err) });
    } finally {
      setSyncBusy(false);
    }
  };
  const pull = async () => {
    if (!user || !other || syncBusy) return;
    setSyncBusy(true);
    setSyncMessage(null);
    try {
      const entries = await pullSidebarLayout({ uid: user.uid }, other);
      setNotice(null);
      setSaveError(null);
      setDraft({ entries, rev: draft?.rev ?? liveRev });
      setSyncMessage({ ok: true, text: `Loaded the ${otherName} layout here. Look it over, then press Save to keep it.` });
    } catch (err) {
      reportFirestoreError("sidebar sync (pull) failed", err, `teams/*/settings/sidebar`);
      setSyncMessage({ ok: false, text: syncFailure(err) });
    } finally {
      setSyncBusy(false);
    }
  };

  return (
    <SidebarPanelView
      loaded={loaded}
      loadError={error}
      entries={shown}
      program={program}
      labelOf={pageLabel}
      dirty={dirty}
      saving={saving}
      conflict={conflict}
      saveError={saveError}
      notice={notice}
      sync={other ? { otherName, busy: syncBusy, message: syncMessage, onSend: () => void send(), onPull: () => void pull() } : undefined}
      onChange={edit}
      onSave={() => void save()}
      onDiscard={reload}
      onResetAll={() => edit(resetAll())}
      onReloadLatest={reload}
    />
  );
}
