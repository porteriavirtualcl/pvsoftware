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
