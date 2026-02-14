// FILE: app/components/LoadingSpinner.tsx
// COMPLETE REWRITE - Consistent loading component used everywhere

"use client";

interface LoadingSpinnerProps {
  message?: string;
  size?: "small" | "medium" | "large";
  fullPage?: boolean;
}

export default function LoadingSpinner({ 
  message = "Loading...", 
  size = "medium",
  fullPage = false 
}: LoadingSpinnerProps) {
  const sizeMap = {
    small: "w-8 h-8 border-2",
    medium: "w-12 h-12 border-3",
    large: "w-16 h-16 border-4"
  };

  const content = (
    <div className="flex flex-col items-center justify-center">
      <div 
        className={`${sizeMap[size]} border-gray-200 rounded-full animate-spin`}
        style={{ 
          borderTopColor: "#c42221",
          borderRightColor: "#c42221"
        }}
      />
      {message && (
        <p className="mt-4 text-gray-600 text-sm font-medium">{message}</p>
      )}
    </div>
  );

  if (fullPage) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50">
        {content}
      </div>
    );
  }

  return (
    <div className="p-12">
      {content}
    </div>
  );
}
