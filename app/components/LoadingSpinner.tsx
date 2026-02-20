// Consistent loading spinner component
export default function LoadingSpinner({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="relative w-16 h-16 mb-4">
        <div className="absolute inset-0 border-4 rounded-full" style={{ borderColor: "var(--theme-border)" }}></div>
        <div
          className="absolute inset-0 border-4 border-transparent rounded-full animate-spin"
          style={{ borderTopColor: "var(--primary-color)" }}
        ></div>
      </div>
      <p className="text-gray-600">{message}</p>
    </div>
  );
}

export function LoadingSpinnerSmall() {
  return (
    <div className="relative w-6 h-6">
      <div className="absolute inset-0 border-2 rounded-full" style={{ borderColor: "var(--theme-border)" }}></div>
      <div
        className="absolute inset-0 border-2 border-transparent rounded-full animate-spin"
        style={{ borderTopColor: "var(--primary-color)" }}
      ></div>
    </div>
  );
}
