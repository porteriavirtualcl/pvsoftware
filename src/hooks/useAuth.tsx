import React, { useState, useEffect, createContext, useContext } from 'react';
import { auth, db } from '../firebase';
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc, query, where, getDocs, collection, deleteDoc, updateDoc } from 'firebase/firestore';

interface UserProfile {
  uid: string;
  email: string;
  name: string;
  role: 'super_admin' | 'condo_admin' | 'operator' | 'technician' | 'resident';
  condoId?: string;
  condoIds?: string[];
  condoName?: string;
  condoScope?: 'single' | 'multiple' | 'all';
  buildingId?: string;
  unitId?: string;
}

interface AuthContextType {
  user: FirebaseUser | null;
  profile: UserProfile | null;
  loading: boolean;
  isAuthReady: boolean;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  profile: null,
  loading: true,
  isAuthReady: false,
});

export const AuthProvider = ({ children }: { children: React.ReactNode }) => {
  const [user, setUser] = useState<FirebaseUser | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [isAuthReady, setIsAuthReady] = useState(false);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      setUser(firebaseUser);
      if (firebaseUser) {
        try {
          const uidDocRef = doc(db, 'users', firebaseUser.uid);
          let uidDocSnap = await getDoc(uidDocRef);
          
          if (uidDocSnap.exists()) {
            const existingProfile = uidDocSnap.data() as UserProfile;
            // Force super_admin role if email matches the master admin email
            if (firebaseUser.email === 'cristianmedinaflores@gmail.com' && existingProfile.role !== 'super_admin') {
              const updatedProfile = { ...existingProfile, role: 'super_admin' as const };
              await setDoc(uidDocRef, updatedProfile);
              setProfile(updatedProfile);
            } else {
              setProfile(existingProfile);
            }
          } else if (firebaseUser.email) {
            // Search by email query
            const usersRef = collection(db, 'users');
            const q = query(usersRef, where('email', '==', firebaseUser.email.toLowerCase().trim()));
            const querySnap = await getDocs(q);
            
            if (!querySnap.empty) {
              const oldDoc = querySnap.docs[0];
              const preRegisteredData = oldDoc.data();
              const newProfile: UserProfile = {
                ...preRegisteredData,
                uid: firebaseUser.uid,
                email: firebaseUser.email,
                name: preRegisteredData.name || firebaseUser.displayName || 'Residente',
                role: preRegisteredData.role || 'resident'
              } as UserProfile;
              
              await setDoc(uidDocRef, newProfile);
              setProfile(newProfile);

              // Cleanup if needed
              if (oldDoc.id !== firebaseUser.uid) {
                await updateDoc(oldDoc.ref, { uid: firebaseUser.uid });
              }
              console.log('Profile linked successfully.');
            } else {
              const isDefaultAdmin = firebaseUser.email === 'cristianmedinaflores@gmail.com';
              const newProfile: UserProfile = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || '',
                name: firebaseUser.displayName || '',
                role: isDefaultAdmin ? 'super_admin' : 'resident',
              };
              
              await setDoc(uidDocRef, newProfile);
              setProfile(newProfile);
            }
          }
        } catch (error: any) {
          console.error('Auth Error:', error);
        }
      } else {
        setProfile(null);
      }
      setLoading(false);
      setIsAuthReady(true);
    });

    return () => unsubscribe();
  }, []);

  return (
    <AuthContext.Provider value={{ user, profile, loading, isAuthReady }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => useContext(AuthContext);
