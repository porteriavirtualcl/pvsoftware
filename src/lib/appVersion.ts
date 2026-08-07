// Single source of truth for the app version shown in the profile modal.
// Keep `version` aligned with package.json on every release.
export const APP_VERSION = '1.15.3';
export const APP_RELEASE_DATE = '08-07-2026';

// Compara dos versiones semánticas ("1.14.2"). Devuelve <0 si a<b, 0 si igual, >0 si a>b.
export function compareVersions(a: string, b: string): number {
  const pa = String(a).split('.').map(n => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map(n => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

// Una versión nativa (Android/iOS) está desactualizada si es menor a la última publicada.
// Los usuarios web siempre corren la última (se actualiza sola), así que no se marcan.
export function isAppOutdated(appVersion?: string, appPlatform?: string): boolean {
  if (!appVersion || !appPlatform) return false;
  if (appPlatform !== 'android' && appPlatform !== 'ios') return false;
  return compareVersions(appVersion, APP_VERSION) < 0;
}
