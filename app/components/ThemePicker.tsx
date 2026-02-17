// FILE: app/components/ThemePicker.tsx
// UPDATED - Pride flag categories

"use client";

import { useState, useEffect } from "react";
import { themes, getTheme, applyTheme, saveTheme, loadTheme } from "@/app/utils/themes";
import { useAuth } from "@/app/AuthContext";
import { Palette, Check } from "lucide-react";

export default function ThemePicker({ compact = false }: { compact?: boolean }) {
  const { userData } = useAuth();
  const [selectedTheme, setSelectedTheme] = useState("default");
  const [showPicker, setShowPicker] = useState(false);

  useEffect(() => {
    const savedTheme = userData?.uid ? loadTheme(userData.uid) : "default";
    applyTheme(getTheme(savedTheme));
  }, [userData?.uid]);

  function togglePicker() {
    if (!showPicker) {
      const savedTheme = userData?.uid ? loadTheme(userData.uid) : "default";
      setSelectedTheme(savedTheme);
    }
    setShowPicker(!showPicker);
  }

  function handleThemeSelect(themeId: string) {
    if (!userData?.uid) return;
    
    setSelectedTheme(themeId);
    const theme = getTheme(themeId);
    applyTheme(theme);
    saveTheme(userData.uid, themeId);
    setShowPicker(false);
  }

  // Pride flag themes
  const prideThemes = themes.filter(t => 
    ["pride-rainbow", "lesbian", "gay", "bisexual", "pansexual", "transgender", 
     "nonbinary", "genderfluid", "asexual", "demisexual", "aromantic", "genderqueer",
     "agender", "polysexual", "omnisexual"].includes(t.id)
  );

  // Solid color themes
  const solidThemes = themes.filter(t => 
    ["default", "ocean-blue", "navy", "cyan", "purple", "lavender", "rose", 
     "pink", "emerald", "forest", "orange", "amber"].includes(t.id)
  );

  // Dark themes
  const darkThemes = themes.filter(t => t.id.startsWith("dark-"));

  return (
    <div className="relative">
      <button
        onClick={togglePicker}
        className={`flex items-center gap-2 rounded-lg hover:bg-gray-100 transition-colors ${
          compact ? "w-full px-2 py-2 text-sm" : "px-4 py-2"
        }`}
        title="Change Theme"
      >
        <Palette size={20} />
        <span className="font-medium">{compact ? "Themes" : "Theme"}</span>
      </button>

      {showPicker && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white rounded-xl shadow-xl w-[95vw] max-w-6xl max-h-[90vh] overflow-y-auto p-6 m-2">
            <div className="flex items-center justify-between mb-6">
              <h2 className="text-2xl font-bold" style={{ color: "var(--primary-color)" }}>
                Choose Your Theme
              </h2>
              <button
                onClick={() => setShowPicker(false)}
                className="p-2 hover:bg-gray-100 rounded-lg"
              >
                Close
              </button>
            </div>

            {/* Theme Categories */}
            <div className="space-y-8">
              {/* Pride Flags */}
              <div>
                <h3 className="text-lg font-semibold mb-4 text-gray-700">Pride Flags</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-4">
                  {prideThemes.map(theme => (
                    <button
                      key={theme.id}
                      onClick={() => handleThemeSelect(theme.id)}
                      className="relative p-4 rounded-lg border-2 hover:scale-105 transition-transform"
                      style={{
                        background: theme.gradient,
                        borderColor: selectedTheme === theme.id ? "#000" : "transparent"
                      }}
                    >
                      <div className="absolute top-2 right-2">
                        {selectedTheme === theme.id && (
                          <Check size={20} className="text-white drop-shadow-lg" />
                        )}
                      </div>
                      <div className="h-16"></div>
                      <p className="text-white font-semibold text-center text-sm drop-shadow-lg">
                        {theme.name}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Solid Colors */}
              <div>
                <h3 className="text-lg font-semibold mb-4 text-gray-700">Solid Colors</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                  {solidThemes.map(theme => (
                    <button
                      key={theme.id}
                      onClick={() => handleThemeSelect(theme.id)}
                      className="relative p-4 rounded-lg border-2 hover:scale-105 transition-transform"
                      style={{
                        background: theme.gradient,
                        borderColor: selectedTheme === theme.id ? "#000" : "transparent"
                      }}
                    >
                      <div className="absolute top-2 right-2">
                        {selectedTheme === theme.id && (
                          <Check size={20} className="text-white" />
                        )}
                      </div>
                      <p className="text-white font-semibold text-center mt-8">
                        {theme.name}
                      </p>
                    </button>
                  ))}
                </div>
              </div>

              {/* Dark Themes */}
              <div>
                <h3 className="text-lg font-semibold mb-4 text-gray-700">Dark Mode</h3>
                <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                  {darkThemes.map(theme => (
                    <button
                      key={theme.id}
                      onClick={() => handleThemeSelect(theme.id)}
                      className="relative p-4 rounded-lg border-2 hover:scale-105 transition-transform"
                      style={{
                        background: theme.gradient,
                        borderColor: selectedTheme === theme.id ? "#fff" : "transparent"
                      }}
                    >
                      <div className="absolute top-2 right-2">
                        {selectedTheme === theme.id && (
                          <Check size={20} className="text-white" />
                        )}
                      </div>
                      <p className="text-white font-semibold text-center mt-8">
                        {theme.name}
                      </p>
                    </button>
                  ))}
                </div>
              </div>
            </div>

            <div className="mt-6 p-4 bg-gray-50 rounded-lg">
              <p className="text-sm text-gray-600 text-center">
                Theme preferences are saved locally to your device.
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
