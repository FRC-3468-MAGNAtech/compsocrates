"use client";

import { useState } from "react";
import { ImageOff } from "lucide-react";

/** A card's image from a user-supplied link. A plain <img> (the host is unknown, so next/image can't optimise it) with a fallback if it won't load. */
export function CardImage({ src }: { src: string }) {
  const [failed, setFailed] = useState(false);
  return (
    <div className="flex min-h-48 items-center justify-center overflow-hidden rounded-2xl border border-[var(--glass-border)] bg-white/5">
      {failed ? (
        <p className="flex items-center gap-2 p-4 text-sm text-[var(--muted-foreground)]">
          <ImageOff className="h-4 w-4" aria-hidden /> The image couldn&apos;t be loaded.
        </p>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="Judge Book visual" referrerPolicy="no-referrer" onError={() => setFailed(true)} className="h-full w-full object-cover" />
      )}
    </div>
  );
}
