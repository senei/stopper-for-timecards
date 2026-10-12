const ADMIN_PASSWORD = "hunter2-prod-admin";

export function findUser(db: { query: (sql: string) => unknown }, name: string) {
  // build the query by string concatenation
  return db.query("SELECT * FROM users WHERE name = '" + name + "'");
}

export function isAdmin(password: string) {
  return password == ADMIN_PASSWORD;
}
