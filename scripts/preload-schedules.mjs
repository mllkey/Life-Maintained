// Pre-load ~40,000+ vehicle and property schedules + estimates
// Run: npm run preload-schedules   (or: node scripts/preload-schedules.mjs)
// BEFORE RUNNING: Set CLAUDE_MODEL to claude-haiku-4-5-20251001 in Supabase Edge Function secrets
// AFTER RUNNING: Change CLAUDE_MODEL back to claude-sonnet-4-20250514
//
// ⚠️ Auth: Edge functions require Authorization: Bearer <user JWT> and a real vehicle_id /
// property_id owned by that user. The vehicle must have zero existing tasks (otherwise 409).
// Set PRELOAD_USER_JWT in .env. You still need a valid preload vehicle/property strategy
// (e.g. temp rows per combo or a future "preload" mode in the functions).

import { createClient } from "@supabase/supabase-js";
import { config } from "dotenv";
import { readFileSync, writeFileSync, existsSync } from "fs";
config();

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.EXPO_PUBLIC_SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env");
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const PRELOAD_USER_JWT = process.env.PRELOAD_USER_JWT?.trim();

/** Must match generate-property-schedule cache_key (IECC zone from ZIP prefix). */
function getClimateZone(zip) {
  if (!zip || zip.length < 3) return { zone: 4, description: "Mixed (default)" };
  const prefix = parseInt(zip.substring(0, 3), 10);
  if (prefix >= 327 && prefix <= 339) return { zone: 1, description: "Hot-Humid (South Florida)" };
  if (prefix >= 967 && prefix <= 968) return { zone: 1, description: "Hot-Humid (Hawaii)" };
  if (prefix >= 780 && prefix <= 789) return { zone: 1, description: "Hot (South Texas)" };
  if (prefix >= 850 && prefix <= 857) return { zone: 1, description: "Hot-Dry (South Arizona)" };
  if (prefix >= 350 && prefix <= 369) return { zone: 3, description: "Warm-Humid (Alabama)" };
  if (prefix >= 370 && prefix <= 385) return { zone: 3, description: "Warm-Humid (Tennessee/Mississippi)" };
  if (prefix >= 700 && prefix <= 714) return { zone: 3, description: "Warm-Humid (Louisiana)" };
  if (prefix >= 716 && prefix <= 729) return { zone: 3, description: "Warm-Humid (Arkansas/Oklahoma)" };
  if (prefix >= 750 && prefix <= 779) return { zone: 3, description: "Warm (Texas)" };
  if (prefix >= 290 && prefix <= 299) return { zone: 3, description: "Warm-Humid (South Carolina)" };
  if (prefix >= 300 && prefix <= 319) return { zone: 3, description: "Warm-Humid (Georgia)" };
  if (prefix >= 320 && prefix <= 326) return { zone: 3, description: "Warm-Humid (North Florida)" };
  if (prefix >= 386 && prefix <= 397) return { zone: 3, description: "Warm-Humid (Mississippi)" };
  if (prefix >= 900 && prefix <= 935) return { zone: 3, description: "Warm-Dry (Southern California)" };
  if (prefix >= 995 && prefix <= 999) return { zone: 7, description: "Very Cold (Alaska)" };
  if (prefix >= 550 && prefix <= 567) return { zone: 6, description: "Cold (Minnesota)" };
  if (prefix >= 570 && prefix <= 577) return { zone: 6, description: "Cold (South Dakota)" };
  if (prefix >= 580 && prefix <= 588) return { zone: 6, description: "Cold (North Dakota)" };
  if (prefix >= 590 && prefix <= 599) return { zone: 6, description: "Cold (Montana)" };
  if (prefix >= 820 && prefix <= 831) return { zone: 6, description: "Cold (Wyoming)" };
  if (prefix >= 430 && prefix <= 458) return { zone: 5, description: "Cool (Ohio)" };
  if (prefix >= 460 && prefix <= 479) return { zone: 5, description: "Cool (Indiana)" };
  if (prefix >= 480 && prefix <= 499) return { zone: 5, description: "Cool (Michigan)" };
  if (prefix >= 500 && prefix <= 528) return { zone: 5, description: "Cool (Iowa)" };
  if (prefix >= 530 && prefix <= 549) return { zone: 5, description: "Cool (Wisconsin)" };
  if (prefix >= 600 && prefix <= 629) return { zone: 5, description: "Cool (Illinois)" };
  if (prefix >= 680 && prefix <= 693) return { zone: 5, description: "Cool (Nebraska)" };
  if (prefix >= 100 && prefix <= 149) return { zone: 5, description: "Cool (New York)" };
  if (prefix >= 150 && prefix <= 196) return { zone: 5, description: "Cool (Pennsylvania)" };
  if (prefix >= 800 && prefix <= 816) return { zone: 5, description: "Cool (Colorado)" };
  if (prefix >= 832 && prefix <= 838) return { zone: 5, description: "Cool (Idaho)" };
  if (prefix >= 980 && prefix <= 994) return { zone: 5, description: "Cool (Washington)" };
  if (prefix >= 10 && prefix <= 34) return { zone: 5, description: "Cool (Massachusetts/Connecticut)" };
  if (prefix >= 35 && prefix <= 59) return { zone: 6, description: "Cold (Vermont/New Hampshire/Maine)" };
  if (prefix >= 60 && prefix <= 69) return { zone: 5, description: "Cool (Connecticut)" };
  if (prefix >= 200 && prefix <= 289) return { zone: 4, description: "Mixed (Mid-Atlantic)" };
  if (prefix >= 400 && prefix <= 427) return { zone: 4, description: "Mixed (Kentucky)" };
  if (prefix >= 630 && prefix <= 658) return { zone: 4, description: "Mixed (Missouri)" };
  if (prefix >= 660 && prefix <= 679) return { zone: 4, description: "Mixed (Kansas)" };
  if (prefix >= 197 && prefix <= 199) return { zone: 4, description: "Mixed (Delaware)" };
  if (prefix >= 840 && prefix <= 847) return { zone: 5, description: "Cool-Dry (Utah)" };
  if (prefix >= 870 && prefix <= 884) return { zone: 4, description: "Mixed-Dry (New Mexico)" };
  if (prefix >= 889 && prefix <= 898) return { zone: 3, description: "Warm-Dry (Nevada)" };
  if (prefix >= 936 && prefix <= 966) return { zone: 4, description: "Mixed (Northern California)" };
  if (prefix >= 970 && prefix <= 979) return { zone: 5, description: "Cool (Oregon)" };
  return { zone: 4, description: "Mixed (default)" };
}

// ═══════════════════════════════════════════════════════════════
// YEAR RANGES
// ═══════════════════════════════════════════════════════════════

