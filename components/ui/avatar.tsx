"use client";

import { useState } from "react";
import { Bot, Cog, Eye, Flame, Leaf, Moon, Rocket, Star, Target, Trophy, Waves, Zap, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { initialsOf } from "@/lib/profile/model";
import { presetById } from "@/lib/profile/config";
import type { AvatarInput } from "@/lib/avatar/model";
import { useResolvedAvatar } from "@/lib/avatar/use-avatar";

const PRESET_ICONS: Record<string, LucideIcon> = { bot: Bot, cog: Cog, zap: Zap, rocket: Rocket, target: Target, eye: Eye, trophy: Trophy, star: Star, flame: Flame, leaf: Leaf, waves: Waves, moon: Moon };

const SIZE_CLASSES = {
  sm: { box: "h-8 w-8 text-xs", icon: "h-4 w-4", px: 32 },
  md: { box: "h-10 w-10 text-sm", icon: "h-5 w-5", px: 40 },
  lg: { box: "h-14 w-14 text-lg", icon: "h-7 w-7", px: 56 },
  /** The profile header. */
  xl: { box: "h-24 w-24 text-3xl", icon: "h-12 w-12", px: 96 },
} as const;

/**
 * A member's picture, the ONE component for both programs. With no `avatar` it is the initials-on-gradient disc it always was. `lib/avatar/model.ts`
 * `resolveAvatar` decides what else: the uploaded photo (only when it is on our own picture store and in this person's own folder, and this viewer may see this
 * person's profile), else the Google picture or a preset glyph, else the initials. A picture that will not load falls back to the initials. Images load lazily with
 * their size set (no layout shift) and the alt text is the person's name.
 *
 * `hidePhoto` forces the initials-or-choice look for the uploaded photo (the "This profile is private" card).
 */
export function Avatar({
  name,
  color,
  className,
  size = "md",
  avatar,
  hidePhoto = false,
}: {
  name: string;
  color?: string;
  className?: string;
  size?: keyof typeof SIZE_CLASSES;
  avatar?: AvatarInput | null;
  hidePhoto?: boolean;
}) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const resolved = useResolvedAvatar(avatar, hidePhoto);
  const sizes = SIZE_CLASSES[size];
  const base = cn("flex shrink-0 items-center justify-center overflow-hidden rounded-full font-semibold text-white shadow-inner", sizes.box, className);
  const gradient = `linear-gradient(135deg, ${color ?? "var(--color-primary)"}, var(--color-accent))`;

  if ((resolved.kind === "upload" || resolved.kind === "google") && failedUrl !== resolved.url) {
    return (
      <div className={base} data-avatar={resolved.kind} style={{ background: gradient }}>
        {/* A plain <img>: our own already-resized 512 px picture or a Google-hosted one, so Next's image optimizer has nothing to add. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={resolved.url}
          alt={name}
          width={sizes.px}
          height={sizes.px}
          referrerPolicy="no-referrer"
          loading="lazy"
          decoding="async"
          draggable={false}
          className="h-full w-full object-cover"
          onError={() => setFailedUrl(resolved.url)}
        />
      </div>
    );
  }

  const preset = resolved.kind === "preset" ? presetById(resolved.presetId) : null;
  if (preset) {
    const Icon = PRESET_ICONS[preset.icon] ?? Bot;
    return (
      <div className={base} data-avatar={`preset:${preset.id}`} style={{ background: `linear-gradient(135deg, ${preset.from}, ${preset.to})` }}>
        <Icon className={sizes.icon} aria-hidden />
      </div>
    );
  }

  return (
    <div className={base} data-avatar="initials" style={{ background: gradient }}>
      {initialsOf(name)}
    </div>
  );
}
