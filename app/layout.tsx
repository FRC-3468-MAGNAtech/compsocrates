import "./globals.css";
import { ReactNode } from "react";
import { AuthProvider } from "@/app/AuthContext";
import CookieConsentBanner from "@/app/components/CookieConsentBanner";

export const metadata = {
  title: "CompSocrates",
  description: "Greek-Tech scouting and strategy platform for competition robotics",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AuthProvider>
          <main className="w-full min-h-screen">
            {children}
          </main>
          <CookieConsentBanner />
        </AuthProvider>
      </body>
    </html>
  );
}