const Y00_25 = Array.from({ length: 26 }, (_, i) => 2000 + i); // 2000-2025
const Y05_25 = Array.from({ length: 21 }, (_, i) => 2005 + i); // 2005-2025
const Y98_25 = Array.from({ length: 28 }, (_, i) => 1998 + i); // 1998-2025
const Y10_25 = Array.from({ length: 16 }, (_, i) => 2010 + i); // 2010-2025
const Y15_25 = Array.from({ length: 11 }, (_, i) => 2015 + i); // 2015-2025
const Y18_25 = Array.from({ length: 8 }, (_, i) => 2018 + i);  // 2018-2025

// ═══════════════════════════════════════════════════════════════
// CARS / TRUCKS / SUVs — COMPREHENSIVE
// ═══════════════════════════════════════════════════════════════

const CAR_MODELS = {
  "Toyota": ["Camry", "Corolla", "RAV4", "Highlander", "4Runner", "Tacoma", "Tundra", "Prius", "Sienna", "Venza", "GR86", "Supra", "Land Cruiser", "Sequoia", "C-HR", "Avalon", "Matrix", "Yaris", "FJ Cruiser", "Celica", "MR2", "Echo"],
  "Honda": ["Civic", "Accord", "CR-V", "Pilot", "HR-V", "Ridgeline", "Passport", "Odyssey", "Fit", "Element", "S2000", "Prelude", "Insight", "Crosstour"],
  "Ford": ["F-150", "Explorer", "Escape", "Bronco", "Bronco Sport", "Ranger", "Maverick", "Mustang", "Edge", "Expedition", "F-250 Super Duty", "F-350 Super Duty", "Transit", "Flex", "Fusion", "Focus", "Taurus", "Excursion", "Crown Victoria", "Fiesta", "F-450 Super Duty"],
  "Chevrolet": ["Silverado 1500", "Equinox", "Tahoe", "Traverse", "Malibu", "Camaro", "Corvette", "Suburban", "Colorado", "Trailblazer", "Blazer", "Silverado 2500HD", "Silverado 3500HD", "Impala", "Cruze", "Spark", "Sonic", "Trax", "Avalanche", "S-10", "Monte Carlo", "Express"],
  "Ram": ["1500", "2500", "3500", "ProMaster", "ProMaster City"],
  "Jeep": ["Grand Cherokee", "Wrangler", "Cherokee", "Compass", "Gladiator", "Renegade", "Grand Wagoneer", "Wagoneer", "Liberty", "Commander", "Patriot"],
  "Hyundai": ["Tucson", "Santa Fe", "Elantra", "Sonata", "Kona", "Palisade", "Venue", "Ioniq 5", "Ioniq 6", "Santa Cruz", "Accent", "Veloster", "Genesis Coupe", "Tiburon", "Azera"],
  "Kia": ["Sportage", "Telluride", "Forte", "Seltos", "Sorento", "Soul", "K5", "Carnival", "EV6", "EV9", "Optima", "Rio", "Stinger", "Spectra", "Sedona"],
  "Subaru": ["Outback", "Forester", "Crosstrek", "Impreza", "WRX", "Ascent", "Legacy", "BRZ", "Baja", "Tribeca", "SVX"],
  "Nissan": ["Rogue", "Altima", "Sentra", "Pathfinder", "Frontier", "Murano", "Kicks", "Titan", "Armada", "Versa", "Z", "Maxima", "Juke", "Xterra", "Quest", "350Z", "370Z", "Leaf"],
  "GMC": ["Sierra 1500", "Terrain", "Acadia", "Yukon", "Canyon", "Sierra 2500HD", "Sierra 3500HD", "Hummer EV", "Envoy", "Jimmy"],
  "BMW": ["3 Series", "5 Series", "X3", "X5", "X1", "4 Series", "7 Series", "X7", "i4", "iX", "M3", "M4", "Z4", "X6", "2 Series", "6 Series", "M5", "X4", "1 Series", "i3", "i8"],
  "Mercedes-Benz": ["C-Class", "E-Class", "GLC", "GLE", "A-Class", "S-Class", "GLA", "GLB", "CLA", "EQS", "G-Class", "AMG GT", "GLS", "ML-Class", "GL-Class", "SL-Class", "CLK-Class", "SLK-Class", "R-Class"],
  "Audi": ["A4", "Q5", "A3", "Q7", "A6", "Q3", "e-tron", "A5", "Q8", "RS5", "S4", "TT", "A7", "A8", "Q4 e-tron", "RS6", "S5", "R8"],
  "Lexus": ["RX", "NX", "ES", "IS", "GX", "UX", "TX", "LC", "LX", "RC", "GS", "LS", "CT", "SC"],
  "Volkswagen": ["Jetta", "Tiguan", "Atlas", "Golf", "Taos", "ID.4", "Atlas Cross Sport", "GTI", "Passat", "Beetle", "CC", "Touareg", "R32"],
  "Mazda": ["CX-5", "Mazda3", "CX-50", "CX-9", "CX-30", "MX-5 Miata", "CX-90", "Mazda6", "CX-7", "RX-8", "Tribute", "Speed3"],
  "Buick": ["Encore GX", "Enclave", "Envista", "Envision", "LaCrosse", "Regal", "Verano", "Lucerne", "Rendezvous"],
  "Cadillac": ["Escalade", "XT5", "XT4", "CT5", "CT4", "Lyriq", "XT6", "CTS", "ATS", "SRX", "DTS", "XTS", "Escalade ESV"],
  "Lincoln": ["Navigator", "Corsair", "Nautilus", "Aviator", "MKZ", "MKC", "MKX", "Continental", "Town Car"],
  "Acura": ["MDX", "RDX", "Integra", "TLX", "ZDX", "TL", "TSX", "RSX", "ILX", "RL"],
  "Infiniti": ["QX60", "QX80", "QX50", "Q50", "Q60", "QX55", "G37", "G35", "FX35", "M37"],
  "Volvo": ["XC90", "XC60", "XC40", "S60", "V60 Cross Country", "EX30", "S90", "V90", "S40", "C30", "C70"],
  "Porsche": ["Cayenne", "Macan", "911", "Taycan", "Panamera", "Boxster", "Cayman", "718"],
  "Land Rover": ["Range Rover", "Range Rover Sport", "Defender", "Discovery", "Evoque", "LR4", "LR3", "Freelander"],
  "Dodge": ["Durango", "Charger", "Challenger", "Hornet", "Grand Caravan", "Journey", "Dart", "Viper", "Magnum", "Nitro", "Dakota", "Neon"],
  "Chrysler": ["Pacifica", "300", "Town & Country", "Sebring", "200", "PT Cruiser", "Crossfire"],
  "Genesis": ["GV70", "GV80", "G70", "G80", "GV60", "G90"],
  "Mitsubishi": ["Outlander", "Eclipse Cross", "Mirage", "Outlander Sport", "Lancer", "Eclipse", "Galant", "Endeavor"],
  "Pontiac": ["G6", "Grand Prix", "Grand Am", "Vibe", "GTO", "Firebird", "Bonneville", "Sunfire", "Montana", "Aztek"],
  "Saturn": ["Vue", "Outlook", "Ion", "Aura", "Sky", "S-Series", "L-Series"],
  "Mercury": ["Grand Marquis", "Mountaineer", "Mariner", "Milan", "Sable", "Cougar"],
  "Saab": ["9-3", "9-5", "9-2X"],
  "Hummer": ["H2", "H3"],
  "Scion": ["tC", "xB", "xD", "FR-S", "iM"],
  "Fiat": ["500", "500X", "500L", "Spider"],
  "Smart": ["Fortwo"],
  "Tesla": ["Model 3", "Model Y", "Model S", "Model X", "Cybertruck"],
  "Rivian": ["R1T", "R1S"],
  "Lucid": ["Air", "Gravity"],
  "Mini": ["Cooper", "Countryman", "Clubman", "Paceman"],
  "Alfa Romeo": ["Giulia", "Stelvio", "Tonale", "4C"],
  "Maserati": ["Ghibli", "Levante", "Grecale", "Quattroporte", "GranTurismo"],
  "Jaguar": ["F-PACE", "E-PACE", "XF", "XE", "XJ", "F-Type", "XK"],
  "Aston Martin": ["DB11", "Vantage", "DBX"],
  "Bentley": ["Bentayga", "Continental GT", "Flying Spur"],
  "Rolls-Royce": ["Cullinan", "Ghost", "Phantom"],
  "Lamborghini": ["Urus", "Huracan", "Aventador"],
  "Ferrari": ["Roma", "296 GTB", "SF90", "812", "F8", "Portofino"],
  "McLaren": ["720S", "GT", "Artura"],
};

