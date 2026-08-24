import { Inter, JetBrains_Mono, Orbitron } from "next/font/google";

export const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });

export const jetbrainsMono = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains-mono",
  display: "swap",
  weight: ["400", "500", "600", "700"],
});

// Guaranteed-to-load display fallback behind "Dalek" — drop Dalek.woff2/.woff
// into public/fonts/ and the @font-face in globals.css picks it up with zero
// code changes; until then this renders instead.
export const orbitron = Orbitron({
  subsets: ["latin"],
  variable: "--font-orbitron",
  display: "swap",
  weight: ["600", "700", "800", "900"],
});
