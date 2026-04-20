import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import {
  collection, query, where, onSnapshot, addDoc, setDoc, updateDoc,
  doc, deleteDoc, Timestamp,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  Plus, Search, User, Users, Home, QrCode, ShieldCheck, Mail, Edit2, Trash2,
  AlertOctagon, Car, ShieldAlert, Wifi, WifiOff, Phone,
  Building2, CheckSquare, Square, RefreshCw, CheckCircle2, AlertCircle,
  ChevronRight, Lock, X,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn, handleFirestoreError, OperationType } from '../lib/utils';
import { initializeApp, deleteApp, getApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import DahuaService, { DahuaPerson, DahuaPersonGroup } from '../services/DahuaService';
import firebaseConfig from '../../firebase-applet-config.json';
import { Button, Card, PageHeader, Field, Input, Modal, EmptyState, Badge, Spinner } from '../components/ui';

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
  dahuaPersonId?: string;
  dahuaOrgName?: string;
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
  });

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
    });
    setShowAddModal(true);
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
        await fetch('/api/users/update-password', {
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
      if (editingResident) {
        await updateDoc(doc(db, 'users', editingResident.id), rest);
      } else if (finalUid) {
        await setDoc(doc(db, 'users', finalUid), { ...rest, createdAt: Timestamp.now() });
      } else {
        await addDoc(collection(db, 'users'), { ...rest, createdAt: Timestamp.now() });
      }
      setShowAddModal(false);
    } catch (err) {
      handleFirestoreError(err, editingResident ? OperationType.UPDATE : OperationType.CREATE, 'users');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingResident) return;
    try {
      await deleteDoc(doc(db, 'users', deletingResident.id));
      setDeletingResident(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'users');
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
      setDssError(err.message || 'Error al conectar con Dahua DSS');
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
    if (groupId === '__none__') return 'Sin Grupo DSS';
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
            <Button variant="secondary" icon={Wifi} onClick={openDssModal}>
              Importar DSS
            </Button>
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
          description='Usa "Importar desde DSS" o crea uno manualmente.'
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
              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
                <AnimatePresence>
                  {visibleResidents.map(resident => (
                    <motion.div
                      layout
                      key={resident.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                    >
                      <Card variant="glass" hoverable padding="none" className="relative overflow-hidden group">
                        <div className="absolute top-0 right-0 w-24 h-24 bg-blue-600/5 rounded-full -mr-12 -mt-12 blur-2xl group-hover:bg-blue-600/10 transition-colors pointer-events-none" />

                        <div className="p-5">
                          {/* Card header */}
                          <div className="flex justify-between items-start mb-3">
                            <div className="w-10 h-10 bg-slate-100 dark:bg-white/5 rounded-xl flex items-center justify-center text-blue-600 dark:text-blue-400 border border-slate-200 dark:border-white/10 group-hover:scale-110 transition-transform shadow-inner">
                              <User size={18} />
                            </div>
                            <div className="flex flex-col items-end gap-1.5">
                              {statusBadge(resident.status)}
                              {resident.dahuaPersonId
                                ? <span title={`DSS: ${resident.dahuaOrgName || resident.dahuaPersonId}`} className="flex items-center gap-1 text-[9px] font-bold text-indigo-400 dark:text-indigo-400">
                                    <Wifi size={10} />DSS
                                  </span>
                                : <span className="text-[9px] text-slate-400 dark:text-slate-600 font-bold">Manual</span>}
                            </div>
                          </div>

                          {/* Name + email */}
                          <div className="space-y-2 mb-4">
                            <div>
                              <h3 className="text-base font-bold text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors leading-tight">
                                {resident.name}
                              </h3>
                              <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-500 mt-0.5">
                                <Mail size={10} />
                                <span className="truncate">{resident.email}</span>
                              </div>
                            </div>

                            <div className="flex items-center gap-3 text-xs flex-wrap">
                              <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                                <Home size={11} className="text-blue-500" />
                                <span className="font-bold">{resident.unit || '—'}</span>
                              </div>
                              {resident.plates?.length > 0 && resident.plates.map((p, i) => (
                                <span key={i} className="bg-slate-100 dark:bg-white/5 text-[10px] font-black px-1.5 py-0.5 rounded font-mono text-slate-600 dark:text-slate-400">{p}</span>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Card footer */}
                        <div className="flex items-center justify-between px-5 py-3 border-t border-slate-200 dark:border-white/5">
                          <div className="flex gap-1.5">
                            <div className={cn('p-1.5 rounded-lg', resident.canGenerateQR ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/10' : 'text-slate-300 dark:text-slate-700 bg-slate-100 dark:bg-white/5')} title="Pases QR">
                              <QrCode size={13} />
                            </div>
                            <div className={cn('p-1.5 rounded-lg', resident.hasFacilityAccess ? 'text-blue-600 dark:text-blue-400 bg-blue-500/10' : 'text-slate-300 dark:text-slate-700 bg-slate-100 dark:bg-white/5')} title="Instalaciones">
                              <ShieldCheck size={13} />
                            </div>
                          </div>
                          <div className="flex gap-1">
                            <button onClick={() => handleOpenEdit(resident)} className="p-2 text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 rounded-xl transition-all cursor-pointer">
                              <Edit2 size={15} />
                            </button>
                            <button onClick={() => setDeletingResident(resident)} className="p-2 text-slate-400 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all cursor-pointer">
                              <Trash2 size={15} />
                            </button>
                          </div>
                        </div>
                      </Card>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
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
                    <h3 className="text-lg sm:text-xl font-black text-white">Importar desde Dahua DSS Pro</h3>
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
                  <p className="text-gray-400 font-bold text-sm">Conectando con Dahua DSS Pro…</p>
                </div>
              )}

              {/* ── ERROR state ───────────────────────────────────────────── */}
              {dssError && !dssLoading && (
                <div className="flex-1 flex flex-col items-center justify-center gap-4 p-12 text-center">
                  <AlertCircle className="text-red-500" size={48} />
                  <div>
                    <p className="text-red-400 font-bold text-base mb-1">Error al conectar con DSS</p>
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
                    <button onClick={fetchDssPersons} title="Recargar desde DSS" className="p-2 bg-white/5 hover:bg-white/10 text-gray-400 rounded-xl transition-all cursor-pointer">
                      <RefreshCw size={14} />
                    </button>
                  </div>

                  <div className="flex-1 overflow-y-auto no-scrollbar px-4 sm:px-6 py-4 space-y-6">
                    {dssPersons.length === 0 ? (
                      <div className="text-center py-12 text-gray-500 text-sm">No se encontraron personas en DSS Pro.</div>
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
                            {hasQr && <span className="text-[9px] text-green-400 font-black bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">Tiene acceso en DSS</span>}
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
