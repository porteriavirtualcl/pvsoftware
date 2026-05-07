import { getToken } from 'firebase/messaging';
import { doc, updateDoc } from 'firebase/firestore';
import { messagingPromise, db } from '../firebase';
import { Capacitor } from '@capacitor/core';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';

const VAPID_KEY = import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined;

export type NotifPermissionState = NotificationPermission | 'unsupported';

/**
 * Returns the current notification permission state, cross-platform.
 */
export async function getNotifPermission(): Promise<NotifPermissionState> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { receive } = await FirebaseMessaging.checkPermissions();
      if (receive === 'granted') return 'granted';
      if (receive === 'denied') return 'denied';
      return 'default';
    } catch {
      return 'unsupported';
    }
  }
  if (typeof window !== 'undefined' && 'Notification' in window) {
    return Notification.permission;
  }
  return 'unsupported';
}

/**
 * Requests notification permission, obtains FCM token, and stores it in the
 * user's Firestore document so the server can send push notifications.
 */
export async function registerFcmToken(userId: string): Promise<void> {
  if (Capacitor.isNativePlatform()) {
    try {
      const { receive } = await FirebaseMessaging.requestPermissions();
      if (receive !== 'granted') return;
      const { token } = await FirebaseMessaging.getToken();
      if (token) {
        await updateDoc(doc(db, 'users', userId), { fcmToken: token });
      }
    } catch (err) {
      console.warn('[FCM] native token registration failed:', (err as Error).message);
    }
    return;
  }

  if (!VAPID_KEY) {
    console.warn('[FCM] VITE_FIREBASE_VAPID_KEY not set — skipping push registration');
    return;
  }
  const messaging = await messagingPromise;
  if (!messaging) return;

  try {
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') return;

    const token = await getToken(messaging, { vapidKey: VAPID_KEY });
    if (token) {
      await updateDoc(doc(db, 'users', userId), { fcmToken: token });
    }
  } catch (err) {
    console.warn('[FCM] token registration failed:', (err as Error).message);
  }
}

/**
 * Clears the stored FCM token on logout.
 */
export async function unregisterFcmToken(userId: string): Promise<void> {
  try {
    await updateDoc(doc(db, 'users', userId), { fcmToken: null });
  } catch {
    // ignore
  }
}