// ── MOTORCYCLES — DEEP CATALOG ──────────────────────────────

const MOTORCYCLE_MODELS = {
  "Harley-Davidson": [
    "Street Glide", "Road Glide", "Road King", "Heritage Classic", "Fat Boy", "Softail Standard",
    "Sportster S", "Iron 883", "Forty-Eight", "Street Bob", "Low Rider S", "Fat Bob",
    "Electra Glide", "Ultra Limited", "CVO Street Glide", "CVO Road Glide", "Nightster",
    "Sportster 1200", "Breakout", "Pan America", "LiveWire", "V-Rod", "Dyna Street Bob",
    "Dyna Low Rider", "Dyna Wide Glide", "Dyna Super Glide", "Night Rod Special",
    "Road Glide Special", "Road Glide Limited", "Street Glide Special", "Heritage Softail Classic",
    "Softail Deluxe", "Softail Slim", "Sport Glide", "Low Rider ST", "Nightster Special",
    "Iron 1200", "SuperLow", "Seventy-Two", "Street 500", "Street 750",
    "Tri Glide Ultra", "Freewheeler", "CVO Limited",
  ],
  "Honda": [
    "CBR600RR", "CBR1000RR", "CBR1000RR-R", "CBR500R", "CBR300R", "CBR250R",
    "CB500F", "CB500X", "CB650R", "CB300R", "CB1000R",
    "Gold Wing", "Gold Wing Tour",
    "Rebel 300", "Rebel 500", "Rebel 1100",
    "Africa Twin", "Africa Twin Adventure Sports",
    "CRF300L", "CRF300L Rally", "CRF450L", "CRF450RL", "CRF250L",
    "Monkey", "Grom", "Navi", "Trail 125", "Super Cub",
    "NC750X", "Shadow Phantom", "Shadow Aero", "Shadow Spirit",
    "VTX 1300", "VTX 1800", "Fury", "Valkyrie",
    "ST1300", "CTX700", "CTX1300", "DN-01", "NM4",
    "CBR600F4i", "CBR929RR", "CBR954RR", "RC51",
  ],
  "Yamaha": [
    "YZF-R1", "YZF-R1M", "YZF-R6", "YZF-R7", "YZF-R3", "YZF-R9",
    "MT-03", "MT-07", "MT-09", "MT-10",
    "Tenere 700", "XSR700", "XSR900",
    "Bolt", "V Star 250", "V Star 650", "V Star 950", "V Star 1100", "V Star 1300",
    "VMAX", "FZ-09", "FZ-07", "FZ-06", "FZ1", "FZ8", "FZ6",
    "Star Venture", "Stryker", "Raider",
    "Royal Star", "Royal Star Venture", "Royal Star Tour Deluxe",
    "TW200", "XT250", "WR250R", "YZ250F", "YZ450F",
    "Super Tenere", "Tracer 9 GT",
  ],
  "Kawasaki": [
    "Ninja 250", "Ninja 250R", "Ninja 300", "Ninja 400", "Ninja 500", "Ninja 650",
    "Ninja 1000", "Ninja 1000SX", "Ninja ZX-6R", "Ninja ZX-10R", "Ninja ZX-10RR",
    "Ninja ZX-14R", "Ninja ZX-4R", "Ninja ZX-4RR",
    "Z400", "Z650", "Z900", "Z900RS", "Z H2",
    "Versys 650", "Versys 1000", "Versys-X 300",
    "Vulcan S", "Vulcan 900 Classic", "Vulcan 900 Custom", "Vulcan 1700 Voyager", "Vulcan 2000",
    "KLR 650", "KLX 300", "KLX 300SM", "KLX 230", "KLX 140",
    "Concours 14", "W800", "Eliminator",
    "Ninja ZX-6RR", "Ninja ZX-9R", "Ninja ZX-12R",
    "KZ1000", "GPZ900R",
  ],
  "Suzuki": [
    "GSX-R600", "GSX-R750", "GSX-R1000", "GSX-R1000R",
    "GSX-S750", "GSX-S1000", "GSX-S1000GT",
    "GSX-8S", "GSX-8R",
    "V-Strom 650", "V-Strom 650XT", "V-Strom 1050", "V-Strom 1050DE",
    "Hayabusa",
    "Boulevard M109R", "Boulevard M50", "Boulevard C50", "Boulevard C90", "Boulevard S40", "Boulevard S50",
    "DR-Z400S", "DR-Z400SM", "DR650SE",
    "SV650", "SV650X", "SV1000",
    "TL1000R", "TL1000S",
    "Bandit 600", "Bandit 1200", "Bandit 1250",
    "GSX-R1100", "GS500", "GS750",
    "Burgman 400", "Burgman 650",
    "RM-Z250", "RM-Z450",
  ],
  "BMW": [
    "R 1250 GS", "R 1250 GS Adventure", "R 1250 RT", "R 1250 RS",
    "R 1200 GS", "R 1200 GS Adventure", "R 1200 RT",
    "S 1000 RR", "S 1000 XR", "S 1000 R",
    "F 900 R", "F 900 XR", "F 850 GS", "F 850 GS Adventure", "F 750 GS",
    "F 800 GS", "F 800 R", "F 800 GT",
    "R nineT", "R nineT Scrambler", "R nineT Pure",
    "G 310 R", "G 310 GS",
    "K 1600 GTL", "K 1600 Grand America", "K 1600 B",
    "R 18", "R 18 Classic", "R 18 Transcontinental",
    "M 1000 RR", "M 1000 XR", "M 1000 R",
    "CE 04",
    "HP4", "S 1000 RR HP4",
  ],
  "Ducati": [
    "Monster", "Monster 937", "Monster SP",
    "Panigale V4", "Panigale V4 S", "Panigale V4 R", "Panigale V2",
    "Streetfighter V4", "Streetfighter V4 S", "Streetfighter V2",
    "Multistrada V4", "Multistrada V4 S", "Multistrada V4 Rally", "Multistrada V2",
    "Scrambler Icon", "Scrambler Desert Sled", "Scrambler Full Throttle", "Scrambler Café Racer",
    "Diavel V4", "XDiavel",
    "Hypermotard 950", "Hypermotard 950 SP",
    "SuperSport 950", "SuperSport 950 S",
    "DesertX", "DesertX Rally",
    "848", "1098", "1199 Panigale", "1299 Panigale",
    "Monster 696", "Monster 796", "Monster 1100", "Monster 1200",
    "Hyperstrada", "Multistrada 1200", "Multistrada 1260",
    "GT1000", "Paul Smart", "Sport Classic",
  ],
  "KTM": [
    "390 Duke", "690 Duke", "790 Duke", "890 Duke", "890 Duke R", "1290 Super Duke R", "1290 Super Duke GT",
    "390 Adventure", "890 Adventure", "890 Adventure R", "1290 Super Adventure S", "1290 Super Adventure R",
    "RC 390", "RC 200",
    "300 EXC", "350 EXC-F", "450 EXC-F", "500 EXC-F",
    "250 SX-F", "350 SX-F", "450 SX-F",
    "1190 Adventure", "1090 Adventure",
    "690 Enduro", "690 SMC",
  ],
  "Indian": [
    "Scout", "Scout Bobber", "Scout Bobber Twenty", "Scout Sixty",
    "Chief", "Chief Dark Horse", "Chief Bobber", "Chief Bobber Dark Horse",
    "Chieftain", "Chieftain Dark Horse", "Chieftain Limited",
    "Challenger", "Challenger Dark Horse", "Challenger Limited",
    "Pursuit", "Pursuit Dark Horse", "Pursuit Limited",
    "Roadmaster", "Roadmaster Dark Horse", "Roadmaster Limited",
    "Springfield", "Springfield Dark Horse",
    "FTR 1200", "FTR 1200 S", "FTR Rally",
    "Super Chief", "Super Chief Limited",
  ],
  "Triumph": [
    "Bonneville T120", "Bonneville T100", "Bonneville Bobber", "Bonneville Speedmaster",
    "Street Triple", "Street Triple R", "Street Triple RS",
    "Speed Triple 1200", "Speed Triple 1200 RS",
    "Tiger 900", "Tiger 900 Rally", "Tiger 900 GT",
    "Tiger 1200", "Tiger 1200 Rally", "Tiger 1200 GT",
    "Trident 660", "Rocket 3", "Rocket 3 R", "Rocket 3 GT",
    "Thruxton RS", "Thruxton 1200",
    "Scrambler 1200 XC", "Scrambler 1200 XE",
    "Speed Twin", "Speed Twin 1200",
    "Daytona 675", "Daytona 675R",
    "Sprint ST", "Sprint GT",
    "Tiger 800", "Tiger Explorer",
    "Thunderbird", "America",
  ],
  "Royal Enfield": [
    "Classic 350", "Classic 500", "Meteor 350", "Hunter 350",
    "Himalayan", "Himalayan 450",
    "INT650", "Continental GT 650",
    "Super Meteor 650", "Shotgun 650",
    "Bullet 350", "Bullet 500",
  ],
  "Aprilia": ["RS 660", "Tuono 660", "Tuareg 660", "RSV4", "RSV4 Factory", "Tuono V4", "Tuono V4 Factory", "Dorsoduro 900", "Shiver 900"],
  "Moto Guzzi": ["V7", "V7 Stone", "V85 TT", "V100 Mandello", "California", "Griso", "Stelvio"],
  "Can-Am": ["Spyder F3", "Spyder F3-S", "Spyder F3-T", "Spyder RT", "Spyder RT Limited", "Ryker", "Ryker Rally", "Ryker Sport"],
  "Buell": ["XB12R", "XB12S", "XB9R", "1125R", "Blast", "Lightning", "Firebolt"],
  "MV Agusta": ["F3 800", "Brutale 800", "Turismo Veloce", "Dragster"],
  "Husqvarna Moto": ["Vitpilen 401", "Svartpilen 401", "Norden 901", "701 Enduro", "701 Supermoto"],
  "Zero": ["SR/F", "SR/S", "S", "DS", "FX", "FXE"],
  "Energica": ["Ego", "Eva", "Experia"],
};

