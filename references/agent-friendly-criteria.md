---
title: "Agent-Friendly Platform Criteria"
description: "Five core criteria that determine whether an agent can operate a platform independently from a session."
version: 1
---

# Agent-Friendly Platform Criteria

These five criteria determine whether an agent can operate a deployment platform unattended, without needing human intervention to troubleshoot or work around platform limitations.

## The Five Criteria

### 1. CLI-First

**What it means:** Every routine operation — deploy, rollback, log tailing, environment variable management, secret rotation — has a documented command-line interface.

**Why it matters:** Agents work with text, not clickable panels. A platform with a strong CLI is directly usable by an agent; a platform that requires panel navigation blocks the agent at every operational step.

**Scoring:**
- **Pass:** Platform has a complete, stable CLI that covers deployment, logs, environment, and secrets. Examples: `wrangler`, `flyctl`, `vercel` CLI.
- **Partial:** CLI covers most operations but requires occasional panel access for setup or admin tasks.
- **Fail:** Panel-first design; CLI is limited or non-existent.

**Interview weight:** Cost sensitivity, DX preference, and global reach don't reweight this — it's foundational.

---

### 2. Managed / Serverless

**What it means:** The platform abstracts away infrastructure concerns — servers, networking, scaling, patching. The user deploys code or containers; the platform handles the rest.

**Why it matters:** Fewer moving parts mean fewer ways for an agent to misunderstand state or corrupt it. A managed platform gives the agent a predictable, bounded scope of responsibilities.

**Scoring:**
- **Pass:** Platform is fully managed; no infrastructure provisioning, patching, or scaling to configure. Examples: Cloudflare Pages, Vercel, Netlify.
- **Partial:** Managed but with escape hatches for advanced configuration (e.g., Railway, Render offer simple abstractions but expose config if needed).
- **Fail:** Requires manual infrastructure management, server patching, or explicit scaling decisions.

**Hard filter:** If the PRD or tech stack specifies "persistent server processes must stay alive," drop platforms that are serverless-only (Vercel, Netlify) before scoring.

**Interview weight:** Cost sensitivity favors managed platforms (no surprise scaling costs). Existing familiarity with self-managed platforms (AWS, GCP) doesn't override the managed/serverless preference — it just means the user will be comfortable learning the abstractions.

---

### 3. Agent-Readable Docs

**What it means:** Documentation is published as markdown, plaintext, or LLMs.txt on a platform like GitHub, not as JavaScript-rendered marketing websites.

**Why it matters:** Agents can fetch and parse markdown and plaintext. JavaScript-rendered pages require headless browser automation or human transcription; neither scales.

**Scoring:**
- **Pass:** Docs are native markdown on GitHub or published as plaintext/LLMs.txt. Examples: Fly.io (GitHub docs), Cloudflare (markdown). Agent can `curl` and parse.
- **Partial:** Docs exist in multiple formats; some are JS-rendered but mirrors or summaries exist in markdown.
- **Fail:** Only JS-rendered docs; agent cannot reliably extract information.

**Interview weight:** No interview question directly reweights this — it's foundational for agent operability.

---

### 4. Stable, Scriptable Deploy API

**What it means:** Deployment commands exit with predictable codes, produce structured output (JSON when requested), and don't hang or prompt interactively mid-deploy.

**Why it matters:** An agent can only proceed reliably if it can parse command output and detect success/failure from exit codes. Interactive prompts or unstructured text output require manual intervention.

**Scoring:**
- **Pass:** CLI exits cleanly with documented codes (0 = success, nonzero = failure); structured output available (JSON, YAML, or plaintext with clear delimiters). Example: `wrangler deploy --json`.
- **Partial:** Mostly stable but has edge cases (e.g., needs `--non-interactive` flag to suppress prompts).
- **Fail:** Deploy commands prompt for user input or produce only unstructured output.

