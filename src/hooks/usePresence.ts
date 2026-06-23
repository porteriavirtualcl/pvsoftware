import { useEffect } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { Capacitor } from '@capacitor/core';
import { App as CapApp } from '@capacitor/app';
import { db } from '../firebase';
import { APP_VERSION } from '../lib/appVersion';

const HEARTBEAT_MS = 2 * 60 * 1000; // 2 min

export function usePresence(uid: string | null | undefined) {
  useEffect(() => {
    if (!uid) return;

    const ref = doc(db, 'users', uid);

    // Reportar versión y plataforma de la app una vez por sesión, para verlo en
    // la ficha del usuario y detectar quién no actualizó (Android/iOS).
    (async () => {
      let appVersion = APP_VERSION;
      if (Capacitor.isNativePlatform()) {
        try { appVersion = (await CapApp.getInfo()).version; } catch { /* usa APP_VERSION */ }
      }
      updateDoc(ref, { appVersion, appPlatform: Capacitor.getPlatform() }).catch(() => {});
    })();

    const setOnline = () =>
      updateDoc(ref, { isOnline: true, lastSeen: serverTimestamp() }).catch(() => {});

    const setOffline = () =>
      updateDoc(ref, { isOnline: false, lastSeen: serverTimestamp() }).catch(() => {});

    setOnline();

    const heartbeat = setInterval(
      () => updateDoc(ref, { lastSeen: serverTimestamp() }).catch(() => {}),
      HEARTBEAT_MS,
    );

    const onVisibility = () => {
      if (document.visibilityState === 'hidden') setOffline();
      else setOnline();
    };

    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('beforeunload', setOffline);

    return () => {
      clearInterval(heartbeat);
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('beforeunload', setOffline);
      setOffline();
    };
  }, [uid]);
}

/** Returns true if a user doc with isOnline+lastSeen fields is considered online. */
export function isOnlineNow(user: { isOnline?: boolean; lastSeen?: { toMillis(): number } | null }): boolean {
  if (!user.isOnline) return false;
  if (!user.lastSeen?.toMillis) return false;
  return Date.now() - user.lastSeen.toMillis() < 5 * 60 * 1000;
}
