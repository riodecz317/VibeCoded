# gstack — Quality, Risk, Security & Loophole Assessment
**Repo:** https://github.com/garrytan/gstack  
**Version analyzed:** 1.57.9.0 (main branch, June 2026)  
**Assessment date:** June 30, 2026  
**Language breakdown:** TypeScript 79.4% · Go Template 11.2% · Shell 5.8% · JS 2.6%

---

## Executive Summary

gstack is a mature, well-documented AI engineering workflow toolkit built on Claude Code. It is architecturally sound in many areas — notably its browser daemon, token auth, cookie security, and multi-layer prompt-injection defense — but carries meaningful risks in a handful of areas that are worth understanding before adopting it in a team or enterprise context.

**Overall ratings:**

| Dimension | Rating | Notes |
|---|---|---|
| Code Quality | ★★★★☆ | Strong architecture, good patterns; some shell script fragility |
| Documentation Quality | ★★★★★ | Exceptional — auto-generated from source, Diataxis-structured |
| Security Posture | ★★★★☆ | Well thought-out; two notable gaps remain |
| Risk Level (individual use) | 🟡 Medium-Low | Acceptable with awareness |
| Risk Level (team/enterprise) | 🟠 Medium | Requires policy decisions before deployment |
| Open Loopholes | 🔴 3 confirmed, 2 partial | Documented by authors; mitigations vary |

---

## 1. Code Quality Assessment

### Strengths

**Architecture is clean and intentional.** The daemon model (long-lived Chromium process + localhost HTTP) is the right call for interactive QA workflows. The decision to use physical port separation for the tunnel vs. local listener (rather than header inference) is architecturally superior and shows security-aware design thinking.

**Generated documentation is synced with code.** The `SKILL.md.tmpl` → `gen-skill-docs.ts` → `SKILL.md` pipeline means docs can't silently drift from the commands that exist in code. This is a real quality-of-life win for a project of this complexity.

**The ref system is well-designed.** Using Playwright Locators backed by the ARIA accessibility tree (rather than DOM injection) avoids CSP issues, framework hydration conflicts, and shadow DOM problems. Ref staleness detection (count() check before use) is a thoughtful guard against SPA-related stale refs.

**Error messages are agent-oriented.** Errors are rewritten to tell the AI agent what to do next, not just what went wrong. This is the right philosophy for AI-consumed tooling.

**Test tier structure is pragmatic.** Static validation (free, <2s) catches the majority of issues; LLM-as-judge and E2E tests are gated behind `EVALS=1` to avoid unnecessary API spend. The eval observability pipeline (heartbeat + partial results + watcher) is sophisticated.

**Unicode sanitization is properly placed.** Lone UTF-16 surrogate cleanup runs inside `JSON.stringify` via a replacer function (not post-stringify regex), which is the only correct approach. The architectural invariant is documented and pinned with tests.

### Weaknesses

