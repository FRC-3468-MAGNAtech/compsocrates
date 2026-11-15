"use client";

import { Fragment, useMemo, useState } from "react";
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, FolderPlus, Pencil, RotateCcw, Trash2 } from "lucide-react";
import { isUnavailableInProgram } from "@/config/programs";
import type { ProgramId } from "@/config/programs/types";
import { useNavLabel } from "@/components/layout/use-nav-label";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { GlassSkeletonCard } from "@/components/ui/glass-skeleton";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useAuth } from "@/lib/auth";
import { reportFirestoreError } from "@/lib/firestore-errors";
import type { NavItem } from "@/lib/nav";
import { useProgram } from "@/lib/program/context";
import {
  canHide,
  canIndent,
  canMoveDown,
  canMoveUp,
  canOutdent,
  createGroup,
  deleteGroup,
  indent,
  isItemCustomized,
  moveDown,
  moveTargets,
  moveTo,
  moveUp,
  outdent,
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
import { SIDEBAR_ICON_KEYS, SIDEBAR_ICONS, sidebarIcon } from "@/lib/sidebar/icons";
import { childrenOf, pageById } from "@/lib/sidebar/layout";
import { resolveSidebar, type SidebarNode } from "@/lib/sidebar/resolve";
import { SidebarConflictError, saveSidebarConfig, useSidebarConfig } from "@/lib/sidebar/store";
import { FOOTER_ZONE, MAIN_ZONE, MAX_LABEL_LENGTH, type SidebarEntry } from "@/lib/sidebar/types";
import { cn } from "@/lib/utils";

/**
 * Session F: Admin Panel > Sidebar. An admin arranges the pages the code defines (order, groups, labels, icons, hidden) for their team and program.
 * Visibility here is cosmetic: it never grants or blocks access to a page (page access and the route guard decide that). Moving works with buttons
 * (up, down, indent, outdent, "Move to") so it needs no drag, and so works by mouse, touch and keyboard.
 */

const DEFAULT_ICON = "__default";
const iconButton = "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--glass-border)] text-[var(--foreground)] transition-colors hover:bg-white/8 disabled:cursor-not-allowed disabled:opacity-35";

// --- the editor: pure over the entry list ----------------------------------------------------------------------------------------

type EditorProps = {
  entries: SidebarEntry[];
  onChange: (next: SidebarEntry[]) => void;
  labelOf: (item: NavItem) => string;
  program: ProgramId;
  disabled?: boolean;
};

export function SidebarEditor({ entries, onChange, labelOf, program, disabled = false }: EditorProps) {
  const [editing, setEditing] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<string | null>(null);
  const [newGroup, setNewGroup] = useState("");

  const entryName = (e: SidebarEntry): string => e.label ?? (e.kind === "page" ? labelOf(pageById(e.id) as NavItem) : "Group");
  const editingEntry = editing ? entries.find((e) => e.id === editing) : undefined;
  const deletingEntry = deleting ? entries.find((e) => e.id === deleting) : undefined;

  const addGroup = () => {
    const { entries: next, id } = createGroup(entries, newGroup);
    if (id) {
      onChange(next);
      setNewGroup("");
    }
  };

  const renderRow = (e: SidebarEntry, depth: 0 | 1) => {
    const page = e.kind === "page" ? pageById(e.id) : null;
    const name = entryName(e);
    const Icon = sidebarIcon(e.icon, page?.icon);
    const targets = moveTargets(entries, e.id).filter((t) => (t.value === "@main" ? e.parent !== MAIN_ZONE : t.value !== e.parent));
    const hideable = canHide(e.id);
    return (
      <li key={e.id} data-entry={e.id} className={cn("flex flex-col gap-2 rounded-2xl border border-[var(--glass-border)] bg-white/4 p-2.5 sm:flex-row sm:items-center", depth === 1 && "ml-4 sm:ml-8")}>
        <div className="flex min-w-0 flex-1 items-center gap-2.5">
          <Icon className="h-[18px] w-[18px] shrink-0 text-[var(--muted-foreground)]" aria-hidden />
          <div className="min-w-0">
            <div className={cn("truncate text-sm", e.kind === "group" ? "font-semibold" : "font-medium", e.hidden && "text-[var(--muted-foreground)] line-through decoration-1")}>{name}</div>
            <div className="flex flex-wrap gap-x-2 text-[11px] text-[var(--muted-foreground)]">
              {e.kind === "group" && <span>Group</span>}
              {e.hidden && <span>Hidden from the sidebar</span>}
              {page && isUnavailableInProgram(program, page.href) && <span>Greyed out: not in this program yet</span>}
              {e.label && page && <span>Renamed (was {labelOf(page)})</span>}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <button type="button" className={iconButton} aria-label={`Move ${name} up`} disabled={disabled || !canMoveUp(entries, e.id)} onClick={() => onChange(moveUp(entries, e.id))}>
            <ArrowUp className="h-4 w-4" aria-hidden />
          </button>
          <button type="button" className={iconButton} aria-label={`Move ${name} down`} disabled={disabled || !canMoveDown(entries, e.id)} onClick={() => onChange(moveDown(entries, e.id))}>
            <ArrowDown className="h-4 w-4" aria-hidden />
          </button>
          {e.kind === "page" && (
            <>
              <button type="button" className={iconButton} aria-label={`Indent ${name} into the group above`} title="Indent: put it inside the group above" disabled={disabled || !canIndent(entries, e.id)} onClick={() => onChange(indent(entries, e.id))}>
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
              <button type="button" className={iconButton} aria-label={`Outdent ${name} out of its group`} title="Outdent: take it out of its group" disabled={disabled || !canOutdent(entries, e.id)} onClick={() => onChange(outdent(entries, e.id))}>
                <ChevronLeft className="h-4 w-4" aria-hidden />
              </button>
            </>
          )}
          <Select value="" onValueChange={(v) => onChange(moveTo(entries, e.id, v))} disabled={disabled || targets.length === 0}>
            <SelectTrigger className="h-9 w-[9.5rem] px-3 text-xs" aria-label={`Move ${name} to`}>
              <SelectValue>Move to...</SelectValue>
            </SelectTrigger>
            <SelectContent>
              {targets.map((t) => (
                <SelectItem key={t.value} value={t.value}>
                  {t.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <button type="button" className={iconButton} aria-label={`Rename or change the icon of ${name}`} disabled={disabled} onClick={() => setEditing(e.id)}>
            <Pencil className="h-4 w-4" aria-hidden />
          </button>
          {e.kind === "page" && (
            <button type="button" className={iconButton} aria-label={`Reset ${name} to its default`} title="Reset this item" disabled={disabled || !isItemCustomized(entries, e.id)} onClick={() => onChange(resetItem(entries, e.id))}>
              <RotateCcw className="h-4 w-4" aria-hidden />
            </button>
          )}
          {e.kind === "group" ? (
            <button type="button" className={iconButton} aria-label={`Delete the group ${name}`} disabled={disabled} onClick={() => setDeleting(e.id)}>
              <Trash2 className="h-4 w-4" aria-hidden />
            </button>
          ) : (
            <label className="ml-1 inline-flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <Switch checked={!e.hidden} disabled={disabled || !hideable} onCheckedChange={(shown) => onChange(setHidden(entries, e.id, !shown))} aria-label={`Show ${name} in the sidebar`} />
              <span>{hideable ? (e.hidden ? "Hidden" : "Shown") : "Always shown"}</span>
            </label>
          )}
          {e.kind === "group" && (
            <label className="ml-1 inline-flex items-center gap-2 text-xs text-[var(--muted-foreground)]">
              <Switch checked={!e.hidden} disabled={disabled} onCheckedChange={(shown) => onChange(setHidden(entries, e.id, !shown))} aria-label={`Show the group ${name} in the sidebar`} />
              <span>{e.hidden ? "Hidden" : "Shown"}</span>
            </label>
          )}
        </div>
      </li>
    );
  };

  const renderZone = (parent: string | null, title: string) => (
    <section aria-label={title} className="flex flex-col gap-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{title}</h4>
      <ul className="flex flex-col gap-2">
        {childrenOf(entries, parent).map((e) => (
          <Fragment key={e.id}>
            {renderRow(e, 0)}
            {e.kind === "group" && childrenOf(entries, e.id).map((c) => renderRow(c, 1))}
            {e.kind === "group" && childrenOf(entries, e.id).length === 0 && <li className="ml-4 px-2 text-xs text-[var(--muted-foreground)] sm:ml-8">Empty group (not shown in the sidebar until a page is in it).</li>}
          </Fragment>
        ))}
      </ul>
    </section>
  );

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

      {renderZone(MAIN_ZONE, "Main list")}
      {renderZone(FOOTER_ZONE, "Bottom block")}

      <EditDialog
        key={editing ?? "none"}
        entry={editingEntry}
        name={editingEntry ? entryName(editingEntry) : ""}
        defaultLabel={editingEntry && editingEntry.kind === "page" ? labelOf(pageById(editingEntry.id) as NavItem) : ""}
        onClose={() => setEditing(null)}
        onApply={(label, icon) => {
          if (editingEntry) onChange(setIcon(rename(entries, editingEntry.id, label), editingEntry.id, icon));
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

function EditDialog({ entry, name, defaultLabel, onClose, onApply }: { entry: SidebarEntry | undefined; name: string; defaultLabel: string; onClose: () => void; onApply: (label: string, icon: string | undefined) => void }) {
  const [label, setLabel] = useState(entry?.label ?? "");
  const [icon, setIconKey] = useState<string>(entry?.icon ?? DEFAULT_ICON);
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
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={() => onApply(label, icon === DEFAULT_ICON ? undefined : icon)} disabled={isGroup && label.trim() === "" && !entry?.label}>
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
  onChange: (next: SidebarEntry[]) => void;
  onSave: () => void;
  onDiscard: () => void;
  onResetAll: () => void;
  onReloadLatest: () => void;
};

export function SidebarPanelView(props: SidebarPanelViewProps) {
  const { loaded, loadError, entries, program, labelOf, dirty, saving, conflict, saveError, notice } = props;
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
  const labelOf = useNavLabel();
  const { config, loaded, error } = useSidebarConfig();
  const liveRev = config?.rev ?? 0;
  const base = useMemo(() => workingCopy(config), [config]);

  // `draft` exists once the admin has edited; `rev` is the stored revision it started from (what the save is checked against).
  const [draft, setDraft] = useState<{ entries: SidebarEntry[]; rev: number } | null>(null);
  // Just saved: shown until the live config catches up, so the screen never flashes the old layout.
  const [justSaved, setJustSaved] = useState<{ entries: SidebarEntry[]; rev: number } | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [conflictHit, setConflictHit] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const shown = draft ? draft.entries : justSaved && justSaved.rev > liveRev ? justSaved.entries : base;
  const dirty = draft !== null && !sameLayout(draft.entries, base);
  const conflict = conflictHit || (draft !== null && draft.rev !== liveRev);

  const edit = (next: SidebarEntry[]) => {
    setNotice(null);
    setSaveError(null);
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

  return (
    <SidebarPanelView
      loaded={loaded}
      loadError={error}
      entries={shown}
      program={program}
      labelOf={labelOf}
      dirty={dirty}
      saving={saving}
      conflict={conflict}
      saveError={saveError}
      notice={notice}
      onChange={edit}
      onSave={() => void save()}
      onDiscard={reload}
      onResetAll={() => edit(resetAll())}
      onReloadLatest={reload}
    />
  );
}
