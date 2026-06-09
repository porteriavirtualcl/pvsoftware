import React, { useState } from 'react';
import { auth } from '../firebase';
import { signInWithEmailAndPassword, signInWithPopup, signInWithCredential, GoogleAuthProvider, OAuthProvider } from 'firebase/auth';
import { Capacitor } from '@capacitor/core';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { useNavigate, Link } from 'react-router-dom';
import { useAuth } from '../hooks/useAuth';
import { LogIn, Mail, Lock, Eye, EyeOff, AlertCircle, ShieldCheck } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { Button, Field, Input } from '../components/ui';

const GoogleIcon = () => (
  <svg width="18" height="18" viewBox="0 0 48 48" aria-hidden>
    <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3c-1.6 4.7-6.1 8-11.3 8a12 12 0 1 1 0-24c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 1 0 44 24c0-1.2-.1-2.4-.4-3.5z"/>
    <path fill="#FF3D00" d="M6.3 14.1l6.6 4.8A12 12 0 0 1 24 12c3 0 5.8 1.1 7.9 3l5.7-5.7A20 20 0 0 0 6.3 14.1z"/>
    <path fill="#4CAF50" d="M24 44c5.2 0 10-2 13.6-5.3l-6.3-5.3a12 12 0 0 1-18-6.2L6.7 32A20 20 0 0 0 24 44z"/>
    <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3a12 12 0 0 1-4 5.4l6.3 5.3C41.3 35.3 44 30 44 24c0-1.2-.1-2.4-.4-3.5z"/>
  </svg>
);

const isIOS = Capacitor.getPlatform() === 'ios';

