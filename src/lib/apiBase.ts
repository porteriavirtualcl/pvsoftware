/// <reference types="vite/client" />
/**
 * apiBase — base URL for backend (Express server.cjs) calls.
 *
 * Web/PWA build  → VITE_API_BASE_URL is empty → relative URLs → same-origin.
 * Capacitor APK  → VITE_API_BASE_URL = https://app.porteriavirtual.cl
 *                  → absolute URLs → call Hostinger from the device.
 *
 * Usage: api('/api/dahua/login') → '/api/dahua/login' on web,
 *                                   'https://app.porteriavirtual.cl/api/dahua/login' on Android.
 */

const BASE = (import.meta.env.VITE_API_BASE_URL as string | undefined)?.replace(/\/+$/, '') ?? '';

export function api(path: string): string {
  return `${BASE}${path.startsWith('/') ? path : '/' + path}`;
}

export const API_BASE = BASE;

/**
 * authedFetch — fetch que adjunta el ID token de Firebase del usuario actual en
 * la cabecera Authorization. Usar para los endpoints protegidos del backend
 * (usuarios, puertas, visitas, reportes). Si no hay sesión, igual realiza la
 * llamada (el backend responderá 401), sin bloquear flujos que no requieren auth.
 */
export async function authedFetch(path: string, options: RequestInit = {}): Promise<Response> {
  const headers = new Headers(options.headers || {});
  try {
    const { getAuth } = await import('firebase/auth');
    const user = getAuth().currentUser;
    if (user) headers.set('Authorization', `Bearer ${await user.getIdToken()}`);
  } catch {
    /* sin token disponible → el backend decidirá */
  }
  return fetch(api(path), { ...options, headers });
}
