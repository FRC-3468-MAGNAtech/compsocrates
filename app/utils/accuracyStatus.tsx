// Scout Accuracy Status Colors and Labels
import React from "react";

export type AccuracyStatus = "undetermined" | "mentor-intervention" | "student-intervention" | "good" | "excellent" | "perfect";

export function getAccuracyStatus(accuracy: number): AccuracyStatus {
  if (accuracy === 0) return "undetermined";
  if (accuracy < 50) return "mentor-intervention";
  if (accuracy < 80) return "student-intervention";
  if (accuracy < 90) return "good";
  if (accuracy < 100) return "excellent";
  return "perfect";
}

export function getStatusColor(accuracy: number): string {
  const status = getAccuracyStatus(accuracy);
  
  const colors: Record<AccuracyStatus, string> = {
    "undetermined": "bg-gray-200 text-gray-600",
    "mentor-intervention": "bg-red-100 text-red-800 border-2 border-red-300",
    "student-intervention": "bg-orange-100 text-orange-800 border-2 border-orange-300",
    "good": "bg-green-700 text-white",
    "excellent": "bg-green-400 text-green-900",
    "perfect": "bg-yellow-300 text-yellow-900 border-2 border-yellow-500",
  };
  
  return colors[status];
}

export function getStatusLabel(accuracy: number): string {
  const status = getAccuracyStatus(accuracy);
  
  const labels: Record<AccuracyStatus, string> = {
    "undetermined": "Undetermined",
    "mentor-intervention": "Mentor Intervention Required",
    "student-intervention": "Student Intervention Needed",
    "good": "Good",
    "excellent": "Excellent",
    "perfect": "Perfect Score! ⭐",
  };
  
  return labels[status];
}

export function getStatusBadge(accuracy: number): React.ReactNode {
  const color = getStatusColor(accuracy);
  const label = getStatusLabel(accuracy);
  
  return (
    <div className={`inline-flex items-center gap-2 px-3 py-1 rounded-lg font-semibold text-sm ${color}`}>
      <span>{accuracy}%</span>
      <span className="opacity-75">•</span>
      <span>{label}</span>
    </div>
  );
}
