import React, { useState, useEffect, createContext, useContext } from 'react';
import { auth, db } from '../firebase';
<<<<<<< HEAD
import { onAuthStateChanged, User as FirebaseUser } from 'firebase/auth';
import { doc, getDoc, setDoc, query, where, getDocs, collection, deleteDoc, updateDoc } from 'firebase/firestore';
=======
import { onAuthStateChanged, User as FirebaseUser, signOut } from 'firebase/auth';
import { doc, getDoc, setDoc, query, collection, where, getDocs, updateDoc, Timestamp } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/utils';
>>>>>>> 29cee49796eb86d977a5ae56c846a5d1345eca01

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
      if (firebaseUser) {
        try {
<<<<<<< HEAD
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
=======
          const docRef = doc(db, 'users', firebaseUser.uid);
          const docSnap = await getDoc(docRef);
          
          if (docSnap.exists()) {
            const existingProfile = docSnap.data() as UserProfile;
            
            // Force super_admin role and permissions if email matches the master admin email
            if (firebaseUser.email === 'contacto@porteriavirtual.cl') {
              if (existingProfile.role !== 'super_admin' || !existingProfile.canGenerateQR) {
                const updatedProfile = { 
                  ...existingProfile, 
                  role: 'super_admin' as const,
                  canGenerateQR: true,
                  hasFacilityAccess: true 
                };
                await setDoc(docRef, updatedProfile);
                setProfile(updatedProfile);
              } else {
                setProfile(existingProfile);
              }
            } else {
              setProfile(existingProfile);
            }
            setUser(firebaseUser);
            setError(null);
          } else {
            // Profile not found by UID, check by Email (pre-registration)
            const q = query(collection(db, 'users'), where('email', '==', firebaseUser.email));
            const querySnapshot = await getDocs(q);
            
            if (!querySnapshot.empty) {
              const userDoc = querySnapshot.docs[0];
              const registeredProfile = userDoc.data() as UserProfile;
              
              // Link the UID to the registered email profile
              await updateDoc(doc(db, 'users', userDoc.id), {
                uid: firebaseUser.uid,
                updatedAt: Timestamp.now()
              });
              
              setUser(firebaseUser);
              setProfile({ ...registeredProfile, uid: firebaseUser.uid });
              setError(null);
            } else if (firebaseUser.email === 'contacto@porteriavirtual.cl') {
              // Create default super admin if not exists
              const newProfile: UserProfile = {
                uid: firebaseUser.uid,
                email: firebaseUser.email || '',
                name: firebaseUser.displayName || 'Admin',
                role: 'super_admin',
                canGenerateQR: true,
                hasFacilityAccess: true,
              };
              await setDoc(doc(db, 'users', firebaseUser.uid), newProfile);
              setUser(firebaseUser);
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
        } catch (err) {
          console.error("Auth Error:", err);
          handleFirestoreError(err, OperationType.GET, `users/${firebaseUser.uid}`);
>>>>>>> 29cee49796eb86d977a5ae56c846a5d1345eca01
        }
      } else {
        setUser(null);
        setProfile(null);
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