// ── BOATS — COMPREHENSIVE ────────────────────────────────────

const BOAT_MODELS = {
  "Sea Ray": ["SPX 190", "SLX 260", "SDX 250", "Sundancer 320", "SLX 310", "SPX 210", "SDX 270", "Sundancer 370"],
  "Bayliner": ["VR5", "VR6", "Element M15", "DX2000", "Trophy T22CC", "Element E21", "VR4", "Trophy T20CC"],
  "Boston Whaler": ["Montauk 170", "Dauntless 170", "Outrage 190", "Conquest 235", "Outrage 250", "Montauk 150", "Outrage 330", "Conquest 285"],
  "Yamaha Boats": ["AR190", "AR210", "242X", "252S", "195S", "FSH Sport", "SX190", "212X"],
  "MasterCraft": ["NXT22", "NXT24", "X22", "X24", "XT21", "XT23", "NXT20", "X26"],
  "Tracker": ["Bass Tracker Classic", "Pro Team 175", "Targa V-19", "Pro Guide V-16", "Grizzly 1860", "Pro 170", "Super Guide V-16"],
  "Grady-White": ["Fisherman 216", "Freedom 235", "Canyon 271", "Express 330", "Freedom 275", "Fisherman 180"],
  "Chaparral": ["21 SSi", "23 SSi", "267 SSX", "280 OSX", "307 SSX", "21 SSi OB"],
  "Cobalt": ["R5", "R6", "R8", "A29", "CS23", "R4", "R7"],
  "Malibu": ["Wakesetter 23 LSV", "Wakesetter 25 LSV", "Response TXi", "Wakesetter 22 LSV", "22 MXZ"],
  "Nautique": ["Super Air G23", "Super Air G25", "GS22", "Paragon", "Super Air G21"],
  "Bennington": ["22 LSR", "23 LXSB", "25 QX", "SX22", "22 SSRX", "23 SSBX"],
  "Sun Tracker": ["Party Barge 20", "Bass Buggy 16", "Fishin Barge 22", "Sportfish 22", "Party Barge 22"],
  "Lund": ["1675 Adventure", "1875 Crossover", "2075 Tyee", "1775 Impact", "1975 Tyee"],
  "Crestliner": ["1650 Fish Hawk", "1850 Raptor", "2250 Authority", "1750 Fish Hawk", "2050 Authority"],
  "Ranger Boats": ["Z521L", "RT198P", "620FS", "Z519", "VS1882"],
  "Skeeter": ["ZXR 21", "FXR 21", "ZX200", "ZXR 20"],
  "Robalo": ["R222", "R230", "R242", "R272", "R200"],
  "Wellcraft": ["222 Fisherman", "262 Fisherman", "302 Fisherman", "182 Fisherman"],
  "Scarab": ["165", "195", "255", "215"],
  "Sea-Doo": ["Spark", "Spark Trixx", "GTX 170", "GTX 230", "Fish Pro", "Fish Pro Sport", "RXP-X 300", "RXT-X 300", "Switch 13", "Switch 16", "Switch 19", "Switch 21"],
  "Kawasaki Marine": ["STX 160", "STX 160LX", "Ultra 310", "Ultra 310R", "Ultra 310LX"],
  "Yamaha PWC": ["WaveRunner VX", "WaveRunner VX Cruiser", "WaveRunner FX", "WaveRunner FX Cruiser", "WaveRunner GP1800R", "SuperJet", "WaveRunner EX"],
  "Centurion": ["Ri245", "Ri265", "Fi21", "Fi23"],
  "Tige": ["23 ZX", "21 ZX", "R21", "R23"],
  "Axis": ["A22", "A24", "T23"],
  "Heyday": ["WT-1", "WT-2", "WT-Surf"],
  "Starcraft": ["SVX 191 OB", "Fishmaster 196", "EXs 3"],
  "Regulator": ["23", "26", "28", "31", "34", "37", "41"],
  "Yellowfin": ["26 Hybrid", "32", "34", "36", "39", "42"],
  "Sportsman": ["Open 212", "Open 232", "Heritage 231", "Masters 247"],
  "Tidewater": ["220 LXF", "232 CC", "252 CC", "280 CC"],
  "Key West": ["203FS", "219FS", "239FS", "263FS"],
  "Carolina Skiff": ["218 DLV", "JVX 18", "JVX 20"],
  "G3": ["Bay 18 DLX", "Sportsman 1910", "Gator Tough 18"],
  "Alumacraft": ["Competitor 175", "Trophy 185", "Voyageur 175"],
};

