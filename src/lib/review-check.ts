import { timingSafeEqual } from "node:crypto";

export function findUser(db: { query: (sql: string, params: unknown[]) => unknown }, name: string) {
  return db.query("SELECT * FROM users WHERE name = $1", [name]);
}

export function passwordsMatch(input: string, expected: string) {
  const a = Buffer.from(input);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
