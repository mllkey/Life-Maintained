#!/usr/bin/env python3
"""
PromptForge — Claude Code prompt generator + auditor for LifeMaintained.

Modes:
  forge "rough idea"      Build + gate + revise pipeline.
  forge --audit            Post-implementation audit of a Claude Code run.

Models (edit these two lines when you want to switch):
"""

# =============================================================================
# MODEL CONFIG — edit these two lines to switch models
# =============================================================================
CLAUDE_MODEL = "claude-opus-4-7"
GPT_MODEL = "gpt-5.4"
# =============================================================================

import argparse
import os
import subprocess
import sys
import textwrap
from pathlib import Path

try:
    from anthropic import Anthropic, APIError as AnthropicAPIError
    from openai import OpenAI, APIError as OpenAIAPIError
    from dotenv import load_dotenv
except ImportError as e:
    print(f"❌ Missing dependency: {e.name}")
    print("➡️ Run this in macOS terminal:")
    print("   cd ~/Life-Maintained/tools/promptforge && source .venv/bin/activate && pip install anthropic openai python-dotenv")
    sys.exit(1)


# -----------------------------------------------------------------------------
# Stack context — injected into every Stage 1 build prompt
# -----------------------------------------------------------------------------
STACK_CONTEXT = """\
=== LifeMaintained project context — LOCK EXACTLY AS WRITTEN ===

## What this app is
LifeMaintained is a consumer iOS app tracking vehicle, property, and health maintenance. Solo non-technical founder. Quality bar: Apple, Robinhood, Calm, Duolingo. Internal benchmark: LogSheet + VoiceOrb components — every new component must hit that bar.

## Stack (exact versions)
- React Native 0.81.5 + React 19.1.0 + TypeScript 5.9 strict
- Expo SDK 54, Expo Router 6 (file-based routing in app/)
- Supabase JS 2.98, TanStack Query 5.83, Zod 3 + zod-validation-error
- RevenueCat via react-native-purchases 9.11 + react-native-purchases-ui
- expo-notifications for push, @sentry/react-native 7 for crash reporting
- Receipt scan: expo-image-picker → expo-image-manipulator → Supabase Edge Function (Claude Vision)
- Native iOS project at ios/LifeMaintained.xcworkspace, EAS Build for App Store builds
- react-native-reanimated 4, react-native-gesture-handler, react-native-safe-area-context, react-native-screens, react-native-svg
- @react-native-async-storage/async-storage for local persistence
- @expo-google-fonts/inter, @expo/vector-icons, expo-haptics, expo-blur, expo-linear-gradient, expo-glass-effect
- Styling: React Native StyleSheet (NO Tailwind, NO NativeWind, NO shadcn, NO Radix)
- Patches via patch-package in patches/ — NEVER edit node_modules directly
- Lint: npm run lint (eslint-config-expo). Typecheck: npx tsc --noEmit. Expo health: npx expo-doctor. NO test runner. NO npm run build.

## This is NOT a web app
No Vite, no Tailwind, no shadcn, no Radix, no Capacitor, no PWA, no react-dom routing. Any output referencing those is WRONG.

## Repo + infra constants
- Working dir: ~/Life-Maintained
- GitHub: git@github.com:mllkey/Life-Maintained.git
- Supabase project ref: fqblqrrgjpwysrsiolcn
- Bundle ID: com.lifemaintained.app
- Apple Team: 7Y595M4H3Z
- EAS project: @mllkey/lifemaintained, Project ID: 2b817e52-5d6d-43c4-9855-966f7ded10ad
- Sentry: org `frameworkuno`, project `lifemaintained`

## Brand system
- Vehicle accent: #E8943A (orange)
- Home/property accent: #64D2FF (cyan)
- Health accent: #FF6B9D (pink)
- Background: #0C111B (dark-first)
- Typography: Inter via @expo-google-fonts/inter

## Pricing (real)
- Personal: $7.99/mo · $49.99/yr
- Pro: $11.99/mo · $99.99/yr
- Business: $34.99/mo · $249.99/yr

## Known canonical names (use these EXACTLY)
- Vehicle mileage column: `vehicles.mileage` (NEVER `current_mileage`)
- Vehicle tasks table: `user_vehicle_maintenance_tasks` (NEVER `vehicle_maintenance_tasks` — that's a DEAD TABLE, never re-wire)
- Property tasks table: `property_maintenance_tasks`
- Vehicle type constants: MILEAGE_TRACKED_TYPES, imported from lib/vehicleTypes.ts — NEVER redefined inline
- Canonical DB types: lib/supabase-types.ts (generated). NEVER hand-write Database types in lib/supabase.ts.
- Dead table — never re-wire: `budget_notification_tiers`
- Budget threshold writes go to: user_notification_preferences.budget_threshold
- Notification scheduling entry point: lib/notificationScheduler.ts
- Auth hook: useAuth from AuthContext (per-user AsyncStorage scoped)

## TanStack Query global config (do NOT override unless task explicitly says to)
- staleTime: 5min, gcTime: 30min, retry: 2 exponential backoff
- refetchOnWindowFocus: true, refetchOnReconnect: true
- React Native focusManager wired in _layout.tsx

## Edge function deploy command
npx supabase functions deploy <name> --no-verify-jwt

## Build commands (NEVER omit --auto-submit on TestFlight)
eas build --platform ios --profile production --auto-submit

## Locked escape-hatch baseline (app code only, excl. supabase/functions/)
as_any=82, as_unknown=4, as_typed=86, non_null=79, ts_ignore=0, ts_expect_error=0, ts_nocheck=0
Current tsc error count: 108 (ceiling: 148). Every pass must assert flat before AND after. NO new `as any`, `ts-ignore`, `ts-expect-error`, `ts-nocheck`, or `!` non-null assertions without explicit founder justification.

## Quality benchmarks (reference these by name when specifying visual bar)
- LogSheet (components/LogSheet.tsx) — the nine-figure reference for sheets/modals. Reanimated springs, real haptics, real presence.
- VoiceOrb — the nine-figure reference for animated interactive elements.
When a task touches a UI surface, the prompt must require parity with LogSheet/VoiceOrb quality on: spring curves, haptic timing, empty/loading/error states, safe area handling, and keyboard behavior.

## Commit message format
Short lowercase imperative, no scope prefix. Example: `fix vehicle schedule empty state 409 deadlock`.

## CODEBASE FACTS — flat assertions, never paraphrase
- MILEAGE_TRACKED_TYPES and HOURS_TRACKED_TYPES in lib/vehicleTypes.ts are JavaScript Sets. Membership checks use `.has(value)`, never `.includes(value)`. A prompt that uses `.includes` against either constant is wrong.
- app/add-vehicle.tsx is shared between the onboarding flow and the tab flow via the `isOnboarding` URL param. Any edit to that file must preserve both flows. Onboarding-specific behavior must be gated on `isOnboarding === 'true'`.
- lib/supabase-types.ts is generated by the Supabase CLI. Never hand-edit. Regenerate via `npx supabase gen types typescript --project-id fqblqrrgjpwysrsiolcn > lib/supabase-types.ts` if drift is detected.
- supabase/functions/ runs on the Deno runtime. It is excluded from the app-code tsc gate AND from the escape-hatch baseline gate. Never grep supabase/functions/ when counting `as any`, `@ts-ignore`, etc.
- Locked escape-hatch baseline as of commit 04c00a1 (app code only, excl. supabase/functions/): as_any=82, as_unknown=4, as_typed=86, non_null=79, ts_ignore=0, ts_expect_error=0, ts_nocheck=0. Prior docs claimed as_any=89; the actual pre-Cat-3E count was 85 (grep-method discrepancy), and Cat 3-E removed 3 hatches landing at 82. This 82 baseline is canonical. Every prompt that touches app code must require a BEFORE and AFTER count and assert flat. New escape hatches require explicit founder justification AND a baseline-update step in the same commit.
- tsc ceiling: 148. Current count: 108. A prompt must require BEFORE and AFTER tsc counts and assert AFTER <= BEFORE.
- Dead tables that must never be re-wired: budget_notification_tiers, vehicle_maintenance_tasks. The live tables are user_notification_preferences (budget_threshold column) and user_vehicle_maintenance_tasks.
- Working directory for every shell command in a generated prompt: ~/Life-Maintained. Every command in a generated prompt must either start with `cd ~/Life-Maintained && ` or assume the founder has already cd'd there in the current session — pick one convention per prompt and stick to it.
"""


