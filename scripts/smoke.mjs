// Smoke test: proves the built app, the Cloudflare adapter and the private-link flow still work together.
// Zero dependencies on purpose. LOCAL ONLY: it creates links, and the app caps links at 10 people
// forever, so it refuses to run against anything but localhost.
//
//   BASE_URL=http://localhost:4321 node scripts/smoke.mjs
//
// For the cap, throttle, access-log and RLS steps also set, from `npx supabase status -o env`:
//   SMOKE_SUPABASE_URL (API_URL), SMOKE_SERVICE_ROLE_KEY (SERVICE_ROLE_KEY), SMOKE_ANON_KEY (ANON_KEY)
// The app under test must use Cloudflare's dummy Turnstile keys and a freshly reset local database.

const BASE_URL = process.env.BASE_URL ?? "http://localhost:4321";
const host = new URL(BASE_URL).hostname;
if (host !== "localhost" && host !== "127.0.0.1") {
  console.error(`Refusing to run against ${BASE_URL}: the smoke test creates links and only runs locally.`);
  process.exit(1);
}

const { SMOKE_SUPABASE_URL, SMOKE_SERVICE_ROLE_KEY, SMOKE_ANON_KEY } = process.env;
const hasServiceAccess = Boolean(SMOKE_SUPABASE_URL && SMOKE_SERVICE_ROLE_KEY);

// Cloudflare's documented dummy token; only the dummy secret key accepts it.
const DUMMY_TURNSTILE_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";
const WORKSPACE_LOCATION = /^\/w\/([A-Za-z0-9_-]{43})$/;

const jar = new Map();
let failed = 0;

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    const expired = attrs.some((a) => /max-age=0/i.test(a.trim()));
    if (expired) jar.delete(name.trim());
    else jar.set(name.trim(), rest.join("="));
  }
}

// `withCookies: false` sends no cookies and ignores any Set-Cookie: a visitor with a fresh browser.
async function request(path, { method = "GET", form, json, withCookies = true } = {}) {
  const response = await fetch(BASE_URL + path, {
    method,
    redirect: "manual",
    headers: {
      ...(withCookies ? { Cookie: cookieHeader() } : {}),
      Origin: BASE_URL,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
      ...(json ? { "Content-Type": "application/json" } : {}),
    },
    body: form ? new URLSearchParams(form).toString() : json ? JSON.stringify(json) : undefined,
  });
  const setsLinkCookie = response.headers.getSetCookie().some((c) => c.startsWith("stopper_link="));
  if (withCookies) storeCookies(response);
  return { status: response.status, location: response.headers.get("location") ?? "", setsLinkCookie };
}

const createLinkForm = { "cf-turnstile-response": DUMMY_TURNSTILE_TOKEN };

function createLinkRequest(withCookies = true) {
  return request("/api/links", { method: "POST", form: createLinkForm, withCookies });
}

