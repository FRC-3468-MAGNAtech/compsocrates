// `npm run dev:emu`: the Firestore and Auth emulators and `next dev` together, pointed at the emulators and NEVER at a real Firebase project.
//
//  1. Generates a throwaway RSA key in memory for FIREBASE_ADMIN_PRIVATE_KEY (the server routes insist on a service-account shape). It is never written to a file.
//  2. Sets the browser switch NEXT_PUBLIC_USE_FIREBASE_EMULATOR=1 and demo web config values. Values set here win over any .env file, so a .env.local that holds
//     production keys cannot reach production through this command. (This script never reads a .env file.)
//  3. Runs `firebase emulators:exec`, which starts the emulators, exports FIRESTORE_EMULATOR_HOST and FIREBASE_AUTH_EMULATOR_HOST to the command, and stops them when
//     the dev server exits. The command seeds a small synthetic dataset (scripts/dev-emu-seed.ts) and then starts the dev server (scripts/dev-emu-run.mjs).
//
// Needs the Firebase CLI and Java 21 (the same as `npm run test:rules`). See docs/LOCAL_DEV.md.
import { generateKeyPairSync } from "node:crypto";
import { spawn } from "node:child_process";

const PROJECT = "demo-compsocrates-rebuild"; // the demo- prefix makes the emulators refuse to talk to anything real
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

const env = {
  ...process.env,
  NEXT_PUBLIC_USE_FIREBASE_EMULATOR: "1",
  NEXT_PUBLIC_FIREBASE_API_KEY: "demo-api-key",
  NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "localhost",
  NEXT_PUBLIC_FIREBASE_PROJECT_ID: PROJECT,
  NEXT_PUBLIC_FIREBASE_APP_ID: "1:000000000000:web:demo",
  NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: `${PROJECT}.appspot.com`,
  NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "000000000000",
  FIREBASE_ADMIN_PROJECT_ID: PROJECT,
  FIREBASE_ADMIN_CLIENT_EMAIL: `demo@${PROJECT}.iam.gserviceaccount.com`,
  FIREBASE_ADMIN_PRIVATE_KEY: privateKey.replace(/\n/g, "\\n"),
  GCLOUD_PROJECT: PROJECT,
};

console.log(`dev:emu: emulators for project ${PROJECT} (no real Firebase project is touched). Sign in with a seeded account: see docs/LOCAL_DEV.md.`);
const child = spawn(`firebase emulators:exec --only firestore,auth --project ${PROJECT} "node scripts/dev-emu-run.mjs"`, { env, stdio: "inherit", shell: true });
child.on("exit", (code) => process.exit(code ?? 0));
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
