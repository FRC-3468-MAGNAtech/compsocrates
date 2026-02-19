import crypto from "node:crypto";

const ALGO = "aes-256-gcm";
const IV_LENGTH = 12;

function getUserKey(): Buffer {
  const secret = process.env.USER_DATA_ENCRYPTION_SECRET || "";
  if (!secret) {
    throw new Error("Missing USER_DATA_ENCRYPTION_SECRET");
  }
  return crypto.createHash("sha256").update(secret).digest();
}

export function encryptUserData(raw: string): string {
  const key = getUserKey();
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  const encrypted = Buffer.concat([cipher.update(raw, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `${iv.toString("base64")}.${tag.toString("base64")}.${encrypted.toString("base64")}`;
}
