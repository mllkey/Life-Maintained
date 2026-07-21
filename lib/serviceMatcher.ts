export type MatchDecision = "AUTO" | "REVIEW" | "NONE";
export type MatchCandidate = { taskId: string; taskName: string; score: number; component: string | null; action: string | null; };
export type MatchOutcome = { decision: MatchDecision; task: MatchCandidate | null; candidates: MatchCandidate[]; topScore: number; margin: number; reason: string; };
type CompDef = [string, boolean, boolean, string[]];
type MatchTask = { id: string; name: string };

const M_COMPONENTS: CompDef[] = [
  ["oil", true, false, ["oil filter","oil and filter","motor oil","engine oil","synthetic oil","lube","oil"]],
  ["air_filter", true, false, ["cabin air filter","engine air filter","air filter","cabin filter","intake filter","air cleaner","pollen filter"]],
  ["washer_fluid", true, false, ["washer fluid","wiper fluid","windshield fluid","washer"]],
  ["tire_pressure", true, false, ["tire pressure","tyre pressure","tire condition","tires","tire"]],
  ["tire_rotation", true, false, ["tire rotation","rotate tires","rotated tires","tyre rotation","wheel rotation"]],
  ["tire_replace", true, false, ["tire replacement","replace tires","replaced tires","new tires"]],
  ["brake_pads", true, false, ["brake pads","brake pad","pads"]],
  ["brake_fluid", true, false, ["brake fluid"]],
  ["brake_rotor", true, false, ["brake rotor","brake disc","rotors","rotor"]],
  ["brake", false, true, ["brakes","brake"]],
  ["battery", true, false, ["charging system","battery","alternator"]],
  ["glow_plugs", true, false, ["glow plugs","glow plug"]],
  ["spark_plugs", true, false, ["ignition coils","spark plugs","spark plug","ignition coil","plugs"]],
  ["coolant", true, false, ["radiator coolant","radiator flush","coolant","antifreeze"]],
  ["differential", true, false, ["differential fluid","differential","diff"]],
  ["transmission", true, false, ["gearbox oil","gear oil","transmission fluid","trans fluid","transmission","tranny","gearbox","atf"]],
  ["wiper", true, false, ["windshield wipers","windshield wiper","wiper blades","wiper blade","wipers","wiper"]],
  ["drive_belt", true, false, ["serpentine belt","drive belt","timing belt","fan belt","belt"]],
  ["fuel_filter", true, false, ["fuel filter"]],
  ["fuel_system", true, false, ["fuel system","fuel injector","fuel injection","fuel"]],
  ["suspension", true, false, ["steering and suspension","suspension","steering","shocks","shock","struts","strut","control arm"]],
];
const M_FAMILY_OF: Record<string, Set<string>> = { brake: new Set(["brake_pads","brake_fluid","brake_rotor"]) };
const M_ACTIONS: [string, string[]][] = [
  ["inspect", ["inspect","inspected","inspection","check","checked","test","tested","examine","examined","condition"]],
  ["clean", ["clean","cleaned","cleaning"]],
  ["rotate", ["rotate","rotated","rotation"]],
  ["topoff", ["top off","topped off","refill","refilled","fill","filled","add","added"]],
  ["replace", ["replace","replaced","replacement","change","changed","swap","swapped","install","installed","flush","flushed","drain","drained","new"]],
  ["repair", ["repair","repaired","rebuild","rebuilt","leak","leaking","fix","fixed","dead","died","jump","jumped","noise","warranty"]],
];
const M_REPAIR_PARTS = new Set<string>(["hose","pump","cable","wire","sensor","terminal","pipe","line","bracket","mount","bulb","fuse","gasket","seal","tensioner","pulley","connector","clamp","motor","relay","module","switch","cap","housing","actuator","solenoid","bearing","joint","boot","bushing","link","pan","cooler","dipstick","reservoir","thermostat","tank","door","rail","tray","arm","rack","valve","fan","spring","drum","shoe","cylinder","compressor","starter","caliper","ring","linkage","column","wheel","tube","screw","neck","plug"]);
const M_STOPWORDS = new Set<string>(["the","and","for","with","of","a","to","your","my","this","that","service","services","system","maintenance","general","scheduled","annual","yearly","full","complete","kit","an","did","done","got","had","just","today","is","was","were","in","on","at","we","i","up","mile","miles","mi"]);
const M_INTENT_WORDS = new Set<string>(["due","overdue","need","needs","needed","recommend","recommended","recommends","decline","declined","defer","deferred","postpone","postponed","skip","skipped","quote","quoted","estimate","estimated","schedule","scheduled","scheduling","appointment","book","booked","upcoming","soon","reminder","waiting","pending","next"]);
const M_REGISTERED_SINGLE = new Set<string>(["battery","coolant"]);
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
type Rep = { norm: string; tokens: string[]; components: Map<string, { specific: boolean; family: boolean }>; actions: Set<string>; weights: Map<string, number>; surfaceTokenCount: number; hasRepairPart: boolean; hasIntentWord: boolean };
function mRepresent(str: string): Rep {
  const norm = mNormalize(str);
  const tokens = norm ? norm.split(" ") : [];
  const consumed = new Array<boolean>(tokens.length).fill(false);
  const components = new Map<string, { specific: boolean; family: boolean }>();
  const actions = new Set<string>();
  for (let pos = 0; pos < tokens.length; pos++) for (const al of M_COMP_ALIASES) if (mMatchAt(tokens, consumed, pos, al.words)) { components.set(al.id, { specific: al.specific, family: al.family }); for (let i = 0; i < al.words.length; i++) consumed[pos + i] = true; break; }
  for (let pos = 0; pos < tokens.length; pos++) { if (consumed[pos]) continue; for (const al of M_ACT_ALIASES) if (mMatchAt(tokens, consumed, pos, al.words)) { actions.add(al.id); for (let i = 0; i < al.words.length; i++) consumed[pos + i] = true; break; } }
  const weights = new Map<string, number>();
  let hasRepairPart = false;
  let hasIntentWord = false;
  for (const tk of tokens) if (M_INTENT_WORDS.has(tk)) hasIntentWord = true;
  for (const id of components.keys()) weights.set("c:" + id, 3.0);
  for (const id of actions) weights.set("a:" + id, 0.5);
  for (let i = 0; i < tokens.length; i++) if (!consumed[i] && tokens[i].length >= 2 && !M_STOPWORDS.has(tokens[i]) && !mIsNumericish(tokens[i])) { const tk = tokens[i]; weights.set("r:" + tk, 1.0); const s1 = tk.endsWith("s") ? tk.slice(0, -1) : tk; const s2 = tk.endsWith("es") ? tk.slice(0, -2) : tk; const part = M_REPAIR_PARTS.has(tk) ? tk : M_REPAIR_PARTS.has(s1) ? s1 : M_REPAIR_PARTS.has(s2) ? s2 : null; if (part && (part !== "spring" || components.has("suspension"))) hasRepairPart = true; }
  return { norm, tokens, components, actions, weights, surfaceTokenCount: tokens.length, hasRepairPart, hasIntentWord };
}
function mWJaccard(A: Map<string, number>, B: Map<string, number>): number {
  let inter = 0, uni = 0; const keys = new Set<string>([...A.keys(), ...B.keys()]);
  for (const k of keys) { const wa = A.get(k) ?? 0, wb = B.get(k) ?? 0; inter += Math.min(wa, wb); uni += Math.max(wa, wb); }
  return uni === 0 ? 0 : inter / uni;
}
function mSatisfies(a: string, b: string): boolean { return a === b || (a === "replace" && (b === "inspect" || b === "clean" || b === "topoff")); }
function mActionCompatible(sv: Rep, tk: Rep): boolean {
  if (sv.actions.has("repair")) return false;
  if (sv.actions.size === 0) return true;
  if (tk.actions.size === 0) return true;
  for (const a of sv.actions) for (const b of tk.actions) if (mSatisfies(a, b)) return true;
  return false;
}
function mTrigrams(s: string): Set<string> { const t = new Set<string>(); const p = "  " + s + "  "; for (let i = 0; i < p.length - 2; i++) t.add(p.slice(i, i + 3)); return t; }
function mDiceTri(a: string, b: string): number { const A = mTrigrams(a), B = mTrigrams(b); let inter = 0; for (const x of A) if (B.has(x)) inter++; return (A.size + B.size) === 0 ? 0 : (2 * inter) / (A.size + B.size); }

