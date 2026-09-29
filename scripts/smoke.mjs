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
// The regenerate route redirects with the status query that shows the save-the-new-link banner.
const REGENERATED_LOCATION = /^\/w\/([A-Za-z0-9_-]{43})\?status=link-regenerated$/;

const jar = new Map();
let failed = 0;

function cookieHeader() {
  return [...jar.entries()].map(([k, v]) => `${k}=${v}`).join("; ");
}

function storeCookies(response) {
  for (const raw of response.headers.getSetCookie()) {
    const [pair, ...attrs] = raw.split(";");
    const [name, ...rest] = pair.split("=");
    // A cookie is expired by Max-Age=0 or by an Expires date in the past (Astro's cookies.delete sends the latter).
    const expired = attrs.some((a) => {
      const attr = a.trim();
      if (/^max-age=0$/i.test(attr)) return true;
      const expires = /^expires=(.*)$/i.exec(attr)?.[1];
      return expires !== undefined && Date.parse(expires) < Date.now();
    });
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
  return {
    status: response.status,
    location: response.headers.get("location") ?? "",
    referrerPolicy: response.headers.get("referrer-policy") ?? "",
    cacheControl: response.headers.get("cache-control") ?? "",
    robotsTag: response.headers.get("x-robots-tag") ?? "",
    setsLinkCookie,
    text: await response.text(),
  };
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

// Every page that carries the token in its URL must keep it out of referrers, caches and search indexes.
function checkLeakHeaders(label, r) {
  check(
    `${label} keeps the token out of referrers, caches and search indexes (strict-origin, no-store, noindex)`,
    r.status === 200 &&
      r.referrerPolicy === "strict-origin" &&
      r.cacheControl === "no-store" &&
      r.robotsTag === "noindex",
    `${r.status} Referrer-Policy: ${r.referrerPolicy || "(none)"}, Cache-Control: ${r.cacheControl || "(none)"}, X-Robots-Tag: ${r.robotsTag || "(none)"}`,
  );
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
// A real browser sends `Origin: null` on same-origin form posts from a page served with `no-referrer`, and Astro's
// origin check answers those with a 403. This test sets Origin itself, so it can only guard the header, not the post.
check(
  "the workspace keeps the token out of the referrer without breaking its forms (strict-origin, not no-referrer)",
  r.referrerPolicy === "strict-origin",
  r.referrerPolicy || "(no Referrer-Policy header)",
);
checkLeakHeaders("the workspace", r);

r = await request(`/w/${token}/regenerate`);
checkLeakHeaders("the regenerate page", r);

r = await request(`/w/${token}/delete-account`);
checkLeakHeaders("the delete-account page", r);

r = await request(`/w/${token}/grid`);
checkLeakHeaders("the grid page", r);

r = await request(`/w/${token}`, { withCookies: false });
check("a browser with no link remembers the one it opens", r.status === 200 && r.setsLinkCookie, describeResponse(r));

r = await createLinkRequest();
check(
  "creating again with the cookie returns to the same workspace",
  r.status === 303 && r.location === `/w/${token}`,
  describeResponse(r),
);

// Starting a timer on the freshly created link, exercised through the same HTTP route a
// person's browser would hit (R-01: wrong project attribution, R-02: two concurrent timers).
r = await request(`/api/w/${token}/timer/start`, { method: "POST", form: { projectName: "Acme Widgets" } });
check(
  "starting a timer redirects back to the workspace",
  r.status === 303 && r.location === `/w/${token}`,
  describeResponse(r),
);

if (!hasServiceAccess) {
  console.log("SKIP  timer attribution and concurrency checks (set SMOKE_SUPABASE_URL and SMOKE_SERVICE_ROLE_KEY)");
} else {
  const { json: linkRows } = await rest("links?select=id&order=created_at.desc&limit=1");
  const linkId = linkRows[0]?.id;

  const { json: projectsAfterStart } = await rest(`projects?select=id,name&link_id=eq.${linkId}`);
  check(
    "exactly one project row exists for the link after starting a timer",
    projectsAfterStart.length === 1,
    `${projectsAfterStart.length} project(s)`,
  );

  const { json: openEntriesAfterStart } = await rest(
    `time_entries?select=id,project_name&link_id=eq.${linkId}&ended_at=is.null`,
  );
  check(
    "exactly one open time entry exists, attributed to the project name that was submitted",
    openEntriesAfterStart.length === 1 && openEntriesAfterStart[0].project_name === "Acme Widgets",
    JSON.stringify(openEntriesAfterStart),
  );

  // R-02: a second start while one is already running must not open a second entry or
  // reattribute the running one.
  r = await request(`/api/w/${token}/timer/start`, { method: "POST", form: { projectName: "Other Project" } });
  check(
    "a second start while a timer runs still redirects to the workspace",
    r.status === 303 && r.location === `/w/${token}`,
    describeResponse(r),
  );

  const { json: openEntriesAfterSecondStart } = await rest(
    `time_entries?select=id,project_name&link_id=eq.${linkId}&ended_at=is.null`,
  );
  check(
    "the second start does not open a second entry and leaves the running project unchanged",
    openEntriesAfterSecondStart.length === 1 && openEntriesAfterSecondStart[0].project_name === "Acme Widgets",
    JSON.stringify(openEntriesAfterSecondStart),
  );

  const { json: projectsAfterSecondStart } = await rest(`projects?select=id,name&link_id=eq.${linkId}`);
  check(
    "the second start does not create a second project row either",
    projectsAfterSecondStart.length === 1,
    `${projectsAfterSecondStart.length} project(s)`,
  );

  // R-04: a project with logged time must not be deletable through the real HTTP route.
  const usedProjectId = projectsAfterSecondStart[0]?.id;

  // The delete confirmation page 404s for a missing project, so it is checked here, while a project still exists.
  r = await request(`/w/${token}/projects/${usedProjectId}/delete`);
  checkLeakHeaders("the delete-project page", r);

  r = await request(`/api/w/${token}/projects/${usedProjectId}/delete`, { method: "POST" });
  check(
    "deleting a project with logged time redirects with the in-use error",
    r.status === 303 && r.location === `/w/${token}?error=project-in-use`,
    describeResponse(r),
  );

  const { json: usedProjectAfterAttempt } = await rest(`projects?select=id&id=eq.${usedProjectId}`);
  check(
    "the used project row still exists after the blocked delete attempt",
    usedProjectAfterAttempt.length === 1,
    `${usedProjectAfterAttempt.length} row(s)`,
  );

  // R-04: an unused project (no time_entries rows) can be deleted through the real HTTP route.
  // Inserted directly, since the app has no way yet to create a project without also starting a
  // timer for it (see plan's Key Discoveries). The default Prefer setting returns no body on
  // insert, so the new row's id is fetched back with a follow-up select, same as other rest()
  // calls in this file.
  await rest("projects", { method: "POST", body: { link_id: linkId, name: "UnusedProject" } });
  const { json: insertedUnused } = await rest(`projects?select=id&link_id=eq.${linkId}&name=eq.UnusedProject`);
  const unusedProjectId = insertedUnused[0]?.id;

  r = await request(`/api/w/${token}/projects/${unusedProjectId}/delete`, { method: "POST" });
  check(
    "deleting an unused project redirects with the deleted status",
    r.status === 303 && r.location === `/w/${token}?status=project-deleted`,
    describeResponse(r),
  );

  const { json: unusedProjectAfterDelete } = await rest(`projects?select=id&id=eq.${unusedProjectId}`);
  check(
    "the unused project row is gone after the successful delete",
    unusedProjectAfterDelete.length === 0,
    `${unusedProjectAfterDelete.length} row(s)`,
  );

  // R-02: switching closes the running entry and opens exactly one new one, through the same HTTP
  // route a person's browser would hit. "Acme Widgets" is still running from the start checks above.
  async function timeEntries() {
    const { json } = await rest(
      `time_entries?select=id,project_id,project_name,ended_at&link_id=eq.${linkId}&order=started_at.asc`,
    );
    return {
      all: json,
      open: json.filter((e) => e.ended_at === null),
      closed: json.filter((e) => e.ended_at !== null),
    };
  }

  r = await request(`/w/${token}`);
  check("the workspace opens while a timer is running", r.status === 200, describeResponse(r));

  r = await request(`/api/w/${token}/timer/switch`, { method: "POST", form: { projectName: "Beta Corp" } });
  check(
    "switching the timer redirects back to the workspace",
    r.status === 303 && r.location === `/w/${token}`,
    describeResponse(r),
  );

  let entries = await timeEntries();
  check(
    "the switch closes the old entry and leaves exactly one open entry, attributed to the new project",
    entries.all.length === 2 &&
      entries.closed.length === 1 &&
      entries.closed[0].project_name === "Acme Widgets" &&
      entries.open.length === 1 &&
      entries.open[0].project_name === "Beta Corp",
    JSON.stringify(entries.all),
  );

  // The switch list is one hidden-input form per project; the running project must not be among them.
  r = await request(`/w/${token}`);
  const switchTargets = [...r.text.matchAll(/<input[^>]*type="hidden"[^>]*value="([^"]*)"/g)].map((m) => m[1]);
  check(
    "while tracking, the workspace offers the other projects to switch to but not the running one",
    r.status === 200 &&
      r.text.includes("Switch to a different project") &&
      switchTargets.includes("Acme Widgets") &&
      !switchTargets.includes("Beta Corp"),
    JSON.stringify(switchTargets),
  );

  r = await request(`/api/w/${token}/timer/switch`, { method: "POST", form: { projectName: "Gamma Inc" } });
  entries = await timeEntries();
  check(
    "a second switch closes the running entry again and still leaves exactly one open entry",
    r.status === 303 &&
      entries.all.length === 3 &&
      entries.closed.length === 2 &&
      entries.open.length === 1 &&
      entries.open[0].project_name === "Gamma Inc",
    JSON.stringify(entries.all),
  );

  // R-01: switching back to a project by name (any case) reuses its row instead of duplicating it.
  r = await request(`/api/w/${token}/timer/switch`, { method: "POST", form: { projectName: "acme widgets" } });
  entries = await timeEntries();
  check(
    "switching back by name reopens the original project, not a duplicate",
    r.status === 303 &&
      entries.all.length === 4 &&
      entries.open.length === 1 &&
      entries.open[0].project_id === usedProjectId &&
      entries.open[0].project_name === "Acme Widgets",
    JSON.stringify(entries.open),
  );

  const { json: projectsAfterSwitches } = await rest(`projects?select=id,name&link_id=eq.${linkId}`);
  check(
    "switching created one project per new name and none for the reused one",
    projectsAfterSwitches.length === 3,
    `${projectsAfterSwitches.length} project(s)`,
  );

  // S-04: stopping and the long-running flag. "Acme Widgets" is still running from the switch checks above and
  // is fresh, so the workspace must not carry the warning. The flag is matched by its marker attribute, not its prose.
  const FLAG_MARKER = "data-long-running-warning";
  r = await request(`/w/${token}`);
  check(
    "a freshly started timer is not flagged as long-running",
    r.status === 200 && !r.text.includes(FLAG_MARKER),
    describeResponse(r),
  );

  r = await request(`/api/w/${token}/timer/stop`, { method: "POST" });
  check(
    "stopping the timer redirects with the stopped status",
    r.status === 303 && r.location === `/w/${token}?status=timer-stopped`,
    describeResponse(r),
  );

  entries = await timeEntries();
  check(
    "the stop closes the running entry and leaves no open entry",
    entries.all.length === 4 && entries.open.length === 0 && entries.closed.length === 4,
    JSON.stringify(entries.all),
  );

  r = await request(`/w/${token}?status=timer-stopped`);
  check(
    "after stopping, the workspace shows the banner and the start form instead of the switch form",
    r.status === 200 && r.text.includes("Timer stopped.") && !r.text.includes("Switch to a different project"),
    describeResponse(r),
  );

  r = await request(`/api/w/${token}/timer/stop`, { method: "POST" });
  check(
    "a second stop with nothing running redirects quietly to the workspace",
    r.status === 303 && r.location === `/w/${token}`,
    describeResponse(r),
  );

  // Stopping is not "day closed": a new timer can be started straight away.
  r = await request(`/api/w/${token}/timer/start`, { method: "POST", form: { projectName: "Acme Widgets" } });
  entries = await timeEntries();
  check(
    "starting again after a stop opens a new entry",
    r.status === 303 && entries.all.length === 5 && entries.open.length === 1,
    JSON.stringify(entries.open),
  );

  // Seed a timer that started 13 hours ago: close the fresh one first (one open entry per link), then insert the old one.
  await request(`/api/w/${token}/timer/stop`, { method: "POST" });
  const thirteenHoursAgo = new Date(Date.now() - 13 * 60 * 60 * 1000).toISOString();
  await rest("time_entries", {
    method: "POST",
    body: { link_id: linkId, project_id: usedProjectId, project_name: "Acme Widgets", started_at: thirteenHoursAgo },
  });
  r = await request(`/w/${token}`);
  check(
    "a timer running for 13 hours is flagged with its elapsed hours",
    r.status === 200 && r.text.includes(FLAG_MARKER) && r.text.includes("13 hours"),
    describeResponse(r),
  );

  r = await request(`/api/w/${token}/timer/stop`, { method: "POST" });
  entries = await timeEntries();
  check(
    "stopping a flagged timer closes it like any other",
    r.status === 303 && r.location === `/w/${token}?status=timer-stopped` && entries.open.length === 0,
    JSON.stringify(entries.open),
  );
}

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

  // S-07: a user can regenerate their own link. The old token 404s immediately, the new one lands
  // in the same workspace (same projects/entries — only this link ever has any, so a global count
  // is an exact proxy for "this link's rows"), and no other person's link is touched. Placed last:
  // regenerating changes the `stopper_link` cookie and invalidates `token`, which earlier checks
  // in this file still depend on.
  r = await request(`/w/${token}/regenerate`);
  check("the regenerate confirmation page opens", r.status === 200, describeResponse(r));

  const { json: linksBeforeRegen } = await rest("links?select=id");
  const { json: projectsBeforeRegen } = await rest("projects?select=id");
  const { json: entriesBeforeRegen } = await rest("time_entries?select=id");

  r = await request(`/api/w/${token}/regenerate`, { method: "POST" });
  const regeneratedToken = REGENERATED_LOCATION.exec(r.location)?.[1];
  check(
    "regenerating redirects to a new workspace URL with a fresh token",
    r.status === 303 && Boolean(regeneratedToken) && regeneratedToken !== token,
    describeResponse(r),
  );

  r = await request(`/w/${token}`, { withCookies: false });
  check("the old token 404s immediately after regenerating", r.status === 404, describeResponse(r));

  r = await request(`/w/${regeneratedToken}`, { withCookies: false });
  check("the new token opens the same workspace", r.status === 200, describeResponse(r));

  const { json: linksAfterRegen } = await rest("links?select=id");
  check(
    "regenerating swaps the token in place rather than creating a new links row",
    linksAfterRegen.length === linksBeforeRegen.length,
    `${linksAfterRegen.length} link(s)`,
  );

  const { json: projectsAfterRegen } = await rest("projects?select=id");
  const { json: entriesAfterRegen } = await rest("time_entries?select=id");
  check(
    "all of that person's projects and time entries survive the swap, unchanged in count",
    projectsAfterRegen.length === projectsBeforeRegen.length && entriesAfterRegen.length === entriesBeforeRegen.length,
    `${projectsAfterRegen.length} project(s), ${entriesAfterRegen.length} entr(y/ies)`,
  );

  r = await request(`/w/${otherToken}`, { withCookies: false });
  check(
    "another person's link still works after someone else regenerated theirs",
    r.status === 200,
    describeResponse(r),
  );

  r = await request(`/api/w/${token}/regenerate`, { method: "POST" });
  check("the old (already-regenerated) token can no longer regenerate either", r.status === 404, describeResponse(r));

  // S-10: a person can delete all their data. Placed after the regenerate checks and last in the file, since it
  // removes the link the earlier checks used. Only `regeneratedToken`'s person has projects and entries, so the
  // global counts are an exact proxy for that person's rows.
  r = await request(`/w/${regeneratedToken}/delete-account`);
  check("the delete-account confirmation page opens", r.status === 200, describeResponse(r));

  const { json: linksBeforeDelete } = await rest("links?select=id");
  const { json: projectsBeforeDelete } = await rest("projects?select=id");
  const { json: entriesBeforeDelete } = await rest("time_entries?select=id");
  const CONFIRM_ERROR_LOCATION = `/w/${regeneratedToken}/delete-account?error=confirm-phrase`;

  r = await request(`/api/w/${regeneratedToken}/delete-account`, { method: "POST" });
  check(
    "deleting without the confirmation phrase redirects back to the confirmation page",
    r.status === 303 && r.location === CONFIRM_ERROR_LOCATION,
    describeResponse(r),
  );

  r = await request(`/api/w/${regeneratedToken}/delete-account`, { method: "POST", form: { confirm: "delete" } });
  check(
    "deleting with the phrase in lowercase redirects back to the confirmation page",
    r.status === 303 && r.location === CONFIRM_ERROR_LOCATION,
    describeResponse(r),
  );

  const { json: linksAfterRefused } = await rest("links?select=id");
  const { json: projectsAfterRefused } = await rest("projects?select=id");
  const { json: entriesAfterRefused } = await rest("time_entries?select=id");
  check(
    "the refused deletes leave every count unchanged",
    linksAfterRefused.length === linksBeforeDelete.length &&
      projectsAfterRefused.length === projectsBeforeDelete.length &&
      entriesAfterRefused.length === entriesBeforeDelete.length,
    `${linksAfterRefused.length} link(s), ${projectsAfterRefused.length} project(s), ${entriesAfterRefused.length} entr(y/ies)`,
  );

  r = await request(`/w/${regeneratedToken}/delete-account?error=confirm-phrase`);
  check(
    "the confirmation page shows the wrong-phrase error",
    r.status === 200 && r.text.includes("Type DELETE exactly to confirm."),
    describeResponse(r),
  );

  // Only this person owns projects, so their link id is the one on those rows. Their workspace views wrote access-log
  // rows, which the delete must remove too.
  const { json: ownedProjects } = await rest("projects?select=link_id&limit=1");
  const deletedLinkId = ownedProjects[0]?.link_id;
  const { json: accessBeforeDelete } = await rest(`access_log?select=id&link_id=eq.${deletedLinkId}`);
  check("the access log holds rows for the person's link before the delete", accessBeforeDelete.length > 0);

  r = await request(`/api/w/${regeneratedToken}/delete-account`, { method: "POST", form: { confirm: "DELETE" } });
  check(
    "deleting with the phrase redirects to the home page with the deleted status",
    r.status === 303 && r.location === "/?status=account-deleted",
    describeResponse(r),
  );
  check(
    "deleting the remembered link clears the browser's link cookie",
    !jar.has("stopper_link"),
    jar.get("stopper_link") ?? "(no cookie)",
  );

  r = await request(`/w/${token}`, { withCookies: false });
  check("the old token still 404s after the delete", r.status === 404, describeResponse(r));

  r = await request(`/w/${regeneratedToken}`, { withCookies: false });
  check("the deleted link's token 404s", r.status === 404, describeResponse(r));

  const { json: linksAfterDelete } = await rest("links?select=id");
  const { json: projectsAfterDelete } = await rest("projects?select=id");
  const { json: entriesAfterDelete } = await rest("time_entries?select=id");
  check(
    "the delete removes exactly that person's rows: one link, all their projects and all their time entries",
    linksAfterDelete.length === linksBeforeDelete.length - 1 &&
      linksAfterDelete.length === 9 &&
      projectsBeforeDelete.length > 0 &&
      entriesBeforeDelete.length > 0 &&
      projectsAfterDelete.length === 0 &&
      entriesAfterDelete.length === 0,
    `${linksAfterDelete.length} link(s), ${projectsAfterDelete.length} project(s), ${entriesAfterDelete.length} entr(y/ies)`,
  );

  const { json: accessForDeleted } = await rest(`access_log?select=id&link_id=eq.${deletedLinkId}`);
  check(
    "the access log has no row for the deleted link",
    Boolean(deletedLinkId) && accessForDeleted.length === 0,
    `${accessForDeleted.length} row(s)`,
  );

  r = await request(`/w/${otherToken}`, { withCookies: false });
  check("another person's link still works after someone else deleted theirs", r.status === 200, describeResponse(r));

  // The freed slot: with nine links left, one more person can create theirs (no cookie, a fresh visitor).
  r = await createLinkRequest(false);
  check(
    "a new link can be created after the delete freed a slot",
    r.status === 303 && WORKSPACE_LOCATION.test(r.location),
    describeResponse(r),
  );
}

console.log(failed ? `\n${failed} step(s) failed` : "\nAll smoke steps passed");
process.exit(failed ? 1 : 0);
