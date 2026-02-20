import { Trophy } from "lucide-react";

interface FinalsMatchSelectorProps {
  onSelect: (matchNumber: number) => void;
  onBack: () => void;
}

export default function FinalsMatchSelector({ onSelect, onBack }: FinalsMatchSelectorProps) {
  const finalsMatches = [
    { num: 14, label: "Finals Match 1", desc: "First finals match" },
    { num: 15, label: "Finals Match 2", desc: "Second finals match" },
    { num: 16, label: "Finals Match 3", desc: "Third finals match (if needed)" },
  ];

  return (
    <div className="space-y-4">
      <div className="text-center mb-6">
        <Trophy className="mx-auto mb-3" size={48} style={{ color: "var(--primary-color)" }} />
        <h2 className="text-2xl font-bold mb-2">Which Finals Match?</h2>
        <p className="text-gray-600">Select which finals match you're scouting</p>
      </div>

      <div className="space-y-3">
        {finalsMatches.map((match) => (
          <button
            key={match.num}
            onClick={() => onSelect(match.num)}
            className="w-full p-4 border-2 border-gray-200 rounded-lg hover:border-red-600 hover:bg-red-50 text-left transition-all group"
          >
            <div className="flex items-center justify-between">
              <div>
                <div className="font-bold text-lg group-hover:text-red-600 transition-colors">
                  {match.label}
                </div>
                <div className="text-sm text-gray-600">{match.desc}</div>
              </div>
              <div className="text-3xl font-mono font-bold text-gray-400 group-hover:text-red-600 transition-colors">
                F{match.num}
              </div>
            </div>
          </button>
        ))}
      </div>

      <button
        onClick={onBack}
        className="w-full py-2 text-gray-600 hover:text-gray-800"
      >
        ← Back to Match Type
      </button>
    </div>
  );
}
