import React, { useState, useEffect, createContext, useContext } from 'react';
import { auth, db } from '../firebase';
import { onAuthStateChanged, User as FirebaseUser, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, query, collection, where, getDocs, updateDoc, deleteDoc, Timestamp } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: 'super_admin' | 'condo_admin' | 'administrador' | 'operator' | 'technician' | 'resident' | 'usuario';
  condoId?: string;
  condoIds?: string[];
  condoName?: string;
  condoScope?: 'single' | 'multiple' | 'all';
  buildingId?: string;
  unitId?: string;
  /** Unidad específica a la que queda acotado un condo_admin (vacío = todo el condominio). */
  unit?: string;
  canGenerateQR?: boolean;
  hasFacilityAccess?: boolean;
  status?: string;
}

interface AuthContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  isAuthReady: boolean;
  error: string | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  isAuthReady: false,
  error: null,
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Fallback: if Firebase auth doesn't respond in 8 s (e.g. no network),
    // stop the loading spinner so the login screen is reachable.
    const timeout = setTimeout(() => {
      setLoading(false);
      setIsAuthReady(true);
    }, 8000);

    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      clearTimeout(timeout);
      setLoading(true);
      if (firebaseUser) {
        try {
          const docRef = doc(db, 'users', firebaseUser.uid);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            const existingProfile = docSnap.data() as UserProfile;
            
            // MASTER RULE: Whitelist for SuperAdmins via email to prevent accidental lockout
            const isMasterEmail = firebaseUser.email === 'contacto@porteriavirtual.cl' || 
                               firebaseUser.email === 'cristianmedinaflores@gmail.com' ||
                               firebaseUser.email === 'contacto@maipobodegas.cl';

            if (isMasterEmail && (existingProfile.role !== 'super_admin' || !existingProfile.canGenerateQR)) {
              const updatedProfile: UserProfile = { 
                ...existingProfile, 
                role: 'super_admin' as const,
                canGenerateQR: true,
                hasFacilityAccess: true,
                condoScope: 'all' as const
              };
              await updateDoc(docRef, { 
                role: 'super_admin', 
                name: existingProfile.name === 'Hector Quiroz' || existingProfile.name === 'Super Admin' ? 'Cristian' : existingProfile.name,
                canGenerateQR: true,
                hasFacilityAccess: true,
                condoScope: 'all',
                updatedAt: Timestamp.now()
              });
              setProfile(updatedProfile);
            } else {
              setProfile(existingProfile);
            }
            setUser(firebaseUser);
            setError(null);
          } else {
            // Profile not found by UID, check by Email (pre-registration linking)
            const q = query(collection(db, 'users'), where('email', '==', firebaseUser.email));
            const querySnapshot = await getDocs(q);
            
            if (!querySnapshot.empty) {
              const userDoc = querySnapshot.docs[0];
              const registeredProfile = userDoc.data() as UserProfile;
              const mergedProfile = { ...registeredProfile, uid: firebaseUser.uid };

              // Migrate doc to uid-based ID so getProfile() works in Firestore rules.
              // Create at users/{uid}, then delete the old mismatched doc.
              if (userDoc.id !== firebaseUser.uid) {
                await setDoc(doc(db, 'users', firebaseUser.uid), {
                  ...mergedProfile,
                  updatedAt: Timestamp.now(),
                });
                await deleteDoc(doc(db, 'users', userDoc.id)).catch(() => {});
              } else {
                await updateDoc(doc(db, 'users', userDoc.id), {
                  uid: firebaseUser.uid,
                  updatedAt: Timestamp.now(),
                });
              }

              setUser(firebaseUser);
              setProfile(mergedProfile);
              setError(null);
            } else if (firebaseUser.email === 'contacto@porteriavirtual.cl' || 
                       firebaseUser.email === 'contacto@maipobodegas.cl') {
              // Forced Initialization for SuperAdmin if somehow deleted or first login
              const newProfile: UserProfile = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || '',
                name: 'Cristian',
                role: 'super_admin',
                canGenerateQR: true,
                hasFacilityAccess: true,
                condoScope: 'all'
              };
              await setDoc(doc(db, 'users', firebaseUser.uid), {
                ...newProfile,
                createdAt: Timestamp.now()
              });
              setUser(firebaseUser);
              setProfile(newProfile);
              setError(null);
            } else {
              setError('Your account is not registered in this system. / Tu cuenta no está registrada. Contact your building administrator to request access.');
              await signOut(auth);
              setProfile(null);
              setUser(null);
            }
          }
        } catch (err) {
          console.error("Auth System Error:", err);
          try { handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`); } catch {}
        } finally {
          setLoading(false);
          setIsAuthReady(true);
        }
      } else {
        setUser(null);
        setProfile(null);
        setLoading(false);
        setIsAuthReady(true);
      }
    });

    return () => { unsubscribe(); clearTimeout(timeout); };
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAuthReady, error }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
