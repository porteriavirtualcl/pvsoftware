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
  // Special mobile-only key: renders a hamburger button that opens the full sidebar.
  'sidebar',
] as const;

export type ModuleKey = typeof ALL_MODULE_KEYS[number];

/** Roles that can be configured. */
export const CONFIGURABLE_ROLES = ['super_admin', 'condo_admin', 'operator', 'technician', 'resident', 'usuario'] as const;

/** Max modules visible in the mobile bottom nav (includes dashboard). */
export const MOBILE_MAX = 4;

/**
 * Defaults used when `config/roleAccess` has no entry for a role.
 * Mirror the original hardcoded role lists in App.tsx menuItems.
 * Mobile = dashboard + first 3 desktop modules (previous behavior).
 */
export const DEFAULT_ROLE_MODULES: Record<string, RoleModules> = {
  super_admin: {
    desktopModules: ['dashboard','condos','equipment','operators','residents','visitors','incidents','expenses','facilities','parcels','users'],
    // Mobile default: dashboard + hamburger sidebar for full access.
    mobileModules:  ['dashboard','sidebar'],
  },
  condo_admin: {
    desktopModules: ['dashboard','equipment','operators','residents','visitors','incidents','expenses','facilities','parcels'],
    mobileModules:  ['dashboard','equipment','operators','residents'],
  },
  operator: {
    desktopModules: ['dashboard','residents','visitors','incidents','facilities','parcels'],
    mobileModules:  ['dashboard','residents','visitors','incidents'],
  },
  technician: {
    desktopModules: ['dashboard','equipment','visitors','incidents'],
    mobileModules:  ['dashboard','equipment','visitors','incidents'],
  },
  resident: {
    desktopModules: ['dashboard','visitors','expenses','facilities','parcels'],
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
 */
export function getRoleModules(role: string, config: RoleAccessConfig | null): RoleModules {
  if (config && config[role]) return config[role];
  if (DEFAULT_ROLE_MODULES[role]) return DEFAULT_ROLE_MODULES[role];
  return { desktopModules: ['dashboard'], mobileModules: ['dashboard'] };
}
