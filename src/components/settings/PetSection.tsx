"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { SectionPage } from "@/components/patterns/SectionPage";
import { SettingsCard } from "@/components/patterns/SettingsCard";
import { FieldRow } from "@/components/patterns/FieldRow";
import { Switch } from "@/components/ui/switch";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { useTranslation } from "@/hooks/useTranslation";

/**
 * Desktop pet settings.
 * Plan: docs/exec-plans/active/desktop-pet.md §10.
 *
 * Two layers:
 *  1) Global toggle + theme list (this file)
 *  2) Pet BrowserWindow itself: src/app/pet/page.tsx (rendered in a separate window)
 *
 * IPC vs HTTP:
 *  - Live state push to pet window: IPC (window.electronAPI.pet.onState)
 *  - Reads/writes for the settings UI: HTTP routes under /api/pet/* (works in
 *    web preview too, where electronAPI is undefined; the toggle just won't
 *    actually spawn a window).
 */

type PetState = "idle" | "working" | "waiting" | "done";
const STATES: PetState[] = ["idle", "working", "waiting", "done"];

interface PetTheme {
  id: string;
  name: string;
  created_at: string;
  is_complete: number;
}

interface PetSettings {
  enabled?: string;
  current_theme_id?: string;
  muted?: string;
}

