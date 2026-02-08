// Event date configuration
export const EVENTS = {
  arkansas: {
    name: 'Arkansas Regional',
    location: 'Little Rock, AR',
    startDate: new Date('2026-03-18'),
    endDate: new Date('2026-03-21'),
  },
  bayou: {
    name: 'Bayou Regional',
    location: 'Kenner, LA',
    startDate: new Date('2026-04-01'),
    endDate: new Date('2026-04-04'),
  },
};

// Check if any event is currently active
export function isEventActive(): boolean {
  const now = new Date();
  
  return Object.values(EVENTS).some(event => {
    return now >= event.startDate && now <= event.endDate;
  });
}

// Get the current active event (if any)
export function getCurrentEvent() {
  const now = new Date();
  
  for (const [key, event] of Object.entries(EVENTS)) {
    if (now >= event.startDate && now <= event.endDate) {
      return { key, ...event };
    }
  }
  
  return null;
}

// Calculate days until an event
export function daysUntilEvent(startDate: Date): number {
  const now = new Date();
  const diff = startDate.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}
