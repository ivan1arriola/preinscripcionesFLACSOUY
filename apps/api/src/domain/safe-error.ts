export function sanitizeSafeError(err: unknown, fallback: string): string {
  if (err instanceof Error && err.message) {
    const clean = err.message.replace(/[\r\n\t]+/g, ' ').trim();
    if (clean.length > 0 && clean.length <= 250) {
      return clean;
    }
    if (clean.length > 250) {
      return clean.slice(0, 247) + '...';
    }
  }
  return fallback;
}