// ── EQUIPMENT ────────────────────────────────────────────────

const EQUIPMENT_MODELS = {
  "John Deere": ["D130", "E120", "S240", "X350", "X570", "Z345R", "Z530M", "Z930M", "Z994R", "1025R", "2032R", "3038E", "3046R", "4066R"],
  "Honda Power": ["HRX217", "HRN216", "EU2200i", "EU3000iS", "EB2800i", "EB5000", "HRR216"],
  "Husqvarna Equipment": ["Z254", "MZ61", "Z560", "455 Rancher", "460 Rancher", "562 XP", "372 XP", "ST430", "350BT", "K770"],
  "Toro": ["TimeCutter SS4225", "TimeCutter SS5000", "Titan MAX 60", "Recycler 22", "Super Recycler", "Z Master 3000"],
  "Stihl": ["MS 170", "MS 250", "MS 271", "MS 362", "MS 391", "MS 462", "MS 500i", "MS 661", "FS 91 R", "FS 131 R", "BR 600", "BR 800", "BG 86"],
  "Echo": ["CS-590", "CS-501P", "CS-2511T", "PB-9010T", "PB-8010T", "SRM-2620", "SRM-2620T"],
  "Kubota": ["BX2380", "BX23S", "L2501", "L3301", "L3901", "L4060", "M7060", "SVL75-2", "SVL95-2S", "KX040-4", "U55-4"],
  "Caterpillar": ["226D", "246D", "262D", "272D", "289D", "299D", "308", "313", "320", "330", "336", "D3", "D5", "D6"],
  "Bobcat": ["S450", "S510", "S590", "S630", "S650", "S770", "S850", "T450", "T590", "T650", "T770", "T870", "E20", "E35", "E42", "E50", "E60", "E85"],
  "Case": ["SR210", "SR240", "SR270", "SV280", "SV340", "TV380B", "CX17C", "CX37C", "CX57C", "CX75C", "580SN", "590SN"],
  "Deere Construction": ["310SL", "317G", "325G", "330G", "331G", "332G", "333G", "35G", "50G", "60G", "85G", "130G", "160G", "210L", "310L", "410L"],
  "Generac": ["GP2200i", "GP3500iO", "GP6500", "GP8000E", "XT8000E", "22kW Guardian", "24kW Guardian", "26kW Guardian"],
  "Champion Power": ["3400W", "3500W", "4375W", "7500W", "9375W", "100520", "200986"],
  "Briggs Stratton": ["P2200", "P3000", "Q6500", "030710", "030764"],
  "DeWalt Power": ["DXGNR7000", "DXGNR8000", "DCE200M2", "DWE43144"],
  "Lincoln Electric": ["Power MIG 210 MP", "Power MIG 260", "Ranger 330MPX", "Vantage 300", "Vantage 500"],
  "Miller": ["Millermatic 211", "Millermatic 255", "Bobcat 250", "Bobcat 260", "Trailblazer 325"],
  "Toyota Forklift": ["8FGCU25", "8FGCU30", "8FBE15U", "8FBE20U", "8FGCU20", "8FGCU32"],
  "Hyster": ["H40FT", "H50FT", "H60FT", "H70FT", "S50FT", "S60FT"],
  "Crown": ["FC 5200", "RC 5500", "SC 6000", "C-5", "PE 4000"],
  "JLG": ["340AJ", "450AJ", "600AJ", "600S", "800S", "1930ES", "2632ES", "3246ES", "4069LE"],
  "Genie": ["S-45", "S-60", "S-80", "GS-1930", "GS-2632", "GS-3246", "GTH-5519", "GTH-636", "GTH-844"],
  "Vermeer": ["BC1000XL", "BC1200XL", "S925TX", "RTX250", "D24x40"],
  "Ditch Witch": ["JT20", "JT30", "SK1050", "SK3000", "C16X"],
};