export function matchServiceToTask(serviceName: string, tasks: MatchTask[]): MatchOutcome {
  const sv = mRepresent(serviceName);
  const taskReps = tasks.map(t => ({ t, r: mRepresent(t.name) }));
  const cand = (t: MatchTask, score: number): MatchCandidate => ({ taskId: t.id, taskName: t.name, score: Number(score.toFixed(3)), component: null, action: null });
  const outcome = (decision: MatchDecision, t: MatchTask | null, candidates: MatchCandidate[], topScore: number, margin: number, reason: string): MatchOutcome => ({ decision, task: t ? cand(t, topScore) : null, candidates, topScore: Number(topScore.toFixed(3)), margin: Number(margin.toFixed(3)), reason });

  for (const { t, r } of taskReps) if (r.norm && r.norm === sv.norm) return outcome("AUTO", t, [cand(t, 1)], 1, 1, "exact");

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
    const auto = sharesSpecific && compatible && !sv.hasRepairPart && !sv.hasIntentWord && top.score >= M_AUTO_SCORE && (eligible.length === 1 || margin >= M_AUTO_MARGIN) && !bareFamilyMulti && !singleTokenBlock;
    if (auto) return outcome("AUTO", top.t, eligible.map(e => cand(e.t, e.score)), top.score, margin, eligible.length === 1 ? "unique-component" : "clear-margin");
    const reason = sv.hasIntentWord ? "future-intent" : sv.hasRepairPart ? "repair-part" : !compatible ? "action-mismatch" : bareFamilyMulti ? "ambiguous-generic" : (eligible.length >= 2 && margin < M_AUTO_MARGIN) ? "sibling-tie" : (top.score < M_AUTO_SCORE || singleTokenBlock) ? "weak-score" : "sibling-tie";
    return outcome("REVIEW", null, eligible.map(e => cand(e.t, e.score)), top.score, margin, reason);
  }

  if (svSpecific.length > 0) return outcome("NONE", null, [], 0, 0, "recognized-no-task");

  const svTokensNoStop = sv.tokens.filter(x => x.length >= 2 && !M_STOPWORDS.has(x) && !mIsNumericish(x));
  const scored = taskReps.map(({ t, r }) => {
    const setJ = mWJaccard(sv.weights, r.weights);
    const taskTokens = new Set(mNormalize(t.name).split(" ").filter(x => x.length >= 2 && !M_STOPWORDS.has(x)));
    const shared = svTokensNoStop.filter(x => taskTokens.has(x)).length;
    const rawOverlap = svTokensNoStop.length ? shared / svTokensNoStop.length : 0;
    return { t, score: Math.max(setJ, rawOverlap, mDiceTri(sv.norm, r.norm)) };
  }).sort((a, b) => b.score - a.score);
  const cands = scored.filter(s => s.score >= M_REVIEW_SCORE);
  if (cands.length > 0) return outcome("REVIEW", null, cands.map(s => cand(s.t, s.score)), cands[0].score, cands[0].score - (cands[1] ? cands[1].score : 0), "no-eligible-component");
  return outcome("NONE", null, [], scored[0] ? scored[0].score : 0, 0, "unrelated");
}