**Interview weight:** No direct question, but cost-sensitive deployments that auto-scale badly score lower on stability (unpredictable exits).

---

### 5. MCP Server or First-Class Agent Integration

**What it means:** The platform publishes an MCP (Model Context Protocol) server exposing structured tools (`pages_deployments_list`, `logs_tail_last_100`, etc.), OR has native integrations with Claude or other LLM agents.

**Why it matters:** Bonus criterion — agents operating independently can make structured queries against live platform state without parsing CLI output. Not required for MVP, but earns points if present.

**Scoring:**
- **Pass:** MCP server available and documented; agent can make structured queries. Examples: Anthropic's own platform servers.
- **Partial:** Native Claude integration (e.g., platform mentions Claude in docs, has example agents) or community MCP server.
- **Fail:** No MCP or documented agent integrations.

**Interview weight:** This criterion is a tiebreaker, never a filter. If two platforms score equally on criteria 1–4, the one with MCP breaks the tie.

---

## Scoring Matrix Template

| Platform | CLI-First | Managed/Serverless | Agent-Readable Docs | Stable Deploy API | MCP / Integration | Total Pass/Partial/Fail |
|---|---|---|---|---|---|---|
| | Pass/Partial/Fail | Pass/Partial/Fail | Pass/Partial/Fail | Pass/Partial/Fail | Pass/Partial/Fail | P/P/F |

**Interpretation:**
- 5 Pass = strong fit for agent operation
- 4 Pass + 1 Partial = solid fit; Partial criterion is a known limitation
- 3 Pass + 2 Partial = workable; two criteria have gaps
- Fewer than 3 Pass = agent operability is significantly constrained

---

## Hard Filters (Pre-Scoring)

These constraints drop platforms from consideration before scoring:

1. **Runtime / Language Match:** If the tech stack specifies a runtime or language not supported by the platform, the platform is dropped. Example: Python on a JavaScript-only edge runtime.

2. **Persistent Connection Requirement:** If the PRD or tech stack requires persistent server-side connections (WebSockets, background workers that stay alive), serverless-only platforms (Vercel, Netlify) are dropped.

3. **Data Residency / Compliance:** If the PRD specifies data residency requirements (e.g., "data must stay in EU"), platforms that don't offer that option are dropped.

---

## Interview Weights (Applied During Scoring)

Answers to the developer interview reweight criteria:

- **Q2 "Minimize cost"**: Penalize platforms with expensive base tiers or unpredictable auto-scaling costs. Lower scores for platforms that charge per request if the cost-per-request is high.
- **Q3 "Existing familiarity"**: Break ties. If two platforms score equally after other weights, the one the user is familiar with wins.
- **Q4 "Global reach"**: Prefer edge-native platforms (Cloudflare, Vercel) that naturally serve global traffic with low latency.
- **Q5 "Co-location preference"**: Prefer platforms offering integrated managed services (database, storage, queues) from the same vendor.

---

## Reference: Candidate Platform Pool

Research these six platforms by default:

| Platform | Primary Use | Notes |
|---|---|---|
| **Cloudflare Workers + Pages** | Edge-first, serverless JS/TS, global CDN | Highest CLI maturity; edge-only (no persistent processes). |
| **Vercel** | Frontend + serverless functions, Next.js-native | Strong JS ecosystem; serverless-only. |
| **Netlify** | Frontend + serverless, JAMstack, form/auth | Similar to Vercel; serverless-only. |
| **Fly.io** | Container-based PaaS, persistent processes | Supports long-running processes; DIY infrastructure abstraction. |
| **Railway** | Full-stack PaaS, co-located databases | Smooth DX; databases bundled; smaller free tier. |
| **Render** | Container/static hosting, free tier, cron | Budget-friendly; supports background jobs; CLI secondary. |

---

## Version History

- **v1** (2026-09-17): Initial definition. Five core criteria, hard filters, interview weights, scoring matrix template.
