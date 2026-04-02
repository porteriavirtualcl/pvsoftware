import React, { useState } from 'react';
import { auth, db } from '../firebase';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { handleFirestoreError, OperationType } from '../lib/errorHandlers';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, LogIn, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';

const Login = () => {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleGoogleLogin = async () => {
    setLoading(true);
    setError(null);
    const provider = new GoogleAuthProvider();
    try {
      const result = await signInWithPopup(auth, provider);
      const user = result.user;

      // Check if user profile exists in Firestore
      const userDocRef = doc(db, 'users', user.uid);
      let userDocSnap;
      try {
        userDocSnap = await getDoc(userDocRef);
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, `users/${user.uid}`);
      }

      if (!userDocSnap?.exists()) {
        // Create a default resident profile if it doesn't exist
        try {
          await setDoc(userDocRef, {
            uid: user.uid,
            email: user.email,
            name: user.displayName || 'Usuario',
            role: 'resident', // Default role for new sign-ups
            createdAt: new Date().toISOString(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.WRITE, `users/${user.uid}`);
        }
      }

      navigate('/');
    } catch (err: any) {
      console.error("Login Error:", err);
      let message = 'Error al iniciar sesión con Google';
      
      if (err.code === 'auth/operation-not-allowed') {
        message = 'El inicio de sesión con Google no está habilitado. Por favor, ve a tu Consola de Firebase > Authentication > Sign-in method y habilita "Google".';
      } else if (err.code === 'auth/unauthorized-domain') {
        message = 'Dominio no autorizado. Por favor, añade este dominio a la lista blanca en la Consola de Firebase.';
      } else {
        try {
          const parsed = JSON.parse(err.message);
          if (parsed.error) message = `Error de Base de Datos: ${parsed.error}`;
        } catch {
          message = err.message || message;
        }
      }
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-gray-900 border border-gray-800 rounded-2xl p-8 shadow-2xl"
      >
        <div className="flex flex-col items-center mb-8 text-center">
          <div className="w-16 h-16 bg-blue-600 rounded-2xl flex items-center justify-center mb-4 shadow-lg shadow-blue-600/20">
            <ShieldAlert className="text-white" size={32} />
          </div>
          <h1 className="text-3xl font-bold text-white mb-2 tracking-tight">Portería Virtual</h1>
          <p className="text-gray-400">Gestión de Condominios y Portería Virtual</p>
        </div>

        {error && (
          <div className="mb-6 p-4 bg-red-900/20 border border-red-800 rounded-lg text-red-400 text-sm">
            {error}
          </div>
        )}

        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full flex items-center justify-center gap-3 bg-white text-gray-900 font-semibold py-3 px-4 rounded-xl hover:bg-gray-200 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {loading ? (
            <div className="w-5 h-5 border-2 border-gray-900 border-t-transparent rounded-full animate-spin" />
          ) : (
            <>
              <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
              Continuar con Google
            </>
          )}
        </button>

        <div className="mt-8 pt-6 border-t border-gray-800 text-center">
          <p className="text-xs text-gray-500 uppercase tracking-widest font-medium">
            Acceso Seguro • Portería Virtual
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default Login;
