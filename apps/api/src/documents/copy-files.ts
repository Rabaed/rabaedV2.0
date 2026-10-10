import type { FileStore } from "./file-store.ts";

// Copying a new item's files (a Revision's, a replacement's, a Duplicate's) while its
// rows are written in a database transaction. The file store is not part of that
// transaction, so a copy made before a failure would be left behind with no row
// pointing at it. withFileCopies runs the transaction with a `copy` function that
// remembers each file it stored; if anything fails before the transaction commits
// (a later copy, the database, the commit itself), it deletes them again, then
// rethrows. Nothing it copies outlives a transaction that didn't commit.

/** A file to copy: from the source Document's key to the new one's. */
export type FileCopy = { storage_key: string; source_storage_key: string };

export async function withFileCopies<T>(files: FileStore, run: (copy: (copies: readonly FileCopy[]) => Promise<void>) => Promise<T>): Promise<T> {
  const stored: string[] = [];
  const copy = async (copies: readonly FileCopy[]) => {
    for (const c of copies) {
      // Remembered first: a copy that fails may still have stored the file (a timeout after the write).
      stored.push(c.storage_key);
      await files.copy(c.source_storage_key, c.storage_key);
    }
  };
  try {
    return await run(copy);
  } catch (error) {
    // Best effort: a delete that fails leaves an object no row names, which no read can reach.
    await Promise.allSettled(stored.map((key) => files.remove(key)));
    throw error;
  }
}
