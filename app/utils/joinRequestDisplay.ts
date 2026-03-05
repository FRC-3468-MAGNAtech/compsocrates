export function deriveJoinRequestName(input: {
  userName?: string | null;
  fallbackDisplayName?: string | null;
  userEmail?: string | null;
  fallbackEmail?: string | null;
  userId?: string | null;
}): string {
  const storedName = String(input.userName || "").trim();
  if (storedName && !storedName.startsWith("User ")) return storedName;

  const displayName = String(input.fallbackDisplayName || "").trim();
  if (displayName) return displayName;

  const email = String(input.userEmail || input.fallbackEmail || "").trim();
  const fromEmail = buildNameFromEmail(email);
  if (fromEmail) return fromEmail;

  const uid = String(input.userId || "").trim();
  if (uid) return `User ${uid.slice(0, 8)}`;
  return "Unknown User";
}

function buildNameFromEmail(email: string): string {
  if (!email.includes("@")) return "";
  const localPart = email.split("@")[0]?.trim() || "";
  if (!localPart) return "";
  const chunks = localPart
    .replace(/\d+/g, " ")
    .split(/[._-]+|\s+/)
    .map((value) => value.trim())
    .filter(Boolean);
  if (chunks.length === 0) return localPart;
  return chunks.map(capitalize).join(" ");
}

function capitalize(value: string): string {
  if (!value) return value;
  return value.charAt(0).toUpperCase() + value.slice(1).toLowerCase();
}
