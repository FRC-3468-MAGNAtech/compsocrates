import { ReactNode } from "react";

export const metadata = {
  title: "Analytics",
  description: "Analytics page layout",
};

export default function AnalyticsLayout({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-white text-black">
      {children}
    </div>
  );
}