# -----------------------------------------------------------------------------
# Prompt A — Claude Stage 1 (build + self-critique + revise)
# -----------------------------------------------------------------------------
PROMPT_A_BUILD = """\
You are writing a Claude Code prompt for LifeMaintained. Quality bar: Apple, Robinhood, Calm, Duolingo. The founder is non-technical and pastes your output directly into Claude Code running with --dangerously-skip-permissions and bash auto-approve — meaning there is no human-in-the-loop between your prompt and code execution. Phrases like "wait for approval" or "stop and report back" are MEANINGLESS because Claude Code auto-executes every turn. Every prompt you write must be 100% self-contained: all diagnostics, decision logic, edits, verification, and triage in one shot, using if/then/else branching so Claude Code never has to interpret or guess.

=============================================================
{stack_context}
=============================================================

=============================================================
## LIVE REPO GROUNDING (read-only pre-flight from the actual repo at HEAD)
=============================================================
The following was collected by running read-only commands (`git log`, targeted `grep`, `git show HEAD:<file>`) against the live repo at ~/Life-Maintained immediately before this prompt was built. Treat these as ground truth. If they conflict with anything in the stack context above, the live grounding wins for THIS task. If this section says "(grounding skipped: ...)" or "(grounding ran but returned no relevant matches ...)", proceed without it but log that fact in your SELF_CRITIQUE.

<live_repo_grounding>
{live_grounding}
</live_repo_grounding>

=============================================================
## NON-NEGOTIABLE STANDARDS (every prompt, every tier, no softening)
=============================================================

These standards are the contract. If you write a prompt that requires the founder to come back to ChatGPT for fixes before pasting into Claude Code, you have failed.

- **Nine-figure quality bar.** Every UI surface must read like Apple, Robinhood, Calm, or Duolingo would ship it. The internal benchmark is LogSheet (components/LogSheet.tsx) and VoiceOrb. For any UI-touching prompt, require explicit parity on: spring damping=18, stiffness=220, mass=1; BlurView intensity=40 where blur is used; haptic patterns (light on tap, medium on commit, success on confirm) — cite the exact `Haptics.ImpactFeedbackStyle` or `Haptics.NotificationFeedbackType` constant. Anything weaker = fail.
- **Locked escape-hatch baseline.** as_any=82, as_unknown=4, as_typed=86, non_null=79, ts_ignore=0, ts_expect_error=0, ts_nocheck=0 (commit 04c00a1, app code only excluding supabase/functions/). Every STANDARD or COMPLEX prompt requires BEFORE and AFTER counts and a flat assertion. New hatches require explicit founder justification.
- **Banned vibe-words in acceptance criteria.** smooth, nice, polished, premium, clean, seamless, works well, modern, slick, refined, elegant, beautiful, intuitive. If you catch one in your draft during SELF_CRITIQUE, replace it with a static gate (grep, count, pixel value, ms duration, exit code) before output.
- **Preserve-behavior clause.** Every prompt must include verbatim the preserve-behavior clause from non-negotiable 5. No exceptions.
- **Decision-forcing if/then/else, gated on STATIC output only.** Every branch resolves from grep count, file existence, file content, exit code, or env var. Runtime-observation branches are FORBIDDEN — you may not write "if React warns at runtime", "if the animation feels janky", "if the user reports", "if it looks off". If a concern is only observable at runtime, either handle it unconditionally with defensive code, or drop it from the prompt.
- **Every JSX edit names the exact element by first attribute or by line number.** "Wrap the FieldGroup" is ambiguous when a FieldGroup has multiple children. "Wrap the inner View whose style prop equals styles.field, the one containing the Current Mileage label, NOT the outer FieldGroup" is unambiguous. Or: "Wrap the JSX element at app/add-vehicle.tsx line 412". Pick one form, never both vague and specific.
- **Baseline-aware numeric assertions.** When a file already contains N instances of a pattern and the patch adds M more, the assertion is `== N + M`, NEVER `>= M`. Always include the BEFORE grep count in the prompt and use exact equality. A `>= M` assertion silently passes with fewer edits than required.
- **Every acceptance criterion is static-checkable.** A grep with expected count, a file-existence check, an exit code, a pixel value, a millisecond duration. If a criterion can only be answered by "I looked at it", it is not a criterion.
- **Quality bar scales DOWN with task size, but never softens.** A 5-line fix gets a short prompt with the same rigor (checkpoint, allowlist, validation commands, 9-section report, rollback). Short does not mean sloppy.

After drafting, your SELF_CRITIQUE must explicitly confirm each non-negotiable above is satisfied or note where you applied a fix. The Stage 2 reviewer will check.

## The founder's rough idea
<rough_idea>
{rough_idea}
</rough_idea>

=============================================================
## YOUR JOB, IN THREE STAGES (do all three internally, then output)
=============================================================

### STAGE 1 — Classify the task

Classify the rough idea into exactly ONE of three complexity tiers. The tier determines the structure and depth of the prompt you output.

- **TRIVIAL**: single-file, single-line or single-constant edit. Examples: "fix typo on vehicles list header", "change card padding from 12 to 16", "remove unused import in X file". Scope is objectively ≤1 file and ≤5 LoC. No UI state change, no DB change, no new dependency.
- **STANDARD**: a single coherent feature, fix, or polish pass. 1–5 files, clear user-visible outcome OR one well-scoped technical fix. Examples: "add pull-to-refresh to vehicles list", "fix Cat 3-B reminder_time INSERT nullable mismatch", "add haptic to schedule-complete button".
- **COMPLEX**: multi-file architectural change, new flow, or signature-moment UI. 5+ files OR DB schema touch OR animation scene OR cross-vertical feature. Examples: "rebuild building-plan.tsx as a staged reveal scene", "resolve Cat 3-E tracking_mode cascade across 7 files", "build YourMonthAheadCard cross-vertical dashboard tile".

When in doubt between tiers, pick the higher one. Err on the side of more rigor.

### STAGE 2 — Draft the prompt, matching structure to tier

All three tiers share the same non-negotiable spine (below). The tiers differ in how much diagnostic scaffolding the prompt carries.

**TRIVIAL prompts** include: checkpoint, file allowlist (1 file), exact edit specified down to the line, all 5 validation commands, 9-section report, rollback. Skip: elaborate regression surface, cross-cache analysis, UX citations (unless the change IS a UX detail).

**STANDARD prompts** include: all of TRIVIAL, plus: repo-grounding step with specific grep/file-read commands (cite exact search terms), named regression surface (minimum 3 flows), measurable acceptance criteria (see below), edge case matrix (minimum 6 cases), Apple HIG / NN/g / WCAG citation by section name when UI-facing.

**COMPLEX prompts** include: all of STANDARD, plus: system-level regression analysis (see below), phased implementation plan with decision branches (if X, do A; if Y, do B), quality parity requirement against LogSheet/VoiceOrb for UI surfaces, explicit escape-hatch baseline check (count BEFORE and AFTER, assert flat), tsc error delta check (report BEFORE and AFTER counts), and a "staging" section where Claude Code reports findings from the grounding step before proceeding to edits (but still within the same turn — NOT a stop-and-wait).

### STAGE 3 — Self-critique, revise, output

After drafting, run your draft against the 16 non-negotiables below. Revise in place. Only then output.

=============================================================
## THE 16 NON-NEGOTIABLES (every prompt, every tier)
=============================================================

**1. Quality ceiling / scope floor.** The prompt must produce Claude Code work that ships at premium iOS app bar — visually, behaviorally, architecturally. This overrides speed, convenience, and brevity. A prompt may bundle multiple files/flows ONLY IF they form one coherent deliverable unit (all edits required for one user-visible outcome or one clearly-defined technical fix). FORBIDDEN: cosmetic cleanup, opportunistic refactors, dependency upgrades, architecture changes, naming cleanup, or adjacent bug fixes unless they are REQUIRED by the stated outcome.

**2. Git checkpoint at top.** Exact command: `git add -A && git commit -m "checkpoint before <short-task-id>" --allow-empty`. One line.

**3. File allowlist with escape valve.** Format: "Claude Code may only edit these files: [EXACT paths]. If more files are required, stop, propose an expanded allowlist with file path + reason per file in a single message, then wait for the founder's next message before proceeding."

**4. Repo-grounding with EXPLICIT commands.** The prompt must specify the EXACT shell commands Claude Code runs to ground itself (e.g. `grep -rn "queryKey.*vehicles" app/ hooks/ lib/`), not generic "inspect the relevant files." Every assumption the task rests on must be verified by a named command.

**5. Preserve existing behavior clause.** Verbatim: "Preserve all existing behavior in onboarding, task completion, vehicle/property/health maintenance flows, auth, subscriptions, receipt scanning, and push notifications unless explicitly listed in scope. Do not refactor opportunistically. Do not rename. Do not 'improve.' If you discover a needed out-of-scope change, append it to section 7 of the final report and do NOT make the change."

**6. Named regression surface (MINIMUM 3 flows for STANDARD, 5 for COMPLEX).** Each named flow must cite the specific file(s) or feature(s) at risk AND a one-line verification step. Generic "don't break things" is a fail.

**7. MEASURABLE acceptance criteria.** Every criterion must be:
   (a) numerically measurable (fps, ms, px, dp, tap-count, LoC), OR
   (b) UI-observable by a non-technical tester (what they see, what they feel, what they hear), OR
   (c) terminal-observable (exact command + expected output).
   Banned words in acceptance criteria: "smooth", "nice", "good", "works well", "feels right", "premium" — replace every one with a concrete check.

**8. Edge case matrix (minimum 6 for STANDARD, 10 for COMPLEX).** Must cover: empty state, loading state, permission denied, network failure, Supabase 5xx, duplicate actions, partial success, user cancels, already-configured state, offline-then-reconnect. Each edge case must specify: trigger → expected UI/state → expected data mutation (if any).

**9. UI/UX citations by section name.** If the task touches UI, cite Apple HIG section title (e.g. "Refresh Content Controls", "Modals", "Live Activities"), NN/g heuristic by number, or WCAG 2.x criterion number. Apple HIG takes precedence. For COMPLEX UI, require explicit parity with LogSheet/VoiceOrb on: spring curve type + values, haptic style + timing, safe area handling, keyboard behavior.

**10. Specific library versions.** Always resolve ambiguity. "react-native-reanimated 4.x" not "Reanimated". Cite from stack context above.

**11. Validation commands (run ALL five, paste raw output):**
```
npx tsc --noEmit
npm run lint
npx expo-doctor
git diff --stat
git diff --check
```

**12. Escape-hatch discipline.** For STANDARD + COMPLEX, require Claude Code to run:
```
rg -n "\\bas any\\b" app/ hooks/ lib/ components/ | wc -l
rg -n "@ts-ignore|@ts-expect-error|@ts-nocheck" app/ hooks/ lib/ components/ | wc -l
```
...BEFORE and AFTER edits, and assert flat (zero new hatches) in the final report. The locked baseline from stack context applies.

**13. Native/config flag.** If the task touches `app.json`, `app.config.*`, `eas.json`, `ios/` native files, `expo-notifications` config, `react-native-purchases` config, `@sentry/react-native` config, Expo plugins, or `patches/` — include this verbatim block:
> ⚠️ This task has native/config implications. Before committing, review whether `npx expo prebuild --no-install --platform ios` should be run. Do NOT run it as part of this task. Flag it in section 9 of your final report for the founder to run in a separate session with a fresh checkpoint.

**14. Mandatory 9-section final report.** In this exact order:
1. What changed
2. Files changed (exact paths)
3. Commands run (every shell command, in order)
4. Test results (RAW output of all 5 validation commands — no summarizing)
5. Manual test checklist (each acceptance criterion, marked pass/fail/untested)
6. Regression risks (each named flow from section 6, with verification step)
7. Risks / assumptions / out-of-scope items discovered
8. Rollback command
9. Native/config flag (yes/no — if yes, list affected config)

**15. System-level regression (COMPLEX only).** The prompt must require Claude Code to:
   (a) Name every TanStack query cache key affected (primary + shared-cache siblings),
   (b) Name every component that re-renders from that cache change,
   (c) Name every screen in which those components appear,
   (d) Verify each named screen still renders correctly in the manual test.

**16. Rollback command** printed alongside the prompt. Format: `git reset --hard HEAD~1` (assumes one commit after checkpoint).

=============================================================
## WRITING STYLE
=============================================================

- Write the prompt in the voice of a senior engineer giving instructions to another senior engineer.
- Use if/then/else branching for every decision point so Claude Code never interprets: "If grep returns 0 matches in app/, then search hooks/; if still 0, stop and report." NEVER: "find the file."
- Use ordered numbered sections so Claude Code executes linearly.
- Every file path EXPLICIT. Every command EXPLICIT. Every expected output EXPLICIT.
- When specifying visual details: cite pixel values, spring curve constants, duration in ms, easing function by name. Banned vague words listed in non-negotiable 7.
- When an external decision is unavoidable (e.g. "use an existing error toast or create one"), supply the decision rule: "IF components/ErrorToast.tsx exists, use it. ELSE log via Sentry and return early. Do NOT create a new toast system."
- **Grep precision rule.** When grep is used to detect whether a JSX component IS RENDERED (not merely imported), the grep pattern must match ONLY the JSX opening tag: `grep -cE "<FlatList[ />]" <path>`. NEVER include import-line patterns (e.g. `from 'react-native'.*FlatList`) in the same count — imports match even when the component is not rendered, corrupting the detection. If you need both signals (imported AND rendered), run two separate greps with separate decision branches.
- **No runtime-observation branches.** Every if/then rule in the generated prompt must be executable from STATIC analysis: grep output, file existence, file content, tsc/lint exit codes, env vars. FORBIDDEN: decision branches that depend on runtime observations ("IF React logs a warning during testing", "IF the animation feels janky", "IF the user reports a bug"). If a concern is only observable at runtime, handle it unconditionally with defensive code, or drop it from the prompt — never make it a conditional branch.

=============================================================
## OUTPUT FORMAT — EXACT 5 BLOCKS
=============================================================

Output MUST be exactly 5 blocks, in this order, with these literal tags. No preamble before <SELF_CRITIQUE>. No commentary between blocks.

<SELF_CRITIQUE>
Line 1: TIER = TRIVIAL | STANDARD | COMPLEX (with one-line justification)

Then check each of the 16 non-negotiables. For each, write "N. Pass — <why>" or "N. Fix applied — <what changed>". Be ruthless. For TRIVIAL tier, mark non-negotiables 6, 8, 9, 15 as "Pass — not required at TRIVIAL tier per Stage 2 rules" if genuinely non-applicable.

Then: "Banned-word sweep: [list any vague words in acceptance criteria and what you replaced them with, or 'clean']."

Then: "Zero-interpretation sweep: [list any places a decision was left to Claude Code's judgment and the if/then rule you inserted, or 'clean']."

Then: "Grep-precision sweep: [list any grep commands counting JSX-rendered components that accidentally include import-line patterns, and the tightened pattern you used, or 'clean — only JSX opening-tag patterns used']."

Then: "Runtime-observation sweep: [list any if/then branches that depend on runtime observations, and how you either made them unconditional or dropped them, or 'clean — all branches are static-analysis executable']."
</SELF_CRITIQUE>

<CANDIDATE_PROMPT>
The full Claude Code prompt. Ready to paste. No meta-commentary, no "here is the prompt" preamble — just the prompt itself. Written to a senior RN engineer. Use markdown headers + numbered sections. Include inline if/then logic.
</CANDIDATE_PROMPT>

<GIT_CHECKPOINT>
Exact git checkpoint command. One line.
</GIT_CHECKPOINT>

<ROLLBACK>
Exact rollback command. One line.
</ROLLBACK>

<FINAL_PROMPT_READY>
true
</FINAL_PROMPT_READY>
"""


