import "./globals.css";
import { ReactNode } from "react";
import { AuthProvider } from "@/app/AuthContext";
import CookieConsentBanner from "@/app/components/CookieConsentBanner";
import { inter, jetbrainsMono, orbitron } from "@/app/fonts";

export const metadata = {
  title: "CompSocrates — Tactical Scouting HUD",
  description: "Floating-HUD scouting and strategy platform for FIRST Robotics Competition teams.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${jetbrainsMono.variable} ${orbitron.variable}`}>
      <body className="min-h-screen">
        <AuthProvider>
          <main className="w-full min-h-screen">{children}</main>
          <CookieConsentBanner />
        </AuthProvider>
      </body>
    </html>
  );
}
