import { useState } from "react";
import { X } from "lucide-react";

interface RoleSelectorProps {
  currentRole: "scout" | "coach";
  currentSpecialRoles: string[];
  onSave: (role: "scout" | "coach", specialRoles: string[]) => void;
  onClose: () => void;
}

export default function RoleSelector({ currentRole, currentSpecialRoles, onSave, onClose }: RoleSelectorProps) {
  const [baseRole, setBaseRole] = useState<"scout" | "coach">(currentRole);
  const [specialRoles, setSpecialRoles] = useState<string[]>(currentSpecialRoles || []);

  const specialRoleOptions = [
    { value: "lead-scout", label: "Lead Scout" },
    { value: "lead-strategist", label: "Lead Strategist" },
    { value: "pit-scout", label: "Pit Scout" },
    { value: "team-admin", label: "Team Admin" },
  ];

  function toggleSpecialRole(role: string) {
    if (specialRoles.includes(role)) {
      setSpecialRoles(specialRoles.filter(r => r !== role));
    } else {
      const exclusiveSpecialRoles = ["lead-scout", "lead-strategist", "pit-scout"];
      if (exclusiveSpecialRoles.includes(role)) {
        const withoutExclusive = specialRoles.filter((r) => !exclusiveSpecialRoles.includes(r));
        setSpecialRoles([...withoutExclusive, role]);
        return;
      }
      setSpecialRoles([...specialRoles, role]);
    }
  }

  function handleSave() {
    onSave(baseRole, specialRoles);
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-md w-full p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold">Change Roles</h2>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={20} />
          </button>
        </div>

        {/* Base Role */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-700 mb-3">Base Role (choose one)</label>
          <div className="space-y-2">
            <label className="flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                   style={{ borderColor: baseRole === "scout" ? "#c42221" : "#e5e7eb" }}>
              <input
                type="radio"
                checked={baseRole === "scout"}
                onChange={() => setBaseRole("scout")}
                className="w-4 h-4"
              />
              <div>
                <div className="font-semibold">Scout</div>
                <div className="text-xs text-gray-600">Collect match data</div>
              </div>
            </label>

            <label className="flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                   style={{ borderColor: baseRole === "coach" ? "#c42221" : "#e5e7eb" }}>
              <input
                type="radio"
                checked={baseRole === "coach"}
                onChange={() => setBaseRole("coach")}
                className="w-4 h-4"
              />
              <div>
                <div className="font-semibold">Coach</div>
                <div className="text-xs text-gray-600">Manage team and scouts</div>
              </div>
            </label>
          </div>
        </div>

        {/* Special Roles */}
        <div className="mb-6">
          <label className="block text-sm font-semibold text-gray-700 mb-3">
            Special Roles (select all that apply)
          </label>
          <p className="text-xs text-gray-500 mb-3">
            Lead Scout, Lead Strategist, and Pit Scout are mutually exclusive.
          </p>
          <div className="space-y-2">
            {specialRoleOptions.map(option => (
              <label
                key={option.value}
                className="flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                style={{ borderColor: specialRoles.includes(option.value) ? "#c42221" : "#e5e7eb" }}
              >
                <input
                  type="checkbox"
                  checked={specialRoles.includes(option.value)}
                  onChange={() => toggleSpecialRole(option.value)}
                  className="w-4 h-4"
                />
                <div className="font-medium">{option.label}</div>
              </label>
            ))}
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <button
            onClick={handleSave}
            className="flex-1 py-2 rounded-lg text-white font-semibold"
            style={{ backgroundColor: "#c42221" }}
          >
            Save Changes
          </button>
          <button
            onClick={onClose}
            className="flex-1 py-2 rounded-lg border-2 border-gray-300 font-semibold hover:bg-gray-50"
          >
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