# -----------------------------------------------------------------------------
# Prompt B — GPT Stage 2 (PASS / REVISE gate)
# -----------------------------------------------------------------------------
PROMPT_B_GATE = """\
You are a gate, not a co-author. You review a Claude Code prompt written for LifeMaintained, a premium iOS app (React Native + Expo + Supabase) targeting a nine-figure outcome.

Your role: flag BLOCKING issues that would let Claude Code ship output below nine-figure quality. You NEVER rewrite the prompt. You NEVER suggest stylistic changes. You NEVER critique word choice unless a word is specifically on the banned list below.

=============================================================
## REVIEW THE PROMPT AGAINST THESE 11 CHECKS (ranked)
=============================================================

**1. Scope containment.** Can Claude Code interpret this as permission to touch unrelated features, refactor extra files, rename things, change architecture, or "clean up" nearby code? The file allowlist must be explicit AND have a clear escape valve. Any ambiguous scope = Issue.

**2. Regression surface.** Does the prompt name SPECIFIC flows at risk (minimum 3 for STANDARD, 5 for COMPLEX) with file paths AND one-line verification steps per flow? Generic "don't break things" = Critical.

**3. Measurable acceptance criteria (ZERO VIBES).** Every acceptance criterion must be numerically measurable (fps, ms, px, dp, tap-count), UI-observable by a non-technical tester (what they see/feel/hear), or terminal-observable (command + expected output). Scan for these BANNED WORDS only in founder-facing implementation instructions, acceptance criteria, validation gates, and section/header text the prompt itself authors — IGNORE occurrences inside fixed STACK_CONTEXT, NON-NEGOTIABLE STANDARDS, or LIVE REPO GROUNDING policy/quoted blocks: "smooth", "nice", "good", "works well", "feels right", "premium", "polished", "clean", "seamless", "modern", "slick", "refined", "elegant", "beautiful", "intuitive". Any single banned word in scope = Issue. Two or more = Critical. Replacement must be a static gate (grep with expected count, pixel value, ms duration, exit code).

**4. Zero-interpretation discipline.** Does the prompt use if/then/else branching for every decision point, or does it leave judgment calls to Claude Code? Examples of judgment calls that should be if/then'd: "find the relevant file" (should be: specific grep command), "use the existing color token" (should be: explicit fallback chain), "handle errors appropriately" (should be: exact error path per edge case). Any remaining judgment call = Issue.

**5. Repo-grounding.** Does the prompt specify EXACT shell commands (grep with specific search terms, file reads by exact path) or does it say "inspect the relevant files"? Vague grounding = Issue.

**6. Edge case matrix.** Minimum 6 cases for STANDARD, 10 for COMPLEX. Each case must specify: trigger → expected UI/state → expected data mutation. Required cases: empty state, loading state, permission denied, network failure, Supabase 5xx, duplicate actions, partial success, user cancels, already-configured state, offline-then-reconnect. Missing required cases = Issue. Fewer than minimum = Critical.

**7. UI/UX citation specificity.** If the prompt touches UI, it must cite Apple HIG by section name, NN/g heuristic by number, or WCAG 2.x criterion by number. Generic "follow Apple HIG" = Issue. Missing entirely on a UI-touching prompt = Critical. For COMPLEX UI: must require parity with LogSheet / VoiceOrb on spring values, haptic timing, safe area, keyboard behavior.

**8. Escape-hatch discipline.** For STANDARD + COMPLEX, prompt must require BEFORE/AFTER counts of `as any`, `@ts-ignore`, `@ts-expect-error`, `@ts-nocheck` and assert flat. Missing on STANDARD/COMPLEX = Issue.

**9. Validation + report discipline.** All five validation commands required (npx tsc --noEmit, npm run lint, npx expo-doctor, git diff --stat, git diff --check). Mandatory 9-section final report required. Native/config flag required. Missing any = Issue.

**10. Grep precision.** Any grep command that counts JSX-rendered components must match ONLY the JSX opening tag (e.g. `<FlatList[ />]`). If a counting grep also matches import-line patterns like `from 'react-native'.*FlatList`, the count will include imports-without-renders and corrupt the decision branch downstream. Any such contaminated grep count used as a decision input = Issue.

**11. No runtime-observation branches.** Every if/then rule in the prompt must be executable from static analysis (grep, file existence, tsc/lint exit codes). Any if/then branch that depends on runtime observations ("IF React logs a warning during testing", "IF the animation feels janky", "IF the user reports", "IF it looks off") = Issue. If the concern matters, the prompt must either handle it unconditionally (defensive code) or drop it — never make it a conditional.

**12. Baseline-aware numeric assertions.** Any acceptance gate of the form `>= M`, `> M`, `at least M`, or `at minimum M` for a count of edits, occurrences, or matches in a file is an Issue UNLESS the prompt also documents the BEFORE count and the gate is on a quantity that can grow independently (e.g. test count). The correct pattern when adding M edits to a file with N existing instances is `== N + M` exact equality. If the prompt does not include the BEFORE count needed to write `== N + M`, it must require Claude Code to capture the BEFORE count first via grep, then write the AFTER assertion exact-equality against `BEFORE + M`. Loose assertions silently pass with fewer edits than required = Issue.

**13. JSX target precision.** Every prompt-specified JSX edit must name the target element by either (a) its first attribute (e.g. a View whose style prop equals styles.field, the one containing the "Current Mileage" label), (b) its exact line number, or (c) a unique grep-locatable signature. Phrases like "the FieldGroup", "the wrapping View", "the parent container" without disambiguation when multiple candidates exist = Issue. If the prompt cannot disambiguate without seeing the file, it must require Claude Code to grep/show the file first and report the candidate set before editing.

=============================================================
## OUTPUT FORMAT
=============================================================

For each of the 11 checks, output one line:

`N. <check name>: Clean` — or —
`N. <check name>: Issue — <one-line evidence>. Required fix: <exact fix>.` — or —
`N. <check name>: Critical — <one-line evidence>. Required fix: <exact fix>.`

Then output EXACTLY one verdict line:

VERDICT: PASS
— or —
VERDICT: REVISE
BLOCKING ISSUES:
1. <issue summary> — REQUIRED FIX: <exact fix>
2. <issue summary> — REQUIRED FIX: <exact fix>
(number as many as needed)

=============================================================
## VERDICT RULES
=============================================================

- Any check marked `Critical` → verdict is REVISE.
- 2 or more checks marked `Issue` → verdict is REVISE.
- All `Clean` or at most 1 `Issue` → verdict may be PASS.
- NEVER rewrite the prompt. NEVER suggest stylistic changes. Only flag blockers.
- When unsure: err toward REVISE. A false REVISE costs one revision pass; a false PASS costs a production regression.

=============================================================
## THE CANDIDATE PROMPT TO REVIEW
=============================================================

<candidate_prompt>
{candidate_prompt}
</candidate_prompt>
"""