const Login = () => {
  const { error: authError } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const navigate = useNavigate();

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setLocalError(null);
    try {
      await signInWithEmailAndPassword(auth, email, password);
      navigate('/');
    } catch (err: any) {
      let message = 'Error al iniciar sesión';
      switch (err.code) {
        case 'auth/invalid-email':      message = 'El formato del correo electrónico no es válido.'; break;
        case 'auth/user-not-found':     message = 'No existe una cuenta con este correo.'; break;
        case 'auth/wrong-password':     message = 'La contraseña es incorrecta.'; break;
        case 'auth/invalid-credential': message = 'Correo o contraseña incorrectos.'; break;
        case 'auth/too-many-requests':  message = 'Demasiados intentos fallidos. Inténtalo más tarde.'; break;
        default:                        message = 'Credenciales no autorizadas o error de conexión.';
      }
      setLocalError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleGoogleLogin = async () => {
    setLoading(true);
    setLocalError(null);
    try {
      if (Capacitor.isNativePlatform()) {
        const result = await FirebaseAuthentication.signInWithGoogle();
        const idToken = result.credential?.idToken;
        if (!idToken) throw new Error('No se recibió token de Google');
        await signInWithCredential(auth, GoogleAuthProvider.credential(idToken));
      } else {
        await signInWithPopup(auth, new GoogleAuthProvider());
      }
      navigate('/');
    } catch (err: any) {
      setLocalError(err?.message || 'Error al iniciar sesión con Google');
    } finally {
      setLoading(false);
    }
  };

  const handleAppleLogin = async () => {
    setLoading(true);
    setLocalError(null);
    try {
      const result = await FirebaseAuthentication.signInWithApple();
      const idToken = result.credential?.idToken;
      const rawNonce = result.credential?.nonce;
      if (!idToken) throw new Error('No se recibió token de Apple');
      const provider = new OAuthProvider('apple.com');
      await signInWithCredential(auth, provider.credential({ idToken, rawNonce }));
      navigate('/');
    } catch (err: any) {
      if (err?.code !== 'SIGN_IN_CANCELLED') {
        setLocalError(err?.message || 'Error al iniciar sesión con Apple');
      }
    } finally {
      setLoading(false);
    }
  };

  const displayError = authError || localError;

  return (
    <div
      className="min-h-screen flex items-center justify-center p-4 relative overflow-hidden"
      style={{ background: 'var(--surface-page)' }}
    >
      {/* Ambient background */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden" aria-hidden>
        <div className="absolute top-[-15%] left-[-10%] w-[45%] h-[45%] bg-blue-500/10 dark:bg-blue-600/15 rounded-full blur-[120px]" />
        <div className="absolute bottom-[-15%] right-[-10%] w-[45%] h-[45%] bg-indigo-500/10 dark:bg-indigo-600/15 rounded-full blur-[120px]" />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.2, 0, 0, 1] }}
        className="card-glass relative z-10 w-full max-w-md p-6 sm:p-9 rounded-2xl"
      >
        {/* Logo + headline */}
        <div className="flex flex-col items-center text-center mb-7">
          <div className="bg-white rounded-xl px-5 py-3 shadow-sm ring-1 ring-slate-200 dark:ring-slate-800 mb-4">
            <img src="/logo-horizontal.jpg" alt="Portería Virtual" className="h-9 w-auto object-contain" />
          </div>
          <h1 className="mb-1.5">Bienvenido</h1>
          <p className="subtle">Accede a tu plataforma de gestión residencial</p>
        </div>

        {/* Error */}
        <AnimatePresence mode="wait">
          {displayError && (
            <motion.div
              initial={{ opacity: 0, height: 0, marginBottom: 0 }}
              animate={{ opacity: 1, height: 'auto', marginBottom: 20 }}
              exit={{ opacity: 0, height: 0, marginBottom: 0 }}
              transition={{ duration: 0.2 }}
              role="alert"
              className="overflow-hidden"
            >
              <div className="flex items-start gap-2.5 p-3 rounded-xl bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-300">
                <AlertCircle size={16} className="mt-0.5 shrink-0" />
                <p className="text-sm font-medium">{displayError}</p>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Form */}
        <form onSubmit={handleLogin} className="space-y-4">
          <Field label="Correo electrónico" htmlFor="login-email" required>
            <div className="relative">
              <Mail
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                aria-hidden
              />
              <Input
                id="login-email"
                type="email"
                required
                autoComplete="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="ejemplo@correo.com"
                className="pl-10"
              />
            </div>
          </Field>

          <Field label="Contraseña" htmlFor="login-password" required>
            <div className="relative">
              <Lock
                size={16}
                className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none"
                aria-hidden
              />
              <Input
                id="login-password"
                type={showPassword ? 'text' : 'password'}
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••"
                className="pl-10 pr-10"
              />
              <button
                type="button"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 transition-colors cursor-pointer"
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </Field>

          <Button type="submit" size="lg" loading={loading} icon={LogIn} fullWidth className="mt-2">
            {loading ? 'Ingresando…' : 'Iniciar sesión'}
          </Button>
        </form>

        {/* Divider */}
        <div className="flex items-center gap-3 my-6" aria-hidden>
          <div className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
          <span className="text-xs font-medium text-slate-400 dark:text-slate-500 shrink-0">o continúa con</span>
          <div className="flex-1 h-px bg-slate-200 dark:bg-white/10" />
        </div>

        {/* Google */}
        <button
          onClick={handleGoogleLogin}
          disabled={loading}
          className="w-full inline-flex items-center justify-center gap-3 py-2.5 rounded-xl bg-slate-50 text-slate-900 font-semibold text-sm border border-slate-200 hover:bg-white hover:border-slate-300 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed dark:bg-white dark:text-slate-900 dark:border-transparent dark:hover:bg-slate-100"
        >
          <GoogleIcon />
          Continuar con Google
        </button>

        {/* Sign in with Apple — required by App Store guideline 4.8 when Google is offered */}
        {isIOS && (
          <button
            onClick={handleAppleLogin}
            disabled={loading}
            className="w-full inline-flex items-center justify-center gap-3 py-2.5 rounded-xl bg-black text-white font-semibold text-sm border border-black hover:bg-slate-900 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed mt-3 dark:bg-black dark:text-white dark:border-black dark:hover:bg-slate-900"
          >
            <svg width="18" height="18" viewBox="0 0 814 1000" fill="white" aria-hidden>
              <path d="M788.1 340.9c-5.8 4.5-108.2 62.2-108.2 190.5 0 148.4 130.3 200.9 134.2 202.2-.6 3.2-20.7 71.9-68.7 141.9-42.8 61.6-87.5 123.1-155.5 123.1s-85.5-39.5-164-39.5c-76 0-103.7 40.8-165.9 40.8s-105-57.8-155.5-127.4C46 790.7 0 663 0 541.8c0-207.5 135.4-317.5 269-317.5 70.1 0 128.4 46.4 172.5 46.4 42.8 0 109.6-49.1 189.2-49.1zm-228.1-209.1c31.2-37.5 54.4-89.8 54.4-142.1 0-7.1-.6-14.3-1.9-20.1-51.6 1.9-112.3 34.4-149.2 75.1-28.5 32.4-55.1 84.7-55.1 137.7 0 7.8 1.3 15.6 1.9 18.1 3.2.6 8.4 1.3 13.6 1.3 46.5 0 102.8-30.5 136.3-69.9z"/>
            </svg>
            Continuar con Apple
          </button>
        )}

        {/* Footer */}
        <div className="mt-7 pt-5 border-t border-slate-200 dark:border-white/5 flex flex-col items-center gap-2 text-xs text-slate-400 dark:text-slate-500">
          <div className="flex items-center gap-1.5">
            <ShieldCheck size={13} className="text-emerald-500" aria-hidden />
            <span>Conexión cifrada — Portería Virtual</span>
          </div>
          <Link to="/privacy" className="hover:text-blue-500 dark:hover:text-blue-400 transition-colors underline underline-offset-2">
            Política de Privacidad
          </Link>
        </div>
      </motion.div>
    </div>
  );
};

export default Login;
