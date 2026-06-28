import { useEffect, useState, useCallback } from 'react';
import { doc, onSnapshot, setDoc } from 'firebase/firestore';
import { db } from '../firebase';

export type RoleModules = { desktopModules: string[]; mobileModules: string[] };
export type RoleAccessConfig = Record<string, RoleModules>;

/**
 * Navigable module keys. Matches `to` in App.tsx menuItems
 * (with '/' mapped to 'dashboard').
 */
export const ALL_MODULE_KEYS = [
  'dashboard', 'condos', 'equipment', 'operators', 'residents',
  'visitors', 'incidents', 'expenses', 'facilities', 'parcels', 'users',
  'manual', 'operator-manual', 'access', 'wa-numbers', 'wa-chat', 'atencion-cliente', 'communications',
  // Special mobile-only key: renders a hamburger button that opens the full sidebar.
  'sidebar',
] as const;

export type ModuleKey = typeof ALL_MODULE_KEYS[number];

/** Roles that can be configured. */
export const CONFIGURABLE_ROLES = ['super_admin', 'condo_admin', 'administrador', 'operator', 'technician', 'resident', 'usuario'] as const;

/** Max modules visible in the mobile bottom nav (includes dashboard). */
export const MOBILE_MAX = 4;

/**
 * Defaults used when `config/roleAccess` has no entry for a role.
 * Mirror the original hardcoded role lists in App.tsx menuItems.
 * Mobile = dashboard + first 3 desktop modules (previous behavior).
 */
export const DEFAULT_ROLE_MODULES: Record<string, RoleModules> = {
  super_admin: {
    desktopModules: ['dashboard','condos','equipment','operators','residents','visitors','incidents','expenses','facilities','parcels','users','access','wa-numbers','wa-chat','atencion-cliente','communications'],
    // Mobile default: dashboard + hamburger sidebar for full access.
    mobileModules:  ['dashboard','sidebar'],
  },
  condo_admin: {
    desktopModules: ['dashboard','equipment','operators','residents','visitors','incidents','expenses','facilities','parcels','access','wa-chat','atencion-cliente','communications'],
    mobileModules:  ['dashboard','equipment','operators','residents'],
  },
  administrador: {
    desktopModules: ['dashboard','equipment','operators','residents','visitors','incidents','expenses','facilities','parcels','access','wa-chat','atencion-cliente','communications'],
    mobileModules:  ['dashboard','residents','visitors','incidents'],
  },
  operator: {
    desktopModules: ['dashboard','residents','visitors','incidents','facilities','parcels','access','wa-chat','communications','operator-manual'],
    mobileModules:  ['dashboard','residents','visitors','incidents'],
  },
  technician: {
    desktopModules: ['dashboard','equipment','visitors','incidents'],
    mobileModules:  ['dashboard','equipment','visitors','incidents'],
  },
  resident: {
    desktopModules: ['dashboard','visitors','expenses','facilities','parcels','manual'],
    mobileModules:  ['dashboard','visitors','expenses','facilities'],
  },
  usuario: {
    desktopModules: ['dashboard'],
    mobileModules:  ['dashboard'],
  },
};

// Persistimos la última config conocida en localStorage para que, al recargar, el menú
// use de inmediato la config real y NO flashee los módulos por defecto mientras carga.
const LS_ROLE_ACCESS = 'pv:roleAccess';
function readCachedConfig(): RoleAccessConfig | null {
  try { const s = localStorage.getItem(LS_ROLE_ACCESS); return s ? JSON.parse(s) : null; }
  catch { return null; }
}
let cachedConfig: RoleAccessConfig | null = readCachedConfig();
let cachedLoaded = cachedConfig !== null;

export function useRoleAccess() {
  const [config, setConfig] = useState<RoleAccessConfig | null>(cachedConfig);
  const [loaded, setLoaded] = useState(cachedLoaded);

  useEffect(() => {
    const unsub = onSnapshot(
      doc(db, 'config', 'roleAccess'),
      (snap) => {
        const data = (snap.exists() ? snap.data() : {}) as RoleAccessConfig;
        cachedConfig = data;
        cachedLoaded = true;
        try { localStorage.setItem(LS_ROLE_ACCESS, JSON.stringify(data)); } catch { /* ignore */ }
        setConfig(data);
        setLoaded(true);
      },
      () => {
        cachedLoaded = true;
        setLoaded(true);
      }
    );
    return () => unsub();
  }, []);

  const saveRoleConfig = useCallback(
    async (role: string, cfg: RoleModules) => {
      await setDoc(doc(db, 'config', 'roleAccess'), { [role]: cfg }, { merge: true });
    },
    []
  );

  return { config, loaded, saveRoleConfig };
}

/**
 * Returns the effective modules for a role — from Firestore if present,
 * else from hardcoded defaults.
 *
 * La config guardada es AUTORITATIVA: lo que el admin configura en "Configuración de
 * roles" es exactamente lo que se ve (quitar un módulo lo oculta de verdad). Solo se
 * cae a los defaults cuando el rol no tiene config guardada. 'dashboard' siempre va
 * incluido por seguridad. Nota: un módulo nuevo agregado al código NO aparece en roles
 * ya configurados hasta que el super_admin lo active y vuelva a guardar.
 */
export function getRoleModules(role: string, config: RoleAccessConfig | null): RoleModules {
  const defaults = DEFAULT_ROLE_MODULES[role] ?? { desktopModules: ['dashboard'], mobileModules: ['dashboard'] };
  if (!config || !config[role]) return defaults;

  const saved = config[role];
  const ensureDashboard = (arr: ModuleKey[] | undefined, fallback: ModuleKey[]): ModuleKey[] => {
    const a = Array.isArray(arr) ? arr : fallback;
    return a.includes('dashboard') ? a : ['dashboard', ...a];
  };
  return {
    desktopModules: ensureDashboard(saved.desktopModules, defaults.desktopModules),
    mobileModules:  ensureDashboard(saved.mobileModules,  defaults.mobileModules),
  };
}
