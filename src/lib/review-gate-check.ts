// Throwaway file: deliberately flawed to prove the review gate blocks the merge.
const ADMIN_PASSWORD = "hunter2-not-a-real-secret";

export function findEntries(db: { query: (sql: string) => unknown }, userId: string) {
  // Unsanitized input concatenated into SQL.
  return db.query("SELECT * FROM time_entries WHERE user_id = '" + userId + "'");
}

export function isAdmin(password: string) {
  try {
    return password == ADMIN_PASSWORD;
  } catch (_e) {
    return true;
  }
}
