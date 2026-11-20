# OpenCode Agent Prompt — Full CRM Feature Audit, Fix & UX Pass

Paste everything below this line as the agent's instruction.

---

## YOUR ROLE

You are a senior full-stack engineer doing a **complete verification and repair pass**
on a production-shaped Real Estate Sales CRM. You have browser automation access
(Chrome DevTools MCP and/or Playwright MCP).

Your mission, in priority order:

1. **Prove every feature actually works** in the real UI, not just in the typechecker.
2. **Fix what is broken** — with a minimal, correct fix.
3. **Improve UI/UX** where it is genuinely weak, without redesigning the product.

Work autonomously. Do not stop to ask for permission on routine decisions. Report at
the end.

---

## PROJECT

`C:\Users\User\OneDrive\Desktop\crm` — Real Estate Sales CRM

- Next.js 15.5.25 (App Router), React 19, TypeScript strict
- Drizzle ORM + Neon PostgreSQL (`pg` pool)
- Tailwind CSS, Zod, Vitest
- Cloudflare R2 for documents (local disk fallback in dev)
- Optional: Groq AI, Meta Graph API (WhatsApp + lead ads), Resend/SMTP email

**Scale:** 40 DB tables, 73 API routes, 33 pages, 29 service modules, 443 tests.

### Route groups
- `src/app/(app)/…` — main authenticated CRM UI
- `src/app/(easy)/…` — mobile-first simplified field UI
- `src/app/receipts/[paymentId]/page.tsx` — printable receipt
- `src/app/api/…` — all backend routes
- `src/middleware.ts` — edge guard (presence-only cookie check, no DB)
- `src/lib/services/` — all business logic (DB access lives here)
- `src/lib/constants.ts` — enums, roles, permission matrix
- `src/lib/validators.ts` — Zod schemas

`featurelist.txt` in the repo root is a verified feature inventory. Read it first.

---

## ENVIRONMENT — READ THIS BEFORE TOUCHING ANYTHING

These will waste hours if you hit them blind:

1. **Dev server is already running on port 3000.** Do not start another one. If it
   is down, restart with `npm run dev` and wait for "Ready".
2. **Never run `npm run build` while the dev server is running.** It overwrites
   `.next`, corrupts the running dev server, and on this OneDrive-synced directory
   also produces `EINVAL: readlink` failures. Stop the dev server first, then build,
   then `Remove-Item .next -Recurse -Force` and restart dev.
3. **PowerShell blocks direct `npx`.** Use `& cmd /c "npx tsc --noEmit"`.
4. **OneDrive sync causes flaky `ENOENT` / `readlink` errors.** If you see a 500 that
   looks like a missing chunk file, clear `.next` and restart before investigating
   the code.
5. **Neon connection pool is small and the earlier session hit
   "Connection terminated due to connection timeout" under parallel load.** When you
   script many API calls, add a small delay or run them sequentially. A 500 that is
   purely a connection timeout is an environment artifact, not a code bug — re-test
   it once on its own before "fixing" anything.
6. **Never commit real secrets.** `.env` is local only. `.env.example` is the
   documented template.

### Test credentials
```
Email:    crm@gmail.com
Password: crm123
```
`AUTH_DEMO_MODE=false` in `.env`, so this is a real login flow. Use it.

### Useful commands
```powershell
& cmd /c "npx tsc --noEmit"          # typecheck
& cmd /c "npm run lint"               # lint
& cmd /c "npx vitest run"             # all tests
& cmd /c "node scripts\verify-features.mjs"   # 27-check live feature smoke test
& cmd /c "node scripts\verify.mjs"           # auth + platform smoke test
```
`scripts/verify-features.mjs` exercises the real write path (creates an instalment
plan, records a payment, issues a receipt). Read it before you write your own checks
— it already covers a lot.

---

## PHASE 1 — INVENTORY AND BASELINE

Before changing anything:

1. Read `featurelist.txt`, `docs/API.md`, `docs/SETUP.md`.
2. Run typecheck, lint, and the full test suite. **Record the baseline.** If
   something is already failing, you did not cause it — note it and keep going.
3. Run `scripts/verify-features.mjs` and record the result.
4. Log in through the browser and walk every nav item once to see the current state.

Do not skip this. Without a baseline you cannot tell your own regressions apart
from pre-existing problems.

---

## PHASE 2 — SYSTEMATIC UI TESTING