# -----------------------------------------------------------------------------
# Prompt C — Claude revision pass (anti-laundering)
# -----------------------------------------------------------------------------
PROMPT_C_REVISE = """\
You previously produced this Claude Code prompt:

<previous_prompt>
{previous_prompt}
</previous_prompt>

A reviewer flagged these BLOCKING issues:

<blocking_issues>
{blocking_issues}
</blocking_issues>

You must resolve each numbered issue line-by-line. For EACH numbered issue, write exactly one of:

Issue N: fixed by doing X
— or —
Issue N: rejected because Y (with a concrete defensible reason — not "it's fine" or "low risk")

Silent drops are forbidden. Every numbered issue must be addressed explicitly.

After the line-by-line resolution, output the revised prompt in the same 5-block format:

<SELF_CRITIQUE>
Line-by-line resolution of each numbered issue. Then a fresh self-critique against the 14 non-negotiables.
</SELF_CRITIQUE>

<CANDIDATE_PROMPT>
The full revised Claude Code prompt. Ready to paste.
</CANDIDATE_PROMPT>

<GIT_CHECKPOINT>
The exact git checkpoint command. One line.
</GIT_CHECKPOINT>

<ROLLBACK>
The exact rollback command. One line.
</ROLLBACK>

<FINAL_PROMPT_READY>
true   — only if every numbered issue was fixed or legitimately rejected AND the fresh self-critique surfaces no remaining gaps
false  — otherwise, followed by a list of unresolved blockers, one per line
</FINAL_PROMPT_READY>
"""