export function PetSection() {
  const { t } = useTranslation();
  const [themes, setThemes] = useState<PetTheme[]>([]);
  const [settings, setSettings] = useState<PetSettings>({});
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [files, setFiles] = useState<Record<PetState, File | null>>({
    idle: null, working: null, waiting: null, done: null,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [tRes, sRes] = await Promise.all([
        fetch("/api/pet/themes").then((r) => r.json()),
        fetch("/api/pet/settings").then((r) => r.json()),
      ]);
      setThemes(tRes.themes || []);
      setSettings(sRes.settings || {});
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const enabled = settings.enabled === "1";
  const currentId = settings.current_theme_id || null;
  const hasUsableTheme = themes.some((t) => t.is_complete === 1);

  const handleToggleEnabled = async (next: boolean) => {
    setError(null);
    // Refuse-by-design: enabling without a complete theme is a no-op (the
    // pet window would show a placeholder). Surface a hint instead.
    if (next && !hasUsableTheme) {
      setError(t("pet.noThemeWarning"));
      return;
    }
    // Update DB via HTTP so the toggle works even before the Electron main
    // has the listener (e.g. dev hot reload). Then ask main to actually
    // create/destroy the window.
    await fetch("/api/pet/settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ settings: { enabled: next ? "1" : "0" } }),
    });
    try { await window.electronAPI?.pet?.setEnabled(next); } catch { /* web preview */ }
    await refresh();
  };

  const handleActivate = async (id: string) => {
    setError(null);
    const res = await fetch(`/api/pet/themes/${encodeURIComponent(id)}/activate`, { method: "POST" });
    if (!res.ok) {
      const j = await res.json().catch(() => ({}));
      setError(j.error || "Failed to activate");
      return;
    }
    // If the pet is already on, the next 2s tick picks up the new theme.
    await refresh();
  };

  const handleDelete = async (id: string) => {
    if (!confirm(`Delete theme "${id}"?`)) return;
    await fetch(`/api/pet/themes?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    await refresh();
  };

  const handleResetPos = async () => {
    try { await window.electronAPI?.pet?.resetPosition(); } catch { /* web */ }
  };

  const allFilesPicked = STATES.every((s) => files[s] !== null);

  const handleCreate = async () => {
    setError(null);
    const name = newName.trim();
    if (!name) { setError("name required"); return; }
    if (!allFilesPicked) { setError("upload all 4 state images"); return; }
    setSubmitting(true);
    try {
      const createRes = await fetch("/api/pet/themes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const createJson = await createRes.json();
      if (!createRes.ok) throw new Error(createJson.error || "create failed");
      const id = createJson.theme.id;
      for (const state of STATES) {
        const f = files[state];
        if (!f) continue;
        const fd = new FormData();
        fd.append("state", state);
        fd.append("file", f);
        const upRes = await fetch(`/api/pet/themes/${encodeURIComponent(id)}/upload`, {
          method: "POST", body: fd,
        });
        if (!upRes.ok) {
          const j = await upRes.json().catch(() => ({}));
          throw new Error(j.error || `upload failed for ${state}`);
        }
      }
      // Auto-activate the first complete theme so the user immediately sees
      // something when they flip the master switch.
      if (themes.length === 0) {
        await fetch(`/api/pet/themes/${encodeURIComponent(id)}/activate`, { method: "POST" });
      }
      setNewName("");
      setFiles({ idle: null, working: null, waiting: null, done: null });
      setCreating(false);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <SectionPage>
      <SettingsCard
        title={t("settings.pet")}
        description={t("settings.petDesc")}
      >
        <FieldRow
          label={t("pet.master")}
          description={t("pet.masterDesc")}
        >
          <Switch checked={enabled} onCheckedChange={handleToggleEnabled} disabled={loading} />
        </FieldRow>
        <FieldRow
          label={t("pet.resetPosition")}
          description={t("pet.resetPositionDesc")}
          separator
        >
          <Button variant="outline" size="sm" onClick={handleResetPos}>
            {t("pet.resetPosition")}
          </Button>
        </FieldRow>
      </SettingsCard>

      <SettingsCard title={t("pet.themes")}>
        {error ? (
          <div className="text-xs text-destructive border border-destructive/40 rounded px-3 py-2">
            {error}
          </div>
        ) : null}

        <div className="flex justify-end">
          <Dialog open={creating} onOpenChange={setCreating}>
            <DialogTrigger asChild>
              <Button size="sm">{t("pet.newTheme")}</Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{t("pet.newTheme")}</DialogTitle>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-1.5">
                  <label className="text-xs font-medium">{t("pet.newThemeName")}</label>
                  <Input
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder={t("pet.newThemeNamePlaceholder")}
                    maxLength={60}
                  />
                </div>
                <div className="space-y-3">
                  {STATES.map((state) => (
                    <FileSlot
                      key={state}
                      stateLabel={t(`pet.state${state.charAt(0).toUpperCase() + state.slice(1)}` as `pet.stateIdle`)}
                      uploadFor={t("pet.uploadFor", { state: state })}
                      file={files[state]}
                      onPick={(f) => setFiles((prev) => ({ ...prev, [state]: f }))}
                    />
                  ))}
                  <p className="text-[11px] text-muted-foreground">{t("pet.uploadHint")}</p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCreating(false)} disabled={submitting}>
                  {t("pet.cancel")}
                </Button>
                <Button onClick={handleCreate} disabled={submitting || !newName.trim() || !allFilesPicked}>
                  {t("pet.create")}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>

        {themes.length === 0 ? (
          <div className="text-sm text-muted-foreground py-6 text-center">
            {t("pet.empty")}
          </div>
        ) : (
          <div className="space-y-3">
            {themes.map((theme) => (
              <ThemeRow
                key={theme.id}
                theme={theme}
                isActive={currentId === theme.id}
                onActivate={() => handleActivate(theme.id)}
                onDelete={() => handleDelete(theme.id)}
                t={t}
              />
            ))}
          </div>
        )}
      </SettingsCard>
    </SectionPage>
  );
}

function FileSlot({
  stateLabel,
  uploadFor,
  file,
  onPick,
}: {
  stateLabel: string;
  uploadFor: string;
  file: File | null;
  onPick: (f: File | null) => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="flex items-center gap-3 border border-border/50 rounded px-3 py-2">
      <div className="w-16 text-xs font-medium">{stateLabel}</div>
      <div className="flex-1 min-w-0">
        <button
          type="button"
          onClick={() => ref.current?.click()}
          className="text-xs text-muted-foreground hover:text-foreground truncate w-full text-left"
          title={uploadFor}
        >
          {file ? file.name : uploadFor}
        </button>
        <input
          ref={ref}
          type="file"
          accept="image/png"
          className="hidden"
          onChange={(e) => onPick(e.target.files?.[0] || null)}
        />
      </div>
      {file ? (
        <Button size="sm" variant="ghost" onClick={() => onPick(null)}>
          ✕
        </Button>
      ) : null}
    </div>
  );
}

function ThemeRow({
  theme, isActive, onActivate, onDelete, t,
}: {
  theme: PetTheme;
  isActive: boolean;
  onActivate: () => void;
  onDelete: () => void;
  t: ReturnType<typeof useTranslation>["t"];
}) {
  return (
    <div className="flex items-center gap-3 border border-border/50 rounded-lg p-3">
      <div className="flex gap-1.5">
        {STATES.map((s) => (
          <div
            key={s}
            className="w-10 h-10 rounded bg-muted/40 border border-border/40 overflow-hidden flex items-center justify-center"
            title={s}
          >
            {theme.is_complete ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/api/pet/asset?theme=${encodeURIComponent(theme.id)}&state=${s}&t=${theme.created_at}`}
                alt={s}
                className="w-full h-full object-contain"
              />
            ) : (
              <span className="text-xs text-muted-foreground">?</span>
            )}
          </div>
        ))}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium truncate">{theme.name}</div>
        <div className="text-[11px] text-muted-foreground">
          {theme.is_complete ? theme.id : t("pet.incomplete")}
        </div>
      </div>
      <div className="flex gap-2">
        {isActive ? (
          <span className="text-xs px-2 py-1 rounded bg-primary/15 text-primary">
            {t("pet.activated")}
          </span>
        ) : (
          <Button
            size="sm"
            variant="outline"
            onClick={onActivate}
            disabled={!theme.is_complete}
          >
            {t("pet.activate")}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onDelete}>
          {t("pet.delete")}
        </Button>
      </div>
    </div>
  );
}
