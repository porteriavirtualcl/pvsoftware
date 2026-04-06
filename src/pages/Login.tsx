import React, { useState } from 'react';
<<<<<<< HEAD
import { auth, db } from '../firebase';
import { signInWithEmailAndPassword } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, LogIn, Mail, Lock, Eye, EyeOff } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

const Login = () => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
=======
import { auth } from '../firebase';
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { ShieldAlert, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';

const Login = () => {
  const { error: authError } = useAuth();
>>>>>>> 29cee49796eb86d977a5ae56c846a5d1345eca01
  const [loading, setLoading] = useState(false);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
<<<<<<< HEAD
    setError(null);

    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/');
    } catch (err: any) {
      console.error("Login Error:", err);
      let message = 'Error al iniciar sesión';
      
      switch (err.code) {
        case 'auth/invalid-email':
          message = 'El formato del correo electrónico no es válido.';
          break;
        case 'auth/user-not-found':
          message = 'No existe una cuenta con este correo.';
          break;
        case 'auth/wrong-password':
          message = 'La contraseña es incorrecta.';
          break;
        case 'auth/too-many-requests':
          message = 'Demasiados intentos fallidos. Inténtalo más tarde.';
          break;
        default:
          message = 'Credenciales no autorizadas o error de conexión.';
      }
      setError(message);
=======
    setErrorCode(null);
    const provider = new GoogleAuthProvider();
    try {
      await signInWithPopup(auth, provider);
      // navigation is handled by the ProtectedRoute or App.tsx logic once state updates
      navigate('/');
    } catch (err: any) {
      console.error("Login Error:", err);
      setErrorCode(err.message || 'Error al iniciar sesión con Google');
>>>>>>> 29cee49796eb86d977a5ae56c846a5d1345eca01
    } finally {
      setLoading(false);
    }
  };

  const displayError = authError || errorCode;

  return (
<<<<<<< HEAD
    <div className="min-h-screen flex items-center justify-center bg-gray-950 p-4 relative overflow-hidden">
      {/* Background decoration elements */}
      <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-blue-600/10 rounded-full blur-[100px]" />
      <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-900/10 rounded-full blur-[100px]" />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="w-full max-w-md bg-gray-900/80 backdrop-blur-xl border border-gray-800 rounded-[32px] p-10 shadow-2xl relative z-10"
      >
        <div className="flex flex-col items-center mb-10 text-center">
          <motion.div 
            whileHover={{ scale: 1.05 }}
            className="w-20 h-20 bg-gradient-to-br from-blue-600 to-blue-800 rounded-3xl flex items-center justify-center mb-6 shadow-xl shadow-blue-600/30 ring-4 ring-blue-600/10"
          >
            <ShieldAlert className="text-white" size={40} />
          </motion.div>
          <h1 className="text-3xl font-black text-white mb-2 tracking-tighter uppercase italic">Portería Virtual</h1>
          <p className="text-gray-400 font-medium px-4">Acceso seguro a la plataforma de gestión residencial</p>
        </div>

        <AnimatePresence>
          {error && (
            <motion.div 
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              className="mb-8 p-4 bg-red-900/10 border border-red-500/20 rounded-[18px] text-red-500 text-sm flex items-start gap-3"
            >
              <div className="mt-0.5"><LogIn size={16} /></div>
              <p className="font-medium">{error}</p>
            </motion.div>
          )}
        </AnimatePresence>

        <form onSubmit={handleLogin} className="space-y-6">
          <div className="space-y-2">
            <label className="text-xs font-bold text-gray-500 uppercase tracking-widest ml-1">Correo Electrónico</label>
            <div className="relative group">
              <Mail className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-blue-500 transition-colors" size={20} />
              <input
                required
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-gray-950/50 border border-gray-800 rounded-2xl py-4 pl-12 pr-4 text-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all placeholder:text-gray-600"
                placeholder="ejemplo@correo.com"
              />
            </div>
          </div>

          <div className="space-y-2">
            <div className="flex justify-between items-center px-1">
              <label className="text-xs font-bold text-gray-500 uppercase tracking-widest">Contraseña</label>
              <button type="button" className="text-[10px] font-bold text-blue-500 hover:text-blue-400 uppercase tracking-wider">¿Olvidaste tu contraseña?</button>
            </div>
            <div className="relative group">
              <Lock className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-500 group-focus-within:text-blue-500 transition-colors" size={20} />
              <input
                required
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-gray-950/50 border border-gray-800 rounded-2xl py-4 pl-12 pr-12 text-white focus:border-blue-600 focus:ring-1 focus:ring-blue-600 outline-none transition-all placeholder:text-gray-600"
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                className="absolute right-4 top-1/2 -translate-y-1/2 text-gray-500 hover:text-gray-300 transition-colors"
              >
                {showPassword ? <EyeOff size={20} /> : <Eye size={20} />}
              </button>
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full bg-blue-600 hover:bg-blue-500 active:scale-[0.98] text-white font-black py-4 rounded-2xl transition-all shadow-xl shadow-blue-600/20 disabled:opacity-50 disabled:cursor-not-allowed mt-4 uppercase tracking-widest flex items-center justify-center gap-2"
          >
            {loading ? (
              <div className="w-5 h-5 border-[3px] border-white/30 border-t-white rounded-full animate-spin" />
            ) : (
              <>
                <LogIn size={20} />
                Ingresar al Portal
              </>
            )}
          </button>
        </form>

        <div className="mt-10 pt-8 border-t border-gray-800/50 text-center">
          <div className="flex items-center justify-center gap-2 text-gray-500 text-xs font-semibold">
            <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
            SISTEMA OPERATIVO Y SEGURO
          </div>
=======
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
>>>>>>> 29cee49796eb86d977a5ae56c846a5d1345eca01
        </div>
      </motion.div>
    </div>
  );
};

export default Login;
