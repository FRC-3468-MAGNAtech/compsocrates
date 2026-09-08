import type { Metadata } from "next";
import "./globals.css";
import Sidebar from "./_components/Sidebar";
import Topbar from "./_components/Topbar";

export const metadata: Metadata = {
  title: "CompSocrates — FRC Scouting Suite",
  description: "Dark, energetic scouting and strategy platform for FRC teams.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <div className="flex min-h-screen">
          <Sidebar />
          <div className="flex min-h-screen flex-1 flex-col">
            <Topbar />
            <main className="flex-1 px-4 py-6 sm:px-8 sm:py-10">{children}</main>
          </div>
        </div>
      </body>
    </html>
  );
}
