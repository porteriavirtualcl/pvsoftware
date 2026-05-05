import { useEffect } from 'react';
import { doc, updateDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';

const HEARTBEAT_MS = 2 * 60 * 1000; // 2 min

export function usePresence(uid: string | null | undefined) {
  useEffect(() => {
    if (!uid) return;

    const ref = doc(db, 'users', uid);

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
