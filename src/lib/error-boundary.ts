import type { APIContext } from "astro";
import { logError } from "./log";

/**
 * Turns an error nobody anticipated, raised while a request is rendered (a page's frontmatter or an API route), into one
 * structured log line. The response is returned untouched and the error is rethrown unchanged, so Astro still logs its
 * own stack line and renders `src/pages/500.astro` with the error. Swallowing it instead would remove Astro's log.
 *
 * The event is labelled with the route *pattern* (`GET /w/[token]`), never the URL: the path carries the private token.
 * It logs only from the `catch`, so Astro's own 500 render, which re-enters the middleware, adds no second event.
 * It does not see an error thrown after the response has started streaming.
 */
export async function errorBoundary(
  context: Pick<APIContext, "request" | "routePattern">,
  next: () => Promise<Response>,
): Promise<Response> {
  try {
    return await next();
  } catch (err) {
    logError("unhandled_request_error", { route: `${context.request.method} ${context.routePattern}` }, err);
    throw err;
  }
}
