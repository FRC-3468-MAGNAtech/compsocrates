// Consistent loading spinner component
export function LoadingSpinner({ message = "Loading..." }: { message?: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="relative w-16 h-16 mb-4">
        <div className="absolute inset-0 border-4 border-gray-200 rounded-full"></div>
        <div className="absolute inset-0 border-4 border-transparent border-t-red-600 rounded-full animate-spin"></div>
      </div>
      <p className="text-gray-600">{message}</p>
    </div>
  );
}

export function LoadingSpinnerSmall() {
  return (
    <div className="relative w-6 h-6">
      <div className="absolute inset-0 border-2 border-gray-200 rounded-full"></div>
      <div className="absolute inset-0 border-2 border-transparent border-t-red-600 rounded-full animate-spin"></div>
    </div>
  );
}
