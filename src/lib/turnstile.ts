const VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
const VERIFY_TIMEOUT_MS = 5000;

/**
 * Verifies a Cloudflare Turnstile token server-side.
 *
 * Fails closed: a missing token or secret, a network error, a bad response or a
 * failed challenge all return false. The secret is passed in (rather than read from
 * astro:env here) so this module stays testable without the Astro runtime.
 */
export async function verifyTurnstile(
  token: string | null,
  ip: string | null,
  secret: string | undefined,
): Promise<boolean> {
  if (!token || !secret) {
    return false;
  }

  try {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) {
      body.set("remoteip", ip);
    }

    const response = await fetch(VERIFY_URL, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!response.ok) {
      return false;
    }

    const result: unknown = await response.json();
    return typeof result === "object" && result !== null && "success" in result && result.success === true;
  } catch {
    return false;
  }
}
