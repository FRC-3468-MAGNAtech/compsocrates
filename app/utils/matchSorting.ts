// Utility to properly sort matches by type (P, Q, F) then by number

export function sortMatches<T extends { matchId: string }>(matches: T[]): T[] {
  return matches.sort((a, b) => {
    const aId = a.matchId.toLowerCase();
    const bId = b.matchId.toLowerCase();
    
    // Extract type (first letter) and number
    const aType = aId[0];
    const bType = bId[0];
    const aNum = parseInt(aId.slice(1)) || 0;
    const bNum = parseInt(bId.slice(1)) || 0;
    
    // Sort order: practice (p), qualification (q), finals (f)
    const typeOrder: Record<string, number> = { 'p': 0, 'q': 1, 'f': 2 };
    const aTypeOrder = typeOrder[aType] ?? 999;
    const bTypeOrder = typeOrder[bType] ?? 999;
    
    // First sort by type
    if (aTypeOrder !== bTypeOrder) {
      return aTypeOrder - bTypeOrder;
    }
    
    // Same type, sort by number
    return aNum - bNum;
  });
}

export function getMatchTypeName(matchId: string): string {
  const type = matchId[0].toLowerCase();
  if (type === 'p') return 'Practice';
  if (type === 'q') return 'Qualification';
  if (type === 'f') return 'Finals';
  return 'Unknown';
}

export function formatMatchId(matchId: string): string {
  const type = matchId[0].toUpperCase();
  const num = matchId.slice(1);
  return `${type}${num}`;
}
