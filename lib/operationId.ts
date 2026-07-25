/**
 * RFC-4122 v4 identifiers for the idempotency key of complete_vehicle_task v6.
 *
 * The server key is (task_id, operation_id). A stable id per ITEM - not per
 * save - is what makes an automatic retry, a picker Retry, and a post-crash
 * resume replay-safe instead of double-advancing a task.
 *
 * Availability ladder: crypto.randomUUID, then getRandomValues, then
 * Math.random. Cryptographic unpredictability is not required here - the value
 * is scoped to one user and consumed within seconds - but collision avoidance
 * and correct version/variant bits are.
 */
const HEX: string[] = [];
for (let i = 0; i < 256; i++) HEX.push((i + 0x100).toString(16).slice(1));

function formatV4(b: Uint8Array): string {
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  return (
    HEX[b[0]] + HEX[b[1]] + HEX[b[2]] + HEX[b[3]] + "-" +
    HEX[b[4]] + HEX[b[5]] + "-" +
    HEX[b[6]] + HEX[b[7]] + "-" +
    HEX[b[8]] + HEX[b[9]] + "-" +
    HEX[b[10]] + HEX[b[11]] + HEX[b[12]] + HEX[b[13]] + HEX[b[14]] + HEX[b[15]]
  );
}

export function newOperationId(): string {
  const c: any = (globalThis as any).crypto;
  if (c && typeof c.randomUUID === "function") {
    try { return c.randomUUID(); } catch { /* fall through */ }
  }
  const bytes = new Uint8Array(16);
  if (c && typeof c.getRandomValues === "function") {
    try { c.getRandomValues(bytes); return formatV4(bytes); } catch { /* fall through */ }
  }
  for (let i = 0; i < 16; i++) bytes[i] = Math.floor(Math.random() * 256);
  return formatV4(bytes);
}

const V4_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function isOperationId(v: unknown): v is string {
  return typeof v === "string" && V4_RE.test(v);
}
