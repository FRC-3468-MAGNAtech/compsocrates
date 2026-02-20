import { doc, getDoc, setDoc, updateDoc } from "firebase/firestore";
import { db } from "@/app/firebase";

async function encryptPayload(data: Record<string, unknown>) {
  const response = await fetch("/api/user/encrypt", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ data }),
  });
  if (!response.ok) {
    throw new Error("Failed to encrypt user data");
  }
  const payload = await response.json();
  const encryptedUserData =
    typeof payload?.encryptedUserData === "string" ? payload.encryptedUserData : "";
  if (!encryptedUserData) {
    throw new Error("No encrypted user data returned");
  }
  return encryptedUserData;
}

async function tryEncryptPayload(data: Record<string, unknown>): Promise<string | null> {
  try {
    return await encryptPayload(data);
  } catch (error) {
    console.warn("Falling back to plain user doc write (encryption unavailable):", error);
    return null;
  }
}

export async function setSecureUserDoc(
  uid: string,
  data: Record<string, unknown>,
  merge = false
) {
  const ref = doc(db, "users", uid);
  let fullData = data;
  if (merge) {
    const existing = await getDoc(ref);
    fullData = { ...(existing.exists() ? existing.data() : {}), ...data };
  }

  const encryptedUserData = await tryEncryptPayload(fullData);
  const payload = encryptedUserData
    ? {
        ...data,
        encryptedUserData,
        userDataEncryptedAt: Date.now(),
      }
    : { ...data };
  await setDoc(
    ref,
    payload,
    { merge }
  );
}

export async function updateSecureUserDoc(uid: string, updates: Record<string, unknown>) {
  const ref = doc(db, "users", uid);
  const existing = await getDoc(ref);
  const fullData = { ...(existing.exists() ? existing.data() : {}), ...updates };
  const encryptedUserData = await tryEncryptPayload(fullData);
  const payload = encryptedUserData
    ? {
        ...updates,
        encryptedUserData,
        userDataEncryptedAt: Date.now(),
      }
    : { ...updates };
  await updateDoc(ref, payload);
}
