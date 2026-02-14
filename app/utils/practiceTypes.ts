// FILE: app/utils/practiceTypes.ts
// COMPLETE REWRITE - Added modes, proper types

export interface PracticeMatch {
  id?: string;
  matchKey?: string;
  eventName?: string;
  eventKey?: string;
  matchNumber: number;
  matchType: 'qualification' | 'playoff' | 'practice';
  videoUrl: string;
  difficulty: 'easy' | 'medium' | 'hard';
  mode: 'trial' | 'competitive'; // NEW
  
  alliance: 'red' | 'blue';
  allianceScore?: number;
  
  // Team numbers for all 3 robots
  teamNumbers: number[]; // [team1, team2, team3]
  humanPlayerPosition?: number; // 0, 1, or 2 - which robot scouts human
  
  // Actual data for all 3 robots
  actualData: Array<{
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
  }>;
  
  actualScore: number;
  createdAt?: number;
}

export interface PracticeSession {
  id?: string;
  scoutName: string;
  scoutId?: string;
  
  matchKey?: string;
  matchNumber: number;
  matchType: 'qualification' | 'playoff' | 'practice';
  difficulty: 'easy' | 'medium' | 'hard';
  mode: 'trial' | 'competitive'; // NEW
  
  // All 3 robots scouted
  robotsData: Array<{
    teamNumber: number;
    scoutedData: any;
    actualData: any;
    scoutedScore: number;
    actualScore: number;
    accuracy: number;
  }>;
  
  overallAccuracy: number;
  timestamp: number;
  startedAt?: number;
  completedAt?: number;
}

// Scoring constants
const SCORING_POINTS = {
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

export function calculateScoutedScore(data: any): number {
  let score = 0;
  
  if (data.leftStartingZone) score += SCORING_POINTS.LEAVE;
  
  score += (data.autoCoralL1 || 0) * SCORING_POINTS.AUTO_CORAL_L1;
  score += (data.autoCoralL2 || 0) * SCORING_POINTS.AUTO_CORAL_L2;
  score += (data.autoCoralL3 || 0) * SCORING_POINTS.AUTO_CORAL_L3;
  score += (data.autoCoralL4 || 0) * SCORING_POINTS.AUTO_CORAL_L4;
  score += (data.autoAlgaeProcessorScored || 0) * SCORING_POINTS.AUTO_ALGAE_PROC;
  score += (data.autoAlgaeNetScored || 0) * SCORING_POINTS.AUTO_ALGAE_NET;
  
  score += (data.teleopCoralL1 || 0) * SCORING_POINTS.TELE_CORAL_L1;
  score += (data.teleopCoralL2 || 0) * SCORING_POINTS.TELE_CORAL_L2;
  score += (data.teleopCoralL3 || 0) * SCORING_POINTS.TELE_CORAL_L3;
  score += (data.teleopCoralL4 || 0) * SCORING_POINTS.TELE_CORAL_L4;
  score += (data.teleopProcessorScored || 0) * SCORING_POINTS.TELE_ALGAE_PROC;
  score += (data.teleopNetRobotScored || 0) * SCORING_POINTS.TELE_ALGAE_NET_R;
  score += (data.teleopNetHumanScored || 0) * SCORING_POINTS.TELE_ALGAE_NET_H;
  
  if (data.teleopAlgaeRemoved) score += SCORING_POINTS.ALGAE_REMOVED;
  
  const stage = (data.stageStatus || "").toLowerCase();
  if (stage.includes('deep')) score += SCORING_POINTS.CLIMB_DEEP;
  else if (stage.includes('shallow')) score += SCORING_POINTS.CLIMB_SHALLOW;
  else if (stage.includes('park') || stage.includes('barge')) score += SCORING_POINTS.CLIMB_PARK;
  
  return score;
}

export function calculateAccuracy(scoutedData: any, actualData: any): number {
  let totalFields = 0;
  let correctFields = 0;
  
  const numericFields = [
    'autoCoralMissed', 'autoCoralL1', 'autoCoralL2', 'autoCoralL3', 'autoCoralL4',
    'autoAlgaeProcessorMissed', 'autoAlgaeProcessorScored',
    'autoAlgaeNetMissed', 'autoAlgaeNetScored',
    'teleopCoralMissed', 'teleopCoralL1', 'teleopCoralL2', 'teleopCoralL3', 'teleopCoralL4',
    'teleopProcessorMissed', 'teleopProcessorScored',
    'teleopNetRobotMissed', 'teleopNetRobotScored',
    'teleopNetHumanMissed', 'teleopNetHumanScored',
    'failedClimb'
  ];
  
  numericFields.forEach(field => {
    totalFields++;
    const scouted = scoutedData[field] || 0;
    const actual = actualData[field] || 0;
    if (Math.abs(scouted - actual) <= 1) correctFields++;
  });
  
  if (scoutedData.leftStartingZone === actualData.leftStartingZone) correctFields++;
  totalFields++;
  
  if (scoutedData.teleopAlgaeRemoved === actualData.teleopAlgaeRemoved) correctFields++;
  totalFields++;
  
  if (scoutedData.startingPosition === actualData.startingPosition) correctFields++;
  totalFields++;
  
  if (scoutedData.stageStatus === actualData.stageStatus) correctFields++;
  totalFields++;
  
  return Math.round((correctFields / totalFields) * 100);
}
