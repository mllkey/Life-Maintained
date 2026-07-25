import { matchServiceToTask } from "./serviceMatcher.v17.ts";
type T = { id: string; name: string };
const SEDAN: T[] = [
  { id: "oil", name: "Oil Change" }, { id: "rot", name: "Tire Rotation" },
  { id: "pads", name: "Brake Pad Replacement" }, { id: "bfluid", name: "Brake Fluid Flush" },
  { id: "bat", name: "Battery Replacement" }, { id: "plugs", name: "Spark Plug Replacement" },
  { id: "cool", name: "Coolant Flush" }, { id: "trans", name: "Transmission Fluid Change" },
  { id: "air", name: "Engine Air Filter" }, { id: "cabin", name: "Cabin Air Filter" },
  { id: "wip", name: "Wiper Blade Replacement" }, { id: "fuel", name: "Fuel Filter Replacement" },
  { id: "susp", name: "Suspension Inspection" },
];
const HOURS: T[] = [
  { id: "oil", name: "Oil Change" }, { id: "bat", name: "Battery Replacement" },
  { id: "plugs", name: "Spark Plug Replacement" }, { id: "air", name: "Air Filter Replacement" },
  { id: "fuel", name: "Fuel Filter Replacement" },
];
let pass = 0, fail = 0;
function chk(label: string, got: string, want: string, extra = "") {
  const ok = got === want;
  if (ok) pass++; else { fail++; console.log("FAIL", label, "->", got, "want", want, extra); }
}
function d(p: string, tasks: T[], vt: string | null) { return matchServiceToTask(p, tasks, vt); }

// A. Core positives on a sedan (owner type car)
for (const [p, id] of [["oil change","oil"],["changed the oil","oil"],
  ["tire rotation","rot"],["rotated tires","rot"],["brake pads replaced","pads"],["brake fluid flush","bfluid"],
  ["new battery","bat"],["car battery replaced","bat"],["replaced battery","bat"],
  ["spark plugs","plugs"],["coolant flush","cool"],
  ["tranny fluid change","trans"],["transmission fluid","trans"],["cabin air filter","cabin"],
  ["wiper blades","wip"],["fuel filter","fuel"]] as [string,string][]) {
  const o = d(p, SEDAN, "car");
  chk("A+ "+p, o.decision === "AUTO" && o.task?.taskId === id ? "AUTO:"+id : o.decision+":"+(o.task?.taskId ?? "-"), "AUTO:"+id, o.reason);
}

// B. Must never AUTO on a sedan: repairs, parts, intent, ambiguity, never-context
for (const p of ["coolant hose replaced","coolant hoses replaced","radiator hose leak","brake caliper replaced",
  "water pump replaced","transmission rebuild","battery terminal cleaned","battery cable replaced",
  "due for oil change","scheduled coolant flush","declined transmission service","oil change quote",
  "brake service","brakes","oil pan gasket replaced","valve cover gasket","engine air filter replaced","synthetic oil and filter","ignition coils replaced","starter motor replaced",
  "watch battery","key fob battery","remote battery","phone battery","smoke detector battery",
  "thermostat battery replaced","glow plugs replaced"]) {
  const o = d(p, SEDAN, "car");
  chk("B! "+p, o.decision === "AUTO" ? "AUTO:"+(o.task?.taskId ?? "?") : "notauto", "notauto", o.reason);
}

// C. Foreign-asset battery on a sedan: all 13-alias phrasings must not AUTO
const ALIASES: [string, string][] = [
  ["quad battery replaced","atv"],["four wheeler tire pressure checked","atv"],
  ["lawnmower oil changed","lawnmower"],["mower oil changed","lawnmower"],
  ["jet ski battery replaced","pwc"],["jetski spark plugs","pwc"],
  ["motorhome battery replaced","rv"],["snowblower spark plug replaced","snow_blower"],
  ["boat oil change","boat"],["sled battery","snowmobile"],["side by side air filter","utv"],
  ["forklift battery replaced","forklift"],["skid steer fuel filter","skid_steer"],
];
for (const [p] of ALIASES) {
  const o = d(p, SEDAN, "car");
  chk("C-sedan "+p, o.decision === "AUTO" ? "AUTO" : "notauto", "notauto", o.reason);
}
// D. Same phrasings AUTO on the owner's actual asset (stripping restores full confidence)
for (const [p, vt] of ALIASES) {
  const tasks = ["atv","lawnmower","pwc","rv","snow_blower","boat","snowmobile","utv","forklift","skid_steer"].includes(vt) ? HOURS : SEDAN;
  const o = d(p, tasks, vt);
  const wantReview = p.includes("tire pressure"); // inspect-phrase on a set without a tire task: NONE/REVIEW both fine, never AUTO-wrong
  if (wantReview) { chk("D-own "+p, o.decision === "AUTO" ? "AUTO" : "notauto", "notauto", o.reason); }
  else chk("D-own "+p+" ["+vt+"]", o.decision, "AUTO", o.reason + " " + (o.task?.taskId ?? "-"));
}

