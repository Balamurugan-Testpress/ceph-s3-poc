// Tiny wrapper over the `idb` package, scoped to the multipart-upload store.
//
// Schema (object store: "uploads"):
//   {
//     fingerprint: string,    // primary key — `${name}|${size}|${lastModified}|${bucket}|${key}`
//     bucket: string,
//     key: string,
//     uploadId: string,
//     partSize: number,
//     totalSize: number,
//     totalParts: number,
//     parts: { [partNumber: number]: { etag: string, size: number } },
//     createdAt: number,
//     fileName: string,       // for re-rendering paused rows on reload
//   }
//
// We can't persist the File object itself across reloads — the user has to
// re-pick the file to resume after a refresh. We keep enough metadata to
// recognise it when they do.

import { openDB } from "idb";

const DB_NAME = "ceph-s3-uploads";
const STORE = "uploads";

let dbPromise = null;

function db() {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, 1, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE, { keyPath: "fingerprint" });
        }
      },
    });
  }
  return dbPromise;
}

export function fingerprintFor(bucket, file) {
  return `${file.name}|${file.size}|${file.lastModified}|${bucket}|${file.name}`;
}

export async function getSession(fingerprint) {
  return (await db()).get(STORE, fingerprint);
}

export async function putSession(session) {
  await (await db()).put(STORE, session);
}

export async function deleteSession(fingerprint) {
  await (await db()).delete(STORE, fingerprint);
}

export async function listSessions() {
  return (await db()).getAll(STORE);
}

export async function recordPart(fingerprint, partNumber, etag, size) {
  const d = await db();
  const tx = d.transaction(STORE, "readwrite");
  const row = await tx.store.get(fingerprint);
  if (row) {
    row.parts = { ...row.parts, [partNumber]: { etag, size } };
    await tx.store.put(row);
  }
  await tx.done;
}
