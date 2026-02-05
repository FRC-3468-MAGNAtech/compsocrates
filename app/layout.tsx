import "../globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "CompSocrates Scouting",
  description: "Scouting website for robotics competitions",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-100 text-gray-900">
        <main className="w-full min-h-screen">
          {children}
        </main>
      </body>
    </html>
  );
}