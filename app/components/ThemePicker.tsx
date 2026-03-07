"use client";

import { useEffect, useMemo, useState } from "react";
import { Check, Palette, X } from "lucide-react";
import { useAuth } from "@/app/AuthContext";
import {
  applyFontPreset,
  applyTheme,
  clearFontPresetOverride,
  clearThemeOverride,
  fontPresets,
  getFontPreset,
  getTheme,
  loadAccountFontCache,
  loadAccountThemeCache,
  loadFontPresetOverride,
  loadThemeOverride,
  saveAccountFontCache,
  saveAccountThemeCache,
  saveFontPreset,
  saveTheme,
  themes,
  type Theme,
} from "@/app/utils/themes";

function ThemeCard({
  theme,
  isSelected,
  onSelect,
}: {
  theme: Theme;
  isSelected: boolean;
  onSelect: (themeId: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(theme.id)}
      className={`w-full rounded-lg border p-3 text-left transition ${
        isSelected ? "border-gray-900 shadow-sm" : "border-gray-200 hover:border-gray-300"
      }`}
      style={{ backgroundColor: "var(--theme-surface)" }}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="text-sm font-semibold" style={{ color: "var(--theme-body-text)" }}>
          {theme.name}
        </p>
        {isSelected && <Check size={16} style={{ color: "var(--primary-color)" }} />}
      </div>
      <div className="mb-2 flex items-center gap-2">
        <span className="h-5 w-5 rounded-full border border-black/10" style={{ backgroundColor: theme.primaryColor }} />
        <span className="h-5 w-5 rounded-full border border-black/10" style={{ backgroundColor: theme.accentColor }} />
        <span className="h-5 w-5 rounded-full border border-black/10" style={{ backgroundColor: theme.bgColor }} />
      </div>
      <p className="text-xs" style={{ color: "var(--theme-subtle-text)" }}>
        {theme.headingFont.replace(/'/g, "").split(",")[0]} + {theme.bodyFont.replace(/'/g, "").split(",")[0]}
      </p>
    </button>
  );
}

