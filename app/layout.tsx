import "./globals.css";
import { ReactNode } from "react";
import { AuthProvider } from "@/app/AuthContext";
import ThemeInitializer from "@/app/components/ThemeInitializer";

export const metadata = {
  title: "CompSocrates Scouting",
  description: "Scouting website for robotics competitions",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen">
        <AuthProvider>
          <ThemeInitializer />
          <main className="w-full min-h-screen">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}
