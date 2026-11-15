"use client";

import { ConfirmDialog } from "@/components/scout/confirm-dialog";

/**
 * "Switch to REEFSCAPE?": the site's own confirmation (not the browser's) before another game's form replaces a form that saves nothing until Submit.
 * (Match Scout needs none: its answers stay as a draft per game and its notes are kept per game.)
 */
export function SeasonSwitchDialog({
  toName,
  onCancel,
  onConfirm,
}: {
  /** The game being switched to; null while the dialog is closed. */
  toName: string | null;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <ConfirmDialog
      open={toName !== null}
      onOpenChange={(open) => !open && onCancel()}
      title={`Switch to ${toName ?? ""}?`}
      description="Nothing on this form has been submitted yet. If you switch, everything you typed here will be erased."
      confirmLabel="Erase and switch"
      cancelLabel="Stay here"
      onConfirm={onConfirm}
      testId="season-switch-dialog"
    />
  );
}
