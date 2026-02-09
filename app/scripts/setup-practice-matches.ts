// Script to populate practice matches from TBA into Firebase
// Run this with: npx tsx app/scripts/setup-practice-matches.ts

import { config } from 'dotenv';
import { resolve } from 'path';

// Load environment variables from .env.local
config({ path: resolve(process.cwd(), '.env.local') });

// Simple Node.js script that uses fetch
const TBA_API_KEY = process.env.NEXT_PUBLIC_TBA_API_KEY || '';
const TBA_BASE_URL = 'https://www.thebluealliance.com/api/v3';

// Firebase config from env
const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

async function fetchEventMatches(eventKey: string) {
  const response = await fetch(`${TBA_BASE_URL}/event/${eventKey}/matches`, {
    headers: { 'X-TBA-Auth-Key': TBA_API_KEY },
  });
  if (!response.ok) throw new Error(`Failed to fetch matches for ${eventKey}`);
  return response.json();
}

function filterPracticeMatches(matches: any[]) {
  return matches.filter(match => 
    match.comp_level === 'qm' && // Qualification matches
    match.videos && match.videos.length > 0 // Has video
  );
}

function getYouTubeUrl(match: any): string | null {
  const video = match.videos?.find((v: any) => v.type === 'youtube');
  return video ? `https://www.youtube.com/watch?v=${video.key}` : null;
}

function categorizeMatchDifficulty(score: number): 'easy' | 'medium' | 'hard' {
  if (score <= 100) return 'easy';
  if (score <= 200) return 'medium';
  return 'hard';
}

function extractTeamNumber(teamKey: string): string {
  return teamKey.replace('frc', '');
}

async function addToFirestore(collectionName: string, data: any) {
  const url = `https://firestore.googleapis.com/v1/projects/${firebaseConfig.projectId}/databases/(default)/documents/${collectionName}`;
  
  // Convert data to Firestore format
  const firestoreData: any = { fields: {} };
  
  for (const [key, value] of Object.entries(data)) {
    if (typeof value === 'string') {
      firestoreData.fields[key] = { stringValue: value };
    } else if (typeof value === 'number') {
      firestoreData.fields[key] = { integerValue: value };
    } else if (typeof value === 'boolean') {
      firestoreData.fields[key] = { booleanValue: value };
    } else if (typeof value === 'object') {
      firestoreData.fields[key] = { stringValue: JSON.stringify(value) };
    }
  }
  
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(firestoreData),
  });
  
  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Firestore error: ${error}`);
  }
  
  return response.json();
}

async function setupPracticeMatches() {
  console.log('🚀 Starting practice match setup...');
  console.log('Project ID:', firebaseConfig.projectId);
  
  if (!TBA_API_KEY) {
    console.error('❌ TBA_API_KEY not found in environment variables');
    console.error('Make sure .env.local exists with NEXT_PUBLIC_TBA_API_KEY');
    return;
  }
  
  const events = [
    { key: '2025alhu', name: 'Rocket City Regional' },
    { key: '2025lake', name: 'Bayou Regional' },
  ];
  
  let totalMatches = 0;
  
  for (const event of events) {
    console.log(`\n📥 Fetching matches from ${event.name}...`);
    
    try {
      const matches = await fetchEventMatches(event.key);
      console.log(`Found ${matches.length} total matches`);
      
      const practiceEligible = filterPracticeMatches(matches);
      console.log(`${practiceEligible.length} matches eligible for practice`);
      
      for (const match of practiceEligible) {
        const videoUrl = getYouTubeUrl(match);
        if (!videoUrl) continue;
        
        // Create practice matches for both alliances
        for (const allianceColor of ['red', 'blue']) {
          const alliance = match.alliances[allianceColor];
          const difficulty = categorizeMatchDifficulty(alliance.score);
          
          // Create a practice match for each team on the alliance
          for (let position = 0; position < alliance.team_keys.length; position++) {
            const teamKey = alliance.team_keys[position];
            const teamNumber = extractTeamNumber(teamKey);
            
            const practiceMatch = {
              matchKey: match.key,
              eventName: event.name,
              eventKey: event.key,
              matchNumber: match.match_number,
              videoUrl,
              difficulty,
              alliance: allianceColor,
              allianceScore: alliance.score,
              teamPosition: position,
              teamNumber,
              officialScore: alliance.score,
              penaltyPoints: match.score_breakdown?.[allianceColor]?.foulPoints || 0,
              createdAt: Date.now(),
            };
            
            try {
              await addToFirestore('practiceMatches', practiceMatch);
              totalMatches++;
              
              if (totalMatches % 10 === 0) {
                console.log(`✅ Added ${totalMatches} practice matches...`);
              }
            } catch (error) {
              console.error(`❌ Error adding match ${match.key}:`, error);
            }
          }
        }
      }
    } catch (error) {
      console.error(`❌ Error processing ${event.name}:`, error);
    }
  }
  
  console.log(`\n🎉 Setup complete! Added ${totalMatches} practice matches to Firebase.`);
}

// Run the setup
setupPracticeMatches().catch(console.error);
