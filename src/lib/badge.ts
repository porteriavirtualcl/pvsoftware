import { Capacitor } from '@capacitor/core';
import { Badge } from '@capawesome/capacitor-badge';

/**
 * Sets the app icon badge count.
 * - Native (Android/iOS via Capacitor): uses @capawesome/capacitor-badge
 * - PWA installed on Android/desktop: uses Web Badge API (navigator.setAppBadge)
 */
export async function setAppBadge(count: number): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      await Badge.set({ count });
    } catch (err) {
      console.warn('[Badge] native badge failed:', (err as Error).message);
    }
    return;
  }
  // Web Badge API — works on installed PWAs in Chrome/Edge on Android and desktop
  if ('setAppBadge' in navigator) {
    try {
      if (count > 0) {
        await (navigator as Navigator & { setAppBadge(n?: number): Promise<void> }).setAppBadge(count);
      } else {
        await (navigator as Navigator & { clearAppBadge(): Promise<void> }).clearAppBadge();
      }
    } catch (err) {
      console.warn('[Badge] web badge failed:', (err as Error).message);
    }
  }
}
