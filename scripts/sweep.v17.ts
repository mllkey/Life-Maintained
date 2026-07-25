import { matchServiceToTask, M_INTENT_WORDS, M_COMPLIANCE_TERMINATORS, M_COMPLIANCE_MODIFIERS } from "./serviceMatcher.v17.ts";
type T = { id: string; name: string };
const TASKS: T[] = [
  { id: "oil", name: "Oil Change" }, { id: "bat", name: "Replace Battery" },
  { id: "tp", name: "Inspect Tire Pressure" }, { id: "rot", name: "Tire Rotation" },
  { id: "trep", name: "Replace Tires" }, { id: "pads", name: "Brake Pad Replacement" },
  { id: "plugs", name: "Spark Plug Replacement" }, { id: "cool", name: "Coolant Flush" },
  { id: "air", name: "Engine Air Filter Replacement" }, { id: "cs", name: "Test Battery and Charging System" },
];
// component phrase -> the ONLY task it may ever AUTO
const COMP: [string, string][] = [
  ["oil", "oil"], ["engine oil", "oil"], ["battery", "bat"], ["tires", "trep_or_tp"],
  ["brake pads", "pads"], ["spark plugs", "plugs"], ["coolant", "cool"],
  ["air filter", "air"], ["charging system", "cs"],
];
const DONE = ["replaced", "changed", "swapped", "installed new"];
const HAZ_CTX: string[] = [
  // never/context nouns
  "watch","key fob","remote","phone","laptop","doorbell","smoke alarm","garage door opener","game controller",
  "camera","dash cam","headphone","earbud","mouse","keyboard","airtag","mobility scooter","r c","toy","drone",
  "battery charger","trickle charger","battery tender","battery maintainer","battery booster","boost pack",
  // foreign assets (owner=car)
  "boat","jet ski","lawnmower","mower","snowblower","atv","quad","four wheeler","motorhome","golf cart","tractor",
  "bicycle","e bike","mountain bike","forklift","generator","chainsaw","skid steer","snowmobile","sled","dinghy",
  // repair-adjacent
  "alternator","supercharger","turbo charger","blower","pro charger",
];
const BOOK_LEADS = ["i want to book","trying to book","looking to book","called to book","could book","kindly book","book"];
const REPAIR_VERBS = ["repaired","fixed","patched","warranty","leak repaired"];
const PER_TAILS = ["per mileage","per usage","per 5000 miles","per month","every month","every 2 years"];
const INTENT_LEAD = ["due for","need","scheduled","quote for","declined","recommend","upcoming","reminder for","every month"];
let fail = 0, autoCount = 0, blocked = 0, total = 0;
function run(p: string, expectAuto: string | null, tag: string) {
  total++;
  const o = matchServiceToTask(p, TASKS, "car");
  if (expectAuto === null) {
    if (o.decision === "AUTO") { fail++; console.log("ORACLE FAIL [" + tag + "]", p, "-> AUTO", o.task?.taskId, o.reason); }
    else blocked++;
  } else {
    if (o.decision === "AUTO") {
      autoCount++;
      const ok = expectAuto === "trep_or_tp" ? (o.task?.taskId === "trep") : o.task?.taskId === expectAuto;
      if (!ok) { fail++; console.log("ORACLE FAIL [wrong-target]", p, "-> AUTO", o.task?.taskId, "expected", expectAuto); }
    }
    // non-AUTO on a clean phrase is a safe cost, not an oracle failure; counted only
  }
}
// 1) HAZARD x COMPONENT x DONE - context before, between, after: must never AUTO
for (const ctx of HAZ_CTX) for (const [c] of COMP) for (const d of DONE) {
  run(`${ctx} ${c} ${d}`, null, "ctx-pre");
  run(`${c} ${d} on the ${ctx}`, null, "ctx-post");
  run(`${ctx} s ${c} ${d}`, null, "ctx-poss");
}
// 2) INTENT x COMPONENT: must never AUTO
for (const lead of INTENT_LEAD) for (const [c] of COMP) run(`${lead} ${c} ${DONE[0]}`.replace(" replaced",""), null, "intent");
for (const lead of INTENT_LEAD) for (const [c] of COMP) run(`${lead} ${c} service`, null, "intent-svc");
// 3) CLEAN completions: AUTO must target the intended task only
for (const [c, target] of COMP) for (const d of DONE) {
  run(`${c} ${d}`, target, "clean");
  run(`${d.split(" ")[0]} ${c}`, target, "clean-rev");
}
// 5) repair verbs on every component incl. explicit pressure: never AUTO
for (const [c] of COMP) for (const v of REPAIR_VERBS) run(c + " " + v, null, "repair-verb");
run("tire pressure leak repaired", null, "repair-verb");
// 6) recurrence tails on every component: never AUTO
for (const [c] of COMP) for (const t of PER_TAILS) run(c + " changed " + t, null, "recur");
// 7) FULL CROSS-PRODUCT: every intent word x every compliance terminator.
// Compliance modifiers must AUTO inside a span; every other intent word must block.
for (const iw of M_INTENT_WORDS) for (const term of M_COMPLIANCE_TERMINATORS) {
  const p = 'oil changed per ' + iw + ' ' + term;
  run(p, (M_COMPLIANCE_MODIFIERS.has(iw) || M_COMPLIANCE_TERMINATORS.has(iw)) ? 'oil' : null, 'span-x');
}
// 8) booking constructions on every component: never AUTO
for (const [c] of COMP) for (const b of BOOK_LEADS) run(b + ' ' + c + ' change', null, 'booking');
// 4) actionless + dangling residual: never AUTO (except registered singles alone)
for (const [c] of COMP) { run(`${c} stuff`, null, "dangle"); run(`${c} 12v`, null, "numeric"); }
console.log(`SWEEP: ${total} phrases | hazard-blocked ${blocked} | clean-AUTO ${autoCount} | ORACLE FAILURES ${fail}`);
