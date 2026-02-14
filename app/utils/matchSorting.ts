// FILE: app/utils/matchSorting.ts
// COMPLETE NEW FILE - Match sorting utility

export function sortMatches(matches: string[]): string[] {
  return matches.sort((a, b) => {
    const aStr = a.toString();
    const bStr = b.toString();
    
    const aType = aStr[0]?.toLowerCase() || '';
    const bType = bStr[0]?.toLowerCase() || '';
    
    // Type order: Practice (p) -> Qualification (q) -> Finals (f)
    const typeOrder: { [key: string]: number } = { p: 0, q: 1, f: 2 };
    
    const aTypeOrder = typeOrder[aType] !== undefined ? typeOrder[aType] : 99;
    const bTypeOrder = typeOrder[bType] !== undefined ? typeOrder[bType] : 99;
    
    // Sort by type first
    if (aTypeOrder !== bTypeOrder) {
      return aTypeOrder - bTypeOrder;
    }
    
    // Then by number
    const aNum = parseInt(aStr.slice(1)) || 0;
    const bNum = parseInt(bStr.slice(1)) || 0;
    return aNum - bNum;
  });
}

export function formatMatchDisplay(matchId: string, matchType?: string): string {
  const matchStr = matchId.toString();
  const firstChar = matchStr[0]?.toLowerCase();
  const number = matchStr.slice(1);
  
  // If matchType is provided, use that
  if (matchType) {
    const typeMap: { [key: string]: string } = {
      practice: 'P',
      qualification: 'Q',
      finals: 'F',
      playoff: 'F'
    };
    const prefix = typeMap[matchType.toLowerCase()] || 'Q';
    return `${prefix}${number}`;
  }
  
  // Otherwise infer from ID
  if (firstChar === 'p') return `P${number}`;
  if (firstChar === 'f') return `F${number}`;
  return `Q${number}`;
}
