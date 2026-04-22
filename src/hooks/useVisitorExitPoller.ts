import { useEffect, useRef } from 'react';
import { db } from '../firebase';
import {
  collection, query, where, onSnapshot, doc, updateDoc, Timestamp,
} from 'firebase/firestore';
import DahuaService from '../services/DahuaService';
import { sendNotification } from '../lib/utils';

interface ActiveVisitor {
  id: string;
  condoId: string;
  userId: string;
  visitorName: string;
  dahuaVisitorId: string;
}

const POLL_INTERVAL_MS = 30_000;

/**
 * Polls Dahua DSS every 30 s for visitors currently in "entered" state.
 * When DSS reports status = 4 (visitor left), the Firestore document is
 * updated to "exited" and an in-app notification is sent to the resident.
 *
 * Only active for residents (condoId required). No-op on web (Capacitor
 * native only isn't enforced here — works on web too for consistency).
 */
export function useVisitorExitPoller(
  userId: string | undefined,
  condoId: string | undefined,
  isResident: boolean,
) {
  const visitorsRef = useRef<ActiveVisitor[]>([]);
  const notifiedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!userId || !condoId || !isResident) return;

    const q = query(
      collection(db, `condos/${condoId}/visitors`),
      where('userId', '==', userId),
      where('status', '==', 'entered'),
    );

    const unsub = onSnapshot(q, (snap) => {
      visitorsRef.current = snap.docs
        .map(d => ({ id: d.id, ...d.data() } as any))
        .filter((v): v is ActiveVisitor => !!v.dahuaVisitorId);
    }, () => { /* ignore listener errors */ });

    const poll = async () => {
      for (const v of visitorsRef.current) {
        if (notifiedRef.current.has(v.id)) continue;
        try {
          const detail = await DahuaService.getVisitor(v.dahuaVisitorId);
          const dssStatus = Number(detail?.status ?? detail?.data?.status ?? -1);
          if (dssStatus === 4) {
            notifiedRef.current.add(v.id);
            await updateDoc(doc(db, `condos/${v.condoId}/visitors`, v.id), {
              status: 'exited',
              updatedAt: Timestamp.now(),
            });
            await sendNotification(
              v.userId,
              'Su visita se ha ido',
              `${v.visitorName} se ha retirado del condominio.`,
              'visitor',
              '/visitors',
            );
          }
        } catch (err) {
          console.warn('[VisitorExitPoller] error checking visitor:', (err as Error).message);
        }
      }
    };

    // Initial check + recurring poll
    poll();
    const timer = setInterval(poll, POLL_INTERVAL_MS);

    return () => {
      unsub();
      clearInterval(timer);
    };
  }, [userId, condoId, isResident]);
}
