"use client";

import { initializeApp, getApps, getApp, type FirebaseApp } from "firebase/app";
import {
  connectFirestoreEmulator,
  initializeFirestore,
  memoryLocalCache,
  persistentLocalCache,
  persistentMultipleTabManager,
  type Firestore,
} from "firebase/firestore";
import { connectAuthEmulator, getAuth, type Auth } from "firebase/auth";

const firebaseConfig = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  measurementId: process.env.NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID,
};

const hasConfig = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId && firebaseConfig.appId);

export function isFirebaseConfigured(): boolean {
  return hasConfig;
}

// Firestore/Auth throw eagerly on a missing projectId, which would otherwise
// crash every page on import before the config even exists yet. Only
// initialize when configured; every real consumer (lib/auth.tsx, lib/team.ts,
// lib/scout-entries.ts) checks isFirebaseConfigured() first and shows a clear
// "not configured" state instead of touching these.
let app: FirebaseApp | null = null;
let authInstance: Auth | null = null;
let dbInstance: Firestore | null = null;

// TEST SEAM (data/cs/adapter.emulator.test.ts): with NEXT_PUBLIC_USE_FIREBASE_EMULATOR=1 the singletons point at the local Auth and
// Firestore emulators (hosts from FIREBASE_AUTH_EMULATOR_HOST / FIRESTORE_EMULATOR_HOST, as `firebase emulators:exec` exports them)
// and use the in-memory cache, because IndexedDB persistence does not exist under Node. Never set in production, `next dev` or `next build`.
const useEmulator = process.env.NEXT_PUBLIC_USE_FIREBASE_EMULATOR === "1";

if (hasConfig) {
  app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  authInstance = getAuth(app);
  if (useEmulator) {
    connectAuthEmulator(authInstance, `http://${process.env.FIREBASE_AUTH_EMULATOR_HOST ?? "127.0.0.1:9099"}`, { disableWarnings: true });
    dbInstance = initializeFirestore(app, { localCache: memoryLocalCache() });
    const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST ?? "127.0.0.1:8080").split(":");
    connectFirestoreEmulator(dbInstance, host, Number(port));
  } else {
    // persistentLocalCache (IndexedDB-backed) is what lets the Scout Form keep
    // working — queuing writes locally — when venue Wi-Fi drops; multi-tab so
    // a scout with two tabs open doesn't fight over the cache.
    dbInstance = initializeFirestore(app, {
      localCache: persistentLocalCache({ tabManager: persistentMultipleTabManager() }),
    });
  }
}

export const auth = authInstance as Auth;
export const db = dbInstance as Firestore;
