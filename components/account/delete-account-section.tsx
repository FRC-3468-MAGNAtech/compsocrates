"use client";

import { useEffect, useState } from "react";
import { Trash2 } from "lucide-react";
import { ReauthField } from "@/components/team/reauth-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { GlassPanel } from "@/components/ui/glass-panel";
import { Input, Label } from "@/components/ui/input";
import { ApiError } from "@/lib/api-client";
import { useAuth } from "@/lib/auth";
import { DELETE_CONFIRMATION_WORD } from "@/lib/deletion/constants";
import { deletionApi, useAccountDeletionEnabled } from "@/lib/deletion/client";
import { DELETION_TEXT, friendlyDeletionError } from "@/lib/deletion/strings";
import { reauthenticate } from "@/lib/reauth";
import { usePlatformOwnerClaim } from "@/lib/use-platform-owner-claim";

/** The states of the dialog: asking, working, accepted (the person is being signed out). */
export type DeleteState = "ask" | "working" | "started";

/**
 * The words and controls of "Delete account", drawn from props so a test can render every state (`DeleteAccountSection` below reads and acts). The same for both
 * programs. Nothing here names a program.
 */
export function DeleteAccountDialogBody(props: {
  state: DeleteState;
  password: string;
  confirm: string;
  error: string | null;
  onPassword: (v: string) => void;
  onConfirm: (v: string) => void;
  onSubmit: () => void;
  onCancel: () => void;
  onSignOut: () => void;
}) {
  const T = DELETION_TEXT;
  if (props.state === "started") {
    return (
      <div className="flex flex-col gap-4" data-testid="delete-account-started">
        <h2 className="text-lg font-semibold">{T.inProgressTitle}</h2>
        <p className="text-sm text-[var(--muted-foreground)]">{T.inProgress}</p>
        <Button type="button" variant="glass" className="min-h-11 self-start" onClick={props.onSignOut}>
          {T.signOut}
        </Button>
      </div>
    );
  }
  const working = props.state === "working";
  return (
    <form
      className="flex flex-col gap-4"
      onSubmit={(e) => {
        e.preventDefault();
        props.onSubmit();
      }}
      data-testid="delete-account-form"
    >
      <h2 className="text-lg font-semibold">{T.dialogTitle}</h2>
      <p className="text-sm text-[var(--muted-foreground)]">{T.sectionIntro}</p>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">{T.keptTitle}</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted-foreground)]">
          {T.kept.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <div className="flex flex-col gap-1">
        <h3 className="text-sm font-semibold">{T.deletedTitle}</h3>
        <ul className="list-disc space-y-1 pl-5 text-sm text-[var(--muted-foreground)]">
          {T.deleted.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
      </div>
      <p className="text-sm font-medium">{T.irreversible}</p>
      <p className="text-xs text-[var(--muted-foreground)]">{T.policy}</p>
      <ReauthField password={props.password} onPasswordChange={props.onPassword} disabled={working} />
      <div>
        <Label htmlFor="delete-confirm">{T.confirmLabel}</Label>
        <Input id="delete-confirm" value={props.confirm} onChange={(e) => props.onConfirm(e.target.value)} placeholder={T.confirmPlaceholder} autoComplete="off" disabled={working} />
      </div>
      {props.error && (
        <p role="alert" className="text-sm text-red-400">
          {props.error}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" variant="danger" className="min-h-11" disabled={working || props.confirm !== DELETE_CONFIRMATION_WORD}>
          {working ? T.submitting : T.submit}
        </Button>
        <Button type="button" variant="ghost" className="min-h-11" onClick={props.onCancel} disabled={working}>
          {T.cancel}
        </Button>
      </div>
    </form>
  );
}

/** Account Settings > Delete account. Hidden while the kill switch is OFF (or not known yet): the page is exactly as it was. */
export function DeleteAccountSection() {
  const enabled = useAccountDeletionEnabled();
  // A platform owner's account is never deleted here (the server refuses it), so the control is not offered.
  const platformOwner = usePlatformOwnerClaim();
  const { logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [state, setState] = useState<DeleteState>("ask");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Once the request is accepted the person is signed out after a moment (the account is disabled; this device's session would only stop working later).
  useEffect(() => {
    if (state !== "started") return;
    const t = setTimeout(() => void logout().catch(() => {}), 6000);
    return () => clearTimeout(t);
  }, [state, logout]);

  if (!enabled || platformOwner) return null;

  const submit = async () => {
    setState("working");
    setError(null);
    try {
      await reauthenticate(password);
      await deletionApi.deleteMyAccount(confirm);
      setPassword("");
      setState("started");
    } catch (err) {
      setState("ask");
      if (err instanceof ApiError) {
        // "Already being deleted" is not a failure for the person: show the same in-progress state.
        if (err.code === "deletion_in_progress") return setState("started");
        setError(friendlyDeletionError(err.code, err.message));
      } else setError(err instanceof Error ? err.message : DELETION_TEXT.generic);
    }
  };

  return (
    <GlassPanel className="flex flex-col gap-3" data-testid="delete-account-section">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-[var(--muted-foreground)]">{DELETION_TEXT.sectionTitle}</h2>
      <p className="text-xs text-[var(--muted-foreground)]">{DELETION_TEXT.sectionIntro}</p>
      <Button type="button" variant="outline" className="min-h-11 gap-2 self-start" onClick={() => { setError(null); setState("ask"); setOpen(true); }}>
        <Trash2 className="h-4 w-4" aria-hidden /> {DELETION_TEXT.open}
      </Button>
      <Dialog open={open} onOpenChange={(next) => state !== "working" && setOpen(next)}>
        <DialogContent className="glass-overlay w-[min(94vw,520px)]">
          <DialogTitle className="sr-only">{state === "started" ? DELETION_TEXT.inProgressTitle : DELETION_TEXT.dialogTitle}</DialogTitle>
          <DialogDescription className="sr-only">{DELETION_TEXT.sectionIntro}</DialogDescription>
          <DeleteAccountDialogBody
            state={state}
            password={password}
            confirm={confirm}
            error={error}
            onPassword={setPassword}
            onConfirm={setConfirm}
            onSubmit={() => void submit()}
            onCancel={() => setOpen(false)}
            onSignOut={() => void logout().catch(() => {})}
          />
        </DialogContent>
      </Dialog>
    </GlassPanel>
  );
}
