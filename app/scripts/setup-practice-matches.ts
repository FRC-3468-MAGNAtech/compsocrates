// Script to populate practice matches from TBA into Firebase
// Run this once to set up the practice match database

import { collection, addDoc } from 'firebase/firestore';
import { db } from '@/app/firebase';
import { fetchEventMatches, filterPracticeMatches, getYouTubeUrl, categorizeMatchDifficulty, extractTeamNumber } from 'app/utils/tbaHelpers';
import { PracticeMatch } from 'app/utils/practiceTypes';

async function setupPracticeMatches() {
  console.log('🚀 Starting practice match setup...');
  
  const events = [
    { key: '2025lake', name: 'Lake Superior Regional' },  // Closest to Rocket City
    { key: '2025gal', name: 'Bayou Regional' },
  ];
  
  let totalMatches = 0;
  
  for (const event of events) {
    console.log(`\n📥 Fetching matches from ${event.name}...`);
    
    const matches = await fetchEventMatches(event.key);
    console.log(`Found ${matches.length} total matches`);
    
    const practiceEligible = filterPracticeMatches(matches);
    console.log(`${practiceEligible.length} matches eligible for practice`);
    
    for (const match of practiceEligible) {
      const videoUrl = getYouTubeUrl(match);
      if (!videoUrl) continue;
      
      // Create practice matches for both alliances
      for (const allianceColor of ['red', 'blue'] as const) {
        const alliance = match.alliances[allianceColor];
        const difficulty = categorizeMatchDifficulty(alliance.score);
        
        // Create a practice match for each team on the alliance
        for (let position = 0; position < alliance.team_keys.length; position++) {
          const teamKey = alliance.team_keys[position];
          const teamNumber = extractTeamNumber(teamKey);
          
          const practiceMatch: Omit<PracticeMatch, 'id'> = {
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
            officialData: {
              score: alliance.score,
              penaltyPoints: match.score_breakdown?.[allianceColor]?.foulPoints || 0,
              breakdown: match.score_breakdown?.[allianceColor] || {},
            },
            createdAt: Date.now(),
          };
          
          try {
            await addDoc(collection(db, 'practiceMatches'), practiceMatch);
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
  }
  
  console.log(`\n🎉 Setup complete! Added ${totalMatches} practice matches to Firebase.`);
  console.log('\nBreakdown by difficulty:');
  
  // Count by difficulty (you'd need to query Firebase for this)
  console.log('Run the following to check counts:');
  console.log('- Easy matches (0-100 pts): Query where difficulty == "easy"');
  console.log('- Medium matches (101-200 pts): Query where difficulty == "medium"');
  console.log('- Hard matches (201-300 pts): Query where difficulty == "hard"');
}

// Run the setup
setupPracticeMatches().catch(console.error);

export { setupPracticeMatches };
