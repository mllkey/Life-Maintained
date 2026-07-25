import { newOperationId, isOperationId } from "./operationId.ts";
import { planToast, buildSubtitle, materialFacts, type OutcomeInput, type CompletionOutcome } from "./saveOutcome.ts";
import { pendingSaveKey, serializePendingSave, parsePendingSave, resumeMode, resumePrompt, resumeServiceDateLabel, SILENT_RESUME_WINDOW_MS, type PendingSaveRecord } from "./pendingSave.ts";

let pass = 0, fail = 0;
function chk(label: string, got: unknown, want: unknown) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; } else { fail++; console.log("FAIL [" + label + "]\n  got  " + g + "\n  want " + w); }
}
function ok(label: string, cond: boolean) { if (cond) pass++; else { fail++; console.log("FAIL [" + label + "]"); } }

// ---------- operationId ----------
const ids = new Set<string>();
for (let i = 0; i < 20000; i++) { const id = newOperationId(); ok("v4 shape", isOperationId(id)); ids.add(id); }
chk("20000 unique ids", ids.size, 20000);
ok("rejects non-v4", !isOperationId("441387248a1d24eb04dd3a698dcd7c94"));
ok("rejects wrong version nibble", !isOperationId("00000000-0000-1000-8000-000000000000"));
ok("rejects wrong variant nibble", !isOperationId("00000000-0000-4000-c000-000000000000"));
ok("accepts canonical", isOperationId("00000000-0000-4000-8000-000000000000"));
// Math.random fallback must still set version/variant bits. globalThis.crypto
// is getter-only on modern Node, so shadow it with a configurable property.
const cryptoDesc = Object.getOwnPropertyDescriptor(globalThis, "crypto");
Object.defineProperty(globalThis, "crypto", { value: undefined, configurable: true, writable: true });
const fbIds = new Set<string>();
for (let i = 0; i < 5000; i++) { const id = newOperationId(); ok("fallback v4 shape", isOperationId(id)); fbIds.add(id); }
chk("5000 unique fallback ids", fbIds.size, 5000);
if (cryptoDesc) Object.defineProperty(globalThis, "crypto", cryptoDesc);

// ---------- outcome fixtures ----------
const done = (n: string, due: string | null = null): CompletionOutcome =>
  ({ kind: "completed", taskId: "t-" + n, taskName: n, eventId: "e-" + n, nextDue: due });
const undone = (n: string): CompletionOutcome => ({ kind: "consumed_undone", taskId: "t-" + n, taskName: n });
const unk = (n: string, explicit = true): CompletionOutcome => ({ kind: "unknown", taskId: "t-" + n, taskName: n, explicit });
const bad = (n: string, explicit = true): CompletionOutcome => ({ kind: "failed", taskId: "t-" + n, taskName: n, explicit });
const base = (o: Partial<OutcomeInput> = {}): OutcomeInput => ({
  outcomes: [], receiptFailed: false, droppedReviewCount: 0,
  matchingUnavailable: false, firstServiceName: "Oil change", ...o,
});

const UNK_OIL = "Couldn't confirm Oil Change. Check Tasks.";
const RECEIPT = "Receipt wasn't uploaded.";

// D1 - a failed AUTO match must be DISCLOSED but never NAMED
chk("auto unknown is counted, not named",
  buildSubtitle(base({ outcomes: [unk("Oil Change", false)] })),
  "Couldn't confirm 1 automatic task update. Check Tasks.");
chk("auto losses aggregate into one line",
  buildSubtitle(base({ outcomes: [unk("Oil Change", false), bad("Brake Pads", false)] })),
  "Couldn't confirm 2 automatic task updates. Check Tasks.");
ok("auto fact never leaks the task name",
  !buildSubtitle(base({ outcomes: [unk("Oil Change", false)] }))!.includes("Oil Change"));
chk("payoff cannot hide a lost auto update",
  buildSubtitle(base({ outcomes: [done("Tire Rotation", "Next due at 50,000 mi"), unk("Oil Change", false)] })),
  "Couldn't confirm 1 automatic task update. Check Tasks.");
chk("explicit is named, auto is counted, in one subtitle",
  buildSubtitle(base({ outcomes: [unk("Oil Change"), unk("Coolant Flush", false)] })),
  UNK_OIL + " 1 more task item to check in Tasks.");

// B5 - payoff never replaces an explicit failure
chk("payoff suppressed by explicit unknown",
  buildSubtitle(base({ outcomes: [done("Tire Rotation", "Next due at 50,000 mi"), unk("Oil Change")] })), UNK_OIL);