# -----------------------------------------------------------------------------
# Prompt D — Claude audit (forge-audit)
# -----------------------------------------------------------------------------
PROMPT_D_AUDIT = """\
You are an adversarial reviewer auditing a Claude Code implementation for LifeMaintained, a premium iOS app targeting a nine-figure outcome. Your posture: assume Claude Code drifted, scope-crept, or introduced regressions. Prove otherwise using evidence from the final report and the git diff.

You will be given three inputs:

1. The ORIGINAL prompt the founder pasted into Claude Code.
2. Claude Code's FINAL REPORT (the mandatory 9-section format).
3. The GIT DIFF (output of `git diff HEAD~1`).

Produce an audit verdict using this EXACT format:

AUDIT VERDICT: PASS
— or —
AUDIT VERDICT: REVISE

1. Missed requirements:
<bulleted list of requirements from the ORIGINAL prompt that the diff/report does not demonstrate were met, or "none">

2. Scope creep detected:
<bulleted list of files or changes in the diff that are OUTSIDE the allowlist or OUTSIDE the stated scope, or "none". Cite filenames.>

3. Regressions introduced:
<bulleted list of named flows at risk based on diff analysis — e.g. "lib/notificationScheduler.ts modified without corresponding regression test for medication reminders" — or "none">

4. Validation gaps:
<bulleted list of validation commands that were not run, ran and failed, or ran and were not reported in raw form, or "none">

5. Recommendation:
- If PASS: the exact commit command in this format:
  git add -A && git commit -m "<one-line summary of what changed>"
- If REVISE: the exact rollback command `git reset --hard HEAD~1` AND a one-line summary of what went wrong.

Rules:
- PASS requires all 4 checks (1-4) to be "none" OR for any findings to be explicitly acknowledged in the report AND defensible.
- REVISE is the default under uncertainty. If the diff is too large to audit, REVISE.
- If the report references files that do not appear in the diff (phantom changes), REVISE.
- If the diff references files that do not appear in the report (silent changes), REVISE.
- If any validation command was skipped or reported non-raw, REVISE.

Here are the three inputs:

<original_prompt>
{original_prompt}
</original_prompt>

<final_report>
{final_report}
</final_report>

<git_diff>
{git_diff}
</git_diff>
"""


# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
def load_env():
    """Load API keys from .env next to this script."""
    env_path = Path(__file__).parent / ".env"
    if not env_path.exists():
        print(f"❌ .env file not found at {env_path}")
        print("➡️ Create it with the setup instructions from Claude's chat.")
        sys.exit(1)
    load_dotenv(env_path)
    anthropic_key = os.getenv("ANTHROPIC_API_KEY")
    openai_key = os.getenv("OPENAI_API_KEY")
    if not anthropic_key:
        print("❌ ANTHROPIC_API_KEY missing from .env")
        sys.exit(1)
    if not openai_key:
        print("❌ OPENAI_API_KEY missing from .env")
        sys.exit(1)
    return anthropic_key, openai_key


def copy_to_clipboard(text):
    """Copy text to macOS clipboard via pbcopy."""
    try:
        subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=True)
        return True
    except Exception:
        return False


def notify_done(message="PromptForge done"):
    """Play a system chime and post a macOS notification banner. Non-fatal if either fails."""
    try:
        # Glass.aiff is the default macOS chime — short, premium, not annoying.
        subprocess.Popen(
            ["afplay", "/System/Library/Sounds/Glass.aiff"],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass
    try:
        # osascript banner in Notification Center (no clicks needed).
        subprocess.Popen(
            ["osascript", "-e", f'display notification "{message}" with title "PromptForge"'],
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
    except Exception:
        pass


def extract_block(text, tag):
    """Extract content between <TAG>...</TAG>."""
    start_tag = f"<{tag}>"
    end_tag = f"</{tag}>"
    start = text.find(start_tag)
    end = text.find(end_tag)
    if start == -1 or end == -1:
        return None
    return text[start + len(start_tag):end].strip()


def call_claude(client, prompt, verbose=False, label=""):
    """Call Claude API. Returns text on success, exits on failure."""
    if verbose:
        print(f"\n🟣 [Claude — {label}] calling API...", file=sys.stderr)
    try:
        response = client.messages.create(
            model=CLAUDE_MODEL,
            max_tokens=16000,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.content[0].text
        if verbose:
            print(f"🟣 [Claude — {label}] received {len(text)} chars", file=sys.stderr)
        return text
    except AnthropicAPIError as e:
        print(f"\n❌ Anthropic API error: {e}")
        print("➡️ Check https://status.anthropic.com — if the API is up, verify your key and credits at https://console.anthropic.com/settings/billing")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error calling Claude: {e}")
        sys.exit(1)


def call_gpt(client, prompt, verbose=False, label=""):
    """Call OpenAI API. Returns text on success, exits on failure."""
    if verbose:
        print(f"\n🟢 [GPT — {label}] calling API...", file=sys.stderr)
    try:
        response = client.chat.completions.create(
            model=GPT_MODEL,
            messages=[{"role": "user", "content": prompt}],
        )
        text = response.choices[0].message.content
        if verbose:
            print(f"🟢 [GPT — {label}] received {len(text)} chars", file=sys.stderr)
        return text
    except OpenAIAPIError as e:
        print(f"\n❌ OpenAI API error: {e}")
        print("➡️ Check https://status.openai.com — if the API is up, verify your key and credits at https://platform.openai.com/account/billing")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Unexpected error calling GPT: {e}")
        sys.exit(1)


def parse_gpt_verdict(text):
    """Return ('PASS', None), ('REVISE', blocking_issues_text), or ('AMBIGUOUS', None)."""
    upper = text.upper()
    if "VERDICT: PASS" in upper and "VERDICT: REVISE" not in upper:
        return "PASS", None
    if "VERDICT: REVISE" in upper:
        idx = upper.find("BLOCKING ISSUES:")
        if idx == -1:
            return "REVISE", text  # send whole critique
        return "REVISE", text[idx:]
    return "AMBIGUOUS", None


def read_multiline_stdin(prompt_msg):
    """Read until Ctrl-D. Returns stripped text."""
    print(prompt_msg)
    print("(paste now, then press Ctrl-D on a blank line when done)")
    print("─" * 60)
    lines = sys.stdin.read()
    return lines.strip()


# -----------------------------------------------------------------------------
# Live repo grounding — read-only pre-flight that feeds Stage 1
# -----------------------------------------------------------------------------
REPO_ROOT = Path.home() / "Life-Maintained"
GROUNDING_LINE_CAP = 2000


def _run_readonly(cmd, cwd, timeout=15):
    """Run an internally constructed shell command intended to be read-only. Return stdout text or empty string on any failure. Do not pass user-authored shell text into this helper."""
    try:
        result = subprocess.run(
            cmd,
            cwd=str(cwd),
            shell=True,
            capture_output=True,
            text=True,
            timeout=timeout,
        )
        return result.stdout or ""
    except Exception:
        return ""


def _detect_repo_tokens(rough_idea):
    """Pull plausible file paths and symbol names out of the rough idea string for targeted grep."""
    import re
    tokens = set()
    # File paths like app/foo/bar.tsx, lib/x.ts, components/Y.tsx, hooks/useZ.ts
    for m in re.findall(r"[\w./\[\]@-]*?(?:app|lib|hooks|components|supabase)/[\w./\[\]@-]+", rough_idea):
        tokens.add(m.strip(".,;:"))
    # CamelCase symbols (likely components, hooks, types)
    for m in re.findall(r"\b[A-Z][a-zA-Z0-9]{2,}\b", rough_idea):
        tokens.add(m)
    # camelCase identifiers with at least one uppercase
    for m in re.findall(r"\b[a-z][a-zA-Z0-9]*[A-Z][a-zA-Z0-9]*\b", rough_idea):
        tokens.add(m)
    # Snake_case identifiers (DB columns / tables)
    for m in re.findall(r"\b[a-z]+_[a-z_]+\b", rough_idea):
        tokens.add(m)
    return [t for t in tokens if 3 <= len(t) <= 80]


def gather_live_repo_grounding(rough_idea, verbose=False):
    """Run read-only commands against the live repo and return a string for Stage 1 injection.
    Total output is hard-capped at GROUNDING_LINE_CAP lines."""
    if not REPO_ROOT.exists():
        if verbose:
            print(f"⚠️  [grounding] repo not found at {REPO_ROOT} — skipping", file=sys.stderr)
        return "(grounding skipped: repo not found at ~/Life-Maintained)"

    sections = []

    # 1. Recent commit history
    git_log = _run_readonly("git log --oneline -10", REPO_ROOT)
    if git_log.strip():
        sections.append("### Last 10 commits\n" + git_log.strip())

    # 2. Token-targeted grep across app code
    tokens = _detect_repo_tokens(rough_idea)
    if tokens:
        grep_results = []
        for tok in tokens[:12]:  # cap to avoid runaway
            # Escape single quotes for shell
            safe_tok = tok.replace("'", "'\\''")
            cmd = (
                f"grep -rn --include='*.ts' --include='*.tsx' "
                f"-F '{safe_tok}' app/ hooks/ lib/ components/ 2>/dev/null | head -n 25"
            )
            out = _run_readonly(cmd, REPO_ROOT)
            if out.strip():
                grep_results.append(f"--- token: {tok} ---\n{out.strip()}")
        if grep_results:
            sections.append("### Token-targeted grep results\n" + "\n\n".join(grep_results))

    # 3. Full-file dumps for any file path token that resolves to an existing file
    file_dumps = []
    for tok in tokens:
        candidate = REPO_ROOT / tok
        if candidate.is_file() and candidate.suffix in (".ts", ".tsx", ".js", ".jsx", ".sql", ".json"):
            safe_path = tok.replace("'", "'\\''")
            cmd = f"git show HEAD:'{safe_path}'"
            out = _run_readonly(cmd, REPO_ROOT)
            if out.strip():
                file_dumps.append(f"--- HEAD:{tok} ---\n{out}")
    if file_dumps:
        sections.append("### File contents at HEAD\n" + "\n\n".join(file_dumps))

    if not sections:
        return "(grounding ran but returned no relevant matches — Stage 1 should proceed without live repo grounding)"

    full = "\n\n".join(sections)
    lines = full.splitlines()
    if len(lines) > GROUNDING_LINE_CAP:
        # Reserve 2 lines for the trailing blank + truncation message so the
        # returned string honors GROUNDING_LINE_CAP exactly under splitlines().
        truncated = "\n".join(lines[:GROUNDING_LINE_CAP - 2])
        truncated += f"\n\n[grounding truncated at {GROUNDING_LINE_CAP} lines of {len(lines)} total]"
        return truncated
    return full


# -----------------------------------------------------------------------------
# forge (build mode)
# -----------------------------------------------------------------------------
def run_forge(rough_idea, verbose, max_revisions):
    anthropic_key, openai_key = load_env()
    claude = Anthropic(api_key=anthropic_key)
    gpt = OpenAI(api_key=openai_key)

    # Pre-flight — live repo grounding
    if verbose:
        print("🟡 [grounding] running read-only repo pre-flight...", file=sys.stderr)
    live_grounding = gather_live_repo_grounding(rough_idea, verbose=verbose)
    if verbose:
        print(f"🟡 [grounding] {len(live_grounding.splitlines())} lines collected", file=sys.stderr)

    # Stage 1 — build
    build_prompt = PROMPT_A_BUILD.format(
        stack_context=STACK_CONTEXT,
        live_grounding=live_grounding,
        rough_idea=rough_idea,
    )
    stage1_output = call_claude(claude, build_prompt, verbose=verbose, label="Stage 1 build")

    candidate = extract_block(stage1_output, "CANDIDATE_PROMPT")
    git_checkpoint = extract_block(stage1_output, "GIT_CHECKPOINT")
    rollback = extract_block(stage1_output, "ROLLBACK")
    ready = extract_block(stage1_output, "FINAL_PROMPT_READY")

    if candidate is None:
        print("❌ Claude returned malformed output (no <CANDIDATE_PROMPT> block). Raw output:")
        print(stage1_output)
        sys.exit(1)

    # Stage 2 — gate (loop up to max_revisions)
    revision_count = 0
    ready_flag = (ready or "false").strip().lower() == "true"
    unresolved_blockers = None

    while revision_count < max_revisions:
        gate_prompt = PROMPT_B_GATE.format(candidate_prompt=candidate)
        gate_output = call_gpt(gpt, gate_prompt, verbose=verbose, label=f"Stage 2 gate (round {revision_count + 1})")
        verdict, blocking_issues = parse_gpt_verdict(gate_output)

        if verbose:
            print(f"\n🟢 [GPT verdict] {verdict}", file=sys.stderr)

        if verdict == "PASS":
            break

        if verdict == "AMBIGUOUS":
            if verbose:
                print("⚠️  GPT returned ambiguous verdict — treating as PASS (verbose warning)", file=sys.stderr)
            break

        # REVISE path
        revision_count += 1
        if verbose:
            print(f"\n🟣 [Claude — revision {revision_count}] applying GPT blockers...", file=sys.stderr)

        revise_prompt = PROMPT_C_REVISE.format(
            previous_prompt=candidate, blocking_issues=blocking_issues
        )
        revise_output = call_claude(claude, revise_prompt, verbose=verbose, label=f"revision {revision_count}")

        new_candidate = extract_block(revise_output, "CANDIDATE_PROMPT")
        new_git = extract_block(revise_output, "GIT_CHECKPOINT")
        new_rollback = extract_block(revise_output, "ROLLBACK")
        new_ready = extract_block(revise_output, "FINAL_PROMPT_READY")

        if new_candidate is None:
            print("❌ Claude revision returned malformed output. Keeping previous candidate.")
            break

        candidate = new_candidate
        if new_git:
            git_checkpoint = new_git
        if new_rollback:
            rollback = new_rollback

        ready_raw = (new_ready or "false").strip()
        ready_flag = ready_raw.lower().startswith("true")
        if ready_flag:
            unresolved_blockers = None
            # Loop back to re-gate the revised prompt
            continue
        else:
            # Claude couldn't resolve all blockers; stop looping.
            unresolved_blockers = ready_raw
            break

    # Output
    print()
    if not ready_flag and unresolved_blockers:
        print("=" * 60)
        print("⚠️  UNRESOLVED BLOCKERS — review before pasting into Claude Code")
        print("=" * 60)
        print(unresolved_blockers)
        print("=" * 60)
        print()

    print("➡️ NEXT STEP: first, run this git checkpoint in macOS terminal:")
    print()
    print(f"    {git_checkpoint}")
    print()
    print("─" * 60)
    print("➡️ NEXT STEP: paste this into Claude Code (it is also in your clipboard):")
    print("─" * 60)
    print()
    print(candidate)
    print()
    print("─" * 60)
    print("➡️ IF THE TASK FAILS: run this in macOS terminal to roll back:")
    print()
    print(f"    {rollback}")
    print()

    if copy_to_clipboard(candidate):
        print("✅ Final prompt copied to clipboard.")
    else:
        print("⚠️  Could not copy to clipboard (pbcopy failed). Copy manually from above.")

    notify_done("Prompt ready — paste into Claude Code")


# -----------------------------------------------------------------------------
# forge-audit (audit mode)
# -----------------------------------------------------------------------------
def run_audit(verbose):
    anthropic_key, _ = load_env()
    claude = Anthropic(api_key=anthropic_key)

    print("=" * 60)
    print("FORGE AUDIT — post-implementation review")
    print("=" * 60)
    print()

    original_prompt = read_multiline_stdin(
        "STEP 1 of 3: Paste the ORIGINAL prompt you gave Claude Code."
    )
    print()
    final_report = read_multiline_stdin(
        "STEP 2 of 3: Paste Claude Code's FINAL 9-SECTION REPORT."
    )
    print()
    git_diff = read_multiline_stdin(
        "STEP 3 of 3: Paste the output of `git diff HEAD~1`."
    )
    print()

    if not original_prompt or not final_report or not git_diff:
        print("❌ One or more inputs was empty. Aborting audit.")
        sys.exit(1)

    audit_prompt = PROMPT_D_AUDIT.format(
        original_prompt=original_prompt,
        final_report=final_report,
        git_diff=git_diff,
    )

    if verbose:
        print(f"🟣 [Claude — audit] sending {len(audit_prompt)} chars...", file=sys.stderr)

    audit_output = call_claude(claude, audit_prompt, verbose=verbose, label="audit")

    print()
    print("=" * 60)
    print("AUDIT RESULT")
    print("=" * 60)
    print()
    print(audit_output)
    print()

    if copy_to_clipboard(audit_output):
        print("✅ Audit verdict copied to clipboard.")
    else:
        print("⚠️  Could not copy to clipboard (pbcopy failed).")

    verdict_label = "PASS" if "AUDIT VERDICT: PASS" in audit_output.upper() else "REVISE"
    notify_done(f"Audit complete — {verdict_label}")


# -----------------------------------------------------------------------------
# CLI
# -----------------------------------------------------------------------------
def main():
    parser = argparse.ArgumentParser(
        description="PromptForge — Claude Code prompt generator + auditor for LifeMaintained.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    parser.add_argument("rough_idea", nargs="?", default=None,
                        help='Rough idea to forge into a prompt (e.g. forge "add pull to refresh on vehicles list").')
    parser.add_argument("--audit", action="store_true",
                        help="Run post-implementation audit instead of forge.")
    parser.add_argument("--verbose", "-v", action="store_true",
                        help="Show intermediate API calls.")
    parser.add_argument("--max-revisions", type=int, default=2,
                        help="Max Claude revision passes after GPT REVISE (default 2, hard cap 3).")
    args = parser.parse_args()

    max_rev = max(1, min(args.max_revisions, 3))

    if args.audit:
        run_audit(verbose=args.verbose)
        return

    if not args.rough_idea:
        print('Usage: forge "rough idea here"')
        print("       forge --audit")
        sys.exit(1)

    run_forge(args.rough_idea, verbose=args.verbose, max_revisions=max_rev)


if __name__ == "__main__":
    main()
