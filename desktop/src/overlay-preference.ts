/** Older versions enabled the overlay automatically; only a new explicit opt-in enables it. */
export function overlayPreference(saved: unknown): boolean {
  if (!saved || typeof saved !== 'object') return false;
  const value = saved as Record<string, unknown>;
  return value.overlayPreferenceVersion === 1 && value.overlay === true;
}
