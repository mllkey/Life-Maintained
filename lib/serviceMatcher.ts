export type MatchDecision = "AUTO" | "REVIEW" | "NONE";
export type MatchCandidate = { taskId: string; taskName: string; score: number; component: string | null; action: string | null; };
export type MatchOutcome = { decision: MatchDecision; task: MatchCandidate | null; candidates: MatchCandidate[]; topScore: number; margin: number; reason: string; };
type CompDef = [string, boolean, boolean, string[]];
type MatchTask = { id: string; name: string };

const M_COMPONENTS: CompDef[] = [
  ["oil", true, false, ["engine oil and filter","motor oil and filter","oil filter","oil and filter","motor oil","engine oil","synthetic oil","lube","oil"]],
  ["air_filter", true, false, ["cabin air filter","engine air filter","air filter","cabin filter","intake filter","air cleaner","pollen filter"]],
  ["washer_fluid", true, false, ["washer fluid","wiper fluid","windshield fluid","washer"]],
  ["tire_pressure", true, false, ["tire pressure","tyre pressure","tire condition","tires","tire"]],
  ["tire_rotation", true, false, ["tire rotation","rotate tires","rotated tires","tyre rotation","wheel rotation"]],
  ["tire_replace", true, false, ["tire replacement","replace tires","replaced tires","new tires"]],
  ["brake_pads", true, false, ["brake pads","brake pad","pads"]],
  ["brake_fluid", true, false, ["brake fluid"]],
  ["brake_rotor", true, false, ["brake rotor","brake disc","rotors","rotor"]],
  ["brake", false, true, ["brakes","brake"]],
  ["battery", true, false, ["battery"]],
  ["charging_system", true, false, ["battery and charging system","charging system"]],
  ["glow_plugs", true, false, ["glow plugs","glow plug"]],
  ["spark_plugs", true, false, ["spark plugs","spark plug","plugs"]],
  ["coolant", true, false, ["radiator coolant","radiator flush","coolant","antifreeze"]],
  ["differential", true, false, ["differential fluid","differential","diff"]],
  ["transmission", true, false, ["gearbox oil","gear oil","transmission fluid","trans fluid","transmission","tranny","gearbox","atf"]],
  ["wiper", true, false, ["windshield wipers","windshield wiper","wiper blades","wiper blade","wipers","wiper"]],
  ["drive_belt", true, false, ["serpentine belt","drive belt","timing belt","fan belt","belt"]],
  ["fuel_filter", true, false, ["fuel filter"]],
  ["fuel_system", true, false, ["fuel system","fuel"]],
  ["suspension", true, false, ["steering and suspension","suspension","steering","shocks","shock","struts","strut"]],
];
const M_FAMILY_OF: Record<string, Set<string>> = { brake: new Set(["brake_pads","brake_fluid","brake_rotor"]) };
const M_ACTIONS: [string, string[]][] = [
  ["inspect", ["inspect","inspected","inspection","check","checked","test","tested","examine","examined","condition"]],
  ["adjust", ["adjusted","adjust","adjusting","inflated","inflate","aired"]],
  ["clean", ["clean","cleaned","cleaning"]],
  ["rotate", ["rotate","rotated","rotation"]],
  ["topoff", ["top off","topped off","refill","refilled","fill","filled","add","added"]],
  ["complete", ["service completed", "service performed", "maintenance completed", "maintenance performed"]],
  ["replace", ["replace","replaced","replacement","change","changed","swap","swapped","install","installed","flush","flushed","drain","drained","new"]],
  ["repair", ["repair","repaired","rebuild","rebuilt","leak","leaking","fix","fixed","dead","died","jump","jumped","noise"]],
];
const M_REPAIR_PARTS = new Set<string>(["alternator","injector","coil","supercharger","turbocharger","turbo","blower","procharger","hose","pump","cable","wire","sensor","terminal","pipe","line","bracket","mount","bulb","fuse","gasket","seal","tensioner","pulley","connector","clamp","motor","relay","module","switch","cap","housing","actuator","solenoid","bearing","joint","boot","bushing","link","pan","cooler","dipstick","reservoir","thermostat","tank","door","rail","tray","arm","rack","valve","fan","spring","drum","shoe","cylinder","compressor","starter","caliper","ring","linkage","column","wheel","tube","screw","neck","plug"]);
const M_REPAIR_PHRASES: string[][] = [["super", "charger"], ["super", "chargers"], ["turbo", "charger"], ["turbo", "chargers"], ["pro", "charger"], ["pro", "chargers"]];
export const M_COMPLIANCE_TERMINATORS = new Set(["schedule", "schedules", "manual", "manuals", "spec", "specs", "recommendation", "recommendations", "interval", "intervals", "maintenance", "guideline", "guidelines", "instructions", "book"]);
export const M_COMPLIANCE_MODIFIERS = new Set(["scheduled", "schedule", "schedules", "recommended", "recommend", "recommends"]);
const M_SCORE_NEUTRAL = new Set(["warranty", "warranties", "under", "extended", "factory", "limited", "dealer", "dealership", "manufacturer", "manufacturers", "s"]);
const M_STOPWORDS = new Set<string>(["the","and","for","with","of","a","to","your","my","this","that","service","services","system","maintenance","general","scheduled","annual","yearly","full","complete","kit","an","did","done","got","had","just","today","is","was","were","in","on","at","we","i","up","mile","miles","mi"]);
export const M_INTENT_WORDS = new Set<string>(["due","overdue","need","needs","needed","recommend","recommended","recommends","decline","declined","defer","deferred","postpone","postponed","skip","skipped","quote","quoted","estimate","estimated","schedule","scheduled","scheduling","appointment","book","booked","upcoming","soon","reminder","waiting","pending","next","every"]);
const M_REGISTERED_SINGLE = new Set<string>(["battery","coolant"]);
const M_ASSET_VOCAB: [string, string[]][] = [
  ["car", ["car"]], ["sedan", ["car"]], ["suv", ["car"]], ["van", ["car"]], ["pickup", ["car"]], ["minivan", ["car"]],
  ["truck", ["car", "semi_truck", "dump_truck"]],
  ["motorcycle", ["motorcycle"]], ["motorbike", ["motorcycle"]], ["bike", ["motorcycle"]], ["mountain bike", []], ["road bike", []], ["electric bike", []], ["exercise bike", []], ["stationary bike", []], ["pedal bike", []], ["dirt bike", ["motorcycle"]], ["moped", ["motorcycle"]], ["scooter", ["motorcycle"]],
  ["semi", ["semi_truck"]], ["semi truck", ["semi_truck"]], ["tractor trailer", ["semi_truck"]], ["semi tractor", ["semi_truck"]], ["big rig", ["semi_truck"]], ["18 wheeler", ["semi_truck"]],
  ["rv", ["rv"]], ["motorhome", ["rv"]], ["motor home", ["rv"]], ["camper", ["rv"]], ["campervan", ["rv"]], ["camper van", ["rv"]], ["motor coach", ["rv"]],
  ["atv", ["atv"]], ["quad", ["atv"]], ["four wheeler", ["atv"]], ["fourwheeler", ["atv"]], ["4 wheeler", ["atv"]],
  ["utv", ["utv"]], ["side by side", ["utv"]], ["sxs", ["utv"]],
  ["snowmobile", ["snowmobile"]], ["sled", ["snowmobile"]], ["ski doo", ["snowmobile"]], ["skidoo", ["snowmobile"]], ["snow machine", ["snowmobile"]],
  ["boat", ["boat"]], ["pontoon", ["boat"]], ["tender", ["boat"]], ["dinghy", ["boat"]], ["outboard", ["boat"]],
  ["pwc", ["pwc"]], ["jet ski", ["pwc"]], ["jetski", ["pwc"]], ["waverunner", ["pwc"]], ["wave runner", ["pwc"]], ["sea doo", ["pwc"]], ["seadoo", ["pwc"]], ["personal watercraft", ["pwc"]], ["watercraft", ["boat", "pwc"]],
  ["lawnmower", ["lawnmower"]], ["lawn mower", ["lawnmower"]], ["mower", ["lawnmower"]], ["riding mower", ["lawnmower"]], ["zero turn", ["lawnmower"]],
  ["chainsaw", ["chainsaw"]], ["chain saw", ["chainsaw"]],
  ["generator", ["generator"]], ["genset", ["generator"]],
  ["snowblower", ["snow_blower"]], ["snow blower", ["snow_blower"]], ["snow thrower", ["snow_blower"]], ["snowthrower", ["snow_blower"]],
  ["pressure washer", ["pressure_washer"]], ["power washer", ["pressure_washer"]],
  ["wood chipper", ["wood_chipper"]], ["chipper", ["wood_chipper"]],
  ["stump grinder", ["stump_grinder"]],
  ["concrete saw", ["concrete_saw"]],
  ["welder", ["welder"]],
  ["excavator", ["excavator", "mini_excavator"]], ["mini excavator", ["mini_excavator"]], ["mini ex", ["mini_excavator"]],
  ["skid steer", ["skid_steer"]], ["skidsteer", ["skid_steer"]],
  ["track loader", ["compact_track_loader"]], ["ctl", ["compact_track_loader"]],
  ["backhoe", ["backhoe"]],
  ["wheel loader", ["wheel_loader"]], ["loader", ["wheel_loader", "skid_steer", "compact_track_loader", "backhoe"]],
  ["telehandler", ["telehandler"]],
  ["forklift", ["forklift"]], ["fork lift", ["forklift"]],
  ["dump truck", ["dump_truck"]],
  ["trailer", ["trailer", "dump_trailer"]], ["dump trailer", ["dump_trailer"]],
  ["dumpster", ["dumpster"]],
  ["golf cart", []], ["bicycle", []], ["e bike", []], ["ebike", []], ["tractor", []],
];
const M_NEVER_CONTEXT: string[][] = [
  ["watch"], ["key", "fob"], ["fob"], ["keyless"], ["remote"], ["phone"], ["laptop"], ["tablet"],
  ["smoke", "detector"], ["thermostat", "battery"], ["hearing", "aid"], ["toy"], ["rc"], ["drone"], ["flashlight"], ["clock"],
  ["mobility", "scooter"], ["r", "c"], ["doorbell"], ["smoke", "alarm"], ["carbon", "monoxide"],
  ["security", "camera"], ["game", "controller"], ["headphones"], ["earbuds"], ["mouse"], ["keyboard"],
  ["airtag"], ["battery", "backup"], ["garage", "door", "opener"],
  ["key"], ["controller"], ["camera"], ["dash", "cam"], ["battery", "charger"], ["battery", "chargers"], ["phone", "charger"], ["phone", "chargers"],
  ["trickle", "charger"], ["trickle", "chargers"], ["onboard", "charger"], ["onboard", "chargers"],
  ["battery", "tender"], ["battery", "tenders"], ["battery", "maintainer"], ["battery", "maintainers"],
  ["battery", "booster"], ["battery", "boosters"], ["boost", "pack"], ["boost", "packs"], ["headphone"], ["earbud"],
];
type AssetAlias = { types: string[]; words: string[] };
const M_ASSET_ALIASES: AssetAlias[] = M_ASSET_VOCAB.map(([a, types]) => ({ types, words: a.split(" ") }));
M_ASSET_ALIASES.sort((x, y) => y.words.length - x.words.length);
const M_NEVER_ALIASES: string[][] = [...M_NEVER_CONTEXT].sort((x, y) => y.length - x.length);

