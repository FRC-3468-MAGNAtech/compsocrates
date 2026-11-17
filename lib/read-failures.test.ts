import { beforeEach, describe, expect, it } from "vitest";
import { clearAllReadFailures, clearReadFailure, currentReadFailures, recordReadFailure } from "@/lib/read-failures";
import type { FirestoreFailure } from "@/lib/firestore-errors";

const failure = (context: string, path: string): FirestoreFailure => ({ context, code: "permission-denied", message: "denied", path, at: "2026-11-14T00:00:00.000Z" });

beforeEach(() => clearAllReadFailures());

describe("read failures", () => {
  it("records a failed read once per path and context, and clears it when that read answers", () => {
    recordReadFailure(failure("Couldn't load the team members", "programs/x/users"));
    recordReadFailure(failure("Couldn't load the team members", "programs/x/users"));
    recordReadFailure(failure("Couldn't load scout entries", "programs/x/scoutEntries"));
    expect(currentReadFailures()).toHaveLength(2);
    clearReadFailure("Couldn't load the team members", "programs/x/users");
    expect(currentReadFailures().map((f) => f.context)).toEqual(["Couldn't load scout entries"]);
  });
});
