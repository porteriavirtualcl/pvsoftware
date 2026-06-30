import React, { useState, useEffect, useMemo } from 'react';
import { db, storage } from '../firebase';
import { ref as sRef, uploadBytes, getDownloadURL } from 'firebase/storage';
import {
  collection, query, where, onSnapshot, addDoc, setDoc, updateDoc,
  doc, deleteDoc, Timestamp,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  Plus, Search, User, Users, Home, QrCode, ShieldCheck, Mail, Edit2, Trash2,
  AlertOctagon, Car, ShieldAlert, Wifi, WifiOff, Phone, MessageCircle,
  Building2, CheckSquare, Square, RefreshCw, CheckCircle2, AlertCircle,
  ChevronRight, Lock, X, Upload, Download, CloudUpload, FileText, Camera,
  Smartphone,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, handleFirestoreError, OperationType } from '../lib/utils';
import { api, authedFetch } from '../lib/apiBase';
import { initializeApp, deleteApp, getApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import DahuaService, { DahuaPerson, DahuaPersonGroup } from '../services/DahuaService';
import firebaseConfig from '../../firebase-applet-config.json';
import { Button, Card, PageHeader, Field, Input, Modal, EmptyState, Badge, Spinner } from '../components/ui';
import { isOnlineNow } from '../hooks/usePresence';
import { isAppOutdated } from '../lib/appVersion';

// ─── types ────────────────────────────────────────────────────────────────────

interface Resident {
  id: string;
  uid?: string;
  name: string;
  email: string;
  phone?: string;
  unit: string;
  condoId: string;
  condoName: string;
  status: 'Activo' | 'Inactivo' | 'Pendiente';
  role: 'resident' | 'usuario';
  plates: string[];
  canGenerateQR: boolean;
  hasFacilityAccess: boolean;
  photoUrl?: string;
  dahuaPersonId?: string;
  dahuaOrgName?: string;
  appVersion?: string;
  appPlatform?: string;
  createdAt: any;
  updatedAt: any;
}

interface ImportRow {
  email: string;
  password: string;
  phone: string;
  unit: string;
  condoId: string;
  canGenerateQR: boolean;
}

interface CsvRow {
  rowNum: number;
  nombre: string;
  email: string;
  contrasena: string;
  telefono: string;
  unidad: string;
  condominio: string;
  patentes: string[];
  rol: 'resident' | 'usuario';
  estado: 'Activo' | 'Pendiente' | 'Inactivo';
  paseQr: boolean;
  instalaciones: boolean;
  resolvedCondoId: string;
  resolvedCondoName: string;
  errors: string[];
}

const selectClass = [
  'block w-full bg-white dark:bg-slate-950/50',
  'border border-slate-200 dark:border-white/10',
  'rounded-xl px-3.5 py-2.5 text-[15px]',
  'text-slate-900 dark:text-slate-100',
  'outline-none transition',
  'focus:border-blue-600 dark:focus:border-blue-500',
  'focus:ring-2 focus:ring-blue-500/20',
].join(' ');

function statusBadge(status: Resident['status']): React.ReactNode {
  const map: Partial<Record<string, { variant: 'success' | 'warn' | 'danger'; label: string }>> = {
    Activo:    { variant: 'success', label: 'Activo' },
    Pendiente: { variant: 'warn',    label: 'Pendiente' },
    Inactivo:  { variant: 'danger',  label: 'Inactivo' },
  };
  const entry = map[status] ?? { variant: 'muted' as const, label: status };
  return <Badge variant={entry.variant as 'success' | 'warn' | 'danger'}>{entry.label}</Badge>;
}

// ─── DSS sync helpers (module-level — no component state needed) ──────────────

function splitName(fullName: string): { firstName: string; lastName: string } {
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return { firstName: parts[0], lastName: '' };
  return { firstName: parts.slice(0, -1).join(' '), lastName: parts[parts.length - 1] };
}

async function syncResidentToDss(
  docId: string,
  data: { name: string; email: string; unit: string; plates: string[]; phone?: string },
): Promise<void> {
  const { firstName, lastName } = splitName(data.name);
  const existing = await DahuaService.searchPersonsByName(data.name);
  const dup = existing.find(p => p.personName.toLowerCase().trim() === data.name.toLowerCase().trim());
  if (dup) {
    await updateDoc(doc(db, 'users', docId), { dahuaPersonId: dup.id });
    return;
  }
  const personId = await DahuaService.createPerson({
    firstName, lastName, orgCode: '001',
    tel: data.phone || '', email: data.email,
    unit: data.unit, plates: data.plates,
  });
  if (personId) await updateDoc(doc(db, 'users', docId), { dahuaPersonId: personId });
}

// ─── CSV helpers (module-level) ───────────────────────────────────────────────

function parseCSV(text: string): string[][] {
  const rows: string[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const cells: string[] = [];
    let i = 0;
    while (i < line.length) {
      if (line[i] === '"') {
        let val = ''; i++;
        while (i < line.length) {
          if (line[i] === '"' && line[i + 1] === '"') { val += '"'; i += 2; }
          else if (line[i] === '"') { i++; break; }
          else val += line[i++];
        }
        cells.push(val);
        if (line[i] === ',') i++;
      } else {
        const end = line.indexOf(',', i);
        if (end === -1) { cells.push(line.slice(i)); i = line.length; }
        else { cells.push(line.slice(i, end)); i = end + 1; }
      }
    }
    rows.push(cells);
  }
  return rows;
}

function downloadCsvTemplate(condos: { id: string; name: string }[]) {
  const header = 'nombre,email,contrasena,telefono,unidad,condominio,patentes,rol,estado,pase_qr,instalaciones';
  const example = `Juan Pérez,juan@correo.com,Vecino2024!,+56912345678,Torre A-101,${condos[0]?.name || 'Mi Condominio'},"ABCD12,EFGH34",resident,Activo,true,true`;
  const blob = new Blob([`${header}\n${example}\n`], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'plantilla_residentes.csv'; link.click();
  URL.revokeObjectURL(url);
}

// ─── OnlineOperatorsForCondo ─────────────────────────────────────────────────

function OnlineOperatorsForCondo({ condoId }: { condoId: string }) {
  const [operators, setOperators] = useState<any[]>([]);
  useEffect(() => {
    const unsub = onSnapshot(
      query(collection(db, 'users'), where('role', '==', 'operator')),
      snap => setOperators(snap.docs.map(d => ({ id: d.id, ...d.data() }))),
    );
    return () => unsub();
  }, []);

  const online = operators.filter(op => {
    if (!isOnlineNow(op)) return false;
    if (op.condoScope === 'all') return true;
    if (op.condoId === condoId) return true;
    if (Array.isArray(op.condoIds) && op.condoIds.includes(condoId)) return true;
    return false;
  });

  if (online.length === 0) return null;

  return (
    <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 space-y-3">
      <p className="flex items-center gap-2 text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wide">
        <span className="w-2 h-2 rounded-full bg-emerald-400 shrink-0 animate-pulse" />
        Operadores en línea para este condominio
      </p>
      <div className="space-y-2">
        {online.map(op => (
          <div key={op.id} className="flex items-center gap-3 p-2.5 rounded-lg bg-white dark:bg-white/5 border border-slate-200 dark:border-white/5">
            <div className="relative shrink-0">
              <div className="w-8 h-8 rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
                <Users size={14} strokeWidth={2.2} />
              </div>
              <span className="absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full bg-emerald-400 ring-2 ring-white dark:ring-slate-900" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{op.name || op.email}</p>
              {op.phone && (
                <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{op.phone}</p>
              )}
            </div>
            {op.phone && (
              <div className="flex gap-1.5 shrink-0">
                <a
                  href={`tel:${op.phone}`}
                  title="Llamar"
                  onClick={e => e.stopPropagation()}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-blue-500 hover:bg-blue-500/10 transition-all"
                >
                  <Phone size={13} />
                </a>
                <a
                  href={`https://wa.me/${op.phone.replace(/\D/g, '')}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="WhatsApp"
                  onClick={e => e.stopPropagation()}
                  className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-500 hover:bg-emerald-500/10 transition-all"
                >
                  <MessageCircle size={13} />
                </a>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── component ────────────────────────────────────────────────────────────────

const Residents = () => {
  const { profile, user } = useAuth();

  // ── Firestore state ─────────────────────────────────────────────────────────
  const [residents, setResidents] = useState<Resident[]>([]);
  const [loading, setLoading]     = useState(true);
  const [condos, setCondos]       = useState<{ id: string; name: string; unitNames?: string[] }[]>([]);

  // ── Manual modal state ──────────────────────────────────────────────────────
  const [showAddModal, setShowAddModal]       = useState(false);
  const [editingResident, setEditingResident] = useState<Resident | null>(null);
  const [deletingResident, setDeletingResident] = useState<Resident | null>(null);
  const [saving, setSaving] = useState(false);
  const [formData, setFormData] = useState({
    name: '', email: '', password: '', unit: '',
    condoId: '', status: 'Activo' as Resident['status'],
    role: 'resident' as Resident['role'],
    plates: [] as string[], canGenerateQR: true, hasFacilityAccess: true,
    photoUrl: '',
  });
  const [photoUploading, setPhotoUploading] = useState(false);

  // ── Search ──────────────────────────────────────────────────────────────────
  const [searchTerm, setSearchTerm] = useState('');

  // ── Tree navigation ─────────────────────────────────────────────────────────
  const [selectedCondoId, setSelectedCondoId] = useState('');
  const [selectedUnit, setSelectedUnit]       = useState('');
  const [expandedCondos, setExpandedCondos]   = useState<Set<string>>(new Set());

  // ── DSS import modal ────────────────────────────────────────────────────────
  const [showDssModal, setShowDssModal]   = useState(false);
  const [dssStep, setDssStep]             = useState<1 | 2>(1);
  const [dssPersons, setDssPersons]       = useState<DahuaPerson[]>([]);
  const [dssPersonGroups, setDssPersonGroups] = useState<DahuaPersonGroup[]>([]);
  const [groupCondoMap, setGroupCondoMap] = useState<Record<string, string>>({});
  const [dssLoading, setDssLoading]       = useState(false);
  const [dssError, setDssError]           = useState<string | null>(null);
  const [dssSearch, setDssSearch]         = useState('');
  const [dssCondoFilter, setDssCondoFilter] = useState('');
  const [selected, setSelected]           = useState<Set<string>>(new Set());
  const [importRows, setImportRows]       = useState<Record<string, ImportRow>>({});
  const [globalPassword, setGlobalPassword] = useState('Porteria2024!');
  const [defaultCondoId, setDefaultCondoId] = useState('');
  const [importing, setImporting]         = useState(false);
  const [importProgress, setImportProgress] = useState({ current: 0, total: 0 });
  const [importResult, setImportResult]   = useState<{
    success: number; failed: number; skipped: number;
  } | null>(null);

  // ── CSV bulk import ──────────────────────────────────────────────────────────
  const [showCsvModal, setShowCsvModal]     = useState(false);
  const [csvRows, setCsvRows]               = useState<CsvRow[]>([]);
  const [globalCsvPassword, setGlobalCsvPassword] = useState('');
  const [csvImporting, setCsvImporting]     = useState(false);
  const [csvProgress, setCsvProgress]       = useState({ current: 0, total: 0 });
  const [csvResult, setCsvResult]           = useState<{ success: number; failed: number; skipped: number } | null>(null);
  // Per-row DSS sync loading state
  const [syncingIds, setSyncingIds]         = useState<Set<string>>(new Set());

  // ─── Firestore listeners ──────────────────────────────────────────────────

  useEffect(() => {
    const condosUnsub = onSnapshot(collection(db, 'condos'), (snap) => {
      const list = snap.docs.map(d => ({
        id: d.id,
        name: d.data().name as string,
        unitNames: d.data().unitNames as string[] | undefined,
      }));
      setCondos(list);
      if (!defaultCondoId && list.length > 0) setDefaultCondoId(list[0].id);
    });

    if (!profile || !user) return () => condosUnsub();

    let q;
    if (profile.role === 'super_admin' || profile.condoScope === 'all') {
      q = query(collection(db, 'users'), where('role', 'in', ['resident', 'usuario']));
    } else if (profile.condoScope === 'multiple' && profile.condoIds) {
      q = query(collection(db, 'users'),
        where('condoId', 'in', profile.condoIds),
        where('role', 'in', ['resident', 'usuario']));
    } else {
      q = query(collection(db, 'users'),
        where('condoId', '==', profile.condoId || 'default'),
        where('role', 'in', ['resident', 'usuario']));
    }

    const unsub = onSnapshot(q, (snap) => {
      setResidents(snap.docs.map(d => ({ id: d.id, ...d.data() })) as Resident[]);
      setLoading(false);
    }, (err) => {
      setLoading(false);
      handleFirestoreError(err, OperationType.LIST, 'users');
    });

    return () => { unsub(); condosUnsub(); };
  }, [profile, user]);

  // ─── derived: tree structure Condo → Unit → Residents ───────────────────

  const filteredResidents = useMemo(() => {
    const term = searchTerm.toLowerCase();
    return residents.filter(r =>
      !term ||
      r.name?.toLowerCase().includes(term) ||
      r.email?.toLowerCase().includes(term) ||
      r.unit?.toLowerCase().includes(term)
    );
  }, [residents, searchTerm]);

  const condoTree = useMemo(() => {
    const byCondoId: Record<string, { condoId: string; condoName: string; byUnit: Record<string, Resident[]> }> = {};
    for (const r of filteredResidents) {
      const cid   = r.condoId   || '__none__';
      const cname = r.condoName || 'Sin Condominio';
      const unit  = r.unit      || '—';
      if (!byCondoId[cid]) byCondoId[cid] = { condoId: cid, condoName: cname, byUnit: {} };
      if (!byCondoId[cid].byUnit[unit]) byCondoId[cid].byUnit[unit] = [];
      byCondoId[cid].byUnit[unit].push(r);
    }
    return Object.values(byCondoId)
      .sort((a, b) => a.condoName.localeCompare(b.condoName, 'es', { sensitivity: 'base' }))
      .map(c => ({
        ...c,
        units: Object.entries(c.byUnit)
          .sort(([a], [b]) => a.localeCompare(b, 'es', { numeric: true, sensitivity: 'base' }))
          .map(([unit, res]) => ({ unit, residents: res })),
      }));
  }, [filteredResidents]);

  const visibleResidents = useMemo(() => {
    if (!selectedCondoId) return filteredResidents;
    const condo = condoTree.find(c => c.condoId === selectedCondoId);
    if (!condo) return [];
    if (!selectedUnit) return condo.units.flatMap(u => u.residents);
    return condo.units.find(u => u.unit === selectedUnit)?.residents ?? [];
  }, [filteredResidents, condoTree, selectedCondoId, selectedUnit]);

  const toggleCondo = (condoId: string) => {
    setExpandedCondos(prev => {
      const next = new Set(prev);
      next.has(condoId) ? next.delete(condoId) : next.add(condoId);
      return next;
    });
  };

  const importedDssIds = useMemo(() =>
    new Set(residents.filter(r => r.dahuaPersonId).map(r => r.dahuaPersonId as string)),
    [residents]);

  // ─── Manual modal handlers ────────────────────────────────────────────────

  const handleOpenAdd = () => {
    setEditingResident(null);
    setFormData({
      name: '', email: '', password: '', unit: '',
      condoId: profile?.condoId || condos[0]?.id || '',
      status: 'Activo', role: 'resident',
      plates: [], canGenerateQR: true, hasFacilityAccess: true,
      photoUrl: '',
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (r: Resident) => {
    setEditingResident(r);
    setFormData({
      name: r.name, email: r.email, password: '', unit: r.unit,
      condoId: r.condoId, status: r.status, role: r.role,
      plates: r.plates || [], canGenerateQR: r.canGenerateQR ?? true,
      hasFacilityAccess: r.hasFacilityAccess ?? true,
      photoUrl: r.photoUrl || '',
    });
    setShowAddModal(true);
  };

  // Sube la foto del residente a Firebase Storage y guarda la URL en el formulario.
  const handlePhotoUpload = async (file?: File) => {
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) { alert('La imagen supera 10MB'); return; }
    setPhotoUploading(true);
    try {
      const ext = (file.name.split('.').pop() || 'jpg').toLowerCase();
      const path = `residents/${formData.condoId || 'sin-condo'}/${Date.now()}.${ext}`;
      const r = sRef(storage, path);
      await uploadBytes(r, file);
      const url = await getDownloadURL(r);
      setFormData(f => ({ ...f, photoUrl: url }));
    } catch (err) {
      console.error('photo upload error', err);
      alert('No se pudo subir la foto');
    } finally {
      setPhotoUploading(false);
    }
  };

  // Ensure a valid condoId is picked once condos have loaded.
  // Without this, opening the modal before condos finish loading leaves condoId=''
  // and the <select> shows a phantom first option — making the unit dropdown unreachable.
  useEffect(() => {
    if (!showAddModal || editingResident || condos.length === 0) return;
    const exists = condos.some(c => c.id === formData.condoId);
    if (exists) return;
    const nextId = profile?.condoId && condos.some(c => c.id === profile.condoId)
      ? profile.condoId
      : condos[0].id;
    setFormData(f => ({ ...f, condoId: nextId }));
  }, [showAddModal, editingResident, condos, profile?.condoId, formData.condoId]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile) return;
    setSaving(true);
    const selectedCondo = condos.find(c => c.id === formData.condoId);
    let finalUid = editingResident?.uid || '';
    if (!editingResident && formData.password) {
      try {
        const appName = 'SecondaryAppResidents';
        const app2 = (() => { try { return getApp(appName); } catch { return initializeApp(firebaseConfig, { name: appName, automaticDataCollectionEnabled: false }); } })();
        const auth2 = getAuth(app2);
        const cred  = await createUserWithEmailAndPassword(auth2, formData.email, formData.password);
        finalUid = cred.user.uid;
        await signOut(auth2);
        await deleteApp(app2).catch(() => {});
      } catch (e2: any) {
        console.warn('Auth provision warning:', e2.code);
      }
    }
    if (editingResident && formData.password && editingResident.uid) {
      try {
        await authedFetch('/api/users/update-password', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ uid: editingResident.uid, password: formData.password }),
        });
      } catch (e2) {
        console.warn('Password update warning:', e2);
      }
    }
    try {
      const { password, ...rest } = { ...formData, uid: finalUid,
        condoName: selectedCondo?.name || profile?.condoName || '',
        updatedAt: Timestamp.now() };
      let newDocId = '';
      if (editingResident) {
        await updateDoc(doc(db, 'users', editingResident.id), rest);
      } else if (finalUid) {
        await setDoc(doc(db, 'users', finalUid), { ...rest, createdAt: Timestamp.now() });
        newDocId = finalUid;
      } else {
        const ref = await addDoc(collection(db, 'users'), { ...rest, createdAt: Timestamp.now() });
        newDocId = ref.id;
      }
      setShowAddModal(false);
      // Auto-sync new residents to DSS (fire and forget — non-blocking)
      if (newDocId) {
        syncResidentToDss(newDocId, {
          name: formData.name, email: formData.email,
          unit: formData.unit, plates: formData.plates,
        }).catch(() => {});
      }
    } catch (err) {
      handleFirestoreError(err, editingResident ? OperationType.UPDATE : OperationType.CREATE, 'users');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingResident) return;
    try {
      // Borra la cuenta de Firebase Auth Y el doc de Firestore (vía Admin SDK), para que
      // el correo quede LIBRE y se pueda volver a registrar. Pasamos el id del doc (que en
      // residentes con auth = uid); si no hay cuenta Auth, el endpoint igual borra el doc.
      const res = await authedFetch('/api/users/delete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uid: deletingResident.id }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || `Error ${res.status}`);
      }
      setDeletingResident(null);
    } catch (err) {
      // Fallback: si el backend no está disponible, al menos borra el doc de Firestore.
      try { await deleteDoc(doc(db, 'users', deletingResident.id)); setDeletingResident(null); }
      catch { handleFirestoreError(err, OperationType.DELETE, 'users'); }
    }
  };

  // ─── DSS import handlers ──────────────────────────────────────────────────

  const openDssModal = async () => {
    setShowDssModal(true);
    setDssStep(1);
    setSelected(new Set());
    setImportResult(null);
    setDssSearch('');
    await fetchDssPersons();
  };

  const fetchDssPersons = async () => {
    setDssLoading(true);
    setDssError(null);
    setDssPersons([]);
    try {
      const [{ list }, groups] = await Promise.all([
        DahuaService.listPersons(1000),
        DahuaService.listPersonGroups().catch(() => [] as DahuaPersonGroup[]),
      ]);

      setDssPersons(list);
      setDssPersonGroups(groups);

      const gMap: Record<string, string> = {};
      for (const g of groups) {
        const match = condos.find(c =>
          c.name.toLowerCase().trim() === g.baseName.toLowerCase().trim() ||
          c.name.toLowerCase().trim() === g.name.toLowerCase().trim()
        );
        if (match) gMap[g.id] = match.id;
      }
      setGroupCondoMap(gMap);

      const groupUnitMap: Record<string, string> = {};
      for (const g of groups) {
        if (g.unitNo) groupUnitMap[g.id] = g.unitNo;
      }

      const fallbackCondoId = profile?.condoId || condos[0]?.id || '';
      const rows: Record<string, ImportRow> = {};
      for (const p of list) {
        const hasQr = (p.accessGroupIds?.length ?? 0) > 0 || (p.doorAuthInfo?.acsChannelIds?.length ?? 0) > 0;
        const resolvedCondoId = (p.accessGroupId && gMap[p.accessGroupId])
          ? gMap[p.accessGroupId]
          : fallbackCondoId;
        const resolvedUnit = p.roomNo || (p.accessGroupId && groupUnitMap[p.accessGroupId]) || '';
        rows[p.id] = {
          email:        p.email    || '',
          password:     globalPassword,
          phone:        p.phoneNum || '',
          unit:         resolvedUnit,
          condoId:      resolvedCondoId,
          canGenerateQR: hasQr,
        };
      }
      setImportRows(rows);
    } catch (err: any) {
      setDssError(err.message || 'Error al conectar con el Sistema de Portería Virtual');
    } finally {
      setDssLoading(false);
    }
  };

  const togglePerson = (id: string) => {
    setSelected(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const selectAllQrEnabled = () => {
    const ids = dssPersons
      .filter(p => ((p.accessGroupIds?.length ?? 0) > 0 || (p.doorAuthInfo?.acsChannelIds?.length ?? 0) > 0) && !importedDssIds.has(p.id))
      .map(p => p.id);
    setSelected(new Set(ids));
  };

  const selectAll = () => {
    const ids = dssPersons.filter(p => !importedDssIds.has(p.id)).map(p => p.id);
    setSelected(new Set(ids));
  };

  const applyGlobalPassword = () => {
    setImportRows(prev => {
      const next = { ...prev };
      for (const id of selected) {
        if (next[id]) next[id] = { ...next[id], password: globalPassword };
      }
      return next;
    });
  };

  const applyDefaultCondo = () => {
    setImportRows(prev => {
      const next = { ...prev };
      for (const id of selected) {
        if (next[id]) next[id] = { ...next[id], condoId: defaultCondoId };
      }
      return next;
    });
  };

  const handleImport = async () => {
    setImporting(true);
    setImportProgress({ current: 0, total: selected.size });
    let success = 0, failed = 0, skipped = 0;

    const ids: string[] = [...selected];
    for (let i = 0; i < ids.length; i++) {
      const pid: string = ids[i];
      setImportProgress({ current: i + 1, total: ids.length });

      if (importedDssIds.has(pid)) { skipped++; continue; }

      const person = dssPersons.find(p => p.id === pid);
      const row    = importRows[pid];
      if (!person || !row?.email || !row?.password) { failed++; continue; }

      try {
        let uid = '';
        try {
          const appName = `Import_${pid.replace(/\W/g, '_')}`;
          const app2  = (() => { try { return getApp(appName); } catch { return initializeApp(firebaseConfig, { name: appName, automaticDataCollectionEnabled: false }); } })();
          const auth2 = getAuth(app2);
          const cred  = await createUserWithEmailAndPassword(auth2, row.email, row.password);
          uid = cred.user.uid;
          await signOut(auth2);
          await deleteApp(app2).catch(() => {});
        } catch (authErr: any) {
          console.warn(`[Import] auth for ${person.personName}:`, authErr.code);
        }

        const condo = condos.find(c => c.id === row.condoId);
        const residentData: Record<string, any> = {
          name:             person.personName,
          email:            row.email,
          unit:             row.unit,
          condoId:          row.condoId,
          condoName:        condo?.name || '',
          status:           'Activo',
          role:             'resident',
          plates:           person.plateNos || [],
          canGenerateQR:    row.canGenerateQR,
          hasFacilityAccess: true,
          dahuaPersonId:    person.id,
          dahuaPersonCode:  person.personCode,
          dahuaOrgName:     person.orgName,
          uid,
          createdAt:        Timestamp.now(),
          updatedAt:        Timestamp.now(),
        };
        if (row.phone)     residentData.phone   = row.phone;
        if (person.gender) residentData.gender  = person.gender;
        if (uid) {
          await setDoc(doc(db, 'users', uid), residentData);
        } else {
          await addDoc(collection(db, 'users'), residentData);
        }
        success++;
      } catch (err) {
        console.error(`[Import] failed for ${person.personName}:`, err);
        failed++;
      }
    }

    setImporting(false);
    setImportResult({ success, failed, skipped });
    setSelected(new Set());
  };

  // ─── DSS person list helpers ──────────────────────────────────────────────

  const filteredDssPersons = useMemo(() => {
    const term = dssSearch.toLowerCase();
    return dssPersons.filter(p => {
      if (!p.email) return false;
      if (term && !(
        p.personName?.toLowerCase().includes(term) ||
        p.orgName?.toLowerCase().includes(term) ||
        p.phoneNum?.includes(term) ||
        p.personCode?.toLowerCase().includes(term)
      )) return false;
      if (dssCondoFilter) {
        const personCondoId = (p.accessGroupId && groupCondoMap[p.accessGroupId]) || '';
        if (personCondoId !== dssCondoFilter) return false;
      }
      return true;
    });
  }, [dssPersons, dssSearch, dssCondoFilter, groupCondoMap]);

  const groupedDssPersons = useMemo(() => {
    const groups: Record<string, DahuaPerson[]> = {};
    for (const p of filteredDssPersons) {
      const key = p.accessGroupId || '__none__';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) =>
        (a.personName || '').localeCompare(b.personName || '', 'es', { sensitivity: 'base' })
      );
    }
    return groups;
  }, [filteredDssPersons]);

  const getGroupName = (groupId: string): string => {
    if (groupId === '__none__') return 'Sin Grupo';
    return dssPersonGroups.find(g => g.id === groupId)?.name ?? groupId;
  };

  const applyGroupCondo = (groupId: string, condoId: string) => {
    setGroupCondoMap(prev => ({ ...prev, [groupId]: condoId }));
    const groupPersonIds = (groupedDssPersons[groupId] ?? []).map(p => p.id);
    setImportRows(prev => {
      const next = { ...prev };
      for (const pid of groupPersonIds) {
        if (next[pid]) next[pid] = { ...next[pid], condoId };
      }
      return next;
    });
  };

  // ─── DSS sync (per-row manual button) ────────────────────────────────────

  const handleSyncToDss = async (resident: Resident) => {
    setSyncingIds(prev => { const n = new Set(prev); n.add(resident.id); return n; });
    try {
      await syncResidentToDss(resident.id, {
        name: resident.name, email: resident.email,
        unit: resident.unit, plates: resident.plates || [],
        phone: resident.phone,
      });
    } catch (err) {
      console.warn('[DSS] manual sync failed:', err);
    } finally {
      setSyncingIds(prev => { const n = new Set(prev); n.delete(resident.id); return n; });
    }
  };

  // ─── CSV bulk import handlers ─────────────────────────────────────────────

  const applyGlobalCsvPassword = () => {
    if (!globalCsvPassword) return;
    setCsvRows(prev => prev.map(r => {
      const hasPassError = r.errors.some(e => e.startsWith('Contraseña'));
      if (!hasPassError) return r;
      const errors = r.errors.filter(e => !e.startsWith('Contraseña'));
      if (globalCsvPassword.length < 6) errors.push('Contraseña mínimo 6 caracteres');
      return { ...r, contrasena: globalCsvPassword, errors };
    }));
  };

  const updateCsvRowPassword = (rowNum: number, password: string) => {
    setCsvRows(prev => prev.map(r => {
      if (r.rowNum !== rowNum) return r;
      const errors = r.errors.filter(e => !e.startsWith('Contraseña'));
      if (!password || password.length < 6) errors.push('Contraseña mínimo 6 caracteres');
      return { ...r, contrasena: password, errors };
    }));
  };

  const handleCsvFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      const allRows = parseCSV(text);
      if (allRows.length < 2) { setCsvRows([]); return; }
      const headers = allRows[0].map(h => h.toLowerCase().trim().replace(/[\s-]/g, '_'));
      const parsed: CsvRow[] = [];
      for (let i = 1; i < allRows.length; i++) {
        const cols = allRows[i];
        const get = (key: string) => { const idx = headers.indexOf(key); return idx >= 0 ? (cols[idx] ?? '').trim() : ''; };
        const nombre = get('nombre');
        const email  = get('email');
        const contrasena = get('contrasena');
        const unidad = get('unidad');
        const condoInput = get('condominio');
        const telefono = get('telefono');
        const patenteRaw = get('patentes');
        const rolRaw = get('rol') || 'resident';
        const estadoRaw = get('estado') || 'Activo';
        const paseQrRaw = get('pase_qr') || 'true';
        const instalRaw = get('instalaciones') || 'true';

        const condo = condos.find(c =>
          c.name.toLowerCase().trim() === condoInput.toLowerCase().trim() || c.id === condoInput
        );
        const errors: string[] = [];
        if (!nombre) errors.push('Nombre requerido');
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) errors.push('Email inválido');
        if (!contrasena || contrasena.length < 6) errors.push('Contraseña mínimo 6 caracteres');
        if (!unidad) errors.push('Unidad requerida');
        if (!condo) errors.push(`Condominio "${condoInput}" no encontrado`);

        parsed.push({
          rowNum: i,
          nombre, email, contrasena, telefono, unidad, condominio: condoInput,
          patentes: patenteRaw ? patenteRaw.split(/[,;]/).map(p => p.trim().toUpperCase()).filter(Boolean) : [],
          rol: (['resident', 'usuario'] as const).includes(rolRaw as any) ? rolRaw as 'resident' | 'usuario' : 'resident',
          estado: (['Activo', 'Pendiente', 'Inactivo'] as const).includes(estadoRaw as any) ? estadoRaw as 'Activo' | 'Pendiente' | 'Inactivo' : 'Activo',
          paseQr: !['false', '0', 'no'].includes(paseQrRaw.toLowerCase()),
          instalaciones: !['false', '0', 'no'].includes(instalRaw.toLowerCase()),
          resolvedCondoId: condo?.id || '',
          resolvedCondoName: condo?.name || '',
          errors,
        });
      }
      setCsvRows(parsed);
    };
    reader.readAsText(file, 'UTF-8');
    e.target.value = '';
  };

  const handleCsvImport = async () => {
    const validRows = csvRows.filter(r => r.errors.length === 0);
    if (!validRows.length) return;
    setCsvImporting(true);
    setCsvProgress({ current: 0, total: validRows.length });
    let success = 0, failed = 0;

    for (let i = 0; i < validRows.length; i++) {
      const row = validRows[i];
      setCsvProgress({ current: i + 1, total: validRows.length });
      try {
        let uid = '';
        try {
          const appName = `CsvImport_${i}_${Date.now()}`;
          const app2 = (() => { try { return getApp(appName); } catch { return initializeApp(firebaseConfig, { name: appName, automaticDataCollectionEnabled: false }); } })();
          const auth2 = getAuth(app2);
          const cred = await createUserWithEmailAndPassword(auth2, row.email, row.contrasena);
          uid = cred.user.uid;
          await signOut(auth2);
          await deleteApp(app2).catch(() => {});
        } catch (authErr: any) {
          console.warn(`[CSV Import] auth for ${row.nombre}:`, authErr.code);
        }

        const residentData: Record<string, any> = {
          name: row.nombre, email: row.email, unit: row.unidad,
          condoId: row.resolvedCondoId, condoName: row.resolvedCondoName,
          status: row.estado, role: row.rol, plates: row.patentes,
          canGenerateQR: row.paseQr, hasFacilityAccess: row.instalaciones,
          uid, createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
        };
        if (row.telefono) residentData.phone = row.telefono;

        let docId = '';
        if (uid) {
          await setDoc(doc(db, 'users', uid), residentData);
          docId = uid;
        } else {
          const ref = await addDoc(collection(db, 'users'), residentData);
          docId = ref.id;
        }

        // Fire-and-forget DSS sync
        syncResidentToDss(docId, {
          name: row.nombre, email: row.email, unit: row.unidad,
          plates: row.patentes, phone: row.telefono,
        }).catch(() => {});

        success++;
      } catch (err) {
        console.error(`[CSV Import] failed for ${row.nombre}:`, err);
        failed++;
      }
    }

    setCsvImporting(false);
    setCsvResult({ success, failed, skipped: csvRows.length - validRows.length });
  };

  // ─── render ───────────────────────────────────────────────────────────────

  if (loading && !residents.length) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner size={40} />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <PageHeader
        icon={Users}
        title="Residentes"
        description="Gestión de accesos, unidades y dispositivos LPR."
        actions={
          <>
            <div className="relative">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={15} />
              <Input
                type="text"
                placeholder="Buscar por nombre, unidad…"
                value={searchTerm}
                onChange={e => setSearchTerm(e.target.value)}
                className="w-52 pl-9 py-2 text-sm"
              />
            </div>
            {profile?.role === 'super_admin' && (
              <>
                <Button variant="secondary" icon={Wifi} onClick={openDssModal}>
                  Importar DSS
                </Button>
                <Button variant="secondary" icon={Upload} onClick={() => { setCsvRows([]); setCsvResult(null); setShowCsvModal(true); }}>
                  Carga Masiva
                </Button>
              </>
            )}
            <Button icon={Plus} onClick={handleOpenAdd}>
              Nuevo Residente
            </Button>
          </>
        }
      />

      {/* ── Tree + Panel layout ─────────────────────────────────────────────── */}
      {residents.length === 0 && !loading ? (
        <EmptyState
          icon={User}
          title="Sin residentes registrados"
          description='Usa "Importar residentes" o crea uno manualmente.'
          action={<Button icon={Plus} onClick={handleOpenAdd}>Nuevo Residente</Button>}
        />
      ) : (
        <div className="flex gap-4 items-start">

          {/* ── LEFT SIDEBAR: Condo → Unit tree ──────────────────────────── */}
          <Card variant="glass" padding="none" className="w-56 shrink-0 overflow-hidden sticky top-4">
            {/* "All" row */}
            <button
              onClick={() => { setSelectedCondoId(''); setSelectedUnit(''); }}
              className={cn(
                'w-full flex items-center gap-2 px-4 py-3 text-xs font-bold transition-all border-b border-slate-200 dark:border-white/5 cursor-pointer',
                !selectedCondoId
                  ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400'
                  : 'text-slate-500 dark:text-slate-400 hover:bg-slate-50 dark:hover:bg-white/5',
              )}
            >
              <Building2 size={13} className="shrink-0" />
              <span className="truncate">Todos los condos</span>
              <span className="ml-auto text-[9px] font-black bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 rounded-full text-slate-500 dark:text-slate-400">
                {residents.length}
              </span>
            </button>

            <div className="overflow-y-auto max-h-[calc(100vh-280px)] no-scrollbar">
              {condoTree.map(condo => {
                const isCondoSelected = selectedCondoId === condo.condoId && !selectedUnit;
                const isExpanded = expandedCondos.has(condo.condoId) || selectedCondoId === condo.condoId;
                const condoCount = condo.units.reduce((s, u) => s + u.residents.length, 0);
                return (
                  <div key={condo.condoId}>
                    <button
                      onClick={() => {
                        toggleCondo(condo.condoId);
                        setSelectedCondoId(condo.condoId);
                        setSelectedUnit('');
                      }}
                      className={cn(
                        'w-full flex items-center gap-2 px-4 py-2.5 text-xs font-bold transition-all border-b border-slate-100 dark:border-white/[0.04] cursor-pointer',
                        isCondoSelected
                          ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400'
                          : 'text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-white/5',
                      )}
                    >
                      <ChevronRight size={12} className={cn('shrink-0 transition-transform', isExpanded && 'rotate-90')} />
                      <Building2 size={12} className="shrink-0 text-blue-500" />
                      <span className="truncate flex-1 text-left">{condo.condoName}</span>
                      <span className="text-[9px] font-black bg-slate-100 dark:bg-white/10 px-1.5 py-0.5 rounded-full text-slate-500 dark:text-slate-400">
                        {condoCount}
                      </span>
                    </button>

                    {isExpanded && condo.units.map(u => {
                      const isUnitSelected = selectedCondoId === condo.condoId && selectedUnit === u.unit;
                      return (
                        <button
                          key={u.unit}
                          onClick={() => { setSelectedCondoId(condo.condoId); setSelectedUnit(u.unit); }}
                          className={cn(
                            'w-full flex items-center gap-2 pl-9 pr-4 py-2 text-[11px] font-semibold transition-all border-b border-slate-100 dark:border-white/[0.03] cursor-pointer',
                            isUnitSelected
                              ? 'bg-blue-600/15 text-blue-600 dark:text-blue-300'
                              : 'text-slate-500 dark:text-slate-500 hover:bg-slate-50 dark:hover:bg-white/5 hover:text-slate-700 dark:hover:text-slate-300',
                          )}
                        >
                          <Home size={11} className="shrink-0 text-slate-400 dark:text-slate-600" />
                          <span className="truncate flex-1 text-left">{u.unit}</span>
                          <span className="text-[9px] font-black bg-slate-100 dark:bg-white/[0.06] px-1.5 py-0.5 rounded-full text-slate-400 dark:text-slate-500">
                            {u.residents.length}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                );
              })}
            </div>
          </Card>

          {/* ── RIGHT PANEL: Resident cards ───────────────────────────────── */}
          <div className="flex-1 min-w-0">
            {/* Breadcrumb */}
            <div className="flex items-center gap-2 mb-4 text-xs text-slate-500 dark:text-slate-500 font-semibold">
              <span
                className={cn(!selectedCondoId ? 'text-blue-600 dark:text-blue-400' : 'cursor-pointer hover:text-slate-700 dark:hover:text-slate-300')}
                onClick={() => { setSelectedCondoId(''); setSelectedUnit(''); }}
              >
                Todos
              </span>
              {selectedCondoId && (
                <>
                  <ChevronRight size={11} />
                  <span
                    className={cn(!selectedUnit ? 'text-blue-600 dark:text-blue-400' : 'cursor-pointer hover:text-slate-700 dark:hover:text-slate-300')}
                    onClick={() => setSelectedUnit('')}
                  >
                    {condoTree.find(c => c.condoId === selectedCondoId)?.condoName}
                  </span>
                </>
              )}
              {selectedUnit && (
                <>
                  <ChevronRight size={11} />
                  <span className="text-blue-600 dark:text-blue-400">{selectedUnit}</span>
                </>
              )}
              <span className="ml-2 text-[9px] bg-slate-100 dark:bg-white/5 px-2 py-0.5 rounded-full text-slate-400 dark:text-slate-500 font-bold">
                {visibleResidents.length} residente{visibleResidents.length !== 1 ? 's' : ''}
              </span>
            </div>

            {visibleResidents.length === 0 ? (
              <EmptyState
                icon={User}
                title="Sin residentes en esta selección"
                description="Selecciona otra unidad o condominio."
              />
            ) : (
              <Card padding="none" className="overflow-hidden">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-slate-100 dark:border-white/5">
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Residente</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Unidad</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Patentes</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Estado</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Fuente</th>
                        <th className="text-left px-5 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400">Permisos</th>
                        <th className="px-5 py-3" />
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                      <AnimatePresence mode="popLayout">
                        {visibleResidents.map(resident => (
                          <motion.tr
                            key={resident.id}
                            layout
                            initial={{ opacity: 0 }}
                            animate={{ opacity: 1 }}
                            exit={{ opacity: 0 }}
                            className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                          >
                            {/* Nombre + email */}
                            <td className="px-5 py-3.5">
                              <div className="flex items-center gap-3">
                                <div className="w-8 h-8 bg-slate-100 dark:bg-white/5 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400 border border-slate-200 dark:border-white/10 shrink-0">
                                  <User size={15} />
                                </div>
                                <div>
                                  <p className="font-semibold text-slate-900 dark:text-white leading-tight">{resident.name}</p>
                                  <p className="text-xs text-slate-500 dark:text-slate-500 flex items-center gap-1 mt-0.5">
                                    <Mail size={10} />{resident.email}
                                  </p>
                                  {resident.appVersion && (
                                    <p className="text-[10px] text-slate-400 dark:text-slate-500 flex items-center gap-1 mt-0.5">
                                      <Smartphone size={9} />
                                      v{resident.appVersion}
                                      {resident.appPlatform ? ` · ${resident.appPlatform === 'android' ? 'Android' : resident.appPlatform === 'ios' ? 'iOS' : 'Web'}` : ''}
                                      {isAppOutdated(resident.appVersion, resident.appPlatform) && (
                                        <span className="ml-1 text-[9px] font-bold text-amber-700 dark:text-amber-400 bg-amber-500/15 px-1.5 py-0.5 rounded-full">Desactualizado</span>
                                      )}
                                    </p>
                                  )}
                                </div>
                              </div>
                            </td>
                            {/* Unidad */}
                            <td className="px-5 py-3.5">
                              <span className="flex items-center gap-1.5 font-semibold text-slate-700 dark:text-slate-300">
                                <Home size={12} className="text-blue-500 shrink-0" />
                                {resident.unit || '—'}
                              </span>
                            </td>
                            {/* Patentes */}
                            <td className="px-5 py-3.5">
                              <div className="flex flex-wrap gap-1">
                                {resident.plates?.length > 0
                                  ? resident.plates.map((p: string, i: number) => (
                                      <span key={i} className="bg-slate-100 dark:bg-white/5 text-[10px] font-black px-1.5 py-0.5 rounded font-mono text-slate-600 dark:text-slate-400">{p}</span>
                                    ))
                                  : <span className="text-xs text-slate-400">—</span>}
                              </div>
                            </td>
                            {/* Estado */}
                            <td className="px-5 py-3.5">{statusBadge(resident.status)}</td>
                            {/* Fuente */}
                            <td className="px-5 py-3.5">
                              {resident.dahuaPersonId
                                ? <span title={`Portería Virtual: ${resident.dahuaOrgName || resident.dahuaPersonId}`} className="flex items-center gap-1 text-xs font-bold text-indigo-500 dark:text-indigo-400"><Wifi size={11} />Sincronizado</span>
                                : syncingIds.has(resident.id)
                                  ? <span className="flex items-center gap-1 text-xs text-slate-400"><div className="w-3 h-3 border-2 border-slate-300 dark:border-slate-600 border-t-blue-500 rounded-full animate-spin" />Sync…</span>
                                  : <button onClick={() => handleSyncToDss(resident)} title="Sincronizar con Portería Virtual" className="flex items-center gap-1 text-xs font-semibold text-slate-400 dark:text-slate-600 hover:text-indigo-500 dark:hover:text-indigo-400 transition-colors cursor-pointer group">
                                      <CloudUpload size={12} />Manual
                                    </button>}
                            </td>
                            {/* Permisos */}
                            <td className="px-5 py-3.5">
                              <div className="flex gap-1.5">
                                <div className={cn('p-1.5 rounded-lg', resident.canGenerateQR ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' : 'text-slate-300 dark:text-slate-700 bg-slate-100 dark:bg-white/5')} title="Pases QR">
                                  <QrCode size={13} />
                                </div>
                                <div className={cn('p-1.5 rounded-lg', resident.hasFacilityAccess ? 'text-blue-600 dark:text-blue-400 bg-blue-500/10' : 'text-slate-300 dark:text-slate-700 bg-slate-100 dark:bg-white/5')} title="Instalaciones">
                                  <ShieldCheck size={13} />
                                </div>
                              </div>
                            </td>
                            {/* Acciones */}
                            <td className="px-5 py-3.5">
                              <div className="flex items-center justify-end gap-1">
                                <button onClick={() => handleOpenEdit(resident)} className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 rounded-xl transition-all cursor-pointer">
                                  <Edit2 size={14} />
                                </button>
                                <button onClick={() => setDeletingResident(resident)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all cursor-pointer">
                                  <Trash2 size={14} />
                                </button>
                              </div>
                            </td>
                          </motion.tr>
                        ))}
                      </AnimatePresence>
                    </tbody>
                  </table>
                </div>
              </Card>
            )}
          </div>

        </div>
      )}

      {/* ── Manual create/edit modal ─────────────────────────────────────────── */}
      <Modal
        open={showAddModal}
        onClose={() => setShowAddModal(false)}
        icon={User}
        title={editingResident ? 'Editar Ficha' : 'Nuevo Residente'}
        description="Configuración técnica y de acceso para el recinto."
        size="lg"
      >
        <form onSubmit={handleSave}>
          <div className="overflow-y-auto max-h-[60vh] no-scrollbar space-y-5 pr-1">
            {/* Name + email */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <Field label="Nombre Completo" required>
                <div className="relative">
                  <User size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none" />
                  <Input
                    required
                    type="text"
                    value={formData.name}
                    onChange={e => setFormData({ ...formData, name: e.target.value })}
                    className="pl-10"
                    placeholder="Juan Pablo Pérez"
                  />
                </div>
              </Field>

              <Field label="Email de Acceso" required>
                <div className="relative">
                  <Mail size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none" />
                  <Input
                    required
                    type="email"
                    value={formData.email}
                    onChange={e => setFormData({ ...formData, email: e.target.value })}
                    className="pl-10"
                    placeholder="vecino@correo.com"
                  />
                </div>
              </Field>

              <Field label="Contraseña Provisoria" required={!editingResident}>
                <div className="relative">
                  <Lock size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none" />
                  <Input
                    required={!editingResident}
                    type="text"
                    value={formData.password}
                    onChange={e => setFormData({ ...formData, password: e.target.value })}
                    className="pl-10 font-mono"
                    placeholder={editingResident ? '(sin cambios)' : 'vecino123'}
                  />
                </div>
              </Field>

              <Field label="Unidad / N° Casa" required>
                <div className="relative">
                  <Home size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none z-10" />
                  {(() => {
                    const selectedCondo = condos.find(c => c.id === formData.condoId);
                    const units = selectedCondo?.unitNames || [];
                    if (units.length === 0) {
                      return (
                        <>
                          <select
                            disabled
                            className={cn(selectClass, 'pl-10 opacity-60 cursor-not-allowed')}
                          >
                            <option>Sin unidades configuradas</option>
                          </select>
                          <p className="mt-1.5 text-[11px] text-amber-700 dark:text-amber-400 font-medium">
                            Este condominio no tiene unidades configuradas. Ve al módulo Condominios → "Configurar unidades".
                          </p>
                        </>
                      );
                    }
                    // Include the current value as an option even if it's not in the list,
                    // so legacy manually-typed units aren't silently lost in the edit flow.
                    const currentValue = formData.unit;
                    const options = currentValue && !units.includes(currentValue)
                      ? [currentValue, ...units]
                      : units;
                    return (
                      <select
                        required
                        value={formData.unit}
                        onChange={e => setFormData({ ...formData, unit: e.target.value })}
                        className={cn(selectClass, 'pl-10')}
                      >
                        <option value="" disabled hidden>Seleccionar unidad</option>
                        {options.map((u: string) => (
                          <option key={u} value={u}>
                            {u}{currentValue === u && !units.includes(u) ? ' (sin configurar)' : ''}
                          </option>
                        ))}
                      </select>
                    );
                  })()}
                </div>
              </Field>
            </div>

            {/* Status + role + condo */}
            <div className={cn('grid gap-4', profile?.role === 'super_admin' ? 'grid-cols-3' : 'grid-cols-2')}>
              <Field label="Estado">
                <select
                  value={formData.status}
                  onChange={e => setFormData({ ...formData, status: e.target.value as Resident['status'] })}
                  className={selectClass}
                >
                  <option value="Activo">Activo</option>
                  <option value="Pendiente">Pendiente</option>
                  <option value="Inactivo">Inactivo</option>
                </select>
              </Field>

              <Field label="Perfil">
                <select
                  value={formData.role}
                  onChange={e => setFormData({ ...formData, role: e.target.value as Resident['role'] })}
                  className={selectClass}
                >
                  <option value="resident">Residente</option>
                  <option value="usuario">Usuario Extra</option>
                </select>
              </Field>

              {profile?.role === 'super_admin' && (
                <Field label="Condominio">
                  <select
                    value={formData.condoId}
                    onChange={e => setFormData({ ...formData, condoId: e.target.value, unit: '' })}
                    className={selectClass}
                  >
                    {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </Field>
              )}
            </div>

            {/* Permissions + plates */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 bg-slate-50 dark:bg-white/[0.02] p-4 rounded-xl border border-slate-200 dark:border-white/5">
              <div className="space-y-3">
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    id="fac"
                    checked={formData.hasFacilityAccess}
                    onChange={e => setFormData({ ...formData, hasFacilityAccess: e.target.checked })}
                    className="w-4 h-4 rounded accent-blue-600"
                  />
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Acceso a Instalaciones</span>
                </label>
                <label className="flex items-center gap-3 cursor-pointer">
                  <input
                    type="checkbox"
                    id="qr"
                    checked={formData.canGenerateQR}
                    onChange={e => setFormData({ ...formData, canGenerateQR: e.target.checked })}
                    className="w-4 h-4 rounded accent-blue-600"
                  />
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Puede generar Pases QR</span>
                </label>
              </div>

              <Field label="Patentes LPR">
                <div className="relative">
                  <Car size={15} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-blue-500 pointer-events-none" />
                  <Input
                    type="text"
                    value={formData.plates?.join(', ')}
                    onChange={e => setFormData({ ...formData, plates: e.target.value.split(',').map(p => p.trim().toUpperCase()).filter(Boolean) })}
                    className="pl-10 font-mono text-sm"
                    placeholder="ABCD12, FGHI34…"
                  />
                </div>
              </Field>
            </div>

            {/* Fotografía del residente (para enrolamiento facial Dahua) */}
            <Field label="Fotografía">
              <div className="flex items-center gap-3">
                {formData.photoUrl ? (
                  <img src={formData.photoUrl} alt="Foto del residente" className="w-16 h-16 rounded-xl object-cover border border-slate-200 dark:border-white/10" />
                ) : (
                  <div className="w-16 h-16 rounded-xl bg-slate-100 dark:bg-white/5 flex items-center justify-center text-slate-300 dark:text-slate-600">
                    <Camera size={20} />
                  </div>
                )}
                <div className="flex flex-col gap-1.5">
                  <label className="inline-flex items-center gap-1.5 cursor-pointer text-sm font-semibold text-blue-600 dark:text-blue-400">
                    {photoUploading ? <RefreshCw size={14} className="animate-spin" /> : <Upload size={14} />}
                    {photoUploading ? 'Subiendo…' : (formData.photoUrl ? 'Actualizar foto' : 'Subir foto')}
                    <input type="file" accept="image/*" className="hidden" disabled={photoUploading}
                      onChange={e => handlePhotoUpload(e.target.files?.[0])} />
                  </label>
                  {formData.photoUrl && (
                    <div className="flex items-center gap-3">
                      <a href={formData.photoUrl} target="_blank" rel="noopener noreferrer" download
                        className="inline-flex items-center gap-1 text-xs font-semibold text-slate-500 hover:text-slate-700 dark:text-slate-400">
                        <Download size={12} /> Descargar
                      </a>
                      <button type="button" onClick={() => setFormData({ ...formData, photoUrl: '' })}
                        className="inline-flex items-center gap-1 text-xs font-semibold text-red-500 hover:text-red-600">
                        <X size={12} /> Quitar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            </Field>

            {/* Online operators for this condo */}
            {formData.condoId && editingResident && (
              <OnlineOperatorsForCondo condoId={formData.condoId} />
            )}

            {/* Auth notice */}
            <div className="flex gap-3 bg-blue-600/5 border border-blue-500/20 rounded-xl p-4">
              <ShieldAlert className="text-blue-500 shrink-0 mt-0.5" size={16} />
              <p className="text-xs text-blue-500 dark:text-blue-400 font-semibold leading-relaxed">
                Al guardar se autorizará el correo en el sistema de autenticación.
              </p>
            </div>
          </div>

          {/* Actions — inside form so submit works */}
          <div className="flex gap-3 pt-4">
            <Button variant="secondary" type="button" fullWidth onClick={() => setShowAddModal(false)}>
              Cancelar
            </Button>
            <Button type="submit" loading={saving} fullWidth>
              {editingResident ? 'Actualizar Ficha' : 'Activar y Registrar'}
            </Button>
          </div>
        </form>
      </Modal>

      {/* ── DSS Import Modal ─────────────────────────────────────────────────── */}
      <AnimatePresence>
        {showDssModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => { if (!importing) setShowDssModal(false); }} className="absolute inset-0 bg-black/95 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.97, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0 }}
              className="relative w-full max-w-3xl bg-gray-900 border border-gray-800 rounded-2xl sm:rounded-[2.5rem] overflow-hidden shadow-[0_0_120px_rgba(99,102,241,0.15)] flex flex-col max-h-[95vh]">

              {/* Modal header */}
              <div className="flex items-center justify-between p-5 sm:p-8 border-b border-white/5 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-indigo-600 rounded-xl flex items-center justify-center shadow-lg shadow-indigo-600/30">
                    <Wifi className="text-white" size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg sm:text-xl font-black text-white">Importar residentes del Sistema de Portería Virtual</h3>
                    <p className="text-gray-500 text-xs">Módulo Información de Personas y Vehículos</p>
                  </div>
                </div>
                {!importing && (
                  <button onClick={() => setShowDssModal(false)} className="w-9 h-9 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-full flex items-center justify-center transition-all cursor-pointer">
                    <X size={18} />
                  </button>
                )}
              </div>

              {/* ── LOADING state ─────────────────────────────────────────── */}
              {dssLoading && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 p-12">
                  <div className="w-14 h-14 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
                  <p className="text-gray-400 font-bold text-sm">Conectando con el Sistema de Portería Virtual…</p>
                </div>
              )}

              {/* ── ERROR state ───────────────────────────────────────────── */}
              {dssError && !dssLoading && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 p-12 text-center">
                  <AlertCircle className="text-red-500" size={48} />
                  <div>
                    <p className="text-red-400 font-bold text-base mb-1">Error al conectar con el Sistema de Portería Virtual</p>
                    <p className="text-gray-500 text-xs max-w-sm">{dssError}</p>
                  </div>
                  <button onClick={fetchDssPersons} className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-xl text-sm transition-all cursor-pointer">
                    <RefreshCw size={16} /> Reintentar
                  </button>
                </div>
              )}

              {/* ── IMPORT RESULT ─────────────────────────────────────────── */}
              {importResult && !importing && (
                <div className="flex-1 flex flex-col items-center justify-center gap-6 p-10 text-center">
                  <CheckCircle2 className="text-green-500" size={56} />
                  <div className="space-y-1">
                    <h4 className="text-2xl font-black text-white">Importación Completa</h4>
                    <p className="text-gray-400 text-sm">Resumen del proceso de importación</p>
                  </div>
                  <div className="grid grid-cols-3 gap-4 w-full max-w-sm">
                    {[
                      { label: 'Importados', value: importResult.success, color: 'text-green-400' },
                      { label: 'Ya existían', value: importResult.skipped, color: 'text-yellow-400' },
                      { label: 'Con error',   value: importResult.failed,  color: 'text-red-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-white/5 rounded-2xl p-4 border border-white/5">
                        <p className={`text-3xl font-black ${color}`}>{value}</p>
                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">{label}</p>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => { setShowDssModal(false); setImportResult(null); }}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-black py-3 px-8 rounded-xl transition-all cursor-pointer">
                    Cerrar
                  </button>
                </div>
              )}

              {/* ── IMPORTING progress ────────────────────────────────────── */}
              {importing && (
                <div className="flex-1 flex flex-col items-center justify-center gap-5 p-12 text-center">
                  <div className="w-14 h-14 border-4 border-indigo-500/20 border-t-indigo-500 rounded-full animate-spin" />
                  <div>
                    <p className="text-white font-bold text-base">Importando residentes…</p>
                    <p className="text-gray-500 text-sm mt-1">{importProgress.current} de {importProgress.total}</p>
                  </div>
                  <div className="w-64 bg-gray-800 rounded-full h-2">
                    <div
                      className="bg-indigo-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${importProgress.total ? (importProgress.current / importProgress.total) * 100 : 0}%` }}
                    />
                  </div>
                </div>
              )}

              {/* ── STEP 1: Select persons ────────────────────────────────── */}
              {!dssLoading && !dssError && !importing && !importResult && dssStep === 1 && (
                <>
                  <div className="flex flex-wrap items-center gap-3 px-5 sm:px-8 py-4 border-b border-white/5 shrink-0 bg-gray-900/50">
                    <div className="relative flex-1 min-w-[160px]">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                      <input type="text" placeholder="Buscar persona…" value={dssSearch}
                        onChange={e => setDssSearch(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl py-2.5 pl-9 pr-4 text-white text-sm focus:border-indigo-600 outline-none" />
                    </div>
                    <select
                      value={dssCondoFilter}
                      onChange={e => setDssCondoFilter(e.target.value)}
                      className="bg-gray-950 border border-gray-800 rounded-xl py-2.5 px-3 text-sm text-white focus:border-indigo-600 outline-none min-w-[140px]"
                    >
                      <option value="">Todos los condos</option>
                      {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <button onClick={selectAllQrEnabled} className="flex items-center gap-1.5 bg-green-600/10 hover:bg-green-600/20 border border-green-500/20 text-green-400 font-bold py-2 px-4 rounded-xl text-xs transition-all cursor-pointer">
                      <QrCode size={13} /> Solo QR activo
                    </button>
                    <button onClick={selectAll} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-gray-300 font-bold py-2 px-4 rounded-xl text-xs transition-all cursor-pointer">
                      <CheckSquare size={13} /> Todos
                    </button>
                    <button onClick={() => setSelected(new Set())} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-gray-400 font-bold py-2 px-3 rounded-xl text-xs transition-all cursor-pointer">
                      <Square size={13} /> Ninguno
                    </button>
                    <button onClick={fetchDssPersons} title="Recargar" className="p-2 bg-white/5 hover:bg-white/10 text-gray-400 rounded-xl transition-all cursor-pointer">
                      <RefreshCw size={14} />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto no-scrollbar px-4 sm:px-6 py-4 space-y-6">
                    {dssPersons.length === 0 ? (
                      <div className="text-center py-12 text-gray-500 text-sm">No se encontraron personas en el Sistema de Portería Virtual.</div>
                    ) : (
                      (Object.entries(groupedDssPersons) as [string, DahuaPerson[]][])
                        .sort(([aId], [bId]) => {
                          const aName = condos.find(c => c.id === (groupCondoMap[aId] || ''))?.name || 'zzz';
                          const bName = condos.find(c => c.id === (groupCondoMap[bId] || ''))?.name || 'zzz';
                          return aName.localeCompare(bName, 'es', { sensitivity: 'base' });
                        })
                        .map(([groupId, persons]) => (
                        <div key={groupId}>
                          <div className="flex items-center gap-2 mb-3 flex-wrap">
                            <Building2 size={13} className="text-indigo-400 shrink-0" />
                            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">
                              {getGroupName(groupId)}
                            </span>
                            <div className="flex-1 h-px bg-white/5 min-w-[20px]" />
                            <select
                              value={groupCondoMap[groupId] || importRows[persons[0]?.id]?.condoId || ''}
                              onChange={e => applyGroupCondo(groupId, e.target.value)}
                              onClick={e => e.stopPropagation()}
                              className="text-[10px] bg-gray-900 border border-indigo-500/30 rounded-lg py-1 px-2 text-indigo-300 font-bold focus:border-indigo-500 outline-none"
                            >
                              <option value="">— asignar condo —</option>
                              {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </div>
                          <div className="space-y-2">
                            {persons.map(p => {
                              const hasQr      = (p.accessGroupIds?.length ?? 0) > 0 || (p.doorAuthInfo?.acsChannelIds?.length ?? 0) > 0;
                              const isImported = importedDssIds.has(p.id);
                              const isSelected = selected.has(p.id);
                              return (
                                <div key={p.id} onClick={() => !isImported && togglePerson(p.id)}
                                  className={cn('flex items-center gap-3 p-3 rounded-xl border transition-all select-none',
                                    isImported  ? 'opacity-40 cursor-not-allowed border-gray-800 bg-gray-900'  :
                                    isSelected  ? 'border-indigo-500/50 bg-indigo-600/10 cursor-pointer'       :
                                                  'border-gray-800 bg-gray-950/50 hover:border-gray-700 cursor-pointer')}>
                                  <div className={cn('shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all',
                                    isImported ? 'border-gray-700 bg-gray-800' :
                                    isSelected ? 'border-indigo-500 bg-indigo-600' : 'border-gray-700')}>
                                    {(isSelected || isImported) && <div className="w-2.5 h-2.5 bg-white rounded-sm" />}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <div className="flex items-center gap-2 flex-wrap">
                                      <span className="font-bold text-white text-sm truncate">{p.personName}</span>
                                      {isImported && <span className="text-[9px] font-black bg-gray-800 text-gray-400 px-2 py-0.5 rounded-full uppercase">Ya importado</span>}
                                    </div>
                                    <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                                      {(p.roomNo || p.personCode) && <span className="text-[10px] text-gray-500 font-mono">{p.roomNo ? `🏠 ${p.roomNo}` : `#${p.personCode}`}</span>}
                                      {p.phoneNum   && <span className="text-[10px] text-gray-500 flex items-center gap-1"><Phone size={9} />{p.phoneNum}</span>}
                                      {p.email      && <span className="text-[10px] text-gray-500 truncate max-w-[120px]">{p.email}</span>}
                                      {p.plateNos?.map((pl, i) => (
                                        <span key={i} className="text-[10px] font-black font-mono text-gray-400 bg-gray-800 px-1.5 py-0.5 rounded">{pl}</span>
                                      ))}
                                    </div>
                                  </div>
                                  <div className={cn('shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black',
                                    hasQr ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-gray-800 text-gray-500')}>
                                    {hasQr ? <QrCode size={11} /> : <WifiOff size={11} />}
                                    {hasQr ? 'QR' : 'Sin acc.'}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))
                    )}
                  </div>

                  <div className="flex items-center justify-between px-5 sm:px-8 py-4 border-t border-white/5 shrink-0 bg-gray-900/50">
                    <div className="text-sm text-gray-400">
                      <span className="font-black text-white">{selected.size}</span> seleccionados de{' '}
                      <span className="font-black text-white">{dssPersons.filter(p => !importedDssIds.has(p.id)).length}</span> disponibles
                      {' · '}
                      <span className="text-green-400 font-bold">{dssPersons.filter(p => (p.accessGroupIds?.length ?? 0) > 0 || (p.doorAuthInfo?.acsChannelIds?.length ?? 0) > 0).length} con QR activo</span>
                    </div>
                    <button
                      onClick={() => setDssStep(2)}
                      disabled={selected.size === 0}
                      className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black py-3 px-6 rounded-xl transition-all text-sm shadow-lg shadow-indigo-600/20 cursor-pointer"
                    >
                      Configurar <ChevronRight size={16} />
                    </button>
                  </div>
                </>
              )}

              {/* ── STEP 2: Configure + Import ────────────────────────────── */}
              {!dssLoading && !dssError && !importing && !importResult && dssStep === 2 && (
                <>
                  <div className="px-5 sm:px-8 py-4 border-b border-white/5 shrink-0 space-y-3">
                    <p className="text-xs text-gray-400">Configura email, contraseña, unidad y condominio para cada residente a importar.</p>
                    <div className="flex flex-wrap gap-3">
                      <div className="flex gap-2 flex-1 min-w-[200px]">
                        <div className="relative flex-1">
                          <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-indigo-400" />
                          <input
                            type="text"
                            placeholder="Contraseña global"
                            value={globalPassword}
                            onChange={e => setGlobalPassword(e.target.value)}
                            className="w-full bg-gray-950 border border-gray-800 rounded-xl py-2.5 pl-9 pr-3 text-white text-sm font-mono focus:border-indigo-600 outline-none"
                          />
                        </div>
                        <button onClick={applyGlobalPassword} className="bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/30 text-indigo-300 hover:text-white font-bold py-2 px-3 rounded-xl text-xs transition-all whitespace-nowrap cursor-pointer">
                          Aplicar a todos
                        </button>
                      </div>
                      <div className="flex gap-2 flex-1 min-w-[180px]">
                        <select value={defaultCondoId} onChange={e => setDefaultCondoId(e.target.value)}
                          className="flex-1 bg-gray-950 border border-gray-800 rounded-xl py-2.5 px-3 text-white text-sm focus:border-indigo-600 outline-none">
                          {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <button onClick={applyDefaultCondo} className="bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/30 text-indigo-300 hover:text-white font-bold py-2 px-3 rounded-xl text-xs transition-all whitespace-nowrap cursor-pointer">
                          Aplicar condo
                        </button>
                      </div>
                    </div>
                  </div>

                  <div className="flex-1 overflow-y-auto no-scrollbar px-4 sm:px-6 py-4 space-y-3">
                    {([...selected] as string[])
                      .sort((a, b) => {
                        const aName = condos.find(c => c.id === importRows[a]?.condoId)?.name || '';
                        const bName = condos.find(c => c.id === importRows[b]?.condoId)?.name || '';
                        return aName.localeCompare(bName, 'es', { sensitivity: 'base' });
                      })
                      .map((pid: string) => {
                      const person = dssPersons.find(p => p.id === pid);
                      if (!person) return null;
                      const row   = (importRows as Record<string, ImportRow>)[pid];
                      const hasQr = (person.accessGroupIds?.length ?? 0) > 0 || (person.doorAuthInfo?.acsChannelIds?.length ?? 0) > 0;
                      return (
                        <div key={pid} className="bg-gray-950/70 border border-gray-800 rounded-2xl p-4 space-y-3">
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-indigo-600/10 rounded-xl flex items-center justify-center text-indigo-400 shrink-0"><User size={16} /></div>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-white text-sm truncate">{person.personName}</p>
                              <p className="text-[10px] text-gray-500">{person.orgName} · #{person.personCode}</p>
                            </div>
                            <span className={cn('text-[10px] font-black px-2 py-0.5 rounded-lg border',
                              hasQr ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-gray-800 text-gray-500 border-gray-700')}>
                              {hasQr ? 'QR activo' : 'Sin acceso'}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            <div>
                              <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest ml-1">Email</label>
                              <div className="relative mt-1">
                                <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                <input type="email" required value={row?.email || ''}
                                  onChange={e => setImportRows(prev => ({ ...prev, [pid]: { ...(prev as Record<string, ImportRow>)[pid], email: (e.target as HTMLInputElement).value } }))}
                                  className="w-full bg-gray-900 border border-gray-800 rounded-xl py-2.5 pl-9 pr-3 text-white text-sm focus:border-indigo-600 outline-none"
                                  placeholder="vecino@correo.com" />
                              </div>
                            </div>
                            <div>
                              <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest ml-1">Contraseña</label>
                              <div className="relative mt-1">
                                <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                <input type="text" required value={row?.password || ''}
                                  onChange={e => setImportRows(prev => ({ ...prev, [pid]: { ...(prev as Record<string, ImportRow>)[pid], password: (e.target as HTMLInputElement).value } }))}
                                  className="w-full bg-gray-900 border border-gray-800 rounded-xl py-2.5 pl-9 pr-3 text-white text-sm font-mono focus:border-indigo-600 outline-none" />
                              </div>
                            </div>
                            <div>
                              <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest ml-1">Teléfono</label>
                              <div className="relative mt-1">
                                <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                <input type="tel" value={row?.phone || ''}
                                  onChange={e => setImportRows(prev => ({ ...prev, [pid]: { ...(prev as Record<string, ImportRow>)[pid], phone: (e.target as HTMLInputElement).value } }))}
                                  className="w-full bg-gray-900 border border-gray-800 rounded-xl py-2.5 pl-9 pr-3 text-white text-sm focus:border-indigo-600 outline-none"
                                  placeholder="+56 9 1234 5678" />
                              </div>
                            </div>
                            <div>
                              <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest ml-1">Unidad / N°casa</label>
                              <div className="relative mt-1">
                                <Home size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                <input type="text" value={row?.unit || ''}
                                  onChange={e => setImportRows(prev => ({ ...prev, [pid]: { ...(prev as Record<string, ImportRow>)[pid], unit: (e.target as HTMLInputElement).value } }))}
                                  className="w-full bg-gray-900 border border-gray-800 rounded-xl py-2.5 pl-9 pr-3 text-white text-sm focus:border-indigo-600 outline-none"
                                  placeholder="Torre B-204" />
                              </div>
                            </div>
                            <div className="sm:col-span-2">
                              <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest ml-1">Condominio</label>
                              <select value={row?.condoId || ''} onChange={e => setImportRows(prev => ({ ...prev, [pid]: { ...(prev as Record<string, ImportRow>)[pid], condoId: (e.target as HTMLSelectElement).value } }))}
                                className="w-full mt-1 bg-gray-900 border border-gray-800 rounded-xl py-2.5 px-3 text-white text-sm focus:border-indigo-600 outline-none">
                                {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                            </div>
                          </div>

                          <div className="flex items-center gap-3 pt-1">
                            <input type="checkbox" id={`qr-${pid}`} checked={row?.canGenerateQR ?? hasQr}
                              onChange={e => setImportRows(prev => ({ ...prev, [pid as string]: { ...(prev as Record<string, ImportRow>)[pid], canGenerateQR: e.target.checked } }))}
                              className="w-4 h-4 rounded bg-black text-indigo-600" />
                            <label htmlFor={`qr-${pid}`} className="text-xs font-bold text-gray-300 cursor-pointer">Habilitar generación de Pases QR en esta app</label>
                            {hasQr && <span className="text-[9px] text-green-400 font-black bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">Tiene acceso registrado</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  <div className="flex items-center justify-between px-5 sm:px-8 py-4 border-t border-white/5 shrink-0 bg-gray-900/50">
                    <button onClick={() => setDssStep(1)} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-gray-300 font-bold py-3 px-5 rounded-xl text-sm transition-all cursor-pointer">
                      ← Volver
                    </button>
                    <button
                      onClick={handleImport}
                      disabled={([...selected] as string[]).some((pid: string) => !(importRows as Record<string, ImportRow>)[pid]?.email)}
                      className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black py-3 px-6 rounded-xl transition-all text-sm shadow-lg shadow-indigo-600/20 cursor-pointer"
                    >
                      <Wifi size={16} />
                      Importar {selected.size} residente{selected.size !== 1 ? 's' : ''}
                    </button>
                  </div>
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── CSV Bulk Import Modal ───────────────────────────────────────────── */}
      <AnimatePresence>
        {showCsvModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              onClick={() => { if (!csvImporting) setShowCsvModal(false); }}
              className="absolute inset-0 bg-black/90 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.97, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.97, opacity: 0 }}
              className="relative w-full max-w-3xl bg-gray-900 border border-gray-800 rounded-2xl sm:rounded-[2.5rem] overflow-hidden shadow-[0_0_120px_rgba(59,130,246,0.12)] flex flex-col max-h-[95vh]">

              {/* Header */}
              <div className="flex items-center justify-between p-5 sm:p-8 border-b border-white/5 shrink-0">
                <div className="flex items-center gap-3">
                  <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shadow-lg shadow-blue-600/30">
                    <FileText className="text-white" size={20} />
                  </div>
                  <div>
                    <h3 className="text-lg sm:text-xl font-black text-white">Carga Masiva desde CSV</h3>
                    <p className="text-gray-500 text-xs">Importa residentes desde una planilla</p>
                  </div>
                </div>
                {!csvImporting && (
                  <button onClick={() => setShowCsvModal(false)} className="w-9 h-9 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-full flex items-center justify-center transition-all cursor-pointer">
                    <X size={18} />
                  </button>
                )}
              </div>

              {/* Importing progress */}
              {csvImporting && (
                <div className="flex-1 flex flex-col items-center justify-center gap-5 p-12 text-center">
                  <div className="w-14 h-14 border-4 border-blue-500/20 border-t-blue-500 rounded-full animate-spin" />
                  <div>
                    <p className="text-white font-bold text-base">Importando residentes…</p>
                    <p className="text-gray-500 text-sm mt-1">{csvProgress.current} de {csvProgress.total}</p>
                  </div>
                  <div className="w-64 bg-gray-800 rounded-full h-2">
                    <div className="bg-blue-500 h-2 rounded-full transition-all duration-300"
                      style={{ width: `${csvProgress.total ? (csvProgress.current / csvProgress.total) * 100 : 0}%` }} />
                  </div>
                </div>
              )}

              {/* Result */}
              {csvResult && !csvImporting && (
                <div className="flex-1 flex flex-col items-center justify-center gap-6 p-10 text-center">
                  <CheckCircle2 className="text-green-500" size={56} />
                  <div className="space-y-1">
                    <h4 className="text-2xl font-black text-white">Importación Completa</h4>
                    <p className="text-gray-400 text-sm">Residentes sincronizados con Portería Virtual en segundo plano</p>
                  </div>
                  <div className="grid grid-cols-3 gap-4 w-full max-w-sm">
                    {[
                      { label: 'Importados', value: csvResult.success, color: 'text-green-400' },
                      { label: 'Omitidos',   value: csvResult.skipped, color: 'text-yellow-400' },
                      { label: 'Con error',  value: csvResult.failed,  color: 'text-red-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-white/5 rounded-2xl p-4 border border-white/5">
                        <p className={`text-3xl font-black ${color}`}>{value}</p>
                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">{label}</p>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => { setShowCsvModal(false); setCsvResult(null); setCsvRows([]); }}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-black py-3 px-8 rounded-xl transition-all cursor-pointer">
                    Cerrar
                  </button>
                </div>
              )}

              {/* Main content */}
              {!csvImporting && !csvResult && (
                <>
                  {csvRows.length === 0 ? (
                    /* Upload area */
                    <div className="flex-1 flex flex-col items-center justify-center gap-6 p-10">
                      <label className="flex flex-col items-center gap-4 border-2 border-dashed border-gray-700 hover:border-blue-500 rounded-2xl p-10 cursor-pointer transition-colors w-full max-w-md">
                        <div className="w-14 h-14 bg-blue-600/10 rounded-2xl flex items-center justify-center">
                          <Upload className="text-blue-400" size={28} />
                        </div>
                        <div className="text-center">
                          <p className="text-white font-bold">Selecciona tu archivo CSV</p>
                          <p className="text-gray-500 text-sm mt-1">o arrastra y suelta aquí</p>
                        </div>
                        <input type="file" accept=".csv,text/csv" onChange={handleCsvFile} className="sr-only" />
                      </label>
                      <button onClick={() => downloadCsvTemplate(condos)}
                        className="flex items-center gap-2 bg-white/5 hover:bg-white/10 border border-white/10 text-gray-300 font-bold py-2.5 px-5 rounded-xl text-sm transition-all cursor-pointer">
                        <Download size={14} /> Descargar plantilla CSV
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Preview toolbar */}
                      <div className="px-5 sm:px-8 py-3 border-b border-white/5 shrink-0 space-y-2">
                        <div className="flex items-center justify-between">
                          <div className="text-sm text-gray-400">
                            <span className="text-white font-bold">{csvRows.filter((r: CsvRow) => r.errors.length === 0).length}</span> válidos ·{' '}
                            <span className="text-red-400 font-bold">{csvRows.filter((r: CsvRow) => r.errors.length > 0).length}</span> con errores
                          </div>
                          <label className="flex items-center gap-2 text-xs text-gray-400 hover:text-white font-bold cursor-pointer transition-colors">
                            <Upload size={13} /> Cambiar archivo
                            <input type="file" accept=".csv,text/csv" onChange={handleCsvFile} className="sr-only" />
                          </label>
                        </div>
                        {/* Global password override — visible only when there are password errors */}
                        {csvRows.some((r: CsvRow) => r.errors.some(e => e.startsWith('Contraseña'))) && (
                          <div className="flex items-center gap-2">
                            <Lock size={12} className="text-yellow-400 shrink-0" />
                            <input
                              type="text"
                              placeholder="Contraseña global para filas con error…"
                              value={globalCsvPassword}
                              onChange={e => setGlobalCsvPassword(e.target.value)}
                              className="flex-1 bg-gray-950 border border-yellow-500/30 rounded-xl py-2 px-3 text-white text-xs font-mono focus:border-yellow-400 outline-none"
                            />
                            <button
                              onClick={applyGlobalCsvPassword}
                              disabled={!globalCsvPassword}
                              className="bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 text-yellow-300 font-bold py-2 px-3 rounded-xl text-xs transition-all whitespace-nowrap cursor-pointer disabled:opacity-40"
                            >
                              Aplicar a errores
                            </button>
                          </div>
                        )}
                      </div>

                      {/* Preview table */}
                      <div className="flex-1 overflow-y-auto no-scrollbar">
                        <table className="w-full text-xs">
                          <thead className="sticky top-0 bg-gray-900/95">
                            <tr className="border-b border-white/5">
                              {['#', 'Nombre', 'Email', 'Contraseña', 'Unidad', 'Condominio', 'Estado'].map(h => (
                                <th key={h} className="text-left px-4 py-2.5 text-[9px] font-black text-gray-500 uppercase tracking-widest">{h}</th>
                              ))}
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-white/[0.04]">
                            {csvRows.map((row: CsvRow) => {
                              const passErr = row.errors.some(e => e.startsWith('Contraseña'));
                              return (
                                <tr key={row.rowNum} className={row.errors.length > 0 ? 'bg-red-900/10' : ''}>
                                  <td className="px-4 py-2 text-gray-600">{row.rowNum}</td>
                                  <td className="px-4 py-2 text-white font-semibold">{row.nombre || <span className="text-red-400">—</span>}</td>
                                  <td className="px-4 py-2 text-gray-400 max-w-[130px] truncate">{row.email || <span className="text-red-400">—</span>}</td>
                                  <td className="px-4 py-1.5 min-w-[130px]">
                                    <input
                                      type="text"
                                      value={row.contrasena}
                                      onChange={e => updateCsvRowPassword(row.rowNum, e.target.value)}
                                      className={`w-full bg-transparent rounded px-1.5 py-1 text-xs font-mono outline-none focus:bg-gray-800 border transition-colors ${passErr ? 'border-red-500/60 text-red-300' : 'border-transparent text-gray-300'}`}
                                      placeholder="mín. 6 caracteres"
                                    />
                                  </td>
                                  <td className="px-4 py-2 text-gray-300">{row.unidad || <span className="text-red-400">—</span>}</td>
                                  <td className="px-4 py-2 text-gray-300">{row.resolvedCondoName || <span className="text-red-400">{row.condominio}</span>}</td>
                                  <td className="px-4 py-2">
                                    {row.errors.length > 0
                                      ? <span className="text-[9px] font-black text-red-400 bg-red-500/10 px-2 py-0.5 rounded-full">{row.errors[0]}</span>
                                      : <span className="text-[9px] font-black text-green-400 bg-green-500/10 px-2 py-0.5 rounded-full">OK</span>}
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>

                      {/* Footer */}
                      <div className="flex items-center justify-between px-5 sm:px-8 py-4 border-t border-white/5 shrink-0 bg-gray-900/50">
                        <button onClick={() => setCsvRows([])} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-gray-300 font-bold py-3 px-5 rounded-xl text-sm transition-all cursor-pointer">
                          ← Volver
                        </button>
                        <button
                          onClick={handleCsvImport}
                          disabled={csvRows.filter(r => r.errors.length === 0).length === 0}
                          className="flex items-center gap-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black py-3 px-6 rounded-xl transition-all text-sm shadow-lg shadow-blue-600/20 cursor-pointer"
                        >
                          <Upload size={16} />
                          Importar {csvRows.filter(r => r.errors.length === 0).length} residente{csvRows.filter(r => r.errors.length === 0).length !== 1 ? 's' : ''}
                        </button>
                      </div>
                    </>
                  )}
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Delete confirmation ──────────────────────────────────────────────── */}
      <Modal
        open={!!deletingResident}
        onClose={() => setDeletingResident(null)}
        icon={AlertOctagon}
        title="¿Anular Residente?"
        description={`Se revocará el acceso de ${deletingResident?.name ?? ''} a todas las instalaciones.`}
        size="sm"
      >
        <div className="flex gap-3 pt-2">
          <Button variant="secondary" fullWidth onClick={() => setDeletingResident(null)}>
            Cancelar
          </Button>
          <Button variant="danger" fullWidth onClick={handleDelete}>
            Anular
          </Button>
        </div>
      </Modal>

    </motion.div>
  );
};

export default Residents;