const M_AUTO_SCORE = 0.55, M_AUTO_MARGIN = 0.20, M_REVIEW_SCORE = 0.40;

type CompAlias = { id: string; specific: boolean; family: boolean; words: string[] };
const M_COMP_ALIASES: CompAlias[] = [];
for (const [id, specific, family, aliases] of M_COMPONENTS) for (const a of aliases) M_COMP_ALIASES.push({ id, specific, family, words: a.split(" ") });
M_COMP_ALIASES.sort((x, y) => y.words.length - x.words.length);
type ActAlias = { id: string; words: string[] };
const M_ACT_ALIASES: ActAlias[] = [];
for (const [id, aliases] of M_ACTIONS) for (const a of aliases) M_ACT_ALIASES.push({ id, words: a.split(" ") });
M_ACT_ALIASES.sort((x, y) => y.words.length - x.words.length);

function mNormalize(s: string): string { return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\s+/g, " ").trim(); }
function mIsNumericish(t: string): boolean { return /^[0-9]+[a-z]{0,2}$/.test(t); }
function mMatchAt(tokens: string[], consumed: boolean[], pos: number, words: string[]): boolean {
  if (pos + words.length > tokens.length) return false;
  for (let i = 0; i < words.length; i++) { if (consumed[pos + i] || tokens[pos + i] !== words[i]) return false; }
  return true;
}
type AssetScan = { strippedTokens: string[]; hasForeignAsset: boolean; hasNeverContext: boolean };
function mScanAssets(tokens: string[], ownerType: string | null): AssetScan {
  const drop = new Array<boolean>(tokens.length).fill(false);
  const consumed = new Array<boolean>(tokens.length).fill(false);
  let hasForeignAsset = false;
  let hasNeverContext = false;
  for (let pos = 0; pos < tokens.length; pos++) {
    for (const nv of M_NEVER_ALIASES) if (mMatchAt(tokens, consumed, pos, nv)) { hasNeverContext = true; for (let i = 0; i < nv.length; i++) consumed[pos + i] = true; break; }
  }
  // Bidirectional accessory context: battery co-occurring with booster/
  // maintainer anywhere in the phrase, in either order, with any intervening
  // words. These nouns have no legitimate vehicle reading alongside
  // "battery" (unlike charger/tender, which stay pair-scoped).
  if (tokens.includes("battery")) {
    for (const acc of ["booster", "boosters", "maintainer", "maintainers"]) {
      if (tokens.includes(acc)) { hasNeverContext = true; break; }
    }
  }
  for (let pos = 0; pos < tokens.length; pos++) {
    for (const al of M_ASSET_ALIASES) if (mMatchAt(tokens, consumed, pos, al.words)) {
      // Only the canonical vehicle_type can lift an asset-noun conflict. A null
      // owner type treats every asset noun as foreign: without proof it is the
      // user's own machine, the phrase can never AUTO.
      if (ownerType !== null && al.types.includes(ownerType)) {
        for (let i = 0; i < al.words.length; i++) { drop[pos + i] = true; consumed[pos + i] = true; }
      } else {
        hasForeignAsset = true;
        for (let i = 0; i < al.words.length; i++) consumed[pos + i] = true;
      }
      break;
    }
  }
  return { strippedTokens: tokens.filter((_, i) => !drop[i]), hasForeignAsset, hasNeverContext };
}
type Rep = { norm: string; tokens: string[]; components: Map<string, { specific: boolean; family: boolean }>; actions: Set<string>; weights: Map<string, number>; surfaceTokenCount: number; residualSurface: number; residualTokens: string[]; explicitTireSignal: boolean; hasRepairPart: boolean; hasIntentWord: boolean };
function mRepresent(str: string): Rep {
  const norm = mNormalize(str);
  const tokens = norm ? norm.split(" ") : [];
  const consumed = new Array<boolean>(tokens.length).fill(false);
  const components = new Map<string, { specific: boolean; family: boolean }>();
  const actions = new Set<string>();
  let explicitTireSignal = false;
  for (let pos = 0; pos < tokens.length; pos++) for (const al of M_COMP_ALIASES) if (mMatchAt(tokens, consumed, pos, al.words)) { components.set(al.id, { specific: al.specific, family: al.family }); if (al.id === "tire_pressure" && al.words.length >= 2) explicitTireSignal = true; for (let i = 0; i < al.words.length; i++) consumed[pos + i] = true; break; }
  for (let pos = 0; pos < tokens.length; pos++) { if (consumed[pos]) continue; for (const al of M_ACT_ALIASES) if (mMatchAt(tokens, consumed, pos, al.words)) { actions.add(al.id); for (let i = 0; i < al.words.length; i++) consumed[pos + i] = true; break; } }
  const weights = new Map<string, number>();
  let hasRepairPart = false;
  let hasIntentWord = false;
  const M_DURATION = new Set(["mile", "miles", "mileage", "month", "months", "year", "years", "week", "weeks", "day", "days", "hour", "hours", "km", "fill", "usage", "use", "uses"]);
  for (let i = 0; i < tokens.length; i++) {
    const tk = tokens[i];
    if (consumed[i]) continue;
    if (tk === "per") {
      const nxt = tokens[i + 1];
      if (nxt !== undefined && (mIsNumericish(nxt) || M_DURATION.has(nxt))) { hasIntentWord = true; continue; }
      // Compliance reference "(as) per [word] schedule(s)": not intent, and the
      // whole reference is consumed so it cannot dilute the match score.
      let schedAt = -1;
      for (let k = i + 1; k <= Math.min(i + 4, tokens.length - 1); k++) {
        if (M_COMPLIANCE_TERMINATORS.has(tokens[k])) { schedAt = k; break; }
      }
      if (schedAt !== -1) {
        let spanClean = true;
        for (let j = i + 1; j < schedAt; j++) {
          if (M_INTENT_WORDS.has(tokens[j]) && !M_COMPLIANCE_MODIFIERS.has(tokens[j])) { spanClean = false; break; }
        }
        if (spanClean) {
          const from = tokens[i - 1] === "as" ? i - 1 : i;
          for (let j = from; j <= schedAt; j++) consumed[j] = true;
        }
      }
      continue;
    }
    if ((tk === "schedule" || tk === "schedules") && (tokens[i - 1] === "per" || tokens[i - 2] === "per" || tokens[i - 3] === "per")) continue;
    if (tk === "book" && tokens[i - 1] === "the"
      && (tokens[i - 2] === "by" || tokens[i - 2] === "following" || (tokens[i - 2] === "to" && tokens[i - 3] === "according"))) continue;
    if (M_INTENT_WORDS.has(tk)) hasIntentWord = true;
  }
  for (let pos = 0; pos < tokens.length; pos++) for (const ph of M_REPAIR_PHRASES) if (mMatchAt(tokens, consumed, pos, ph)) { hasRepairPart = true; for (let i = 0; i < ph.length; i++) consumed[pos + i] = true; break; }
  for (const id of components.keys()) weights.set("c:" + id, 3.0);
  for (const id of actions) weights.set("a:" + id, 0.5);
  for (let i = 0; i < tokens.length; i++) if (!consumed[i] && tokens[i].length >= 2 && !M_STOPWORDS.has(tokens[i]) && !mIsNumericish(tokens[i]) && !M_SCORE_NEUTRAL.has(tokens[i])) { const tk = tokens[i]; weights.set("r:" + tk, 1.0); const s1 = tk.endsWith("s") ? tk.slice(0, -1) : tk; const s2 = tk.endsWith("es") ? tk.slice(0, -2) : tk; const part = M_REPAIR_PARTS.has(tk) ? tk : M_REPAIR_PARTS.has(s1) ? s1 : M_REPAIR_PARTS.has(s2) ? s2 : null; if (part && (part !== "spring" || components.has("suspension"))) hasRepairPart = true; }
  const residualTokens = tokens.filter((tk, i) => !consumed[i]);
  if (explicitTireSignal && components.size === 1 && actions.size > 0 && !actions.has("repair")) {
    actions.clear();
    actions.add("adjust");
    for (const k of [...weights.keys()]) if (k.startsWith("a:")) weights.delete(k);
    weights.set("a:adjust", 0.5);
  }
  return { norm, tokens, components, actions, weights, surfaceTokenCount: tokens.length, residualSurface: residualTokens.length, residualTokens, explicitTireSignal, hasRepairPart, hasIntentWord };
}
const TIRE_DESCRIPTORS = new Set(["front", "rear", "winter", "summer", "snow", "all", "season", "left", "right", "both", "one", "two", "three", "four", "pair", "driver", "passenger", "side"]);
function mTireReclass(r: Rep): boolean {
  // replace/new + tire(s) with only sanctioned descriptors is a tire
  // REPLACEMENT representation; any stranger noun makes it ambiguous.
  // Applied to services AND task names so interleaved task wording like
  // "Replace All Four Tires" represents identically to "Replace Tires".
  if (!(r.components.has("tire_pressure") && r.actions.has("replace") && !r.actions.has("rotate"))) return false;
  // An explicit "tire pressure"/"tire condition" phrase is never a tire
  // replacement: task-side it keeps its pressure identity (callers ignore the
  // flag); service-side replace-acting on an explicit pressure alias is
  // inherently ambiguous and can never AUTO.
  if (r.explicitTireSignal) return true;
  const strangers = r.residualTokens.filter(tk => !TIRE_DESCRIPTORS.has(tk) && !M_STOPWORDS.has(tk) && !mIsNumericish(tk) && !M_SCORE_NEUTRAL.has(tk));
  if (strangers.length === 0) {
    const meta = r.components.get("tire_pressure")!;
    r.components.delete("tire_pressure");
    r.components.set("tire_replace", meta);
    r.weights.delete("c:tire_pressure");
    r.weights.set("c:tire_replace", 3.0);
    for (const d of TIRE_DESCRIPTORS) r.weights.delete("r:" + d);
    return false;
  }
  return true;
}
function mWJaccard(A: Map<string, number>, B: Map<string, number>): number {
  let inter = 0, uni = 0; const keys = new Set<string>([...A.keys(), ...B.keys()]);
  for (const k of keys) { const wa = A.get(k) ?? 0, wb = B.get(k) ?? 0; inter += Math.min(wa, wb); uni += Math.max(wa, wb); }
  return uni === 0 ? 0 : inter / uni;
}
function mSatisfies(a: string, b: string): boolean { return a === b || (a === "replace" && (b === "inspect" || b === "clean" || b === "topoff")); }
const M_COMPLETE_PROOF: Record<string, string> = { oil: "replace", tire_rotation: "rotate", tire_replace: "replace" };
function mCompleteProofComponent(sv: Rep): string | null {
  const explicit = [...sv.actions].filter(a => a !== "complete");
  if (explicit.length > 0 || !sv.actions.has("complete")) return null;
  if (sv.components.size !== 1) return null;
  const only = [...sv.components.keys()][0];
  return M_COMPLETE_PROOF[only] ? only : null;
}
function mIsViscosity(tk: string): boolean { return /^[0-9]+w[0-9]+$/.test(tk); }
function mMeaningfulResidual(r: Rep, allowTireDescriptors: boolean): number {
  return r.residualTokens.filter(tk => !M_STOPWORDS.has(tk) && !mIsNumericish(tk) && !mIsViscosity(tk) && !M_INTENT_WORDS.has(tk)
    && !(allowTireDescriptors && TIRE_DESCRIPTORS.has(tk))).length;
}
function mEffectiveActions(sv: Rep): Set<string> {
  const explicit = new Set([...sv.actions].filter(a => a !== "complete"));
  if (explicit.size > 0) return explicit;
  if (sv.actions.has("complete")) {
    // Generic completion proves WHICH action only when the service represents
    // EXACTLY ONE component and that component's scheduled action is
    // unambiguous. Any multi-component or unmapped phrase proves nothing -
    // a generic "service completed" cannot silently complete siblings.
    if (sv.components.size === 1) {
      const only = [...sv.components.keys()][0];
      const act = M_COMPLETE_PROOF[only];
      if (act) return new Set([act]);
    }
    return new Set(["complete"]); // deliberately satisfies nothing below
  }
  return explicit;
}
function mActionCompatible(sv: Rep, tk: Rep): boolean {
  const eff = mEffectiveActions(sv);
  if (eff.has("repair")) return false;
  if (eff.has("complete")) return false;
  if (eff.size === 0) return true;
  if (tk.actions.size === 0) return true;
  for (const a of eff) for (const b of tk.actions) if (mSatisfies(a, b)) return true;
  return false;
}
function mTrigrams(s: string): Set<string> { const t = new Set<string>(); const p = "  " + s + "  "; for (let i = 0; i < p.length - 2; i++) t.add(p.slice(i, i + 3)); return t; }
function mDiceTri(a: string, b: string): number { const A = mTrigrams(a), B = mTrigrams(b); let inter = 0; for (const x of A) if (B.has(x)) inter++; return (A.size + B.size) === 0 ? 0 : (2 * inter) / (A.size + B.size); }

