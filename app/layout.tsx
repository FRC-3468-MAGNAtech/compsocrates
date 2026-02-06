import "./globals.css";
import { ReactNode } from "react";
import { AuthProvider } from "@/app/AuthContext";

export const metadata = {
  title: "CompSocrates Scouting",
  description: "Scouting website for robotics competitions",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-gray-100 text-gray-900">
        <AuthProvider>
          <main className="w-full min-h-screen">
            {children}
          </main>
        </AuthProvider>
      </body>
    </html>
  );
}