chk("payoff renders when clean",
  buildSubtitle(base({ outcomes: [done("Tire Rotation", "Next due at 50,000 mi")] })), "Next due at 50,000 mi");
chk("no payoff when nextDue null",
  buildSubtitle(base({ outcomes: [done("Tire Rotation", null)] })), undefined);

// Priority ordering
chk("receipt outranks unknown",
  materialFacts(base({ receiptFailed: true, outcomes: [unk("Oil Change")] }))[0], RECEIPT);
chk("explicit outranks auto",
  materialFacts(base({ outcomes: [unk("Coolant Flush", false), unk("Oil Change")] }))[0], UNK_OIL);
chk("auto outranks undone",
  materialFacts(base({ outcomes: [undone("Coolant Flush"), unk("Oil Change", false)] }))[0],
  "Couldn't confirm 1 automatic task update. Check Tasks.");
chk("undone outranks dropped",
  materialFacts(base({ outcomes: [undone("Coolant Flush")], droppedReviewCount: 2 }))[0],
  "Coolant Flush stayed unchanged because your earlier undo was preserved.");

// D7 - undone copy must not read as the service being reversed
const undoneLine = materialFacts(base({ outcomes: [undone("Oil Change")] }))[0];
ok("undone copy does not say 'already undone'", !undoneLine.includes("already undone"));
ok("undone copy attributes the undo to the user", undoneLine.includes("your earlier undo was preserved"));

// D6 - fit rule and neutral summary
chk("single issue renders detail", buildSubtitle(base({ receiptFailed: true })), RECEIPT);
chk("two issues: top fact + singular neutral summary",
  buildSubtitle(base({ receiptFailed: true, outcomes: [unk("Oil Change")] })),
  RECEIPT + " 1 more task item to check in Tasks.");
chk("four issues: top fact + plural neutral summary",
  buildSubtitle(base({ receiptFailed: true, outcomes: [unk("Oil Change"), bad("Brake Pads"), undone("Coolant Flush")] })),
  RECEIPT + " 3 more task items to check in Tasks.");
ok("summary never claims everything needs review",
  !buildSubtitle(base({ receiptFailed: true, outcomes: [undone("Coolant Flush")] }))!.includes("need review in Tasks"));
ok("no malformed compound in unknown copy", !UNK_OIL.includes("complete-check"));

// D6 - two-line budget. Worst realistic subtitle stays inside a conservative
// character budget for 13pt across ~330pt of usable width at large type.
const worst = buildSubtitle(base({ receiptFailed: true, outcomes: [unk("Engine Air Filter Replacement"), bad("B"), undone("C")] }))!;
ok("worst-case subtitle within budget (" + worst.length + " chars)", worst.length <= 96);

// matching-unavailable disclosure (B3)
chk("matching unavailable is disclosed",
  buildSubtitle(base({ matchingUnavailable: true })), "Automatic matching was unavailable.");

// Toast selection
chk("one completion -> undo toast",
  planToast(base({ outcomes: [done("Oil Change", "Next due at 55,000 mi")] })),
  { kind: "undo", message: "Oil Change marked complete", subtitle: "Next due at 55,000 mi", eventIds: ["e-Oil Change"] });
chk("three completions -> plural + all event ids",
  planToast(base({ outcomes: [done("A"), done("B"), done("C")] })),
  { kind: "undo", message: "3 tasks marked complete", subtitle: undefined, eventIds: ["e-A", "e-B", "e-C"] });
chk("undone alone is NOT a completion",
  planToast(base({ outcomes: [undone("Oil Change")] })),
  { kind: "save", message: "Oil change logged", subtitle: "Oil Change stayed unchanged because your earlier undo was preserved.", isError: false });
chk("zero completions -> save toast, never isError",
  planToast(base({ outcomes: [unk("Oil Change")], receiptFailed: true })),
  { kind: "save", message: "Oil change logged", subtitle: RECEIPT + " 1 more task item to check in Tasks.", isError: false });

// D4 - title counts confirmed only; unknown disclosure is never suppressed
const d4 = planToast(base({ outcomes: [done("A"), done("B"), unk("C")] }));
chk("D4 title counts confirmed only", d4.kind === "undo" ? d4.message : null, "2 tasks marked complete");
ok("D4 unknown still disclosed", (d4.subtitle || "").includes("Couldn't confirm C"));

// eventIds must exclude everything that is not a confirmed completion
const mixed = planToast(base({ outcomes: [done("A"), undone("B"), unk("C"), bad("D")] }));
chk("eventIds only from completions", mixed.kind === "undo" ? mixed.eventIds : null, ["e-A"]);