export function matchServiceToTask(serviceName: string, tasks: MatchTask[], ownerVehicleType?: string | null): MatchOutcome {
  const rawTokens = mNormalize(serviceName).split(" ").filter(Boolean);
  const ownerType = ownerVehicleType ? mNormalize(ownerVehicleType).replace(/ /g, "_") : null;
  const scan = mScanAssets(rawTokens, ownerType);
  const sv = mRepresent(scan.strippedTokens.join(" "));
  const tireAmbiguous = mTireReclass(sv);
  const taskReps = tasks.map(t => { const r = mRepresent(t.name); mTireReclass(r); return { t, r }; });
  const cand = (t: MatchTask, score: number): MatchCandidate => ({ taskId: t.id, taskName: t.name, score: Number(score.toFixed(3)), component: null, action: null });
  const outcome = (decision: MatchDecision, t: MatchTask | null, candidates: MatchCandidate[], topScore: number, margin: number, reason: string): MatchOutcome => ({ decision, task: t ? cand(t, topScore) : null, candidates, topScore: Number(topScore.toFixed(3)), margin: Number(margin.toFixed(3)), reason });
  const mGuard = (o: MatchOutcome): MatchOutcome => {
    if (scan.hasNeverContext && o.decision === "AUTO") return { ...o, decision: "REVIEW", task: null, reason: "never-context" };
    if (scan.hasForeignAsset && o.decision === "AUTO") return { ...o, decision: "REVIEW", task: null, reason: "foreign-asset" };
    if (o.decision === "AUTO" && o.reason !== "exact" && sv.actions.size === 0) {
      const bearing = sv.components.has("tire_replace") || sv.components.has("tire_rotation");
      const warrantyAt = sv.tokens.findIndex(tk => tk === "warranty" || tk === "warranties");
      const underAt = warrantyAt > 0 ? sv.tokens.lastIndexOf("under", warrantyAt - 1) : -1;
      const relationFrom = underAt > 0 && (sv.tokens[underAt - 1] === "was" || sv.tokens[underAt - 1] === "done") ? underAt - 1 : underAt;
      const warrantyCompletion = bearing && relationFrom > 0 && warrantyAt > underAt
        && sv.tokens.slice(underAt, warrantyAt + 1).every(tk => M_SCORE_NEUTRAL.has(tk) || tk === "the")
        && sv.residualTokens.length === warrantyAt - relationFrom + 1;
      if (!warrantyCompletion && sv.residualTokens.length > 0) return { ...o, decision: "REVIEW", task: null, reason: "actionless-residual" };
    }
    if (o.decision === "AUTO" && mEffectiveActions(sv).has("complete")) {
      return { ...o, decision: "REVIEW", task: null, reason: "unproven-completion" };
    }
    if (o.decision === "AUTO" && sv.explicitTireSignal && mMeaningfulResidual(sv, true) > 0) {
      return { ...o, decision: "REVIEW", task: null, reason: "tire-ambiguous" };
    }
    if (o.decision === "AUTO" && tireAmbiguous) {
      return { ...o, decision: "REVIEW", task: null, reason: "tire-ambiguous" };
    }
    if (o.decision === "AUTO" && sv.components.has("charging_system") && sv.actions.has("replace")) {
      return { ...o, decision: "REVIEW", task: null, reason: "charging-repair" };
    }
    if (o.decision === "AUTO" && (sv.hasIntentWord || sv.hasRepairPart || mEffectiveActions(sv).has("repair"))) {
      return { ...o, decision: "REVIEW", task: null, reason: sv.hasIntentWord ? "future-intent" : sv.hasRepairPart ? "repair-part" : "repair-action" };
    }
    return o;
  };


  const exacts = taskReps.filter(({ r }) => r.norm && r.norm === sv.norm);
  if (exacts.length === 1) return mGuard(outcome("AUTO", exacts[0].t, [cand(exacts[0].t, 1)], 1, 1, "exact"));
  if (exacts.length > 1) return mGuard(outcome("REVIEW", null, exacts.map(e => cand(e.t, 1)), 1, 0, "duplicate-name"));

  const svComps = [...sv.components.entries()];
  const svSpecific = svComps.filter(([, m]) => m.specific).map(([id]) => id);
  const svFamily = svComps.filter(([, m]) => m.family).map(([id]) => id);

  const eligible: { t: MatchTask; r: Rep; score: number }[] = [];
  if (svComps.length > 0) for (const { t, r } of taskReps) {
    const tComps = [...r.components.keys()];
    let ok = svSpecific.some(sc => tComps.includes(sc));
    if (!ok) for (const fam of svFamily) { const set = M_FAMILY_OF[fam]; if (set) for (const tc of tComps) if (set.has(tc)) ok = true; }
    if (ok) eligible.push({ t, r, score: mWJaccard(sv.weights, r.weights) });
  }
  eligible.sort((a, b) => b.score - a.score);

  if (eligible.length > 0) {
    const top = eligible[0]; const second = eligible[1] ? eligible[1].score : 0; const margin = top.score - second;
    const topComps = [...top.r.components.keys()];
    const sharesSpecific = svSpecific.some(sc => topComps.includes(sc));
    const compatible = mActionCompatible(sv, top.r);
    const bareFamilyMulti = svSpecific.length === 0 && svFamily.length > 0 && eligible.length >= 2;
    const singleTokenBlock = sv.surfaceTokenCount === 1 && !svSpecific.some(id => M_REGISTERED_SINGLE.has(id));
    const proofComp = mCompleteProofComponent(sv);
    const proofScopeOk = proofComp === null
      || (top.r.components.size === 1 && top.r.components.has(proofComp)
          && !top.r.hasRepairPart && mMeaningfulResidual(top.r, proofComp === "tire_replace" || proofComp === "tire_rotation") === 0);
    const auto = sharesSpecific && compatible && proofScopeOk && !sv.hasRepairPart && !sv.hasIntentWord && top.score >= M_AUTO_SCORE && (eligible.length === 1 || margin >= M_AUTO_MARGIN) && !bareFamilyMulti && !singleTokenBlock;
    if (auto) return mGuard(outcome("AUTO", top.t, eligible.map(e => cand(e.t, e.score)), top.score, margin, eligible.length === 1 ? "unique-component" : "clear-margin"));
    const reason = !proofScopeOk ? "unproven-scope" : sv.hasIntentWord ? "future-intent" : sv.hasRepairPart ? "repair-part" : !compatible ? "action-mismatch" : bareFamilyMulti ? "ambiguous-generic" : (eligible.length >= 2 && margin < M_AUTO_MARGIN) ? "sibling-tie" : (top.score < M_AUTO_SCORE || singleTokenBlock) ? "weak-score" : "sibling-tie";
    return mGuard(outcome("REVIEW", null, eligible.map(e => cand(e.t, e.score)), top.score, margin, reason));
  }

  if (svSpecific.length > 0) return mGuard(outcome("NONE", null, [], 0, 0, "recognized-no-task"));

  const svTokensNoStop = sv.tokens.filter(x => x.length >= 2 && !M_STOPWORDS.has(x) && !mIsNumericish(x));
  const scored = taskReps.map(({ t, r }) => {
    const setJ = mWJaccard(sv.weights, r.weights);
    const taskTokens = new Set(mNormalize(t.name).split(" ").filter(x => x.length >= 2 && !M_STOPWORDS.has(x)));
    const shared = svTokensNoStop.filter(x => taskTokens.has(x)).length;
    const rawOverlap = svTokensNoStop.length ? shared / svTokensNoStop.length : 0;
    return { t, score: Math.max(setJ, rawOverlap, mDiceTri(sv.norm, r.norm)) };
  }).sort((a, b) => b.score - a.score);
  const cands = scored.filter(s => s.score >= M_REVIEW_SCORE);
  if (cands.length > 0) return mGuard(outcome("REVIEW", null, cands.map(s => cand(s.t, s.score)), cands[0].score, cands[0].score - (cands[1] ? cands[1].score : 0), "no-eligible-component"));
  return mGuard(outcome("NONE", null, [], scored[0] ? scored[0].score : 0, 0, "unrelated"));
}
