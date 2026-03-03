import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { TeamRole, TEAM_ROLES, getRoleLabel } from "@/app/utils/roles";

interface RoleSelectorProps {
  currentRoles: TeamRole[];
  isTeamAdmin: boolean;
  memberName?: string;
  onSave: (roles: TeamRole[], isTeamAdmin: boolean) => void;
  onClose: () => void;
}

export default function RoleSelector({ currentRoles, isTeamAdmin, memberName, onSave, onClose }: RoleSelectorProps) {
  const initialPrimary = currentRoles.includes("drive-team")
    ? "drive-team"
    : currentRoles.includes("pit-team")
    ? "pit-team"
    : currentRoles[0] || "match-scout";
  const [primaryRole, setPrimaryRole] = useState<TeamRole>(initialPrimary);
  const [teamAdmin, setTeamAdmin] = useState(isTeamAdmin);

  const resolvedRoles = useMemo(() => {
    if (primaryRole === "drive-team") return ["drive-team", "pit-team"] as TeamRole[];
    return [primaryRole] as TeamRole[];
  }, [primaryRole]);

  function handleSave() {
    onSave(resolvedRoles, teamAdmin);
  }

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl max-w-xl w-full max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between mb-4 px-6 pt-6">
          <div>
            <h2 className="text-xl font-bold">Change Roles</h2>
            {memberName ? <p className="text-sm text-gray-600 mt-1">{memberName}</p> : null}
          </div>
          <button onClick={onClose} className="p-1 hover:bg-gray-100 rounded">
            <X size={20} />
          </button>
        </div>

        <div className="mb-6 px-6 overflow-y-auto">
          <label className="block text-sm font-semibold text-gray-700 mb-3">Primary Role</label>
          <div className="grid gap-2">
            {TEAM_ROLES.map((role) => (
              <label
                key={role}
                className="flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
                style={{ borderColor: primaryRole === role ? "var(--primary-color)" : "#e5e7eb" }}
              >
                <input
                  type="radio"
                  checked={primaryRole === role}
                  onChange={() => setPrimaryRole(role)}
                  className="w-4 h-4"
                />
                <div className="font-semibold">{getRoleLabel(role)}</div>
              </label>
            ))}
            <label
              className="flex items-center gap-3 p-3 border-2 rounded-lg cursor-pointer hover:bg-gray-50 transition-colors"
              style={{ borderColor: teamAdmin ? "var(--primary-color)" : "#e5e7eb" }}
            >
              <input
                type="checkbox"
                checked={teamAdmin}
                onChange={(event) => setTeamAdmin(event.target.checked)}
                className="w-4 h-4"
              />
              <div className="font-semibold">Team Admin</div>
            </label>
          </div>
          {primaryRole === "drive-team" && (
            <p className="mt-3 text-sm text-gray-600">
              `Drive Team` automatically includes `Pit Team`.
            </p>
          )}
          <div className="mt-3 flex flex-wrap gap-2">
            {resolvedRoles.map((role) => (
              <span
                key={role}
                className="px-2 py-1 rounded text-xs font-medium bg-gray-100 text-gray-700 border"
              >
                {getRoleLabel(role)}
              </span>
            ))}
          </div>
        </div>

        <div className="flex gap-3 px-6 pb-6 pt-2 border-t border-gray-200">
          <button
            onClick={handleSave}
            className="flex-1 py-2 rounded-lg text-white font-semibold"
            style={{ backgroundColor: "var(--primary-color)" }}
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