// Dropped-review copy
chk("dropped singular", buildSubtitle(base({ droppedReviewCount: 1 })), "1 possible task match needs review.");
chk("dropped plural", buildSubtitle(base({ droppedReviewCount: 2 })), "2 possible task matches need review.");

// Clean save
chk("nothing happened -> plain logged",
  planToast(base()), { kind: "save", message: "Oil change logged", subtitle: undefined, isError: false });

// ---------- pendingSave record ----------
const OP = "00000000-0000-4000-8000-000000000001";
const OP2 = "00000000-0000-4000-8000-000000000002";
const rec: PendingSaveRecord = {
  v: 1, createdAt: 1753400000000, completedDate: "2026-07-25T12:00:00.000Z",
  milesVal: 84210, hoursVal: null, receiptPath: "u/vehicle/v/1.jpg",
  items: [
    { itemKey: "i0", serviceName: "Oil change", opId: OP, directTaskId: "t5", directTaskName: "Engine Oil and Filter Change" },
    { itemKey: "i1", serviceName: "Rotated tires", opId: OP2 },
  ],
};
chk("key format", pendingSaveKey("u-1", "v-9"), "lm:pendingLog:v1:u-1:v-9");
chk("round-trip", parsePendingSave(serializePendingSave(rec)), rec);
chk("opIds survive round-trip",
  parsePendingSave(serializePendingSave(rec))!.items.map(i => i.opId), [OP, OP2]);
chk("directTaskName survives (task name when fetch fails)",
  parsePendingSave(serializePendingSave(rec))!.items[0].directTaskName, "Engine Oil and Filter Change");
chk("null raw", parsePendingSave(null), null);
chk("garbage", parsePendingSave("{{{"), null);
chk("wrong version", parsePendingSave(JSON.stringify({ ...rec, v: 2 })), null);
chk("empty items", parsePendingSave(JSON.stringify({ ...rec, items: [] })), null);
chk("non-v4 opId rejected",
  parsePendingSave(JSON.stringify({ ...rec, items: [{ itemKey: "i0", serviceName: "x", opId: "nope" }] })), null);
chk("duplicate itemKey rejected",
  parsePendingSave(JSON.stringify({ ...rec, items: [rec.items[0], { ...rec.items[1], itemKey: "i0" }] })), null);
chk("missing completedDate rejected",
  parsePendingSave(JSON.stringify({ ...rec, completedDate: "" })), null);
chk("undefined optionals are dropped not null",
  parsePendingSave(serializePendingSave(rec))!.items[1], { itemKey: "i1", serviceName: "Rotated tires", opId: OP2 });
chk("no TTL field exists", Object.keys(parsePendingSave(serializePendingSave(rec))!).includes("expiresAt"), false);
ok("createdAt preserved for age display", parsePendingSave(serializePendingSave(rec))!.createdAt === 1753400000000);

// ---------- D3 resume boundary ----------
const NOW = 1753400000000;
const fresh: PendingSaveRecord = { ...rec, createdAt: NOW - 60_000 };
const old: PendingSaveRecord = { ...rec, createdAt: NOW - 11 * 24 * 3600 * 1000 };
chk("fresh record resumes silently", resumeMode(fresh, NOW), "silent");
chk("boundary exactly 24h is still silent", resumeMode({ ...rec, createdAt: NOW - SILENT_RESUME_WINDOW_MS }, NOW), "silent");
chk("one ms past 24h needs confirmation", resumeMode({ ...rec, createdAt: NOW - SILENT_RESUME_WINDOW_MS - 1 }, NOW), "confirm");
chk("clock skew into the future needs confirmation", resumeMode({ ...rec, createdAt: NOW + 5000 }, NOW), "confirm");
chk("eleven-day-old record needs confirmation", resumeMode(old, NOW), "confirm");
chk("service date label", resumeServiceDateLabel(rec), "July 25");
chk("malformed date label is null", resumeServiceDateLabel({ ...rec, completedDate: "not-a-date" }), null);
chk("resume prompt names the service date and item count", resumePrompt(rec),
  { title: "Finish updating your July 25 service?", detail: "2 items still need checking." });
chk("resume prompt singular", resumePrompt({ ...rec, items: [rec.items[0]] }),
  { title: "Finish updating your July 25 service?", detail: "1 item still needs checking." });
chk("resume prompt without a parseable date", resumePrompt({ ...rec, completedDate: "x" }).title,
  "Finish updating your earlier service?");
ok("prompt never promises a task count", !resumePrompt(rec).detail.includes("task"));

console.log(fail === 0 ? "SAVEFLOW ALL PASS (" + pass + ")" : fail + " FAIL / " + pass + " pass");
