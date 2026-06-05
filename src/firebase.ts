import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, getDocFromServer, doc } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import { getMessaging, isSupported } from 'firebase/messaging';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig, { automaticDataCollectionEnabled: false });
export const auth = getAuth(app);
export const db = firebaseConfig.firestoreDatabaseId && firebaseConfig.firestoreDatabaseId !== '(default)'
  ? getFirestore(app, firebaseConfig.firestoreDatabaseId)
  : getFirestore(app);
export const storage = getStorage(app);

// FCM Messaging — only available in browser environments that support it
export const messagingPromise: Promise<ReturnType<typeof getMessaging> | null> =
  typeof window !== 'undefined'
    ? isSupported().then(ok => ok ? getMessaging(app) : null).catch(() => null)
    : Promise.resolve(null);

// Connection test
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error: any) {
    // Silent fail for connection test in production
    if (process.env.NODE_ENV !== 'production') {
      console.log("Firestore connection test result:", error.message);
    }
  }
}
if (typeof window !== 'undefined') {
  testConnection();
}