export default function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { userData, updateUserData } = useAuth();
  const [open, setOpen] = useState(false);
  const [selectedThemeId, setSelectedThemeId] = useState<string>("light-compsocrates");
  const [selectedFontId, setSelectedFontId] = useState<string>("compsocrates");
  const [useDeviceOverride, setUseDeviceOverride] = useState(false);

  useEffect(() => {
    if (!userData?.uid) return;
    const themeOverride = loadThemeOverride(userData.uid);
    const fontOverride = loadFontPresetOverride(userData.uid);
    const accountTheme =
      String(userData.accountThemeId || "").trim() ||
      loadAccountThemeCache(userData.uid) ||
      "light-compsocrates";
    const accountFont =
      String(userData.accountFontId || "").trim() ||
      loadAccountFontCache(userData.uid) ||
      "compsocrates";

    setUseDeviceOverride(Boolean(themeOverride || fontOverride));
    setSelectedThemeId(themeOverride || accountTheme);
    setSelectedFontId(fontOverride || accountFont);
  }, [userData?.uid, userData?.accountThemeId, userData?.accountFontId]);

  const groupedThemes = useMemo(
    () => ({
      light: themes.filter((theme) => theme.category === "light"),
      dark: themes.filter((theme) => theme.category === "dark"),
      pride: themes.filter((theme) => theme.category === "pride"),
    }),
    [],
  );

  const activeTheme = getTheme(selectedThemeId, userData?.uid);

  async function handleSelectTheme(themeId: string) {
    setSelectedThemeId(themeId);
    const chosenTheme = getTheme(themeId, userData?.uid);
    applyTheme(chosenTheme);
    applyFontPreset(getFontPreset(selectedFontId));
    if (userData?.uid) {
      if (useDeviceOverride) {
        saveTheme(userData.uid, themeId);
      } else {
        clearThemeOverride(userData.uid);
        saveAccountThemeCache(userData.uid, themeId);
        await updateUserData({ accountThemeId: themeId });
      }
    }
  }

  async function handleSelectFont(fontId: string) {
    setSelectedFontId(fontId);
    applyFontPreset(getFontPreset(fontId));
    if (userData?.uid) {
      if (useDeviceOverride) {
        saveFontPreset(userData.uid, fontId);
      } else {
        clearFontPresetOverride(userData.uid);
        saveAccountFontCache(userData.uid, fontId);
        await updateUserData({ accountFontId: fontId });
      }
    }
  }

  async function handleDeviceOverrideToggle(nextValue: boolean) {
    if (!userData?.uid) return;
    setUseDeviceOverride(nextValue);
    if (nextValue) {
      saveTheme(userData.uid, selectedThemeId);
      saveFontPreset(userData.uid, selectedFontId);
      return;
    }
    clearThemeOverride(userData.uid);
    clearFontPresetOverride(userData.uid);
    saveAccountThemeCache(userData.uid, selectedThemeId);
    saveAccountFontCache(userData.uid, selectedFontId);
    await updateUserData({ accountThemeId: selectedThemeId, accountFontId: selectedFontId });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`flex items-center justify-between gap-3 rounded-lg border border-gray-200 text-left ${
          compact ? "w-full px-3 py-2 text-sm" : "w-full px-4 py-3"
        }`}
        style={{ backgroundColor: "var(--theme-surface)" }}
      >
        <div className="flex items-center gap-2">
          <Palette size={18} style={{ color: "var(--primary-color)" }} />
          <div>
            <p className="font-medium" style={{ color: "var(--theme-body-text)" }}>
              Theme: {activeTheme.name}
            </p>
            {!compact && (
              <p className="text-xs" style={{ color: "var(--theme-subtle-text)" }}>
                Colors and fonts can be changed separately
              </p>
            )}
          </div>
        </div>
        <span className="h-4 w-4 rounded-full border border-black/10" style={{ backgroundColor: activeTheme.primaryColor }} />
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4">
          <div
            className="max-h-[85vh] w-full max-w-4xl overflow-hidden rounded-xl border shadow-xl"
            style={{
              backgroundColor: "var(--theme-surface)",
              borderColor: "var(--theme-border)",
            }}
          >
            <div className="flex items-center justify-between border-b px-5 py-4" style={{ borderColor: "var(--theme-border)" }}>
              <div>
                <h3 className="text-lg font-semibold" style={{ color: "var(--primary-color)" }}>
                  Choose Theme
                </h3>
                <p className="text-sm" style={{ color: "var(--theme-subtle-text)" }}>
                  Organized by Light, Dark, then Pride
                </p>
              </div>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded-md border px-2 py-2"
                style={{ borderColor: "var(--theme-border)", color: "var(--theme-body-text)" }}
              >
                <X size={16} />
              </button>
            </div>

            <div className="max-h-[calc(85vh-74px)] space-y-6 overflow-y-auto p-5">
              <section className="rounded-lg border p-3" style={{ borderColor: "var(--theme-border)" }}>
                <label className="flex items-center gap-2 text-sm" style={{ color: "var(--theme-body-text)" }}>
                  <input
                    type="checkbox"
                    checked={useDeviceOverride}
                    onChange={(event) => void handleDeviceOverrideToggle(event.target.checked)}
                  />
                  Use device-specific override
                </label>
                <p className="mt-1 text-xs" style={{ color: "var(--theme-subtle-text)" }}>
                  Off = account-wide theme on all devices. On = this device can use a different theme.
                </p>
              </section>

              <section>
                <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--theme-subtle-text)" }}>
                  Font
                </h4>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  {fontPresets.map((font) => {
                    const selected = selectedFontId === font.id;
                    return (
                      <button
                        key={font.id}
                        type="button"
                        onClick={() => handleSelectFont(font.id)}
                        className={`rounded-lg border p-3 text-left transition ${
                          selected ? "border-gray-900 shadow-sm" : "border-gray-200 hover:border-gray-300"
                        }`}
                        style={{ backgroundColor: "var(--theme-surface)" }}
                      >
                        <p className="text-sm font-semibold" style={{ color: "var(--theme-body-text)", fontFamily: font.headingFont }}>
                          {font.name}
                        </p>
                        <p className="mt-1 text-xs" style={{ color: "var(--theme-subtle-text)", fontFamily: font.bodyFont }}>
                          The quick brown fox
                        </p>
                      </button>
                    );
                  })}
                </div>
              </section>

              <section>
                <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--theme-subtle-text)" }}>
                  Light
                </h4>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {groupedThemes.light.map((theme) => (
                    <ThemeCard key={theme.id} theme={theme} isSelected={selectedThemeId === theme.id} onSelect={handleSelectTheme} />
                  ))}
                </div>
              </section>

              <section>
                <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--theme-subtle-text)" }}>
                  Dark
                </h4>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {groupedThemes.dark.map((theme) => (
                    <ThemeCard key={theme.id} theme={theme} isSelected={selectedThemeId === theme.id} onSelect={handleSelectTheme} />
                  ))}
                </div>
              </section>

              <section>
                <h4 className="mb-3 text-sm font-semibold uppercase tracking-wide" style={{ color: "var(--theme-subtle-text)" }}>
                  Pride
                </h4>
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {groupedThemes.pride.map((theme) => (
                    <ThemeCard key={theme.id} theme={theme} isSelected={selectedThemeId === theme.id} onSelect={handleSelectTheme} />
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
