import React, { useState } from 'react';
import { auth } from '../firebase';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ShieldAlert, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';

const Login = () => {
  const { error: authError } = useAuth();
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleGoogleLogin = async () => {
    setLoading(true);
    setErrorCode(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      // navigation is handled by the ProtectedRoute or App.tsx logic once state updates
      navigate('/');
    } catch (err: any) {
      console.error("Login Error:", err);
      setErrorCode(err.message || 'Error al iniciar sesión con Google');
    } finally {
      setLoading(false);
    }
  };

  const displayError = authError || errorCode;

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#020617] p-4 font-sans">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_50%_50%,rgba(30,58,138,0.2),transparent_50%)] pointer-events-none" />
      
      <motion.div
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-md glass-card rounded-[2.5rem] p-10 shadow-[0_20px_50px_rgba(0,0,0,0.5)] border border-white/10 relative z-10"
      >
        <div className="flex flex-col items-center mb-10 text-center">
          <div className="w-20 h-20 bg-blue-600 rounded-3xl flex items-center justify-center mb-6 shadow-2xl shadow-blue-600/40 rotate-3">
            <ShieldAlert className="text-white" size={40} />
          </div>
          <h1 className="text-4xl font-black text-white mb-2 tracking-tighter">PORTERÍA</h1>
          <p className="text-[10px] font-black text-blue-500 uppercase tracking-[0.4em]">Virtual Platform</p>
        </div>

        {displayError && (
          <motion.div 
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-8 p-5 bg-red-500/10 border border-red-500/20 rounded-2xl flex items-start gap-3"
          >
            <AlertCircle className="text-red-500 shrink-0" size={18} />
            <p className="text-xs font-bold text-red-200 leading-relaxed">
              {displayError}
            </p>
          </motion.div>
        )}

        <div className="space-y-4">
          <button
            onClick={handleGoogleLogin}
            disabled={loading}
            className="w-full flex items-center justify-center gap-4 bg-white text-gray-950 font-black text-xs uppercase tracking-widest py-5 px-6 rounded-2xl hover:bg-blue-50 transition-all active:scale-95 disabled:opacity-50 disabled:cursor-not-allowed shadow-xl shadow-white/5"
          >
            {loading ? (
              <div className="w-5 h-5 border-4 border-gray-950/20 border-t-gray-950 rounded-full animate-spin" />
            ) : (
              <>
                <img src="https://www.gstatic.com/firebasejs/ui/2.0.0/images/auth/google.svg" alt="Google" className="w-5 h-5" />
                Ingresar con Google
              </>
            )}
          </button>
          
          <p className="text-[10px] text-center text-gray-500 font-bold uppercase tracking-widest pt-4">
            Sistema de Acceso Restringido
          </p>
        </div>

        <div className="mt-10 pt-8 border-t border-white/5 text-center">
          <div className="flex items-center justify-center gap-2 mb-2">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full animate-pulse" />
            <span className="text-[9px] font-black text-gray-400 uppercase tracking-widest">Servidores Operativos</span>
          </div>
          <p className="text-[8px] text-gray-600 font-bold uppercase tracking-[0.2em]">
            © 2024 Portería Virtual • v2.5.0
          </p>
        </div>
      </motion.div>
    </div>
  );
};

export default Login;