**Shell scripts are fragile in team mode.** The `setup` and `bin/gstack-team-init` scripts use `ln -snf` symlinks that silently fall back to file copies on Windows without Developer Mode. The fallback behavior (frozen copies that don't refresh on `git pull`) is documented but easy to miss, and the consequence is subtle: stale skills that look current.

**`--no-prefix` / `--prefix` flag is stateful but not obviously visible.** The setup flag choice is persisted, but there's no quick way to inspect the current state without re-running setup. In a team environment with mixed installs, this creates hidden divergence.

**Conductor env var promotion is opt-in per entry point.** The `GSTACK_ANTHROPIC_API_KEY` → `ANTHROPIC_API_KEY` promotion must be manually added to every new TypeScript entry point. A missed entry point means silent failures in Conductor (paid evals, gbrain embeddings just don't work). The CONTRIBUTING.md flags this, but it's a recurring footgun.

**No dependency pinning on `@huggingface/transformers`.** The ML classifier dependency is listed as `^4.1.0` (semver minor-compatible). An upstream minor bump that changes the ONNX model loading interface could silently break the L4 security classifier — the most expensive-to-debug failure mode because security issues don't fail loudly.

**`slop-scan` is a soft dependency.** The `slop` and `slop:diff` npm scripts silently no-op if `slop-scan` isn't installed globally (`echo 'slop-scan not available'`). Teams relying on the AI slop detection gate for code review will get no signal if the dependency is missing.

---

## 2. Risk Assessment

### Risk 1: Supply Chain / Auto-Update (HIGH for teams)

**What it is:** Team mode installs via `gstack-team-init required` and auto-updates every session (throttled to once/hour). This means any commit to the upstream `garrytan/gstack` main branch is pulled into every team member's environment within an hour of their next Claude Code session.

**Impact:** A malicious commit, a compromised author account, or even an unintentional breaking change in the upstream repo propagates automatically to every team member running in required mode. The skills are Markdown, but they instruct Claude to run shell commands, make API calls, and write files.

**Mitigation available:** Use `optional` instead of `required` in team init, or fork the repo and point `~/.claude/skills/gstack` at your fork's specific tag. Neither is the default.

**Severity:** 🔴 High for team/enterprise adoption without a fork strategy.

---

### Risk 2: Telemetry Opt-In Ambiguity (LOW-MEDIUM)

**What it is:** gstack states telemetry is off by default and requires explicit opt-in on first run. What's collected is documented (skill name, duration, success/fail, gstack version, OS). The Supabase publishable key is committed to the repo.

**Concern:** The publishable key being in the repo is expected for client-side Supabase use, but anyone can inspect the schema of the telemetry endpoint. More practically: in enterprise environments, the "first run prompt" behavior may not be visible to IT/security teams reviewing the tool — they'd need to read the source to confirm nothing is sent by default.

**Mitigation:** Explicitly run `gstack-config set telemetry off` during enterprise provisioning before first use. The command is documented.

**Severity:** 🟡 Low-Medium — opt-in is real, but enterprise change management should be aware.

---

### Risk 3: iOS QA Tailnet Exposure (MEDIUM)

**What it is:** `/ios-qa` with `--tailnet` exposes a connected iPhone over a Tailscale listener to any HTTP-capable agent on your tailnet. Remote agents are granted a capability tier (observe/interact/mutate/restore). The `gstack-ios-qa-mint` CLI manages an explicit allowlist at `~/.gstack/ios-qa-allowlist.json` (mode 0600).

**Concern:** The allowlist is per-device and per-user, but Tailscale tailnets can include many machines. A misconfigured tailnet (e.g., one that includes contractors or external machines) could expose device interaction capabilities to unintended parties. The "restore" tier can make state changes on a physical device.

**Mitigation:** Only use `--tailnet` on tailnets you fully control. The allowlist is an explicit-intent mechanism, not auto-allowlisting.

**Severity:** 🟠 Medium — acceptable in controlled environments, risky in broad tailnets.

---

### Risk 4: GBrain Memory Sync Secret Scanner (MEDIUM)

**What it is:** The optional GBrain memory sync pushes gstack state (learnings, CEO plans, design docs, retros, developer profiles) to a private git repo. A "defense-in-depth secret scanner" is described that blocks AWS keys, tokens, PEM blocks, and JWTs before they leave the machine.

**Concern:** The scanner is described but not open-source auditable from the public repo. The effectiveness against novel secret formats (internal API keys, short tokens, database URLs) is unknown. If a learning or design doc contains a credential that doesn't match the scanner's patterns, it gets synced to the git repo.

**Mitigation:** Use the "artifacts only" privacy mode (not "everything allowlisted") unless you have audited what the scanner covers.

**Severity:** 🟠 Medium — depends on how much sensitive material your learnings/plans contain.

---

### Risk 5: `GSTACK_SECURITY_OFF=1` Kill Switch (LOW in practice, notable)

**What it is:** A single environment variable disables the entire prompt-injection ML classifier stack. The canary token still injects, but the ML scan is skipped.

**Concern:** In automated CI pipelines or Conductor workspaces where env vars are set by configuration files, an accidental or adversarially-injected `GSTACK_SECURITY_OFF=1` would silently degrade the security posture of the sidebar agent. There's no warning logged when this is active.

**Mitigation:** Audit your workspace env configs to ensure this variable is never set unintentionally. Consider adding a startup warning log when the kill switch is active.

**Severity:** 🟡 Low in most contexts; worth noting for hardened environments.

---

## 3. Security Assessment

### What's Well-Implemented

**Dual-listener tunnel architecture** is the standout security design decision. By binding the local listener and tunnel listener to separate TCP ports, the implementation achieves physical separation that header-based inference cannot. An ngrok caller cannot reach `/health` or `/cookie-picker` because those paths literally don't exist on that socket — not because of a header check that might be spoofed.

**Bearer token auth on all mutating endpoints** with a UUID v4 token per session, written to a mode 0600 state file. This is correct and prevents other local processes from hijacking the browse server.

**Cookie security chain** is thorough: Keychain access requires user approval, decryption happens in-process and never touches disk in plaintext, the DB is opened read-only on a copy, and cookie values are never logged.

**Shell injection prevention** through hardcoded browser registry paths and explicit `Bun.spawn()` argument arrays rather than string interpolation.

**5-layer prompt injection defense** for the sidebar agent: content security (datamarking, hidden-element strip), BERT-small ML classifier (local, 22MB), Claude Haiku transcript classifier, canary token in system prompt with rolling-buffer detection, and an ensemble combiner requiring 2-of-3 agreement for BLOCK. This is more sophisticated than most commercial browser automation tools.

**Rate-capped attempt logging** prevents log-flood DoS on the security attempt recorder.

### Confirmed Loopholes / Open Issues

#### Loophole 1: Windows CDP Cookie Elevation (Tracked as #1136)
**Status:** Documented open issue, no fix yet.

The cookie-import-browser path launches Chrome with `--remote-debugging-port=<random>`. On Windows with App-Bound Encryption v20 (Chrome 127+), a same-user local process that connects to that debugging port can exfiltrate decrypted v20 cookies — going beyond what direct SQLite DB reading would allow (SQLite can't decrypt v20 without DPAPI context). The fix direction is `--remote-debugging-pipe` instead of TCP, but it requires restructuring the CDP client.

**Impact:** Windows users who use the cookie import feature are exposed to potential cookie exfiltration by other processes running as the same user.

**Workaround:** Don't use the cookie import feature on Windows until #1136 is resolved, or run Chrome with App-Bound Encryption disabled (not recommended).

---

#### Loophole 2: SPA Ref Staleness Window
**Status:** Partially mitigated, not fully closed.

The `resolveRef()` function does a `count()` check to detect stale refs after SPA navigation. However, this check only detects elements that have been removed entirely. If a SPA re-renders an element at the same ARIA role + name (e.g., updates a button label in-place, then reverts it), the old Locator may still resolve to the wrong element. The `count()` would return 1 (element exists), but it's a different logical element than the one the agent snapshotted.

**Impact:** The agent could click, fill, or interact with the wrong element in high-dynamism SPAs. Most likely to cause unintended form submissions or navigation in complex React apps.

**Workaround:** The skill documentation instructs agents to re-run `snapshot` after any navigation. The gap is when the agent doesn't recognize that a re-render has occurred.

---

#### Loophole 3: Scoped Token Capability Inheritance on Tunnel
**Status:** Partial gap — documented behavior, but exploitable.

Scoped tokens on the tunnel listener are restricted to a "browser-driving command allowlist." However, the `/sidebar-chat` endpoint is available on both the local listener (auth) and the tunnel listener (auth). A remote paired agent with a scoped token can post messages into the local sidebar agent via the tunnel, effectively influencing the local Claude session's context. The sidebar agent has Bash, Read, Glob, Grep, and WebFetch tools.

**Impact:** A compromised remote agent in a pair-agent session could inject prompts into the local sidebar agent's conversation via `/sidebar-chat`, potentially escalating from browser-driving to arbitrary file reads or bash execution on the local machine (mediated by the sidebar agent's tool allowances).

**Mitigating factors:** Scoped tokens still go through the sidebar agent's 5-layer injection defense. The canary token would catch attempts to exfiltrate the system prompt. However, social-engineering style injections (instructions that look like legitimate task requests) could pass classifier gates.

**Workaround:** Only pair with agents you fully trust. Do not use `pair-agent` with third-party or external agents on untrusted tasks.

---

#### Partial Gap 1: `@c` Cursor-Interactive Refs Are Not ARIA-Validated
The `-C` flag discovers clickable elements by CSS cursor style and onclick attributes — not ARIA. Elements added to the `@c` namespace may not be accessible to assistive technologies and may not behave predictably across browsers. An agent using `@c` refs is interacting with elements that have explicitly opted out of semantic markup.

**Risk:** Low for functional correctness in most cases; medium if the target site uses custom components that handle clicks differently across user agents.

---

#### Partial Gap 2: ngrok Subdomain Guessability
When `pair-agent` starts an ngrok tunnel, the tunnel URL is a random subdomain on ngrok.io. The setup-key exchange (`POST /connect`) is rate-limited at 300/min on the tunnel listener. However, ngrok free-tier subdomains (random, not reserved) are not kept private by ngrok — they're publicly accessible URLs. An attacker who discovers the subdomain (through network scanning, ngrok logs, or other means) has 300 connection attempts per minute to brute-force the setup key.

**Mitigating factors:** Setup keys are UUIDs (122 bits of entropy at 300 attempts/minute = heat death of universe to brute-force). The practical risk is low.

**Risk:** Very low in practice given UUID key entropy, but worth noting for security-conscious teams.

---

## 4. Architecture Loopholes / Design Gaps

### Gap 1: No Centralized Input Validation Layer
Commands dispatched through the HTTP server use separate validation per command handler (`handleReadCommand`, `handleWriteCommand`, `handleMetaCommand`). There's no centralized request schema validation that would catch malformed arguments before they reach Playwright. An argument that passes one handler's assumptions might behave unexpectedly in another context, particularly as new commands are added by contributors.

**Recommendation:** Add a Zod or similar schema validation layer at the server dispatch boundary.

---

### Gap 2: Skill Markdown as Executable Instructions
The Markdown skill files are the instruction surface that Claude reads and executes. They contain shell commands, file paths, and behavioral rules. If a contributor or team member adds a malicious or misconfigured skill file, Claude will execute it without an additional confirmation step (beyond Claude's own safety reasoning). The skills live at `~/.claude/skills/gstack/` — a path that's writable by the current user.

**Recommendation for teams:** Review all skill Markdown files before committing them to a shared CLAUDE.md reference, and consider treating the skills directory as a privileged path in your security model.

---

### Gap 3: No Linux/Windows Cookie Decryption
The cookie import feature only works on macOS (Keychain). Linux and Windows users who attempt cookie import will encounter either silent failures or undocumented behavior. Given that gstack is positioned as a team tool and CI environments are predominantly Linux, this creates a feature gap that may not be obvious during setup.

---

## 5. What's Notable and Positive

Before closing, it's worth highlighting what gstack does particularly well that is uncommon in open-source developer tooling:

- **Self-improving skill preamble** — every session end reflects on failures and logs operational learnings to a per-project JSONL file. This is a genuine compounding knowledge mechanism, not just documentation.
- **Version-triggered auto-restart** of the browse daemon on binary rebuild prevents entire classes of stale-binary bugs with zero user action.
- **Random port selection** (10000-60000) for the daemon makes multi-workspace Conductor setups work without any configuration, which is thoughtful for the target use case.
- **The `ETHOS.md` and builder philosophy** are unusually well-articulated for a tooling repo, and the "Search Before Building" three-layer knowledge model is genuinely useful guidance for AI-assisted development.

---

## Summary Table

| Finding | Category | Severity | Status |
|---|---|---|---|
| Auto-update supply chain risk (team mode) | Risk | 🔴 High | Open — fork strategy recommended |
| Windows CDP cookie elevation (#1136) | Security Loophole | 🔴 High (Windows only) | Open issue, no fix yet |
| Scoped token → sidebar chat injection path | Security Loophole | 🟠 Medium | Partially mitigated by injection defense |
| GBrain memory sync secret scanner coverage | Risk | 🟠 Medium | Unknown — scanner not auditable |
| iOS QA tailnet exposure | Risk | 🟠 Medium | Acceptable in controlled tailnets |
| SPA ref staleness window | Loophole | 🟡 Medium-Low | Partially mitigated |
| No centralized input validation layer | Architecture | 🟡 Medium-Low | Design gap |
| `GSTACK_SECURITY_OFF` no startup warning | Security | 🟡 Low | Easy to add |
| Shell script symlink fragility (Windows) | Quality | 🟡 Low | Documented workaround exists |
| `@huggingface/transformers` not pinned | Quality | 🟡 Low | Minor semver risk |
| ngrok subdomain guessability | Security | 🟢 Very Low | UUID key makes brute-force impractical |
| Linux/Windows cookie decryption missing | Gap | 🟢 Info | Documented limitation |

---

*Assessment based on public source code, README, ARCHITECTURE.md, package.json, and .env.example as of June 30, 2026. Private source files (browse/src/, lib/, scripts/) were not directly inspected — findings in those areas are inferred from documentation and architecture descriptions.*