// ── SEMI TRUCKS ──────────────────────────────────────────────

const SEMI_MODELS = {
  "Freightliner": ["Cascadia", "Cascadia 126", "Columbia", "M2 106", "M2 112", "M2 112 Plus", "Coronado", "122SD"],
  "Kenworth": ["T680", "T880", "W900", "W900L", "T370", "T480", "T270", "T800"],
  "Peterbilt": ["579", "389", "567", "348", "220", "337", "365", "520"],
  "Volvo Trucks": ["VNL 760", "VNL 860", "VNR 300", "VNR 400", "VNR 640", "VHD 300", "VHD 400"],
  "International": ["LT Series", "HX Series", "MV Series", "HV Series", "RH Series", "CV Series"],
  "Mack": ["Anthem", "Pinnacle", "Granite", "LR", "MD Series", "MD6", "MD7", "TerraPro"],
  "Western Star": ["4700", "4900", "47X", "49X", "57X"],
  "Hino": ["L6", "L7", "XL7", "XL8", "258", "338"],
  "Isuzu": ["NPR HD", "NQR", "NRR", "FTR", "FVR"],
};

// ── RVs ──────────────────────────────────────────────────────

const RV_MODELS = {
  "Winnebago": ["Minnie Winnie", "Vista", "Solis", "Revel", "Travato", "View", "Navion", "Adventurer", "Forza", "Journey"],
  "Thor": ["Four Winds", "Magnitude", "Gemini", "Venetian", "Ace", "Chateau", "Palazzo", "Delano", "Sequence", "Tellaro"],
  "Airstream": ["Interstate 24X", "Interstate 24GL", "Basecamp", "Bambi", "Caravel", "Flying Cloud", "Globetrotter", "Classic"],
  "Coachmen": ["Leprechaun", "Freelander", "Catalina", "Apex", "Prism", "Galleria", "Beyond", "Cross Trail"],
  "Forest River": ["Forester", "Sunseeker", "Georgetown", "Berkshire", "Salem", "Rockwood", "Flagstaff", "Cherokee"],
  "Jayco": ["Redhawk", "Greyhawk", "Melbourne", "Seneca", "Alante", "Precept", "Jay Feather", "Eagle"],
  "Newmar": ["Bay Star", "Canyon Star", "Ventana", "Dutch Star", "King Aire", "Essex"],
  "Tiffin": ["Allegro", "Allegro Bus", "Allegro Breeze", "Phaeton", "Zephyr", "Open Road"],
  "Fleetwood": ["Bounder", "Flair", "Fortis", "Discovery", "Discovery LXE", "Frontier"],
  "Entegra": ["Aspire", "Anthem", "Reatta", "Vision", "Odyssey"],
};

// ── ATVs ─────────────────────────────────────────────────────

const ATV_MODELS = {
  "Polaris": ["Sportsman 450", "Sportsman 570", "Sportsman 850", "Sportsman XP 1000", "Scrambler XP 1000", "Sportsman 6x6", "Outlaw 110"],
  "Can-Am": ["Outlander 450", "Outlander 570", "Outlander 650", "Outlander 850", "Outlander 1000R", "Renegade 850", "Renegade 1000R", "DS 250", "DS 90"],
  "Honda ATV": ["FourTrax Rancher", "FourTrax Foreman", "FourTrax Foreman Rubicon", "FourTrax Rincon", "TRX250X", "TRX90X", "Pioneer 520"],
  "Yamaha ATV": ["Grizzly 700", "Kodiak 700", "Kodiak 450", "Raptor 700R", "YFZ450R", "Wolverine RMAX2 1000", "Raptor 90"],
  "Kawasaki ATV": ["Brute Force 750", "Brute Force 300", "KFX 50", "KFX 90", "KFX 450R"],
  "Arctic Cat ATV": ["Alterra 600", "Alterra 700", "Mudpro 700", "Wildcat XX"],
  "Suzuki ATV": ["KingQuad 750", "KingQuad 500", "KingQuad 400", "QuadSport Z400", "QuadSport Z90"],
  "CFMOTO ATV": ["CForce 600", "CForce 800", "CForce 1000"],
};

// ── UTVs ─────────────────────────────────────────────────────

const UTV_MODELS = {
  "Polaris": ["RZR XP 1000", "RZR Pro XP", "RZR Pro R", "RZR Trail S", "RZR 200", "Ranger 1000", "Ranger XP Kinetic", "Ranger Crew XP 1000", "General XP 1000", "General 4 1000"],
  "Can-Am": ["Maverick X3", "Maverick X3 Max", "Maverick Sport", "Maverick Trail", "Defender HD10", "Defender Max", "Commander 1000R", "Commander Max"],
  "Honda UTV": ["Pioneer 1000", "Pioneer 700", "Pioneer 520", "Talon 1000R", "Talon 1000X"],
  "Yamaha UTV": ["YXZ1000R", "YXZ1000R SS", "Wolverine RMAX 1000", "Wolverine RMAX 700", "Wolverine X2 850", "Viking", "Viking VI"],
  "Kawasaki UTV": ["Teryx KRX 1000", "Teryx KRX4 1000", "Teryx S", "Teryx4", "Mule Pro-FXT", "Mule Pro-MX", "Mule SX"],
  "John Deere UTV": ["Gator XUV835M", "Gator XUV865M", "Gator XUV835R", "Gator XUV590M", "Gator HPX615E"],
  "CFMOTO UTV": ["ZForce 950", "ZForce 800", "UForce 1000", "UForce 600"],
  "Textron": ["Wildcat XX", "Prowler Pro", "Prowler 500"],
};

// ── SNOWMOBILES ──────────────────────────────────────────────

const SNOWMOBILE_MODELS = {
  "Ski-Doo": ["Renegade Adrenaline 900", "Renegade Adrenaline 850", "Summit Edge 850", "Summit Edge 165", "MXZ Blizzard 850", "MXZ TNT 600R", "Expedition LE 900", "Grand Touring Limited", "Backcountry X-RS", "Freeride 165"],
  "Polaris": ["Indy VR1 850", "Indy XC 850", "RMK Khaos 850", "RMK Khaos Slash", "Switchback Assault 850", "Voyageur 155", "Pro-RMK Slash", "Matryx 850", "Titan Adventure"],
  "Arctic Cat": ["ZR 6000", "ZR 8000", "ZR 9000", "M 8000 Hardcore", "M 8000 Mountain Cat", "Riot 8000", "Blast ZR 4000", "Norseman X 8000"],
  "Yamaha Snow": ["Sidewinder SRX", "Sidewinder X-TX", "Transporter Lite", "Mountain Max LE", "SXVenom", "VK540", "SRViper L-TX"],
};

