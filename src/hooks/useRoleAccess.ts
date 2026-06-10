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

let cachedConfig: RoleAccessConfig | null = null;
let cachedLoaded = false;

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
 * Forward-compat: any default desktop module missing from the saved Firestore
 * config (because it was added after the config was last saved) is appended
 * automatically, so new features appear without requiring a manual UserRoles save.
 */
export function getRoleModules(role: string, config: RoleAccessConfig | null): RoleModules {
  const defaults = DEFAULT_ROLE_MODULES[role] ?? { desktopModules: ['dashboard'], mobileModules: ['dashboard'] };
  if (!config || !config[role]) return defaults;

  const saved = config[role];
  const savedDesktopSet = new Set(saved.desktopModules);
  // Add any default desktop modules not present in the saved config
  const newDefaults = defaults.desktopModules.filter(m => !savedDesktopSet.has(m));
  return {
    desktopModules: newDefaults.length ? [...saved.desktopModules, ...newDefaults] : saved.desktopModules,
    mobileModules: saved.mobileModules,
  };
}
