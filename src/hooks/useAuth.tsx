import React, { useState, useEffect, createContext, useContext } from 'react';
import { auth, db } from '../firebase';
import { onAuthStateChanged, User as FirebaseUser, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, query, where, getDocs, collection, updateDoc, Timestamp } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/utils';

interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: 'super_admin' | 'condo_admin' | 'operator' | 'technician' | 'resident' | 'usuario';
  condoId?: string;
  condoIds?: string[];
  condoName?: string;
  condoScope?: 'single' | 'multiple' | 'all';
  buildingId?: string;
  unitId?: string;
  canGenerateQR?: boolean;
  hasFacilityAccess?: boolean;
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
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const uidDocRef = doc(db, 'users', firebaseUser.uid);
          let uidDocSnap = await getDoc(uidDocRef);
          
          if (uidDocSnap.exists()) {
            const existingProfile = uidDocSnap.data() as UserProfile;
            
            // Force super_admin role if email matches the master admin emails
            const isAdminEmail = firebaseUser.email === 'cristianmedinaflores@gmail.com' || firebaseUser.email === 'contacto@porteriavirtual.cl';
            
            if (isAdminEmail && (existingProfile.role !== 'super_admin' || !existingProfile.canGenerateQR)) {
              const updatedProfile = { 
                ...existingProfile, 
                role: 'super_admin' as const,
                canGenerateQR: true,
                hasFacilityAccess: true 
              };
              await setDoc(uidDocRef, updatedProfile);
              setProfile(updatedProfile);
            } else {
              setProfile(existingProfile);
            }
            setError(null);
          } else if (firebaseUser.email) {
            // Search by email query for pre-registered users (Residents/Operators etc.)
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', firebaseUser.email.toLowerCase().trim()));
            const querySnap = await getDocs(q);
            
            if (!querySnap.empty) {
              const userDoc = querySnap.docs[0];
              const preRegisteredData = userDoc.data();
              const newProfile: UserProfile = {
                ...preRegisteredData,
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                name: preRegisteredData.name || firebaseUser.displayName || 'Usuario',
                role: preRegisteredData.role || 'resident'
              } as UserProfile;
              
              // 1. If the old doc was using email or other as ID, link it to the UID
              await updateDoc(doc(db, 'users', userDoc.id), {
                uid: firebaseUser.uid,
                updatedAt: Timestamp.now()
              });
              
              // 2. Also ensure we have a UID-indexed doc if it wasn't the same
              if (userDoc.id !== firebaseUser.uid) {
                await setDoc(uidDocRef, newProfile);
              }
              
              setProfile(newProfile);
              setError(null);
            } else if (firebaseUser.email === 'cristianmedinaflores@gmail.com' || firebaseUser.email === 'contacto@porteriavirtual.cl') {
              // Create default super admin if absolutely no record exists
              const newProfile: UserProfile = {
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                name: firebaseUser.displayName || 'Admin',
                role: 'super_admin',
                canGenerateQR: true,
                hasFacilityAccess: true,
              };
              await setDoc(uidDocRef, newProfile);
              setProfile(newProfile);
              setError(null);
            } else {
              // Deny access - Email not registered
              setError('Tu correo no está registrado en el sistema. Contacta a tu administración.');
              await signOut(auth);
              setProfile(null);
              setUser(null);
            }
          }
        } catch (err: any) {
          console.error('Auth Error:', err);
          handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
          setError('Error al conectar con la base de datos de usuarios.');
        }
      } else {
        setProfile(null);
        setError(null);
      }
      setLoading(false);
      setIsAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAuthReady, error }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
