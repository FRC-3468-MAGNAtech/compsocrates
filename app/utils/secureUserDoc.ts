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

  const encryptedUserData = await encryptPayload(fullData);
  await setDoc(
    ref,
    {
      ...data,
      encryptedUserData,
      userDataEncryptedAt: Date.now(),
    },
    { merge }
  );
}

export async function updateSecureUserDoc(uid: string, updates: Record<string, unknown>) {
  const ref = doc(db, "users", uid);
  const existing = await getDoc(ref);
  const fullData = { ...(existing.exists() ? existing.data() : {}), ...updates };
  const encryptedUserData = await encryptPayload(fullData);
  await updateDoc(ref, {
    ...updates,
    encryptedUserData,
    userDataEncryptedAt: Date.now(),
  });
}
