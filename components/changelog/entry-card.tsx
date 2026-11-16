"use client";

import { AnimatePresence, motion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { RichText } from "@/components/ui/rich-text";
import { PROGRAMS } from "@/config/programs";
import { CHANGE_TYPES, formatEntryDate, type ChangeType } from "@/lib/changelog";
import { groupItems, itemTags, taggedForAll, type PlatformEntry } from "@/lib/platform-changelog/model";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

const typeMeta = (type: ChangeType) => CHANGE_TYPES.find((t) => t.id === type)!;

export function ChangePill({ type, count, className }: { type: ChangeType; count?: number; className?: string }) {
  const meta = typeMeta(type);
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-semibold", meta.pill, className)}>
      {meta.label}
      {count !== undefined && <span className="opacity-70">{count}</span>}
    </span>
  );
}

/**
 * One release of the platform changelog: a collapsible glass card with its items grouped by category. The SAME component renders the
 * page, the legacy list and the owner's preview, so what the owner previews is what users see. `entry.items` is what to show (the page
 * filters by program before it gets here). `showProgramBadges` adds a small program label on items not tagged for every program.
 */
export function EntryCard({
  entry,
  expanded,
  onToggle,
  showProgramBadges = false,
  showDraftNote = false,
}: {
  entry: PlatformEntry;
  expanded: boolean;
  onToggle: () => void;
  showProgramBadges?: boolean;
  /** The owner's lists and preview: say that a draft is not visible to anyone else. */
  showDraftNote?: boolean;
}) {
  const groups = groupItems(entry.items);
  const bodyId = `changelog-body-${entry.id}`;
  const isDraft = entry.status === "draft";
  const heading = entry.version ? `${entry.version} — ${entry.title}` : entry.title;

  return (
    <motion.article transition={spring} className={cn("glass-card glow-ring p-5", isDraft && "border-dashed")} aria-label={heading}>
      <button type="button" onClick={onToggle} aria-expanded={expanded} aria-controls={bodyId} className="group flex min-h-11 w-full items-start gap-3 rounded-xl text-left outline-none focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]">
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          <div className="flex flex-wrap items-center gap-2">
            {entry.version && <span className="font-mono text-sm font-semibold">{entry.version}</span>}
            {entry.legacy && <Badge variant="outline">Legacy</Badge>}
            {isDraft && showDraftNote && <Badge variant="warning">Draft · only the platform owner can see this</Badge>}
            <span className="text-xs text-[var(--muted-foreground)]">{formatEntryDate(entry.date)}</span>
          </div>
          <h2 className="text-base font-semibold leading-snug">{entry.title}</h2>
          {!expanded && (
            <div className="flex flex-wrap gap-1.5 pt-0.5">
              {groups.map((g) => (
                <ChangePill key={g.category} type={g.category} count={g.items.length} />
              ))}
            </div>
          )}
        </div>
        <ChevronDown className={cn("mt-1 h-4 w-4 shrink-0 text-[var(--muted-foreground)] transition-transform duration-300 group-hover:text-[var(--foreground)]", expanded && "rotate-180")} aria-hidden />
      </button>

      <AnimatePresence initial={false}>
        {expanded && (
          <motion.div id={bodyId} key="body" initial={{ height: 0, opacity: 0 }} animate={{ height: "auto", opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={spring} className="overflow-hidden">
            <div className="flex flex-col gap-4 pt-4">
              {groups.map((group) => (
                <section key={group.category} className="flex flex-col gap-2">
                  <ChangePill type={group.category} className="self-start" />
                  <ul className="flex flex-col gap-1.5">
                    {group.items.map((item, i) => {
                      const tags = itemTags(entry, item);
                      return (
                        <li key={i} className="flex items-start gap-2.5 text-sm">
                          <span className={cn("mt-[0.55rem] h-1.5 w-1.5 shrink-0 rounded-full", typeMeta(group.category).bullet)} aria-hidden />
                          <span className="min-w-0">
                            <RichText text={item.text} className="text-[var(--muted-foreground)]" />
                            {showProgramBadges && !taggedForAll(tags) && (
                              <>
                                {tags.map((id) => (
                                  <Badge key={id} variant="outline" className="ml-1.5 px-2 py-0 text-[10px]" data-testid="program-badge">
                                    {PROGRAMS[id].brand.label}
                                  </Badge>
                                ))}
                              </>
                            )}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                </section>
              ))}
              {groups.length === 0 && <p className="text-sm text-[var(--muted-foreground)]">No items in this entry.</p>}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.article>
  );
}
