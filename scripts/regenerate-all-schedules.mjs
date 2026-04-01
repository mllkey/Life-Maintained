#!/usr/bin/env node
/**
 * Regenerates AI schedules and cost estimates for all vehicles.
 * Run: node scripts/regenerate-all-schedules.mjs
 */

const SERVICE_ROLE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZxYmxxcnJnanB3eXNyc2lvbGNuIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImlhdCI6MTc2NjgyNjc0MCwiZXhwIjoyMDgyNDAyNzQwfQ.vA1heK78xJZzMb2b9wcOocguJRe3vfj9vZR5beTUGOk";
const SUPABASE_URL = "https://fqblqrrgjpwysrsiolcn.supabase.co";
const SCHEDULE_URL = `${SUPABASE_URL}/functions/v1/generate-maintenance-schedule`;
const ESTIMATE_URL = `${SUPABASE_URL}/functions/v1/estimate-repair-cost`;

const AUTH = { "Authorization": `Bearer ${SERVICE_ROLE_KEY}`, "Content-Type": "application/json", "apikey": SERVICE_ROLE_KEY };

// Only the 4 vehicles that failed
const vehicles = [
  { id: "68d7b247-450b-4676-b49e-99ce1511dc4b", year: 2016, make: "Mazda",    model: "Mazda3",    vehicle_type: "car",        fuel_type: "gas", mileage: 80000  },
  { id: "79f8e06a-43ff-4bf4-a517-3a6f3ed508dd", year: 2007, make: "Ford",     model: "E-450",     vehicle_type: "car",        fuel_type: "gas", mileage: 155000 },
  { id: "20543e62-281c-4e16-ade8-b07f95641177", year: 2018, make: "Kawasaki", model: "Ninja 1000",vehicle_type: "motorcycle", fuel_type: "gas", mileage: 13200  },
  { id: "e5c262e8-53ca-4693-aaa6-0f4dc3fd62a7", year: 2019, make: "Kawasaki", model: "Z125 PRO",  vehicle_type: "motorcycle", fuel_type: "gas", mileage: 5000   },
];

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function getTasksForVehicle(vehicleId) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/user_vehicle_maintenance_tasks?vehicle_id=eq.${vehicleId}&select=name`,
    { headers: AUTH }
  );
  if (!res.ok) return [];
  return res.json();
}

async function getCacheCount(vehicleKey) {
  const res = await fetch(
    `${SUPABASE_URL}/rest/v1/repair_cost_cache?vehicle_key=eq.${encodeURIComponent(vehicleKey)}&select=service_name`,
    { headers: AUTH }
  );
  if (!res.ok) return 0;
  const rows = await res.json();
  return rows.length;
}

async function regenerateSchedule(v) {
  const body = {
    vehicle_id: v.id,
    year: v.year,
    make: v.make,
    model: v.model,
    vehicle_type: v.fuel_type,
    vehicle_category: v.vehicle_type,
    fuel_type: v.fuel_type,
    current_mileage: v.mileage ?? 0,
    current_hours: v.hours ?? null,
    force_refresh: true,
  };
  const res = await fetch(SCHEDULE_URL, { method: "POST", headers: AUTH, body: JSON.stringify(body) });
  const data = await res.json();
  return { ok: res.ok, status: res.status, data };
}

async function fallbackEstimates(v, taskNames) {
  const vehicleKey = `${v.year}|${v.make}|${v.model}|${v.vehicle_type}`.toLowerCase();
  let cached = 0, failed = 0;
  const BATCH = 3;
  for (let i = 0; i < taskNames.length; i += BATCH) {
    const batch = taskNames.slice(i, i + BATCH);
    await Promise.allSettled(batch.map(async (name) => {
      const body = { year: v.year, make: v.make, model: v.model, service_name: name.toLowerCase().trim(), vehicle_type: v.vehicle_type };
      const res = await fetch(ESTIMATE_URL, { method: "POST", headers: AUTH, body: JSON.stringify(body) });
      const d = await res.json();
      if (res.ok && d.data) cached++;
      else { failed++; console.log(`    ✗ estimate failed for "${name}": ${d.error ?? res.status} ${d.detail ?? ""}`); }
    }));
    if (i + BATCH < taskNames.length) await sleep(800);
  }
  return { cached, failed, vehicleKey };
}

async function main() {
  console.log(`\nRetrying ${vehicles.length} failed vehicles...\n${"─".repeat(60)}`);
  let totalTasks = 0, totalEstimates = 0, successCount = 0, failCount = 0;

  for (const v of vehicles) {
    const label = `${v.year} ${v.make} ${v.model} (${v.id.slice(0,8)})`;
    process.stdout.write(`${label} ... `);

    // Retry up to 2 times
    let result;
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (attempt > 1) { await sleep(3000); process.stdout.write(`retry ${attempt}... `); }
      result = await regenerateSchedule(v);
      if (result.ok) break;
    }

    const { ok, status, data } = result;

    if (!ok) {
      console.log(`FAILED (${status}) — ${data.error ?? ""} ${data.detail ?? ""}`);
      failCount++;
      await sleep(2000);
      continue;
    }

    const taskCount = data.tasks_created ?? 0;
    const estCount = data.estimates_cached ?? 0;
    const source = data.source ?? "?";
    totalTasks += taskCount;
    totalEstimates += estCount;

    const vehicleKey = `${v.year}|${v.make}|${v.model}|${v.vehicle_type}`.toLowerCase();
    const cacheCount = await getCacheCount(vehicleKey);

    if (cacheCount === 0 && taskCount > 0) {
      console.log(`tasks=${taskCount} src=${source} — running fallback estimates...`);
      const tasks = await getTasksForVehicle(v.id);
      const taskNames = tasks.map(t => t.name);
      const fb = await fallbackEstimates(v, taskNames);
      totalEstimates += fb.cached;
      console.log(`    → ${fb.cached} estimates cached, ${fb.failed} failed`);
    } else {
      console.log(`tasks=${taskCount} src=${source} estimates=${estCount} cache_rows=${cacheCount}`);
    }

    successCount++;
    await sleep(2000);
  }

  console.log(`\n${"─".repeat(60)}`);
  console.log(`Done. ${successCount} succeeded, ${failCount} failed.`);
  console.log(`Tasks generated: ${totalTasks} | Estimates cached: ${totalEstimates}`);
}

main().catch(console.error);
