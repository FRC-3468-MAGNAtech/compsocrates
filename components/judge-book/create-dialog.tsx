"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Label, Textarea } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { CardFields } from "@/components/judge-book/card-fields";
import { emptyDraft, parseCsvDrafts, parseMultiDraft, type CardDraft } from "@/lib/judge-book/model";
import type { WriteResult } from "@/lib/judge-book/store";

type Mode = "single" | "multi" | "csv";

/** The "Add" dialog: one card, many cards (one per line), or a CSV import: the three ways CS creates cards. */
export function CreateCardsDialog({
  open,
  onOpenChange,
  onCreate,
  onCreated,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreate: (drafts: CardDraft[]) => Promise<WriteResult & { added?: number }>;
  onCreated: (added: number) => void;
}) {
  const [mode, setMode] = useState<Mode>("single");
  const [single, setSingle] = useState<CardDraft>(emptyDraft);
  const [multi, setMulti] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (drafts: CardDraft[]) => {
    setSaving(true);
    setError(null);
    const result = await onCreate(drafts);
    setSaving(false);
    if (!result.ok) {
      setError(result.message);
      return;
    }
    setSingle(emptyDraft());
    setMulti("");
    onCreated(result.added ?? drafts.length);
    onOpenChange(false);
  };

  const importCsv = async (file: File | null) => {
    if (!file) return;
    const drafts = parseCsvDrafts(await file.text());
    if (drafts.length === 0) {
      setError("That CSV appears empty.");
      return;
    }
    await run(drafts);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (saving) return;
        if (!next) setError(null);
        onOpenChange(next);
      }}
    >
      <DialogContent className="sm:w-[min(92vw,560px)]">
        <DialogTitle>Add Judge Book cards</DialogTitle>
        <DialogDescription>One card, many at once, or a CSV file.</DialogDescription>
        <Tabs
          value={mode}
          onValueChange={(v) => {
            setMode(v as Mode);
            setError(null);
          }}
          className="mt-4 flex flex-col gap-4"
        >
          <TabsList className="w-full">
            <TabsTrigger value="single" className="flex-1">
              One card
            </TabsTrigger>
            <TabsTrigger value="multi" className="flex-1">
              Many
            </TabsTrigger>
            <TabsTrigger value="csv" className="flex-1">
              CSV
            </TabsTrigger>
          </TabsList>

          <TabsContent value="single" className="flex flex-col gap-4">
            <CardFields draft={single} onChange={setSingle} disabled={saving} />
            <Button onClick={() => void run([single])} disabled={saving} className="self-end">
              {saving ? "Saving..." : "Add card"}
            </Button>
          </TabsContent>

          <TabsContent value="multi" className="flex flex-col gap-4">
            <div>
              <Label htmlFor="jb-multi">One card per line</Label>
              <Textarea
                id="jb-multi"
                value={multi}
                onChange={(e) => setMulti(e.target.value)}
                disabled={saving}
                rows={7}
                aria-describedby="jb-multi-hint"
                placeholder={"Member count | 34 students | https://...\nBuild season length | 8 weeks"}
              />
              <p id="jb-multi-hint" className="mt-1.5 text-xs text-[var(--muted-foreground)]">
                Format: question | answer | optional image URL
              </p>
            </div>
            <Button onClick={() => void run(parseMultiDraft(multi))} disabled={saving} className="self-end">
              {saving ? "Saving..." : "Add cards"}
            </Button>
          </TabsContent>

          <TabsContent value="csv" className="flex flex-col gap-3">
            <Label htmlFor="jb-csv">CSV file</Label>
            <input
              id="jb-csv"
              type="file"
              accept=".csv,text/csv"
              disabled={saving}
              onChange={(e) => {
                const file = e.target.files?.[0] ?? null;
                e.target.value = "";
                void importCsv(file);
              }}
              className="block w-full text-sm text-[var(--muted-foreground)] file:mr-3 file:min-h-11 file:rounded-full file:border file:border-[var(--glass-border)] file:bg-transparent file:px-4 file:text-sm file:text-[var(--foreground)]"
              aria-describedby="jb-csv-hint"
            />
            <p id="jb-csv-hint" className="text-xs text-[var(--muted-foreground)]">
              Headers recognised: question, prompt, title or label; answer, response, value or details; image, imageUrl, img, photo or chart. Without a header row the columns are question, answer, image.
            </p>
            {saving && <p className="text-sm text-[var(--muted-foreground)]">Importing...</p>}
          </TabsContent>
        </Tabs>
        {error && (
          <p role="alert" className="mt-3 text-sm text-red-400">
            {error}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
