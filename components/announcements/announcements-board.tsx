"use client";

import { useId, useState } from "react";
import { AlertTriangle, Send, Trash2 } from "lucide-react";
import { ConfirmDialog } from "@/components/scout/confirm-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label, Textarea } from "@/components/ui/input";
import { Shimmer } from "@/components/ui/shimmer";
import {
  ANNOUNCEMENT_TYPES,
  ANNOUNCEMENT_TYPE_BADGE,
  ANNOUNCEMENT_TYPE_LABELS,
  MAX_ANNOUNCEMENT_LENGTH,
  typeLabel,
  type AnnouncementActor,
  type AnnouncementType,
  type TeamAnnouncement,
} from "@/lib/announcements/model";
import { deleteAnnouncement, postAnnouncement, type AnnouncementsState } from "@/lib/announcements/store";
import { cn } from "@/lib/utils";

const timeOf = (ms: number): string => (ms > 0 ? new Date(ms).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "");

/**
 * CS "Team Communication": a type picker, a message box and Post, over the team's posts newest first. Presentational over `state` (the caller
 * owns the subscription, so a dashboard widget and the Team Management page share it). Anyone on the team posts; `canDelete` (a team admin)
 * adds Delete, confirmed in a dialog instead of CS's `window.confirm`.
 */
export function AnnouncementsBoard({
  state,
  teamId,
  actor,
  canDelete,
  listClassName,
}: {
  state: AnnouncementsState;
  teamId: string | null;
  actor: AnnouncementActor | null;
  canDelete: boolean;
  /** Caps the list height (CS scrolled it at 24rem). */
  listClassName?: string;
}) {
  if (!state.loaded) {
    return (
      <div className="flex flex-col gap-2.5" aria-busy="true" aria-label="Loading announcements">
        <Shimmer className="h-11 w-full" />
        <Shimmer className="h-16 w-full" />
        <Shimmer className="h-16 w-full" />
      </div>
    );
  }
  if (state.error) return <AnnouncementsError message="Couldn't load announcements." onRetry={state.retry} />;
  return (
    <div className="flex flex-col gap-4">
      <AnnouncementComposer teamId={teamId} actor={actor} />
      <AnnouncementList posts={state.posts} canDelete={canDelete} className={listClassName} />
    </div>
  );
}

/** The load-failure message with a 44px Retry. */
export function AnnouncementsError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-2 text-center text-sm text-amber-300">
      <AlertTriangle className="h-5 w-5" aria-hidden />
      <span>{message}</span>
      <Button size="sm" variant="glass" className="min-h-11" onClick={onRetry}>
        Try again
      </Button>
    </div>
  );
}

/** CS's compose form: the type pills (a radio group), the message and Post. Clears on success; a refusal or failure shows under the box. */
export function AnnouncementComposer({ teamId, actor }: { teamId: string | null; actor: AnnouncementActor | null }) {
  const bodyId = useId();
  const errorId = useId();
  const [body, setBody] = useState("");
  const [type, setType] = useState<AnnouncementType>("announcement");
  const [posting, setPosting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!teamId || !actor) return;
    setPosting(true);
    setError(null);
    const result = await postAnnouncement({ teamId, actor, body, type });
    setPosting(false);
    if (result.ok) setBody("");
    else setError(result.reason);
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-2" aria-label="Post to the team">
      <div role="radiogroup" aria-label="Post type" className="flex flex-wrap gap-2">
        {ANNOUNCEMENT_TYPES.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={type === option}
            onClick={() => setType(option)}
            className={cn(
              "flex min-h-11 items-center rounded-full border px-4 text-xs font-semibold outline-none transition-colors focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]",
              type === option
                ? "border-transparent bg-[var(--color-primary)] text-[var(--color-primary-foreground)]"
                : "border-[var(--glass-border)] text-[var(--muted-foreground)] hover:bg-white/6 hover:text-[var(--foreground)]"
            )}
          >
            {ANNOUNCEMENT_TYPE_LABELS[option]}
          </button>
        ))}
      </div>
      <div>
        <Label htmlFor={bodyId}>Message</Label>
        <Textarea
          id={bodyId}
          rows={3}
          value={body}
          maxLength={MAX_ANNOUNCEMENT_LENGTH}
          disabled={!teamId || !actor}
          placeholder="Share an update with your team..."
          aria-describedby={error ? errorId : undefined}
          aria-invalid={error ? true : undefined}
          className="text-base"
          onChange={(e) => setBody(e.target.value)}
        />
      </div>
      {error && (
        <p id={errorId} role="alert" className="text-sm font-medium text-red-300">
          {error}
        </p>
      )}
      <Button type="submit" className="min-h-11 self-start gap-1.5" disabled={posting || !teamId || !actor}>
        <Send className="h-4 w-4" aria-hidden /> {posting ? "Posting..." : "Post"}
      </Button>
    </form>
  );
}

/** The posts, newest first, each with its type pill, author, time and message; a team admin also sees Delete. */
export function AnnouncementList({ posts, canDelete, className }: { posts: readonly TeamAnnouncement[]; canDelete: boolean; className?: string }) {
  const [pending, setPending] = useState<TeamAnnouncement | null>(null);
  const [error, setError] = useState<string | null>(null);

  const remove = (post: TeamAnnouncement) => {
    setError(null);
    void deleteAnnouncement(post.id).then((result) => {
      if (!result.ok) setError(result.reason);
    });
  };

  return (
    <div className="flex min-h-0 flex-col gap-2">
      {posts.length === 0 ? (
        <p className="py-4 text-center text-sm text-[var(--muted-foreground)]">No posts yet. Be the first to share an update with the team.</p>
      ) : (
        <ul className={cn("flex flex-col gap-2", className)} data-testid="announcement-list" aria-label="Team posts, newest first">
          {posts.map((post) => (
            <li key={post.id} data-testid={`announcement-${post.id}`} className="rounded-xl border border-[var(--glass-border)] px-3 py-2">
              <div className="flex items-start justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <Badge variant={ANNOUNCEMENT_TYPE_BADGE[post.type]}>{typeLabel(post.type)}</Badge>
                  <span className="truncate text-sm font-semibold">{post.authorName || "Team Member"}</span>
                  {post.createdAt > 0 && (
                    <time dateTime={new Date(post.createdAt).toISOString()} className="text-xs text-[var(--muted-foreground)]">
                      {timeOf(post.createdAt)}
                    </time>
                  )}
                </div>
                {canDelete && (
                  <button
                    type="button"
                    aria-label={`Delete ${typeLabel(post.type).toLowerCase()} from ${post.authorName || "Team Member"}`}
                    onClick={() => setPending(post)}
                    className="-my-1 -mr-1 flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-[var(--muted-foreground)] outline-none hover:bg-white/10 hover:text-red-300 focus-visible:ring-2 focus-visible:ring-[rgba(var(--glow),0.5)]"
                  >
                    <Trash2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </div>
              <p className="mt-1 whitespace-pre-wrap break-words text-sm text-[var(--foreground)]">{post.body}</p>
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-xs font-medium text-red-300">
          {error}
        </p>
      )}
      <ConfirmDialog
        open={pending !== null}
        onOpenChange={(open) => !open && setPending(null)}
        title="Delete this post?"
        description={pending ? `This removes ${pending.authorName || "Team Member"}'s ${typeLabel(pending.type).toLowerCase()} for the whole team.` : undefined}
        confirmLabel="Delete post"
        cancelLabel="Keep it"
        onConfirm={() => pending && remove(pending)}
      />
    </div>
  );
}