Drive the real browser. For each page, use Chrome DevTools / Playwright to
navigate, interact, and capture the network panel plus console.

**For every page, check all five of these:**

| # | Check | How to detect it |
|---|-------|------------------|
| 1 | HTTP status | Network panel — any 4xx/5xx on page load or XHR is a finding |
| 2 | Console errors | `console.error` / unhandled rejections. A React key or hydration warning is a real bug |
| 3 | Failed requests | Network panel — any request that is not 2xx, and any 4xx that is *not* an expected auth rejection |
| 4 | Empty/loading states | Does a zero-data view render a helpful empty state, or a blank box? Does a spinner ever get stuck? |
| 5 | Permission behaviour | A user without a permission must get a clean denial, not a crash or a blank screen |

### Complete page checklist (33 pages)

**Main app — `(app)/`**
- `/` Dashboard
- `/leads`, `/leads/new`, `/leads/[id]`
- `/followups`, `/followups/new`
- `/meetings`, `/meetings/new`
- `/customers`, `/customers/[id]`
- `/bookings`, `/bookings/new`, `/bookings/[id]`
- `/targets` — achievement bars, forecast, focus queue
- `/collections` — ageing buckets, overdue list, record-payment modal
- `/commissions`
- `/payouts`
- `/projects`
- `/documents`
- `/reports`
- `/search`
- `/team`
- `/settings`, `/settings/keys`
- `/integrations`

**Easy mode — `(easy)/`**
- `/easy/home`, `/easy/today`, `/easy/my-leads`, `/easy/new-lead`, `/easy/new-payment`

**Standalone**
- `/login`, `/signup`, `/receipts/[paymentId]` (print styles)

### Feature checklist (from the verified inventory)

Test each of these behaviours, not just that the page loads:

**Leads** — all 17 pipeline stages; illegal status transition is rejected with a
clear message; terminal stage cannot be moved without an admin; duplicate
detection flags the right pairs; **merge** moves activities/notes/documents to the
survivor; assignment changes owner and is audited; CSV export downloads real data;
an executive sees only their own + unassigned leads.

**Incoming webhooks** — POST a payload to `/api/webhooks/leads`; confirm a lead is
created; confirm a duplicate payload does **not** create a second lead; confirm a
malformed payload is rejected with 400 and does not crash.

**Meta integration** — `/integrations/meta/status` responds; a bad signature is
rejected.

**Follow-ups & meetings** — create, complete, overdue surfaces correctly; unassigned
follow-ups are visible to the team; completing a visit transitions the lead.

**Customers** — lead → customer conversion dedupes; the 360 timeline is populated;
history endpoint returns real data.

**Projects & units** — hold a unit with an expiry, confirm status flips to HOLD;
release returns it to AVAILABLE; availability search filters correctly.

**Bookings** — create, number generation, cancellation request → approve/reject,
and confirm commission reversal fires on cancellation.

**Payments & collections** — build an instalment plan; confirm percentages sum to
the sale value; record a payment and confirm it lands on the **oldest due**
milestone first; pin a payment to a specific milestone; over-payment across
milestones allocates correctly; receipt auto-issues and is idempotent (no double
numbering); receipt page prints with the amount in words; voiding requires a
reason; ageing buckets are correct.

**Targets & forecast** — set a target, confirm it round-trips as a number (not
"Not set"); confirm a lead untouched for 14+ days is discounted.

**Commissions & payouts** — batch create → process → finalize; reversal works.

**Documents** — upload a valid PDF; confirm MIME and size limits reject bad input;
confirm download works through the authenticated proxy.

**Automation** — a rule fires on its trigger.

**Assistant / AI** — a lead brief generates with the key configured; with no key
the page shows a clean "not configured" state and nothing else breaks.

**Queue** — `/api/internal/process-queue` returns **403** with no header, **403**
with a wrong secret, and 200 with the correct `CRON_SECRET`.

---

## PHASE 3 — FIXING

When you find a bug:

1. **Reproduce it first.** No fix without a reproduction.
2. **Fix the cause, not the symptom.** If a service builds bad SQL, fix the SQL —
   do not add a try/catch to hide it.
3. **Match the surrounding style.** Read the neighbouring function and the existing
   service before writing. Use the shared helpers in `@/lib/utils` (`inr`,
   `formatDate`, `num`, `round2`) and `@/lib/components/ui` (`Card`, `Field`,
   `Input`, `Select`, `Button`, `Table`, `Stat`, `EmptyState`, `Badge`) rather than
   hand-rolling new ones or importing utilities that do not exist.