// ═══════════════════════════════════════════════════════════════
// BUILD THE FULL LIST
// ═══════════════════════════════════════════════════════════════

const ALL_VEHICLES = [];

function addVehicles(models, category, fuel, trackingMode, years, mileageFn, hoursFn) {
  for (const [rawMake, modelList] of Object.entries(models)) {
    const make = rawMake.replace(/ ATV$| PWC$| Power$| Trucks$| Forklift$| Construction$| Equipment$| Moto$| Boats$| UTV$| Snow$| Marine$/, "").replace(/ Stratton$/, " & Stratton");
    for (const model of modelList) {
      for (const year of years) {
        ALL_VEHICLES.push({ year, make, model, vehicle_type: fuel, vehicle_category: category, tracking_mode: trackingMode, current_mileage: mileageFn(year), current_hours: hoursFn(year) });
      }
    }
  }
}

// Cars — gas (2000-2025)
const nonEV = Object.fromEntries(Object.entries(CAR_MODELS).filter(([m]) => !["Tesla", "Rivian", "Lucid"].includes(m)));
addVehicles(nonEV, "car", "gas", "mileage", Y00_25, y => y >= 2023 ? 8000 : y >= 2018 ? 35000 : y >= 2010 ? 80000 : 130000, () => 0);

// EVs (2012-2025 for Tesla, 2020+ for others)
addVehicles({ "Tesla": CAR_MODELS["Tesla"] }, "car", "ev", "mileage", Array.from({ length: 14 }, (_, i) => 2012 + i), y => y >= 2023 ? 8000 : 30000, () => 0);
addVehicles({ "Rivian": CAR_MODELS["Rivian"], "Lucid": CAR_MODELS["Lucid"] }, "car", "ev", "mileage", Y18_25, y => y >= 2023 ? 8000 : 20000, () => 0);

// Diesel trucks (2005-2025)
const dieselModels = {};
for (const [make, models] of Object.entries(CAR_MODELS)) {
  const diesel = models.filter(m => /super duty|2500|3500|hd|duramax/i.test(m));
  if (diesel.length) dieselModels[make] = diesel;
}
addVehicles(dieselModels, "car", "diesel", "mileage", Y05_25, y => y >= 2023 ? 15000 : y >= 2015 ? 60000 : 120000, () => 0);

// Hybrids (2015-2025)
const HYBRID_MODELS = {
  "Toyota": ["Camry", "RAV4", "Highlander", "Corolla", "Prius", "Venza", "Sienna", "4Runner"],
  "Honda": ["CR-V", "Accord", "Civic", "HR-V"],
  "Hyundai": ["Tucson", "Santa Fe", "Ioniq 5", "Ioniq 6", "Elantra"],
  "Kia": ["Sportage", "Sorento", "EV6", "Niro"],
  "Ford": ["Escape", "Maverick", "Explorer", "F-150"],
  "Lexus": ["RX", "NX", "ES", "UX"],
  "Subaru": ["Crosstrek", "Forester", "Outback"],
};
addVehicles(HYBRID_MODELS, "car", "hybrid", "mileage", Y15_25, y => y >= 2023 ? 8000 : 30000, () => 0);

// Motorcycles (1998-2025)
addVehicles(MOTORCYCLE_MODELS, "motorcycle", "gas", "mileage", Y98_25, y => y >= 2022 ? 3000 : y >= 2015 ? 12000 : y >= 2008 ? 25000 : 40000, () => 0);

// Boats (2010-2025)
addVehicles(BOAT_MODELS, "boat", "gas", "hours", Y10_25, () => 0, y => y >= 2022 ? 50 : y >= 2017 ? 150 : 350);

// Equipment (2015-2025)
addVehicles(EQUIPMENT_MODELS, "lawnmower", "gas", "hours", Y15_25, () => 0, y => y >= 2022 ? 100 : 400);

// Semi trucks (2010-2025)
addVehicles(SEMI_MODELS, "semi_truck", "diesel", "mileage", Y10_25, y => y >= 2022 ? 50000 : y >= 2017 ? 200000 : 500000, () => 0);

// RVs (2010-2025)
addVehicles(RV_MODELS, "rv", "gas", "mileage", Y10_25, y => y >= 2022 ? 5000 : y >= 2017 ? 25000 : 50000, () => 0);

// ATVs (2010-2025)
addVehicles(ATV_MODELS, "atv", "gas", "hours", Y10_25, () => 0, y => y >= 2022 ? 50 : 200);

// UTVs (2015-2025)
addVehicles(UTV_MODELS, "utv", "gas", "hours", Y15_25, () => 0, y => y >= 2022 ? 80 : 300);

// Snowmobiles (2010-2025)
addVehicles(SNOWMOBILE_MODELS, "snowmobile", "gas", "mileage", Y10_25, y => y >= 2022 ? 500 : y >= 2017 ? 2000 : 5000, () => 0);

// ═══════════════════════════════════════════════════════════════
// PROPERTIES
// ═══════════════════════════════════════════════════════════════

const PROPERTY_TYPES = ["house", "condo", "townhouse", "apartment"];
const PROPERTY_DECADES = [1940, 1950, 1955, 1960, 1965, 1970, 1975, 1980, 1985, 1990, 1995, 2000, 2003, 2005, 2008, 2010, 2012, 2015, 2018, 2020, 2022, 2024];
const PROPERTY_SQFT = [600, 800, 1000, 1200, 1400, 1600, 1800, 2000, 2400, 2800, 3200, 3800, 4500, 5500];

const ALL_PROPERTIES = [];
for (const ptype of PROPERTY_TYPES) {
  for (const year of PROPERTY_DECADES) {
    for (const sqft of PROPERTY_SQFT) {
      ALL_PROPERTIES.push({ property_type: ptype, year_built: year, square_footage: sqft, zip_code: "60601" });
    }
  }
}

// ═══════════════════════════════════════════════════════════════
// RUNNER
// ═══════════════════════════════════════════════════════════════

const BATCH_SIZE = 3;
const DELAY_MS = 1500;
const PROGRESS_FILE = "scripts/.preload-progress.json";

