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

// Get the next upcoming event
export function getNextEvent() {
  const now = new Date();
  
  const upcomingEvents = Object.entries(EVENTS)
    .filter(([_, event]) => event.startDate > now)
    .sort((a, b) => a[1].startDate.getTime() - b[1].startDate.getTime());
  
  if (upcomingEvents.length > 0) {
    const [key, event] = upcomingEvents[0];
    return { key, ...event };
  }
  
  return null;
}

// Calculate days until an event
export function daysUntilEvent(eventKey: string): number {
  const event = EVENTS[eventKey as keyof typeof EVENTS];
  if (!event) return 0;
  
  const now = new Date();
  const diff = event.startDate.getTime() - now.getTime();
  return Math.ceil(diff / (1000 * 60 * 60 * 24));
}

// Format event date range
export function formatEventDates(eventKey: string): string {
  const event = EVENTS[eventKey as keyof typeof EVENTS];
  if (!event) return '';
  
  const startMonth = event.startDate.toLocaleDateString('en-US', { month: 'long' });
  const startDay = event.startDate.getDate();
  const endDay = event.endDate.getDate();
  const year = event.startDate.getFullYear();
  
  return `${startMonth} ${startDay}-${endDay}, ${year}`;
}