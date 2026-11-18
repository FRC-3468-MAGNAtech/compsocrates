import "server-only";
import { randomBytes } from "node:crypto";
import { FieldPath, FieldValue, Timestamp, type Firestore, type Query } from "firebase-admin/firestore";
import type { Auth } from "firebase-admin/auth";
import { OPAQUE_ID_PREFIX } from "@/lib/deletion/constants";
import { deleteAvatarBlobs } from "@/lib/server/avatar-blobs";
import { platformAuditDoc } from "@/lib/server/audit";
import { getMembershipsEnabled } from "@/lib/server/team-settings";
import type { AuthPort, BlobPort, DeletionStore, Deps, StoreOp, StoredDoc } from "./ports";

/** The only file of the deletion job that touches the Admin SDK. */
export function adminStore(db: Firestore): DeletionStore {
  const toDoc = (d: FirebaseFirestore.QueryDocumentSnapshot | FirebaseFirestore.DocumentSnapshot): StoredDoc => ({
    path: d.ref.path,
    id: d.id,
    data: (d.data() ?? {}) as Record<string, unknown>,
    updateTime: d.updateTime ? (d.updateTime as Timestamp).toDate().toISOString() : undefined,
  });
  return {
    async query(q) {
      let query: Query = db.collection(q.path);
      for (const w of q.where ?? []) query = query.where(w.field, w.op, w.value);
      if (q.idPrefix !== undefined) query = query.where(FieldPath.documentId(), ">=", q.idPrefix).where(FieldPath.documentId(), "<", `${q.idPrefix}`);
      const snap = await query.limit(q.limit).get();
      return snap.docs.map(toDoc);
    },
    async get(path) {
      const snap = await db.doc(path).get();
      return snap.exists ? toDoc(snap) : null;
    },
    async commit(ops: readonly StoreOp[]) {
      const batch = db.batch();
      for (const op of ops) {
        const ref = db.doc(op.path);
        if (op.kind === "set") batch.set(ref, op.data);
        else if (op.kind === "create") batch.create(ref, op.data);
        else if (op.kind === "delete") batch.delete(ref);
        else {
          const data: Record<string, unknown> = { ...op.data };
          for (const f of op.deleteFields ?? []) data[f] = FieldValue.delete();
          if (op.ifUnchangedSince) batch.update(ref, data, { lastUpdateTime: Timestamp.fromDate(new Date(op.ifUnchangedSince)) });
          else batch.update(ref, data);
        }
      }
      await batch.commit();
    },
  };
}

const isNotFound = (err: unknown) => (err as { code?: string })?.code === "auth/user-not-found";

export function adminAuthPort(auth: Auth): AuthPort {
  return {
    async getUser(uid) {
      try {
        const u = await auth.getUser(uid);
        const claims = (u.customClaims ?? {}) as Record<string, unknown>;
        return { uid: u.uid, email: u.email ?? null, emailVerified: u.emailVerified, displayName: u.displayName ?? null, platformOwnerClaim: claims.platformOwner === true, disabled: u.disabled };
      } catch (err) {
        if (isNotFound(err)) return null;
        throw err;
      }
    },
    async disable(uid) {
      try {
        await auth.updateUser(uid, { disabled: true });
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },
    async revokeTokens(uid) {
      try {
        await auth.revokeRefreshTokens(uid);
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },
    async deleteUser(uid) {
      try {
        await auth.deleteUser(uid);
      } catch (err) {
        if (!isNotFound(err)) throw err;
      }
    },
  };
}

export const blobPort: BlobPort = { deleteAvatars: (uid) => deleteAvatarBlobs(uid) };

/** 128 random bits. Not derived from anything, never stored anywhere except the job document that is deleted with the job. */
export const newOpaqueId = (): string => `${OPAQUE_ID_PREFIX}${randomBytes(16).toString("hex")}`;

export function adminDeps(db: Firestore, auth: Auth): Deps {
  return { store: adminStore(db), auth: adminAuthPort(auth), blobs: blobPort, now: Date.now, newOpaqueId, membershipsEnabled: () => getMembershipsEnabled(db).catch(() => false), audit: async (action, actor, details) => void (await db.collection("platformAuditLog").add(platformAuditDoc(action, actor, details))) };
}