function loadProgress() {
  try { if (existsSync(PROGRESS_FILE)) return JSON.parse(readFileSync(PROGRESS_FILE, "utf8")); } catch {}
  return { vehicleIndex: 0, propertyIndex: 0, stats: { vGen: 0, vCached: 0, vErr: 0, pGen: 0, pCached: 0, pErr: 0 } };
}
function saveProgress(p) { try { writeFileSync(PROGRESS_FILE, JSON.stringify(p)); } catch {} }
async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function preloadVehicle(v) {
  const cacheKey = `${v.year}|${v.make}|${v.model}|${v.vehicle_category}|${v.vehicle_type}|${v.tracking_mode}`.toLowerCase().trim();
  try {
    const { data: existing } = await supabase.from("ai_schedule_cache").select("cache_key").eq("cache_key", cacheKey).maybeSingle();
    if (existing) return { status: "cached", key: cacheKey };
    const invokeOpts = {
      body: {
        vehicle_id: "preload-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        make: v.make, model: v.model, year: v.year,
        current_mileage: v.current_mileage, current_hours: v.current_hours,
        tracking_mode: v.tracking_mode, vehicle_type: v.vehicle_type,
        vehicle_category: v.vehicle_category, is_awd: false,
      },
    };
    if (PRELOAD_USER_JWT) invokeOpts.headers = { Authorization: `Bearer ${PRELOAD_USER_JWT}` };
    const { error } = await supabase.functions.invoke("generate-maintenance-schedule", invokeOpts);
    if (error) return { status: "error", key: cacheKey, error: error.message };
    return { status: "generated", key: cacheKey };
  } catch (e) { return { status: "error", key: cacheKey, error: String(e) }; }
}

async function preloadProperty(p) {
  const zone = getClimateZone(p.zip_code).zone;
  const cacheKey = `prop|${p.property_type}|${p.year_built}|${p.square_footage}|${zone}`.toLowerCase();
  try {
    const { data: existing } = await supabase.from("ai_schedule_cache").select("cache_key").eq("cache_key", cacheKey).maybeSingle();
    if (existing) return { status: "cached", key: cacheKey };
    const invokeOpts = {
      body: {
        property_id: "preload-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8),
        property_type: p.property_type, year_built: p.year_built,
        square_footage: p.square_footage, zip_code: p.zip_code,
      },
    };
    if (PRELOAD_USER_JWT) invokeOpts.headers = { Authorization: `Bearer ${PRELOAD_USER_JWT}` };
    const { error } = await supabase.functions.invoke("generate-property-schedule", invokeOpts);
    if (error) return { status: "error", key: cacheKey, error: error.message };
    return { status: "generated", key: cacheKey };
  } catch (e) { return { status: "error", key: cacheKey, error: String(e) }; }
}

async function run() {
  console.log("═══════════════════════════════════════════════════════");
  console.log("LifeMaintained — Pre-load Schedules & Estimates");
  console.log("═══════════════════════════════════════════════════════");
  if (!PRELOAD_USER_JWT) {
    console.warn("⚠️  PRELOAD_USER_JWT is not set — function invokes will return 401 until you add a user JWT to .env\n");
  }
  console.log(`Vehicles: ${ALL_VEHICLES.length}`);
  console.log(`Properties: ${ALL_PROPERTIES.length}`);
  console.log(`Total: ${ALL_VEHICLES.length + ALL_PROPERTIES.length}`);
  console.log(`Batch: ${BATCH_SIZE} concurrent, ${DELAY_MS}ms delay`);
  console.log("");

  const progress = loadProgress();
  let { vehicleIndex, propertyIndex, stats } = progress;
  if (vehicleIndex > 0 || propertyIndex > 0) {
    console.log(`Resuming: vehicle ${vehicleIndex}, property ${propertyIndex}`);
    console.log(`Previous: ${JSON.stringify(stats)}\n`);
  }

  console.log("── Vehicles ──────────────────────────────────────────");
  const t0 = Date.now();
  for (let i = vehicleIndex; i < ALL_VEHICLES.length; i += BATCH_SIZE) {
    const batch = ALL_VEHICLES.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(v => preloadVehicle(v)));
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value.status === "generated") stats.vGen++;
        else if (r.value.status === "cached") stats.vCached++;
        else { stats.vErr++; if (stats.vErr <= 30) console.log(`\n  ❌ ${r.value.key}: ${r.value.error}`); }
      } else stats.vErr++;
    }
    vehicleIndex = Math.min(i + BATCH_SIZE, ALL_VEHICLES.length);
    const elapsed = ((Date.now() - t0) / 60000).toFixed(1);
    const rate = stats.vGen > 0 ? ((Date.now() - t0) / stats.vGen / 1000).toFixed(1) : "?";
    const left = stats.vGen > 0 ? ((ALL_VEHICLES.length - vehicleIndex) * (Date.now() - t0) / (vehicleIndex - (progress.vehicleIndex || 0)) / 60000).toFixed(0) : "?";
    process.stdout.write(`\r  ${vehicleIndex}/${ALL_VEHICLES.length} | +${stats.vGen} cached:${stats.vCached} err:${stats.vErr} | ${elapsed}min ~${left}min left`);
    saveProgress({ vehicleIndex, propertyIndex, stats });
    if (i + BATCH_SIZE < ALL_VEHICLES.length) await sleep(DELAY_MS);
  }
  console.log("\n");

  console.log("── Properties ────────────────────────────────────────");
  const t1 = Date.now();
  for (let i = propertyIndex; i < ALL_PROPERTIES.length; i += BATCH_SIZE) {
    const batch = ALL_PROPERTIES.slice(i, i + BATCH_SIZE);
    const results = await Promise.allSettled(batch.map(p => preloadProperty(p)));
    for (const r of results) {
      if (r.status === "fulfilled") {
        if (r.value.status === "generated") stats.pGen++;
        else if (r.value.status === "cached") stats.pCached++;
        else { stats.pErr++; if (stats.pErr <= 30) console.log(`\n  ❌ ${r.value.key}: ${r.value.error}`); }
      } else stats.pErr++;
    }
    propertyIndex = Math.min(i + BATCH_SIZE, ALL_PROPERTIES.length);
    const elapsed = ((Date.now() - t1) / 60000).toFixed(1);
    process.stdout.write(`\r  ${propertyIndex}/${ALL_PROPERTIES.length} | +${stats.pGen} cached:${stats.pCached} err:${stats.pErr} | ${elapsed}min`);
    saveProgress({ vehicleIndex, propertyIndex, stats });
    if (i + BATCH_SIZE < ALL_PROPERTIES.length) await sleep(DELAY_MS);
  }
  console.log("\n");

  console.log("═══════════════════════════════════════════════════════");
  console.log("DONE");
  console.log(`Vehicles: ${stats.vGen} generated, ${stats.vCached} cached, ${stats.vErr} errors`);
  console.log(`Properties: ${stats.pGen} generated, ${stats.pCached} cached, ${stats.pErr} errors`);
  console.log(`Total new: ${stats.vGen + stats.pGen}`);
  console.log("═══════════════════════════════════════════════════════");
}

run().catch(e => { console.error("Fatal:", e); process.exit(1); });
