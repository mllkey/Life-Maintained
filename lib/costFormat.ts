function roundToNearest5(n: number): number {
  return Math.round(n / 5) * 5;
}

export function formatCostDisplay(low: number | null, high: number | null): string {
  if (low == null && high == null) return "";
  const lo = low ?? 0;
  const hi = high ?? 0;
  if (lo === 0 && hi === 0) return "";
  const [a, b] = lo > hi ? [hi, lo] : [lo, hi];
  if (a === b) return `$${a}`;
  return `~$${roundToNearest5(Math.round((a + b) / 2))}`;
}

export function formatShopAndDiy(
  shopLow: number | null,
  shopHigh: number | null,
  diyLow: number | null,
  diyHigh: number | null,
): string | null {
  const shop = formatCostDisplay(shopLow, shopHigh);
  const diy = formatCostDisplay(diyLow, diyHigh);
  if (!shop && !diy) return null;
  if (shop && !diy) return `${shop} shop`;
  if (!shop && diy) return `${diy} DIY`;
  return `${shop} shop · ${diy} DIY`;
}