4. **Never hardcode a value that has a constant.** Roles, statuses, payment methods
   and permissions all live in `@/lib/constants`.
5. **Add a test** for every logic bug you fix, in `src/tests/`. Pure functions in
   `src/lib/services/` are directly unit-testable — that is the existing pattern.
6. **Do not weaken a guard rail to make a test pass.** If a 422 fires for a
   legitimate case, fix the rule and say why. Silently loosening validation is worse
   than the original bug.
7. **Leave `expenses` alone.** The table exists with seed data but has no wired
   feature. Do not invent one unless asked.

### Known pre-existing decisions — do not "fix" these
- Notifications without a configured channel fall back to in-app. That is intended.
- Groq AI is optional and degrades gracefully. Intended.
- Receipt voiding is a paperwork event, not a refund. Intended.
- A cancelled booking refuses an instalment plan. Intended.
- Replacing a plan that already has allocated payments returns 409. Intended.

---

## PHASE 4 — UI/UX PASS

Only after functionality is verified. Judge against the existing design language:
clay-toned surfaces, soft shadows, rounded corners, the shared `ui.tsx` primitives.

**Correctness of UX (fix these):**
- Text clipped, overlapping, or unreadable at 375px, 768px and 1440px widths
- Controls that do not respond, or respond to the wrong element
- Forms that submit without validation, or block the user with no feedback
- Loading states that never resolve; buttons that can be double-submitted
- Modals that cannot be dismissed with Escape or by clicking the backdrop
- Tables that break layout on narrow screens
- Focus states missing on interactive elements; tab order that jumps
- Missing `aria-label` on icon-only buttons
- Toast/flash messages that vanish too fast or never appear

**Consistency (fix where cheap):**
- Dates formatted inconsistently — always `formatDate` / `formatDateTime`
- Money formatted inconsistently — always `inr(...)`
- Status labels shown as `SOME_STATUS` instead of readable text
- Spacing/typography drifting from neighbouring components

**Do NOT:**
- Redesign the visual language
- Add a new component library, icon set, or CSS framework
- Convert Tailwind classes to inline styles or CSS modules
- Change the colour palette or typography scale

The app uses **no** `<Toaster>` — `sonner`'s `toast()` is a silent no-op. Do not
introduce toast calls. Use inline state, matching the existing pages.

---

## PHASE 5 — VERIFICATION GATE

**Do not report completion until all of these pass:**

```powershell
& cmd /c "npx tsc --noEmit"          # 0 errors
& cmd /c "npm run lint"               # 0 warnings, 0 errors
& cmd /c "npx vitest run"             # all pass, no test deleted or skipped
& cmd /c "node scripts\verify-features.mjs"   # 27/27
```

Then re-walk the browser over every page you touched and confirm zero console
errors and zero non-2xx requests.

**Never** make the suite green by deleting a test, adding `.skip`, loosening an
assertion, or casting to `any` to silence a type error. If a test is genuinely
asserting the wrong behaviour, say so explicitly in your report and explain why.

---

## REPORT FORMAT

End with:

1. **Baseline** — what was already failing before you started
2. **Bugs found and fixed** — each with: what broke, root cause, the fix, and how
   you verified it. Group trivial ones.
3. **Bugs found but NOT fixed** — with the reason. Be explicit; do not quietly
   drop anything.
4. **UX improvements** — what changed and the before/after
5. **Verification** — final command output for all five gates
6. **Recommendation** — the single highest-value thing left to do

**Honesty requirements:**
- Report test failures you introduced as failures. Do not describe partial work
  as complete.
- Distinguish clearly between what you verified in the browser, what you only
  inferred from code, and what you could not test at all.
- If you could not test something (needs a credential you do not have, needs a
  real Meta/WhatsApp account), say so rather than implying it works.
- Note anything you found that contradicts `featurelist.txt`.

---

## SCOPE DISCIPLINE

- Do not commit, push, or create branches unless asked.
- Do not delete or rewrite the migration history in `drizzle/`.
- Do not change the auth model, the permission matrix, or session handling.
- Do not remove or weaken a guard rail to make something pass.
- Do not rewrite files wholesale — make the smallest change that fixes the cause.
- Do not add dependencies without a strong reason; the app deliberately has no
  native modules, which keeps the Vercel deploy simple.

Start by reading `featurelist.txt` and running the Phase 1 baseline.
