/**
 * Outcome aggregation for the log-service save flow (Packet 2C, P4).
 *
 * Pure. No React, no Supabase, no storage - so scripts/saveflow.battery.ts can
 * symlink and execute this exact file.
 *
 * Priority. An explicit failure, an unknown, or lost automation may never be
 * replaced by payoff copy:
 *   1 receipt upload loss
 *   2 explicit failed / unknown selections (named)
 *   2b automatic failed / unknown matches (counted, never named)
 *   3 replayed+undone tasks (consumed, not completed)
 *   4 dropped REVIEW count
 *   5 next-due payoff
 *
 * Tier 2b exists because silence about a failed AUTO match is a material lie:
 * the user sees "Oil change logged", believes the schedule moved, and the task
 * stays overdue. Naming the inferred task would invent a commitment the
 * product never made, so the count is disclosed without the name.
 *
 * Fit rule: one issue renders its detail; two or more render the
 * highest-priority concrete fact plus fixed summary copy. Copy is kept short
 * because the subtitle is a fixed two-line surface at the largest supported
 * dynamic type.
 *
 * Tier 6 (Packet D): a save whose items matched NO tracked task discloses
 * that fact - "logged" alone implies the schedule moved when nothing did.
 * The disclosure is informational, never a warning, and renders only when
 * there are no completions and no material facts; when exactly one item is
 * involved the plan also offers a hand-attach.
 */

export type CompletionOutcome =
  | { kind: "completed"; taskId: string; taskName: string; eventId: string; nextDue: string | null }
  | { kind: "consumed_undone"; taskId: string; taskName: string }
  | { kind: "failed"; taskId: string; taskName: string; explicit: boolean }
  | { kind: "unknown"; taskId: string; taskName: string; explicit: boolean };

export type OutcomeInput = {
  outcomes: CompletionOutcome[];
  receiptFailed: boolean;
  droppedReviewCount: number;
  matchingUnavailable: boolean;
  /**
   * Items whose service matched no tracked task (a NONE decision). The log is
   * saved and nothing failed, but silence would imply a task moved.
   */
  noneCount: number;
  firstServiceName: string;
};

export type ToastPlan =
  | { kind: "undo"; message: string; subtitle?: string; eventIds: string[] }
  | {
      kind: "save";
      message: string;
      subtitle?: string;
      isError: boolean;
      /** True when the subtitle is the NONE disclosure - informational, not a warning. */
      noneDisclosed: boolean;
      /** True only for the unambiguous case: exactly one NONE item, nothing else to report. */
      offerAttach: boolean;
    };

const RECEIPT_FACT = "Receipt wasn't uploaded.";
const MATCHING_FACT = "Automatic matching was unavailable.";

function unknownFact(name: string): string { return "Couldn't confirm " + name + ". Check Tasks."; }
function failedFact(name: string): string { return "Couldn't update " + name + ". Check Tasks."; }
function autoFact(n: number): string {
  return n === 1
    ? "Couldn't confirm 1 automatic task update. Check Tasks."
    : "Couldn't confirm " + n + " automatic task updates. Check Tasks.";
}
/**
 * replayed+undone means the operation was already consumed and reversed. The
 * service itself is untouched, so the copy must not read as though the log or
 * the maintenance was invalidated.
 */
function undoneFact(name: string): string {
  return name + " stayed unchanged because your earlier undo was preserved.";
}
function noneFact(n: number): string {
  return n === 1 ? "Not tied to a maintenance task." : "Not tied to your maintenance tasks.";
}
function droppedFact(n: number): string {
  return n === 1 ? "1 possible task match needs review." : n + " possible task matches need review.";
}
/**
 * Deliberately neutral. A residual fact can be replayed+undone, which confirms
 * that nothing changed and may need no action, so the summary cannot promise
 * that every residual item "needs review".
 */
function summaryFact(n: number): string {
  return n === 1 ? "1 more task item to check in Tasks." : n + " more task items to check in Tasks.";
}

/** Tiers 1-4, highest priority first. Tier 5 is handled in buildSubtitle. */
export function materialFacts(input: OutcomeInput): string[] {
  const facts: string[] = [];
  if (input.receiptFailed) facts.push(RECEIPT_FACT);

  let autoLost = 0;
  for (const o of input.outcomes) {
    if (o.kind === "unknown") { if (o.explicit) facts.push(unknownFact(o.taskName)); else autoLost++; }
    else if (o.kind === "failed") { if (o.explicit) facts.push(failedFact(o.taskName)); else autoLost++; }
  }
  if (autoLost > 0) facts.push(autoFact(autoLost));
  if (input.matchingUnavailable) facts.push(MATCHING_FACT);

  for (const o of input.outcomes) {
    if (o.kind === "consumed_undone") facts.push(undoneFact(o.taskName));
  }
  if (input.droppedReviewCount > 0) facts.push(droppedFact(input.droppedReviewCount));
  return facts;
}

export function buildSubtitle(input: OutcomeInput): string | undefined {
  const facts = materialFacts(input);
  if (facts.length === 0) {
    const first = input.outcomes.find(o => o.kind === "completed") as
      | Extract<CompletionOutcome, { kind: "completed" }>
      | undefined;
    if (first) return first.nextDue ? first.nextDue : undefined;
    if (input.noneCount > 0) return noneFact(input.noneCount);
    return undefined;
  }
  if (facts.length === 1) return facts[0];
  return facts[0] + " " + summaryFact(facts.length - 1);
}

export function planToast(input: OutcomeInput): ToastPlan {
  const completed = input.outcomes.filter(
    o => o.kind === "completed"
  ) as Extract<CompletionOutcome, { kind: "completed" }>[];
  const subtitle = buildSubtitle(input);

  // The title counts CONFIRMED completions only, and the undo batch carries
  // exactly those event ids. An unknown that committed server-side is absent
  // from both, which is why its disclosure in the subtitle is never optional.
  if (completed.length >= 1) {
    const message =
      completed.length === 1
        ? completed[0].taskName + " marked complete"
        : completed.length + " tasks marked complete";
    return { kind: "undo", message, subtitle, eventIds: completed.map(c => c.eventId) };
  }

  // The log DID commit. Error styling would suggest the whole save failed and
  // invite a duplicate log; the subtitle carries what was lost. A NONE
  // disclosure is not a loss: it renders only when nothing else is reportable,
  // so noneDisclosed is exactly "the subtitle is the NONE fact".
  const noneDisclosed = input.noneCount > 0 && materialFacts(input).length === 0;
  const offerAttach = noneDisclosed && input.noneCount === 1;
  return { kind: "save", message: input.firstServiceName + " logged", subtitle, isError: false, noneDisclosed, offerAttach };
}
