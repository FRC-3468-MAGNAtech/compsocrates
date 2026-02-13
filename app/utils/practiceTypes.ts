// Practice Scouting Type Definitions

export interface PracticeMatch {
  id: string;
  matchKey: string;
  eventName: string;
  eventKey: string;
  matchNumber: number;
  videoUrl: string;
  difficulty: 'easy' | 'medium' | 'hard';
  
  // Alliance to scout
  alliance: 'red' | 'blue';
  allianceScore: number;
  
  // Specific team to watch
  teamPosition: number; // 0, 1, or 2 (index in team array)
  teamNumber: number;
  
  // Actual score for accuracy comparison
  actualScore: number;
  
  // Official data for accuracy calculation
  officialData: {
    score: number;
    penaltyPoints: number;
    breakdown: any;
  };
  
  createdAt: number;
}

export interface PracticeSession {
  id: string;
  scoutName: string;
  scoutId: string;
  
  // Match information
  matchKey: string;
  matchNumber: number;
  teamNumber: number;
  difficulty: 'easy' | 'medium' | 'hard';
  
  // Scouted data (same structure as regular scouting)
  scoutedData: {
    teamNumber: string;
    startingPosition: string;
    leftStartingZone: boolean;
    
    autoCoralMissed: number;
    autoCoralL1: number;
    autoCoralL2: number;
    autoCoralL3: number;
    autoCoralL4: number;
    autoAlgaeProcessorMissed: number;
    autoAlgaeProcessorScored: number;
    autoAlgaeNetMissed: number;
    autoAlgaeNetScored: number;
    
    teleopCoralMissed: number;
    teleopCoralL1: number;
    teleopCoralL2: number;
    teleopCoralL3: number;
    teleopCoralL4: number;
    teleopAlgaeRemoved: boolean;
    teleopProcessorMissed: number;
    teleopProcessorScored: number;
    teleopNetRobotMissed: number;
    teleopNetRobotScored: number;
    teleopNetHumanMissed: number;
    teleopNetHumanScored: number;
    
    failedClimb: number;
    stageStatus: string;
    
    incidents: string[];
    notes: string;
  };
  
  // Accuracy results
  scoutedScore: number;
  officialScore: number;
  accuracy: number; // 0-100 percentage
  
  // Timestamps
  startedAt: number;
  completedAt: number;
}

export interface PracticeStats {
  totalSessions: number;
  averageAccuracy: number;
  bestAccuracy: number;
  recentAccuracies: number[]; // Last 5
  sessionsByDifficulty: {
    easy: number;
    medium: number;
    hard: number;
  };
  accuracyByDifficulty: {
    easy: number;
    medium: number;
    hard: number;
  };
}

// Scoring constants (same as main app)
export const SCORING_POINTS = {
  LEAVE: 3,
  AUTO_CORAL_L1: 3,
  AUTO_CORAL_L2: 4,
  AUTO_CORAL_L3: 6,
  AUTO_CORAL_L4: 7,
  AUTO_ALGAE_PROC: 6,
  AUTO_ALGAE_NET: 4,
  TELE_CORAL_L1: 2,
  TELE_CORAL_L2: 3,
  TELE_CORAL_L3: 4,
  TELE_CORAL_L4: 5,
  TELE_ALGAE_PROC: 6,
  TELE_ALGAE_NET_R: 4,
  TELE_ALGAE_NET_H: 4,
  CLIMB_PARK: 2,
  CLIMB_SHALLOW: 6,
  CLIMB_DEEP: 12,
  ALGAE_REMOVED: 2,
};

// Calculate score from scouted data
export function calculateScoutedScore(data: PracticeSession['scoutedData']): number {
  let score = 0;
  
  if (data.leftStartingZone) score += SCORING_POINTS.LEAVE;
  
  score += data.autoCoralL1 * SCORING_POINTS.AUTO_CORAL_L1;
  score += data.autoCoralL2 * SCORING_POINTS.AUTO_CORAL_L2;
  score += data.autoCoralL3 * SCORING_POINTS.AUTO_CORAL_L3;
  score += data.autoCoralL4 * SCORING_POINTS.AUTO_CORAL_L4;
  score += data.autoAlgaeProcessorScored * SCORING_POINTS.AUTO_ALGAE_PROC;
  score += data.autoAlgaeNetScored * SCORING_POINTS.AUTO_ALGAE_NET;
  
  score += data.teleopCoralL1 * SCORING_POINTS.TELE_CORAL_L1;
  score += data.teleopCoralL2 * SCORING_POINTS.TELE_CORAL_L2;
  score += data.teleopCoralL3 * SCORING_POINTS.TELE_CORAL_L3;
  score += data.teleopCoralL4 * SCORING_POINTS.TELE_CORAL_L4;
  score += data.teleopProcessorScored * SCORING_POINTS.TELE_ALGAE_PROC;
  score += data.teleopNetRobotScored * SCORING_POINTS.TELE_ALGAE_NET_R;
  score += data.teleopNetHumanScored * SCORING_POINTS.TELE_ALGAE_NET_H;
  
  if (data.teleopAlgaeRemoved) score += SCORING_POINTS.ALGAE_REMOVED;
  
  const endStatus = data.stageStatus.toLowerCase();
  if (endStatus.includes('deep')) score += SCORING_POINTS.CLIMB_DEEP;
  else if (endStatus.includes('shallow')) score += SCORING_POINTS.CLIMB_SHALLOW;
  else if (endStatus.includes('park') || endStatus.includes('barge')) {
    score += SCORING_POINTS.CLIMB_PARK;
  }
  
  return score;
}

// Calculate accuracy percentage
export function calculateAccuracy(
  scoutedScore: number,
  officialScore: number
): number {
  if (officialScore === 0) return 0;
  
  const error = Math.abs(officialScore - scoutedScore);
  const accuracy = Math.max(0, (1 - error / officialScore) * 100);
  
  return Math.round(accuracy);
}
