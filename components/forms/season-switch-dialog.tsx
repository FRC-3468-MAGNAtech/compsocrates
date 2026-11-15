"use client";

import { ConfirmDialog } from "@/components/scout/confirm-dialog";

/**
 * "Switch to REEFSCAPE?": the site's own confirmation (not the browser's) before another game's form replaces what is on screen. `keeps` says what happens to
 * the answers: `erases` for a form that saves nothing until Submit, `draft` for the Match Scout form, whose answers stay as a draft on this device and only
 * the sticky notes are deleted.
 */
export function SeasonSwitchDialog({
  toName,
  fromName,
  effect,
  onCancel,
  onConfirm,
}: {
  /** The game being switched to; null while the dialog is closed. */
  toName: string | null;
  fromName: string;
  effect: "erases" | "draft";
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const erases = effect === "erases";
  return (
    <ConfirmDialog
      open={toName !== null}
      onOpenChange={(open) => !open && onCancel()}
      title={`Switch to ${toName ?? ""}?`}
      description={
        erases
          ? `Nothing on this form has been submitted yet. If you switch, everything you typed here will be erased.`
          : `Your sticky notes for this robot will be deleted. Everything else you entered stays saved as a draft on this device, and you can restore it when you switch back to ${fromName}.`
      }
      confirmLabel={erases ? "Erase and switch" : "Delete notes and switch"}
      cancelLabel="Stay here"
      onConfirm={onConfirm}
      testId="season-switch-dialog"
    />
  );
}
