// TBA API Helper Functions
// The Blue Alliance API integration for practice scouting

const TBA_BASE_URL = 'https://www.thebluealliance.com/api/v3';
const TBA_AUTH_KEY = process.env.NEXT_PUBLIC_TBA_API_KEY || '';

export interface TBAMatch {
  key: string;
  event_key: string;
  comp_level: string;
  match_number: number;
  alliances: {
    red: {
      score: number;
      team_keys: string[];
    };
    blue: {
      score: number;
      team_keys: string[];
    };
  };
  score_breakdown: {
    red: any;
    blue: any;
  };
  videos: Array<{
    type: string;
    key: string;
  }>;
}

export async function fetchEventMatches(eventKey: string): Promise<TBAMatch[]> {
  try {
    const response = await fetch(`${TBA_BASE_URL}/event/${eventKey}/matches`, {
      headers: {
        'X-TBA-Auth-Key': TBA_AUTH_KEY,
      },
    });
    
    if (!response.ok) {
      throw new Error(`TBA API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching matches:', error);
    return [];
  }
}

export async function fetchMatchDetails(matchKey: string): Promise<TBAMatch | null> {
  try {
    const response = await fetch(`${TBA_BASE_URL}/match/${matchKey}`, {
      headers: {
        'X-TBA-Auth-Key': TBA_AUTH_KEY,
      },
    });
    
    if (!response.ok) {
      throw new Error(`TBA API error: ${response.status}`);
    }
    
    return await response.json();
  } catch (error) {
    console.error('Error fetching match details:', error);
    return null;
  }
}

export function getYouTubeUrl(match: TBAMatch): string | null {
  const youtubeVideo = match.videos?.find(v => v.type === 'youtube');
  if (youtubeVideo) {
    return `https://www.youtube.com/embed/${youtubeVideo.key}`;
  }
  return null;
}

export function categorizeMatchDifficulty(allianceScore: number): 'easy' | 'medium' | 'hard' {
  if (allianceScore <= 200) return 'easy';
  if (allianceScore <= 400) return 'medium';
  return 'hard';
}

export function extractTeamNumber(teamKey: string): number {
  return parseInt(teamKey.replace('frc', ''));
}

// Filter matches for practice scouting
export function filterPracticeMatches(
  matches: TBAMatch[],
  difficulty?: 'easy' | 'medium' | 'hard'
): TBAMatch[] {
  return matches.filter(match => {
    // Must be qualification matches
    if (match.comp_level !== 'qm') return false;
    
    // Must have video
    if (!match.videos || match.videos.length === 0) return false;
    
    // Must have scores
    if (!match.alliances?.red?.score || !match.alliances?.blue?.score) return false;
    
    // Filter by difficulty if specified
    if (difficulty) {
      const redDifficulty = categorizeMatchDifficulty(match.alliances.red.score);
      const blueDifficulty = categorizeMatchDifficulty(match.alliances.blue.score);
      
      // Match must have at least one alliance in the target difficulty
      if (redDifficulty !== difficulty && blueDifficulty !== difficulty) {
        return false;
      }
    }
    
    return true;
  });
}

// Get a random practice match
export function getRandomPracticeMatch(
  matches: TBAMatch[],
  difficulty: 'easy' | 'medium' | 'hard'
): { match: TBAMatch; alliance: 'red' | 'blue' } | null {
  const filtered = filterPracticeMatches(matches, difficulty);
  
  if (filtered.length === 0) return null;
  
  const randomMatch = filtered[Math.floor(Math.random() * filtered.length)];
  
  // Determine which alliance matches the difficulty
  const redDifficulty = categorizeMatchDifficulty(randomMatch.alliances.red.score);
  const blueDifficulty = categorizeMatchDifficulty(randomMatch.alliances.blue.score);
  
  let alliance: 'red' | 'blue';
  
  if (redDifficulty === difficulty && blueDifficulty === difficulty) {
    // Both match, pick randomly
    alliance = Math.random() < 0.5 ? 'red' : 'blue';
  } else if (redDifficulty === difficulty) {
    alliance = 'red';
  } else {
    alliance = 'blue';
  }
  
  return { match: randomMatch, alliance };
}
