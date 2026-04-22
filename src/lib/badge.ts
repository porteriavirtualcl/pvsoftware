import { Capacitor } from '@capacitor/core';
import { Badge } from '@capawesome/capacitor-badge';

/**
 * Sets the app icon badge count (Android/iOS).
 * No-ops silently on web.
 */
export async function setAppBadge(count: number): Promise<void> {
  if (!Capacitor.isNativePlatform()) return;
  try {
    await Badge.set({ count });
  } catch (err) {
    console.warn('[Badge] setAppBadge failed:', (err as Error).message);
  }
}