// E. No hints: every asset noun is foreign by default
for (const [p] of ALIASES) {
  const o = d(p, HOURS, null);
  chk("E-null "+p, o.decision === "AUTO" ? "AUTO" : "notauto", "notauto", o.reason);
}

// F. Never-context beats own-type neutralization (owner car, watch battery)
chk("F watch battery on car", d("watch battery replaced", SEDAN, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("F key fob on car", d("key fob battery replaced", SEDAN, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");

// G. Ambiguity + single-token behavior preserved from the prior engine
chk("G brakes single", d("brakes", SEDAN, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("G battery single-registered", d("battery", SEDAN, "car").decision, "AUTO");
chk("G oil single blocked", d("oil", SEDAN, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");

// H. Owner-type normalization: values arrive as DB enum snake_case
chk("H snow_blower enum", d("snowblower oil change", HOURS, "snow_blower").decision, "AUTO");
chk("H truck on car", d("truck battery replaced", SEDAN, "car").decision, "AUTO");
chk("H truck on boat", d("truck battery replaced", HOURS, "boat").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("H trailer on dump_trailer", d("trailer bearing repacked", HOURS, "dump_trailer").decision === "AUTO" ? "AUTO" : "notauto", "notauto"); // bearing = repair part regardless

// R. Round-1 reviewer phrases - all must be safe now
const RB = [{ id: "bat", name: "Replace Battery" }];
for (const [p, vt] of [["motorcycle battery charged","motorcycle"],["car battery low","car"],["car battery weak","car"],
  ["alternator replaced","car"],["ignition coil replaced","car"],["fuel injector replaced","car"],["control arm replaced","car"],
  ["bike battery replaced",null],["personal watercraft battery replaced",null],["golf cart battery replaced",null],
  ["mobility scooter battery replaced","motorcycle"],["r/c car battery replaced","car"],
  ["doorbell battery replaced","car"],["smoke alarm battery replaced","car"]] as [string, string|null][]) {
  const set = p.includes("coil") ? [{id:"plugs",name:"Replace Spark Plugs"}] : p.includes("injector") ? [{id:"fs",name:"Clean Fuel System"}] : p.includes("arm") ? [{id:"su",name:"Inspect Suspension"}] : RB;
  const o = matchServiceToTask(p, set, vt);
  chk("R! "+p, o.decision === "AUTO" ? "AUTO:"+(o.task?.taskId ?? "?") : "notauto", "notauto", o.reason);
}
// R2. bike neutralizes on a motorcycle; dup exact reviews; own-strip actionless residual-free still AUTOs
chk("R2 bike on motorcycle", matchServiceToTask("bike battery replaced", RB, "motorcycle").decision, "AUTO");
chk("R2 dup exact", matchServiceToTask("Replace Battery", [{id:"a",name:"Replace Battery"},{id:"b",name:"Replace Battery"}], "car").decision, "REVIEW");
chk("R2 single exact", matchServiceToTask("Replace Battery", RB, "car").decision, "AUTO");
chk("R2 sled battery own", matchServiceToTask("sled battery", [{id:"bat",name:"Battery Replacement"}], "snowmobile").decision, "AUTO");

// S. Round-2 reviewer phrases
const RB2 = [{ id: "bat", name: "Replace Battery" }];
const TP2 = [{ id: "tp", name: "Inspect Tire Pressure" }, { id: "rot", name: "Tire Rotation" }, { id: "trep", name: "Tire Replacement" }];
for (const [p, vt] of [["mountain bike battery replaced","motorcycle"],["electric bike battery replaced","motorcycle"],
  ["exercise bike battery replaced","motorcycle"],["road bike battery replaced","motorcycle"],
  ["motorcycle battery service","motorcycle"],["motorcycle battery maintenance","motorcycle"],
  ["battery general maintenance","car"],["battery annual service","car"],
  ["car key battery changed","car"],["key battery replaced","car"],["controller battery replaced","car"],
  ["xbox controller battery replaced","car"],["digital camera battery replaced","car"],
  ["battery charger replaced","car"],["battery tender replaced","car"],
  ["headphone battery replaced","car"],["earbud battery replaced","car"]] as [string,string][]) {
  const o = matchServiceToTask(p, RB2, vt);
  chk("S! "+p, o.decision === "AUTO" ? "AUTO" : "notauto", "notauto", o.reason);
}
chk("S bike-tire", matchServiceToTask("mountain bike tire replaced", TP2, "motorcycle").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("S exact intent", matchServiceToTask("Oil Change Due", [{id:"od",name:"Oil Change Due"}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("S exact repair", matchServiceToTask("Battery Dead", [{id:"bd",name:"Battery Dead"}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
for (const p of ["tires replaced","front tire replaced","rear tires replaced","new front tire"]) {
  const o = matchServiceToTask(p, TP2, "car");
  chk("S tire "+p, o.decision + ":" + (o.task?.taskId ?? "-"), "AUTO:trep", o.reason);
}
chk("S tire no-replace-task", matchServiceToTask("tires replaced", [{id:"tp",name:"Inspect Tire Pressure"}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("S tractor trailer", matchServiceToTask("tractor trailer oil changed", [{id:"oil",name:"Oil Change"}], "semi_truck").decision, "AUTO");
chk("S semi tractor", matchServiceToTask("semi tractor oil changed", [{id:"oil",name:"Oil Change"}], "semi_truck").decision, "AUTO");
chk("S tractor foreign", matchServiceToTask("tractor oil changed", [{id:"oil",name:"Oil Change"}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("S watercraft boat", matchServiceToTask("watercraft battery replaced", RB2, "boat").decision, "AUTO");
chk("S watercraft pwc", matchServiceToTask("watercraft battery replaced", RB2, "pwc").decision, "AUTO");
chk("S charging system", matchServiceToTask("charging system checked", [{id:"cs",name:"Test Battery and Charging System"}], "car").decision, "AUTO");
chk("S bike still own", matchServiceToTask("bike battery replaced", RB2, "motorcycle").decision, "AUTO");

// T. Round-3 reviewer phrases
const RB3=[{id:"bat",name:"Replace Battery"}]; const TP3=[{id:"tp",name:"Inspect Tire Pressure"},{id:"trep",name:"Replace Tires"}];
const CS3=[{id:"cs",name:"Test Battery and Charging System"}];
for (const p of ["battery 12v","battery 51r","battery 100ah","battery 12v 100ah"]) {
  chk("T# "+p, matchServiceToTask(p, RB3, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
chk("T# coolant 50/50", matchServiceToTask("coolant 50/50", [{id:"co",name:"Replace Coolant"}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("T# tire 35", matchServiceToTask("tire 35", TP3, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
for (const p of ["tire chains installed","tire chains replaced","new tire chains","spare tire installed","tire patch installed",
  "tire studs installed","tire cover installed","tire pressure gauge replaced","tire pressure monitor installed","tire inflator replaced"]) {
  const o = matchServiceToTask(p, TP3, "car");
  chk("T tire! "+p, o.decision === "AUTO" ? "AUTO:"+(o.task?.taskId??"?") : "notauto", "notauto", o.reason);
}
for (const p of ["charging system replaced","battery and charging system replaced","charging system replacement completed"]) {
  chk("T cs! "+p, matchServiceToTask(p, CS3, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
chk("T cs+ checked", matchServiceToTask("charging system checked", CS3, "car").decision, "AUTO");
chk("T charger dodge", matchServiceToTask("dodge charger oil changed", [{id:"oil",name:"Oil Change"}], "car").decision, "AUTO");
chk("T charger battery", matchServiceToTask("battery charger replaced", RB3, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("T charger trickle", matchServiceToTask("trickle charger installed", RB3, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("T coolant svc now reviews", matchServiceToTask("coolant service performed", [{id:"co2",name:"Coolant Flush"}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
for (const [p, id] of [["tire rotation service completed","rot"]] as [string,string][]) {
  const set = [{id:"rot",name:"Tire Rotation"},{id:"co2",name:"Coolant Flush"}];
  const o = matchServiceToTask(p, set, "car");
  chk("T done "+p, o.decision + ":" + (o.task?.taskId ?? "-"), "AUTO:"+id, o.reason);
}
chk("T supercharger", matchServiceToTask("supercharger oil changed", [{id:"oil",name:"Oil Change"}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("T turbo", matchServiceToTask("turbocharger replaced", [{id:"oil",name:"Oil Change"}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("T bare service still blocked", matchServiceToTask("battery service", RB3, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
// tire positives survive the whitelist gate
for (const [p] of [["tires replaced"],["front tire replaced"],["rear tires replaced"],["new front tire"],["winter tires installed"],["all season tires installed"]]) {
  const o = matchServiceToTask(p, TP3, "car");
  chk("T tire+ "+p, o.decision + ":" + (o.task?.taskId ?? "-"), "AUTO:trep", o.reason);
}

// U. Round-4 spec: complete-action model
const RB4=[{id:"bat",name:"Replace Battery"}]; const OIL4=[{id:"oil",name:"Oil Change"}];
const TREP4=[{id:"trep",name:"Replace Tires"},{id:"tp",name:"Inspect Tire Pressure"}];
chk("U oil svc completed", matchServiceToTask("oil service completed", OIL4, "car").decision, "AUTO");
chk("U rot svc completed", matchServiceToTask("tire rotation service completed", [{id:"rot",name:"Tire Rotation"}], "car").decision, "AUTO");
{ const o = matchServiceToTask("new tires maintenance performed", TREP4, "car");
  chk("U new tires maint", o.decision + ":" + (o.task?.taskId ?? "-"), "AUTO:trep", o.reason); }
for (const p of ["battery service completed","coolant service completed","tire service completed","tires maintenance performed"]) {
  const set = p.startsWith("battery") ? RB4 : p.startsWith("coolant") ? [{id:"co",name:"Replace Coolant"}] : TREP4;
  chk("U! "+p, matchServiceToTask(p, set, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
for (const [p, set] of [["battery service performed test",RB4],["coolant service performed topped off",[{id:"co",name:"Replace Coolant"}]],
  ["air filter service performed clean",[{id:"air",name:"Replace Air Filter"}]],
  ["brake pads service completed inspection",[{id:"pads",name:"Replace Brake Pads"}]],
  ["tire service completed rotation",[{id:"tp",name:"Inspect Tire Pressure"}]]] as [string, {id:string;name:string}[]][]) {
  chk("U override "+p, matchServiceToTask(p, set, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
// U2. battery accessory contexts, singular + plural
for (const p of ["battery chargers replaced","battery tender replaced","battery tenders replaced","battery maintainer replaced",
  "battery maintainers replaced","battery booster replaced","battery boosters replaced","battery boost pack replaced","battery boost packs replaced"]) {
  chk("U2! "+p, matchServiceToTask(p, RB4, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
// U3. tender is a boat
chk("U3 tender boat", matchServiceToTask("tender oil changed", OIL4, "boat").decision, "AUTO");
chk("U3 boat tender", matchServiceToTask("boat tender oil changed", OIL4, "boat").decision, "AUTO");
chk("U3 tender null", matchServiceToTask("tender oil changed", OIL4, null).decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("U3 dinghy boat", matchServiceToTask("dinghy oil changed", OIL4, "boat").decision, "AUTO");
chk("U3 dinghy car", matchServiceToTask("dinghy oil changed", OIL4, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("U3 tender car", matchServiceToTask("tender oil changed", OIL4, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
// U4. forced induction separated + colloquial
for (const p of ["blower oil changed","procharger oil changed","super charger oil changed","turbo charger oil changed","pro charger oil changed"]) {
  chk("U4! "+p, matchServiceToTask(p, OIL4, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
// U5. extended tire descriptors
for (const p of ["left front tire replaced","right rear tire replaced","both front tires replaced","two rear tires replaced",
  "four tires replaced","pair of front tires replaced","driver side front tire replaced","passenger side rear tire replaced"]) {
  const o = matchServiceToTask(p, TREP4, "car");
  chk("U5+ "+p, o.decision + ":" + (o.task?.taskId ?? "-"), "AUTO:trep", o.reason);
}

// V. Round-5: exact-path proof, multi-component leakage, plural phrases, contextual accessories
for (const name of ["Battery Service Completed","Battery Maintenance Performed","Coolant Service Performed","Brake Pads Service Completed"]) {
  chk("V exact! "+name, matchServiceToTask(name, [{id:"x",name}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
for (const name of ["Oil Service Completed","Tire Rotation Service Completed"]) {
  chk("V exact+ "+name, matchServiceToTask(name, [{id:"x",name}], "car").decision, "AUTO");
}
for (const [p, tn] of [["oil and battery service completed","Change Oil and Replace Battery"],
  ["oil and coolant service completed","Change Oil and Replace Coolant"],
  ["oil and brake pads service completed","Change Oil and Replace Brake Pads"],
  ["tire rotation and oil service completed","Rotate Tires and Change Oil"]] as [string,string][]) {
  chk("V multi! "+p, matchServiceToTask(p, [{id:"m",name:tn}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
for (const p of ["super chargers oil changed","pro chargers oil changed","turbo chargers oil changed"]) {
  chk("V fi! "+p, matchServiceToTask(p, [{id:"oil",name:"Change Engine Oil"}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
for (const p of ["super chargers belt changed","pro chargers belt changed"]) {
  chk("V fi-belt! "+p, matchServiceToTask(p, [{id:"belt",name:"Replace Drive Belt"}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
chk("V booster freed", matchServiceToTask("booster oil changed", [{id:"oil",name:"Oil Change"}], "car").decision, "AUTO");
for (const p of ["battery maintainer replaced","battery maintainers replaced","battery booster replaced","battery boosters replaced"]) {
  chk("V ctx! "+p, matchServiceToTask(p, [{id:"bat",name:"Replace Battery"}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}

// W. Round-6: bidirectional accessory context + proof scope
const RB6=[{id:"bat",name:"Replace Battery"}];
for (const p of ["booster battery replaced","maintainer battery replaced","booster's battery replaced","maintainer's battery replaced",
  "battery inside booster replaced","battery inside maintainer replaced","portable booster battery replaced","portable maintainer battery replaced"]) {
  chk("W acc! "+p, matchServiceToTask(p, RB6, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
for (const [p, tn] of [["oil service completed","Change Oil and Replace Oil Cooler"],["oil service completed","Change Oil and Replace Oil Pan"],
  ["oil service completed","Change Oil and Replace Oil Pump"],["oil service completed","Change Oil and Replace Drain Plug"],
  ["new tires service completed","Replace Tires and Wheels"],["tire replacement service completed","Replace Tires and TPMS"]] as [string,string][]) {
  chk("W scope! "+p+" -> "+tn, matchServiceToTask(p, [{id:"x",name:tn}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
chk("W scope+ oil", matchServiceToTask("oil service completed", [{id:"oil",name:"Oil Change"}], "car").decision, "AUTO");
chk("W scope+ syn oil", matchServiceToTask("oil service completed", [{id:"oil",name:"Full Synthetic Oil Change"}], "car").decision, "AUTO");
chk("W scope+ rot", matchServiceToTask("tire rotation service completed", [{id:"rot",name:"Tire Rotation"}], "car").decision, "AUTO");
chk("W scope+ 5w30", matchServiceToTask("oil service completed", [{id:"oil",name:"Engine Oil Change 5w30"}], "car").decision, "AUTO");
chk("W scope+ every5000", matchServiceToTask("oil service completed", [{id:"oil",name:"Oil Change Every 5000 Miles"}], "car").decision, "AUTO");
chk("W task-reclass interleaved", matchServiceToTask("tires replaced", [{id:"t4",name:"Replace All Four Tires"}], "car").decision + ":" + "t4", "AUTO:t4");
chk("W task-reclass generic", matchServiceToTask("new tires maintenance performed", [{id:"t4",name:"Replace All Four Tires"}], "car").decision, "AUTO");
chk("W balance stays reviewed", matchServiceToTask("tire rotation service completed", [{id:"tb",name:"Tire Rotation and Balance"}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("W booster alone still free", matchServiceToTask("booster oil changed", [{id:"oil",name:"Oil Change"}], "car").decision, "AUTO");

// X. Round-7: recurrence intent, explicit-pressure protection, oil-and-filter names
for (const [p, tn] of [["oil change every 5000 miles","Change Engine Oil"],["oil change per 5000 miles","Change Engine Oil"],
  ["oil change every year","Change Engine Oil"],["battery replaced every 3 years","Replace Battery"]] as [string,string][]) {
  chk("X every! "+p, matchServiceToTask(p, [{id:"x",name:tn}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
for (const tn of ["Change Tire Pressure","Replace Tire Pressure","Change Tire Pressure to 35","Change Tire Condition"]) {
  chk("X press! -> "+tn, matchServiceToTask("tires replaced", [{id:"x",name:tn}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
  }
chk("X press! new tires", matchServiceToTask("new tires", [{id:"x",name:"Change Tire Pressure"}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("X reclass kept", matchServiceToTask("tires replaced", [{id:"t4",name:"Replace All Four Tires"}], "car").decision, "AUTO");
for (const tn of ["Engine Oil and Filter Change","Change Engine Oil and Filter","Motor Oil and Filter Change"]) {
  chk("X oilfilter+ "+tn, matchServiceToTask("oil service completed", [{id:"oil",name:tn}], "car").decision, "AUTO");
}
chk("X S2 kept", matchServiceToTask("oil service completed", [{id:"oil",name:"Oil Change Every 5000 Miles"}], "car").decision, "AUTO");

// Y. Round-8: contextual per + pressure semantics
const OIL8=[{id:"oil",name:"Oil Change"}]; const TP8=[{id:"x",name:"Change Tire Pressure"}];
for (const p of ["oil changed per manufacturer schedule","oil change performed per schedule","engine oil changed as per service schedule"]) {
  chk("Y per+ "+p, matchServiceToTask(p, OIL8, "car").decision, "AUTO");
}
for (const p of ["oil change per 5000 miles","oil change per year","oil change every year","scheduled coolant flush"]) {
  const set = p.includes("coolant") ? [{id:"co",name:"Coolant Flush"}] : OIL8;
  chk("Y per! "+p, matchServiceToTask(p, set, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
for (const p of ["tire pressure changed","Change Tire Pressure","checked tire pressure","topped off tire pressure","adjusted tire pressure"]) {
  chk("Y tp+ "+p, matchServiceToTask(p, TP8, "car").decision, "AUTO");
}
chk("Y per+ dealer", matchServiceToTask("oil changed per the dealer schedule", OIL8, "car").decision, "AUTO");
chk("Y per+ manual", matchServiceToTask("coolant flushed per owners manual", [{id:"co",name:"Coolant Flush"}], "car").decision, "AUTO");
chk("Y tp+ front", matchServiceToTask("front tire pressure adjusted", TP8, "car").decision, "AUTO");
chk("Y tp guard kept", matchServiceToTask("tires replaced", TP8, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("Y tp gauge kept", matchServiceToTask("tire pressure gauge replaced", TP8, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");

// Z. Round-9: repair through normalization, warranty root defect, structural per-spans
const TP9=[{id:"x",name:"Change Tire Pressure"}]; const OIL9=[{id:"oil",name:"Oil Change"}];
for (const p of ["tire pressure leak repaired","tire pressure repaired","tire pressure warranty","tire pressure checked and leak repaired"]) {
  chk("Z tp! "+p, matchServiceToTask(p, TP9, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
chk("Z warranty root", matchServiceToTask("battery warranty", [{id:"bat",name:"Replace Battery"}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("Z warranty legit", matchServiceToTask("battery replaced under warranty", [{id:"bat",name:"Replace Battery"}], "car").decision, "AUTO");
for (const p of ["oil changed per recommended schedule","oil changed per manufacturer recommended interval",
  "oil changed per scheduled maintenance","oil changed as per the manufacturer s recommendation"]) {
  chk("Z per+ "+p, matchServiceToTask(p, OIL9, "car").decision, "AUTO");
}
chk("Z per-mileage!", matchServiceToTask("oil change per mileage", OIL9, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("Z pressure kept", matchServiceToTask("tire pressure changed", TP9, "car").decision, "AUTO");

// AA. Round-10: span integrity + warranty score-neutrality + documented exact exception
const OILA=[{id:"oil",name:"Oil Change"}]; const RBA=[{id:"bat",name:"Replace Battery"}];
for (const p of ["oil change per upcoming maintenance","oil changed per overdue maintenance","battery replacement per pending maintenance",
  "oil change per appointment schedule","oil change per quote schedule","oil changed per next service interval"]) {
  const set = p.includes("battery") ? RBA : OILA;
  chk("AA span! "+p, matchServiceToTask(p, set, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
for (const p of ["oil changed per recommended schedule","oil changed per scheduled maintenance"]) {
  chk("AA span+ "+p, matchServiceToTask(p, OILA, "car").decision, "AUTO");
}
for (const p of ["battery replaced under extended warranty","battery replaced under factory warranty","battery replaced under manufacturer s warranty"]) {
  chk("AA warr+ "+p, matchServiceToTask(p, RBA, "car").decision, "AUTO");
}
chk("AA book! imperative", matchServiceToTask("book oil change for tuesday", OILA, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("AA book+ compliance", matchServiceToTask("oil changed per the book", OILA, "car").decision, "AUTO");
chk("AA warr! bare", matchServiceToTask("battery warranty", RBA, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
// Documented exception: identical task name means identity, deliberately AUTO
chk("AA warr exact doc", matchServiceToTask("battery warranty", [{id:"x",name:"Battery Warranty"}], "car").decision, "AUTO");

// AB. Round-11: completion-scoped warranty + structural book intent
const TRB=[{id:"trep",name:"Replace Tires"}];
for (const p of ["tires replaced under warranty","tires replaced under factory warranty","tire replacement under dealer warranty"]) {
  const o = matchServiceToTask(p, TRB, "car");
  chk("AB warr+ "+p, o.decision + ":" + (o.task?.taskId ?? "-"), "AUTO:trep", o.reason);
}
for (const p of ["i want to book oil change","trying to book oil change","looking to book oil change",
  "called to book oil change","could book oil change","kindly book oil change","book oil change for tuesday"]) {
  chk("AB book! "+p, matchServiceToTask(p, OILA, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
chk("AB book+ per-the-book", matchServiceToTask("oil changed per the book", OILA, "car").decision, "AUTO");
chk("AB book+ by-the-book", matchServiceToTask("oil changed by the book", OILA, "car").decision, "AUTO");
chk("AB warr! bare kept", matchServiceToTask("battery warranty", RBA, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("AB bearing! dangle", matchServiceToTask("tire replacement stuff", TRB, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("AB bearing! svc kept", matchServiceToTask("tire rotation service", [{id:"rot",name:"Tire Rotation"}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");

// AC. v17 fix-author round: positional warranty structure (defects proven on v16 by differential)
for (const [p, t] of [["tire replacement dealer",TRB],["tire replacement extended",TRB],["tire replacement factory",TRB]] as [string, {id:string;name:string}[]][]) {
  chk("AC pos! "+p, matchServiceToTask(p, t, "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
}
chk("AC pos! rotation dealership", matchServiceToTask("tire rotation dealership", [{id:"rot",name:"Tire Rotation"}], "car").decision === "AUTO" ? "AUTO" : "notauto", "notauto");
chk("AC idiom+ following", matchServiceToTask("oil changed following the book", OILA, "car").decision, "AUTO");
chk("AC idiom+ according", matchServiceToTask("oil changed according to the book", OILA, "car").decision, "AUTO");
chk("AC poss+ manufacturer", matchServiceToTask("battery replaced under manufacturer s warranty", RBA, "car").decision, "AUTO");

// I. Exact-match path still guarded (exact task name typed with foreign noun cannot occur; exact clean name AUTOs)
chk("I exact", d("Oil Change", SEDAN, "car").decision, "AUTO");

console.log(fail === 0 ? `ALL PASS (${pass})` : `${fail} FAIL / ${pass} pass`);
