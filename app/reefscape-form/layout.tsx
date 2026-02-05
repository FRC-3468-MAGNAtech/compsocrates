import "../globals.css";
import { ReactNode } from "react";

export const metadata = {
  title: "CompSocrates Scouting",
  description: "Scouting website for robotics competitions",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}