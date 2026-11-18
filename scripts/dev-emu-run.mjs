// Runs inside `firebase emulators:exec` (see scripts/dev-emu.mjs): the emulator host variables are set, so seeding and the dev server both talk to the emulators.
import { spawn } from "node:child_process";

function run(command, args) {
  return new Promise((resolve) => {
    const child = spawn(command, args, { stdio: "inherit", shell: true, env: process.env });
    child.on("exit", (code) => resolve(code ?? 0));
    for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  });
}

if (!process.env.FIRESTORE_EMULATOR_HOST || !process.env.FIREBASE_AUTH_EMULATOR_HOST) {
  console.error("dev:emu: the emulator host variables are missing, refusing to start (it would not be talking to an emulator).");
  process.exit(1);
}

const seeded = await run("npx", ["vite-node", "--config", "vitest.config.ts", "scripts/dev-emu-seed.ts"]);
if (seeded !== 0) console.error("dev:emu: seeding failed; starting the dev server anyway with empty emulators.");
process.exit(await run("npx", ["next", "dev"]));
