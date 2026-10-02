export interface DbErrorLike {
  message: string;
  code?: string;
  details?: string;
  hint?: string;
}

/** Builds the error to throw when a database call fails, keeping the original error as `cause`. */
export function dbError(op: string, error: DbErrorLike): Error {
  return new Error(`${op} failed: ${error.message}`, { cause: error });
}
