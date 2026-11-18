// The "a scout is live and needs a partner" pill listens to every presence document of the team (a collection-group query), and every heartbeat of every live scout is billed
// once per open tab that listens. So it is mounted only where a person would act on it: the Dashboard and Practice Scouting (program-relative paths, same for every program).
export const LIVE_PILL_PATHS = ["/dashboard", "/practice-scouting"] as const;

export function showsLivePill(pathname: string): boolean {
  return LIVE_PILL_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}
