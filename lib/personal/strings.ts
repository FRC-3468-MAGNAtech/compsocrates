// The words of the no-team (personal) experience, in ONE place so both programs read the same. Program names come from the caller (config), never from here.

export const PERSONAL_DASHBOARD_TEXT = {
  intro: (programLabel: string) => `You're not on a ${programLabel} team yet. Join one with a code, apply for a new team, or practice on your own: your practice stays private to you.`,
  join: { title: "Join a team with a code", body: "Get the join code from your team admin. They approve your request." },
  apply: { title: "Apply for a team", body: "Starting a new team? Applications are approved by hand, one per team." },
  practice: { title: "Practice Scouting", body: "Scout recorded matches on your own time. Only you can see these sessions." },
  achievements: { title: "Achievements", body: "Your milestones, in one place." },
  profile: { title: "Your profile", body: "Your name and how you appear once you join a team." },
} as const;

/** Shown on the no-team Profile page: why it cannot be edited yet. */
export const PERSONAL_PROFILE_NOTE = "Your profile is read-only until you join a team. Edit your name, picture and bio once a team accepts you.";

/** Shown on Account Settings with no team: where the appearance choices are kept. */
export const PERSONAL_SETTINGS_NOTE = "Appearance choices are saved on this device until you join a team here.";

/** Practice Scouting with no team. */
export const PERSONAL_PRACTICE_TEXT = {
  private: "Your practice is private: only you can see these sessions. When you join a team you can choose to share them with it.",
  notAvailable: "Personal practice isn't available right now.",
} as const;

/** Share on join: the opt-in prompt (words in one place, the same in both programs). `writes` is the number of documents that will be written. */
export const SHARE_PRACTICE_TEXT = {
  title: "Share your earlier practice with your team?",
  body: (sessions: number, entries: number) =>
    `Before you joined, you practiced ${sessions} ${sessions === 1 ? "session" : "sessions"} (about ${entries} ${entries === 1 ? "entry" : "entries"}) in private. You can copy them into your team's practice data, so your teammates and admins can see them in your history and scout accuracy.`,
  cost: (writes: number) => `This writes one document for each session and entry (up to ${writes} in all). Your private copy stays as it is.`,
  share: "Share with my team",
  sharing: "Sharing…",
  notNow: "Not now",
  done: "Shared. Your earlier practice is now part of your team's history.",
  failed: "Couldn't share your practice. Nothing is lost: try again.",
  reopen: "Share my earlier private practice with my team",
} as const;
