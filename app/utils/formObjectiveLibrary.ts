export type ObjectiveFieldType = "number" | "checkbox" | "text" | "select" | "rating" | "slider";

export type ObjectiveLibraryItem = {
  id: string;
  label: string;
  type: ObjectiveFieldType;
  section: string;
  game: string;
  category: "Auto" | "Teleop" | "Endgame" | "Pit" | "Subjective" | "Custom";
  options?: string[];
  scaleLabels?: string[];
};

export const OBJECTIVE_LIBRARY: ObjectiveLibraryItem[] = [
  { id: "charged_auto_mobility", label: "Mobility", type: "checkbox", section: "Autonomous", game: "2023 Charged Up", category: "Auto" },
  { id: "charged_auto_grid_bottom", label: "Auto Grid Bottom", type: "number", section: "Autonomous", game: "2023 Charged Up", category: "Auto" },
  { id: "charged_auto_grid_middle", label: "Auto Grid Middle", type: "number", section: "Autonomous", game: "2023 Charged Up", category: "Auto" },
  { id: "charged_auto_grid_top", label: "Auto Grid Top", type: "number", section: "Autonomous", game: "2023 Charged Up", category: "Auto" },
  { id: "charged_endgame_station", label: "Charge Station", type: "select", section: "Endgame", game: "2023 Charged Up", category: "Endgame", options: ["None", "Parked", "Docked", "Engaged"] },
  { id: "reef_auto_leave", label: "Left Starting Zone", type: "checkbox", section: "Autonomous", game: "2025 REEFSCAPE", category: "Auto" },
  { id: "reef_auto_coral_l4", label: "Auto Coral L4", type: "number", section: "Autonomous", game: "2025 REEFSCAPE", category: "Auto" },
  { id: "reef_auto_algae_processor", label: "Auto Algae Processor", type: "number", section: "Autonomous", game: "2025 REEFSCAPE", category: "Auto" },
  { id: "reef_teleop_coral_l4", label: "Teleop Coral L4", type: "number", section: "Teleop", game: "2025 REEFSCAPE", category: "Teleop" },
  { id: "reef_teleop_processor", label: "Teleop Processor", type: "number", section: "Teleop", game: "2025 REEFSCAPE", category: "Teleop" },
  { id: "reef_endgame_cage", label: "Cage Status", type: "select", section: "Endgame", game: "2025 REEFSCAPE", category: "Endgame", options: ["Not Parked", "Parked", "Shallow Cage", "Deep Cage"] },
  { id: "rebuilt_auto_preload", label: "Auto Preload Capacity", type: "slider", section: "Autonomous", game: "2026 REBUILT", category: "Auto", scaleLabels: ["0", "1-2", "3-4", "5-6", "7-8"] },
  { id: "rebuilt_auto_climb", label: "Auto Climb", type: "checkbox", section: "Autonomous", game: "2026 REBUILT", category: "Auto" },
  { id: "rebuilt_cycle_bps", label: "Fuel Scoring Rate", type: "slider", section: "Teleop", game: "2026 REBUILT", category: "Teleop", scaleLabels: ["0", "Low", "Developing", "Strong", "Elite"] },
  { id: "rebuilt_endgame_climb", label: "Endgame Climb Level", type: "select", section: "Endgame", game: "2026 REBUILT", category: "Endgame", options: ["None", "Level 1", "Level 2", "Level 3"] },
  { id: "custom_counter", label: "Custom Counter", type: "number", section: "Teleop", game: "Universal", category: "Custom" },
  { id: "custom_toggle", label: "Custom Toggle", type: "checkbox", section: "Subjective", game: "Universal", category: "Custom" },
  { id: "custom_rating", label: "Custom Rating", type: "rating", section: "Subjective", game: "Universal", category: "Custom", scaleLabels: ["Poor", "Limited", "Average", "Strong", "Elite"] },
  { id: "custom_notes", label: "Open Text Notes", type: "text", section: "Post-Match", game: "Universal", category: "Custom" },
];
