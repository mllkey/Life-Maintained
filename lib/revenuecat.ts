let rcConfigureResolve: (() => void) | null = null;
export const rcReady = new Promise<void>((resolve) => { rcConfigureResolve = resolve; });
export function signalRcReady() { rcConfigureResolve?.(); }
