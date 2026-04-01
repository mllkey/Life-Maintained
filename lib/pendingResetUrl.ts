let _url: string | null = null;

export function setPendingResetUrl(url: string) {
  _url = url;
}

export function getPendingResetUrl(): string | null {
  return _url;
}

export function clearPendingResetUrl() {
  _url = null;
}
