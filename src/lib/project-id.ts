const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** A syntactically valid project id (standard UUID shape) before it reaches the database. */
export function isWellFormedId(value: unknown): value is string {
  return typeof value === "string" && ID_PATTERN.test(value);
}