async function rest(path, { method = "GET", body, key = SMOKE_SERVICE_ROLE_KEY } = {}) {
  const response = await fetch(`${SMOKE_SUPABASE_URL}/rest/v1/${path}`, {
    method,
    headers: { apikey: key, Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, json: text ? JSON.parse(text) : null };
}

function check(name, ok, detail = "") {
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? `  -> ${detail}` : ""}`);
  if (!ok) failed++;
}

function describeResponse(r) {
  return `${r.status} ${r.location}`.trim();
}

if (hasServiceAccess) {
  const { json: existing } = await rest("links?select=id");
  if (existing.length > 0) {
    console.error(`The local database already has ${existing.length} link(s). Run "npx supabase db reset" first.`);
    process.exit(1);
  }
}

let r = await request("/api/links");
check("GET /api/links is not allowed", r.status === 405, describeResponse(r));

r = await request("/api/links", { method: "POST", form: {}, withCookies: false });
check(
  "create without a Turnstile token is refused",
  r.status === 303 && r.location === "/?error=verify",
  describeResponse(r),
);

r = await request("/api/links", { method: "POST", json: {}, withCookies: false });
check(
  "a non-form body is refused with the verify message, not a server error",
  r.status === 303 && r.location === "/?error=verify",
  describeResponse(r),
);

r = await createLinkRequest();
const token = WORKSPACE_LOCATION.exec(r.location)?.[1];
check(
  "create with a Turnstile token redirects to a new workspace",
  r.status === 303 && Boolean(token),
  describeResponse(r),
);

r = await request(`/w/${token}`);
check("the workspace opens", r.status === 200, describeResponse(r));

r = await request(`/w/${token}`, { withCookies: false });
check("a browser with no link remembers the one it opens", r.status === 200 && r.setsLinkCookie, describeResponse(r));

r = await createLinkRequest();
check(
  "creating again with the cookie returns to the same workspace",
  r.status === 303 && r.location === `/w/${token}`,
  describeResponse(r),
);

r = await request(`/w/${"A".repeat(43)}`, { withCookies: false });
check("a well-formed unknown token is a 404", r.status === 404, describeResponse(r));

r = await request("/w/not-a-token", { withCookies: false });
check("a malformed token is a 404", r.status === 404, describeResponse(r));

// The starter's email/password flow is gone, including its public signup endpoint.
for (const path of ["/auth/signin", "/auth/signup", "/dashboard"]) {
  r = await request(path, { withCookies: false });
  check(`${path} is gone (404)`, r.status === 404, describeResponse(r));
}

r = await request("/api/auth/signup", {
  method: "POST",
  form: { email: "smoke@example.com", password: "x" },
  withCookies: false,
});
check("the starter signup endpoint is gone (404)", r.status === 404, describeResponse(r));

if (!hasServiceAccess) {
  console.log("SKIP  cap, throttle, access-log and RLS steps (set SMOKE_SUPABASE_URL and SMOKE_SERVICE_ROLE_KEY)");
} else {
  // Fill up to nine links through the database function, bypassing the HTTP throttle.
  for (let i = 1; i < 9; i++) {
    await rest("rpc/create_link", { method: "POST", body: { p_token_hash: `smoke-fill-${i}` } });
  }
  const { json: filled } = await rest("links?select=id");
  check("nine links exist", filled.length === 9, `${filled.length} links`);

  r = await createLinkRequest(false);
  check(
    "the throttle answers busy while many links were just created",
    r.status === 303 && r.location === "/?error=busy",
    describeResponse(r),
  );

  const anHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
  await rest("links?id=not.is.null", { method: "PATCH", body: { created_at: anHourAgo } });

  r = await createLinkRequest(false);
  check("the 10th link is created", r.status === 303 && WORKSPACE_LOCATION.test(r.location), describeResponse(r));

  // The browser in the jar already remembers the first link; opening another one must not replace it.
  const otherToken = WORKSPACE_LOCATION.exec(r.location)?.[1];
  r = await request(`/w/${otherToken}`);
  check(
    "opening someone else's link keeps the browser's own remembered link",
    r.status === 200 && !r.setsLinkCookie && jar.get("stopper_link") === token,
    describeResponse(r),
  );

  r = await createLinkRequest(false);
  check("the 11th person sees the full message", r.status === 303 && r.location === "/?full=1", describeResponse(r));

  const { json: entries } = await rest("access_log?select=outcome,link_id");
  check(
    "the access log has a success row",
    entries.some((e) => e.outcome === "success" && e.link_id),
  );
  check(
    "the access log has a not_found row with no link id",
    entries.some((e) => e.outcome === "not_found" && e.link_id === null),
  );

  if (SMOKE_ANON_KEY) {
    const { json: anonRows } = await rest("links?select=id", { key: SMOKE_ANON_KEY });
    check(
      "the anon key reads no rows from links",
      Array.isArray(anonRows) && anonRows.length === 0,
      `${anonRows?.length} rows`,
    );
  } else {
    console.log("SKIP  anon RLS check (set SMOKE_ANON_KEY)");
  }
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
