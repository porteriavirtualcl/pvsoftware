import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import {
  collection, query, where, onSnapshot, addDoc, setDoc, updateDoc,
  doc, deleteDoc, Timestamp,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  Plus, Search, User, Home, QrCode, ShieldCheck, Mail, Edit2, Trash2, X,
  AlertOctagon, Car, Settings, ShieldAlert, Wifi, WifiOff, Phone,
  Building2, CheckSquare, Square, RefreshCw, CheckCircle2, AlertCircle,
  ChevronRight, Lock,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType } from '../lib/utils';
import { initializeApp, deleteApp, getApp } from 'firebase/app';
import { getAuth, createUserWithEmailAndPassword, signOut } from 'firebase/auth';
import DahuaService, { DahuaPerson, DahuaPersonGroup } from '../services/DahuaService';
import firebaseConfig from '../../firebase-applet-config.json';

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

// ─── component ────────────────────────────────────────────────────────────────

const Residents = () => {
  const { profile, user } = useAuth();

  // ── Firestore state ─────────────────────────────────────────────────────────
  const [residents, setResidents] = useState<Resident[]>([]);
  const [loading, setLoading]     = useState(true);
  const [condos, setCondos]       = useState<{ id: string; name: string }[]>([]);

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

  // ── DSS import modal ────────────────────────────────────────────────────────
  const [showDssModal, setShowDssModal]   = useState(false);
  const [dssStep, setDssStep]             = useState<1 | 2>(1);
  const [dssPersons, setDssPersons]       = useState<DahuaPerson[]>([]);
  const [dssPersonGroups, setDssPersonGroups] = useState<DahuaPersonGroup[]>([]);
  /** Maps DSS person-group ID → app condo ID */
  const [groupCondoMap, setGroupCondoMap] = useState<Record<string, string>>({});
  const [dssLoading, setDssLoading]       = useState(false);
  const [dssError, setDssError]           = useState<string | null>(null);
  const [dssSearch, setDssSearch]         = useState('');
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
      const list = snap.docs.map(d => ({ id: d.id, name: d.data().name as string }));
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

  // ─── derived: sorted & grouped ───────────────────────────────────────────

  const filteredResidents = useMemo(() =>
    residents.filter(r =>
      r.name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
      r.unit?.toLowerCase().includes(searchTerm.toLowerCase())
    ), [residents, searchTerm]);

  // Group by condoName, sorted alphabetically. Within each group sort by unit (numeric-aware).
  const groupedResidents = useMemo(() => {
    const sorted = [...filteredResidents].sort((a, b) => {
      const cc = (a.condoName || '').localeCompare(b.condoName || '', 'es', { sensitivity: 'base' });
      if (cc !== 0) return cc;
      return (a.unit || '').localeCompare(b.unit || '', 'es', { numeric: true, sensitivity: 'base' });
    });
    const groups: Record<string, Resident[]> = {};
    for (const r of sorted) {
      const key = r.condoName || 'Sin Condominio';
      if (!groups[key]) groups[key] = [];
      groups[key].push(r);
    }
    return groups;
  }, [filteredResidents]);

  // Set of dahuaPersonIds already imported (to skip on re-import)
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
      // Fetch persons and person groups in parallel
      const [{ list }, groups] = await Promise.all([
        DahuaService.listPersons(1000),
        DahuaService.listPersonGroups().catch(() => [] as DahuaPersonGroup[]),
      ]);

      setDssPersons(list);
      setDssPersonGroups(groups);

      // Auto-map DSS person groups → app condos by name (case-insensitive)
      const gMap: Record<string, string> = {};
      for (const g of groups) {
        const match = condos.find(c =>
          c.name.toLowerCase().trim() === g.name.toLowerCase().trim()
        );
        if (match) gMap[g.id] = match.id;
      }
      setGroupCondoMap(gMap);

      // Pre-fill importRows using all available DSS fields
      const fallbackCondoId = profile?.condoId || condos[0]?.id || '';
      const rows: Record<string, ImportRow> = {};
      for (const p of list) {
        const hasQr = (p.accessGroupIds?.length ?? 0) > 0 || (p.doorAuthInfo?.acsChannelIds?.length ?? 0) > 0;
        // Resolve condo from person's primary group mapping
        const resolvedCondoId = (p.accessGroupId && gMap[p.accessGroupId])
          ? gMap[p.accessGroupId]
          : fallbackCondoId;
        rows[p.id] = {
          email:        p.email    || '',
          password:     globalPassword,
          phone:        p.phoneNum || '',
          unit:         p.roomNo || p.personCode || '',
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
          // email already exists — continue with uid = '', Firestore doc still useful
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
        if (row.phone)  residentData.phone  = row.phone;
        if (person.gender) residentData.gender = person.gender;
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

  // ─── DSS person list (filtered + grouped by person group) ───────────────────

  const filteredDssPersons = useMemo(() => {
    const term = dssSearch.toLowerCase();
    return dssPersons.filter(p =>
      !term ||
      p.personName?.toLowerCase().includes(term) ||
      p.orgName?.toLowerCase().includes(term) ||
      p.phoneNum?.includes(term) ||
      p.personCode?.toLowerCase().includes(term)
    );
  }, [dssPersons, dssSearch]);

  /** Groups keyed by DSS person-group ID (or '__none__' for ungrouped) */
  const groupedDssPersons = useMemo(() => {
    const groups: Record<string, DahuaPerson[]> = {};
    for (const p of filteredDssPersons) {
      const key = p.accessGroupId || '__none__';
      if (!groups[key]) groups[key] = [];
      groups[key].push(p);
    }
    // Sort persons within each group by name
    for (const key of Object.keys(groups)) {
      groups[key].sort((a, b) =>
        (a.personName || '').localeCompare(b.personName || '', 'es', { sensitivity: 'base' })
      );
    }
    return groups;
  }, [filteredDssPersons]);

  /** Resolve DSS group ID to its display name */
  const getGroupName = (groupId: string): string => {
    if (groupId === '__none__') return 'Sin Grupo DSS';
    return dssPersonGroups.find(g => g.id === groupId)?.name ?? groupId;
  };

  /** When user maps a group to a condo, update all persons in that group */
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
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
      </div>
    );
  }

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-8">

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 bg-gray-900/50 p-6 rounded-2xl border border-gray-800">
        <div className="space-y-0.5">
          <div className="flex items-center gap-3">
            <h2 className="text-xl font-black text-white italic tracking-tight uppercase">Gestión de Residentes</h2>
            <span className="bg-blue-600/10 text-blue-500 px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-widest border border-blue-500/20">
              {residents.length} Totales
            </span>
          </div>
          <p className="text-gray-500 text-xs font-medium italic">Administración de accesos, unidades y dispositivos LPR.</p>
        </div>

        <div className="flex flex-col sm:flex-row gap-3">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-gray-400" size={16} />
            <input
              type="text"
              placeholder="Buscar por nombre, unidad…"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full sm:w-56 bg-gray-950 border border-gray-800 rounded-xl py-3 pl-10 pr-4 text-white text-sm focus:border-blue-600 outline-none transition-all"
            />
          </div>
          {/* Import DSS */}
          <button
            onClick={openDssModal}
            className="flex items-center justify-center gap-2 bg-indigo-600/10 hover:bg-indigo-600 border border-indigo-500/30 text-indigo-400 hover:text-white font-black py-3 px-5 rounded-xl transition-all text-sm"
          >
            <Wifi size={16} />
            Importar desde DSS
          </button>
          {/* New manual */}
          <button
            onClick={handleOpenAdd}
            className="flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-black py-3 px-5 rounded-xl transition-all shadow-lg shadow-blue-600/20 text-sm"
          >
            <Plus size={18} />
            Nuevo Residente
          </button>
        </div>
      </div>

      {/* ── Grouped resident grid ───────────────────────────────────────────── */}
      {Object.keys(groupedResidents).length === 0 && !loading ? (
        <div className="flex flex-col items-center justify-center py-20 text-center space-y-4">
          <div className="w-20 h-20 bg-gray-900 rounded-full flex items-center justify-center text-gray-700"><User size={40} /></div>
          <div>
            <h3 className="text-xl font-bold text-white">Sin residentes registrados</h3>
            <p className="text-gray-500 text-sm mt-1">Usa "Importar desde DSS" o crea uno manualmente.</p>
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          {(Object.entries(groupedResidents) as [string, Resident[]][]).map(([condoName, group]) => (
            <div key={condoName}>
              {/* Group header */}
              <div className="flex items-center gap-3 mb-4">
                <Building2 size={16} className="text-blue-500 shrink-0" />
                <h3 className="text-xs font-black text-blue-400 uppercase tracking-widest">{condoName}</h3>
                <span className="text-[9px] font-black text-gray-600 bg-gray-800 px-2 py-0.5 rounded-full">{group.length}</span>
                <div className="flex-1 h-px bg-white/5" />
              </div>

              <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4 sm:gap-6">
                <AnimatePresence>
                  {group.map(resident => (
                    <motion.div
                      layout key={resident.id}
                      initial={{ opacity: 0, scale: 0.95 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.95 }}
                      className="bg-gray-900 border border-gray-800 rounded-2xl p-6 hover:border-blue-500/50 transition-all group relative overflow-hidden shadow-lg"
                    >
                      <div className="absolute top-0 right-0 w-24 h-24 bg-blue-600/5 rounded-full -mr-12 -mt-12 blur-2xl group-hover:bg-blue-600/10 transition-colors" />

                      <div className="flex justify-between items-start mb-4">
                        <div className="w-11 h-11 bg-gray-950 rounded-xl flex items-center justify-center text-blue-500 border border-gray-800 group-hover:scale-110 transition-transform shadow-inner">
                          <User size={20} />
                        </div>
                        <div className="flex flex-col items-end gap-1.5">
                          <span className={`px-3 py-1 rounded-full text-[10px] font-black uppercase tracking-widest border ${
                            resident.status === 'Activo'    ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                            resident.status === 'Pendiente' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' :
                                                              'bg-red-500/10 text-red-500 border-red-500/20'
                          }`}>{resident.status}</span>
                          {resident.dahuaPersonId
                            ? <span title={`DSS: ${resident.dahuaOrgName || resident.dahuaPersonId}`}
                                className="flex items-center gap-1 text-[9px] font-bold text-indigo-400">
                                <Wifi size={10} />DSS
                              </span>
                            : <span className="text-[9px] text-gray-700 font-bold">Manual</span>}
                        </div>
                      </div>

                      <div className="space-y-3 mb-6">
                        <div>
                          <h3 className="text-lg font-bold text-white group-hover:text-blue-400 transition-colors">{resident.name}</h3>
                          <div className="flex items-center gap-2 text-xs text-gray-500 mt-0.5">
                            <Mail size={11} /><span>{resident.email}</span>
                          </div>
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                          <div className="bg-gray-950/50 p-3 rounded-xl border border-gray-800/50">
                            <p className="text-[9px] text-gray-600 font-black uppercase tracking-tighter mb-1">Unidad</p>
                            <div className="flex items-center gap-2 text-sm font-bold text-gray-300">
                              <Home size={13} className="text-blue-500" />{resident.unit || '—'}
                            </div>
                          </div>
                          <div className="bg-gray-950/50 p-3 rounded-xl border border-gray-800/50">
                            <p className="text-[9px] text-gray-600 font-black uppercase tracking-tighter mb-1">Vehículos LPR</p>
                            <div className="flex items-center gap-2 text-sm font-bold text-gray-300">
                              <Car size={13} className="text-blue-500" />{resident.plates?.length || 0}
                            </div>
                          </div>
                        </div>

                        {resident.plates?.length > 0 && (
                          <div className="flex flex-wrap gap-1.5">
                            {resident.plates.map((p, i) => (
                              <span key={i} className="bg-gray-800 text-[10px] font-black px-2 py-0.5 rounded text-gray-400 font-mono">{p}</span>
                            ))}
                          </div>
                        )}
                      </div>

                      <div className="flex items-center justify-between pt-4 border-t border-gray-800/50">
                        <div className="flex gap-2">
                          <div className={`p-2 rounded-lg ${resident.canGenerateQR ? 'text-green-500 bg-green-500/10' : 'text-gray-700 bg-gray-800/20'}`} title="Pases QR">
                            <QrCode size={15} />
                          </div>
                          <div className={`p-2 rounded-lg ${resident.hasFacilityAccess ? 'text-blue-500 bg-blue-500/10' : 'text-gray-700 bg-gray-800/20'}`} title="Instalaciones">
                            <ShieldCheck size={15} />
                          </div>
                        </div>
                        <div className="flex gap-1">
                          <button onClick={() => handleOpenEdit(resident)} className="p-2 text-gray-500 hover:text-white hover:bg-white/5 rounded-xl transition-all"><Edit2 size={16} /></button>
                          <button onClick={() => setDeletingResident(resident)} className="p-2 text-gray-500 hover:text-red-500 hover:bg-red-500/10 rounded-xl transition-all"><Trash2 size={16} /></button>
                        </div>
                      </div>
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* ── Manual create/edit modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddModal(false)} className="absolute inset-0 bg-black/95 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.95, opacity: 0, y: 20 }} animate={{ scale: 1, opacity: 1, y: 0 }} exit={{ scale: 0.95, opacity: 0, y: 20 }}
              className="relative w-full max-w-2xl bg-gray-900 border border-gray-800 rounded-2xl sm:rounded-[3rem] p-5 sm:p-10 overflow-y-auto max-h-[90vh] no-scrollbar shadow-[0_0_100px_rgba(37,99,235,0.1)]">
              <div className="flex justify-between items-center mb-6 sm:mb-8">
                <div>
                  <h3 className="text-xl sm:text-3xl font-black text-white italic">{editingResident ? 'Editar Ficha' : 'Nuevo Residente'}</h3>
                  <p className="text-gray-500 text-xs mt-1">Configuración técnica y de acceso para el recinto.</p>
                </div>
                <button onClick={() => setShowAddModal(false)} className="w-10 h-10 bg-gray-800 hover:bg-gray-700 rounded-2xl flex items-center justify-center text-white transition-all shrink-0 ml-3"><X size={18} /></button>
              </div>

              <form onSubmit={handleSave} className="space-y-5 sm:space-y-6">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-6">
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Nombre Completo</label>
                    <div className="relative">
                      <User size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" />
                      <input required type="text" value={formData.name} onChange={e => setFormData({ ...formData, name: e.target.value })}
                        className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 pl-11 pr-4 text-white font-bold focus:border-blue-600 outline-none" placeholder="Juan Pablo Pérez" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Email de Acceso</label>
                    <div className="relative">
                      <Mail size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" />
                      <input required type="email" value={formData.email} onChange={e => setFormData({ ...formData, email: e.target.value })}
                        className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 pl-11 pr-4 text-white font-bold focus:border-blue-600 outline-none" placeholder="vecino@correo.com" />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Contraseña Provisoria</label>
                    <div className="relative">
                      <Lock size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" />
                      <input required={!editingResident} type="text" value={formData.password} onChange={e => setFormData({ ...formData, password: e.target.value })}
                        className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 pl-11 pr-4 text-white font-bold focus:border-blue-600 outline-none font-mono" placeholder={editingResident ? '(sin cambios)' : 'vecino123'} />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em] ml-1">Unidad / N° Casa</label>
                    <div className="relative">
                      <Home size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" />
                      <input required type="text" value={formData.unit} onChange={e => setFormData({ ...formData, unit: e.target.value })}
                        className="w-full bg-gray-950 border border-gray-800 rounded-2xl py-4 pl-11 pr-4 text-white font-bold focus:border-blue-600 outline-none" placeholder="Torre B - 204" />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {['Estado', 'Perfil', ...(profile?.role === 'super_admin' ? ['Condominio'] : [])].map(label => (
                    <div key={label} className="space-y-2">
                      <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">{label}</label>
                      {label === 'Estado' && (
                        <select value={formData.status} onChange={e => setFormData({ ...formData, status: e.target.value as Resident['status'] })}
                          className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white font-bold">
                          <option value="Activo">Activo</option>
                          <option value="Pendiente">Pendiente</option>
                          <option value="Inactivo">Inactivo</option>
                        </select>
                      )}
                      {label === 'Perfil' && (
                        <select value={formData.role} onChange={e => setFormData({ ...formData, role: e.target.value as Resident['role'] })}
                          className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white font-bold">
                          <option value="resident">Residente</option>
                          <option value="usuario">Usuario Extra</option>
                        </select>
                      )}
                      {label === 'Condominio' && (
                        <select value={formData.condoId} onChange={e => setFormData({ ...formData, condoId: e.target.value })}
                          className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 px-4 text-white font-bold">
                          {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                      )}
                    </div>
                  ))}
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-gray-950/50 p-5 sm:p-6 rounded-2xl border border-gray-800">
                  <div className="space-y-4">
                    <div className="flex items-center gap-3">
                      <input type="checkbox" id="fac" checked={formData.hasFacilityAccess} onChange={e => setFormData({ ...formData, hasFacilityAccess: e.target.checked })} className="w-5 h-5 rounded bg-black text-blue-600" />
                      <label htmlFor="fac" className="text-sm font-bold text-gray-300 cursor-pointer">Acceso a Instalaciones</label>
                    </div>
                    <div className="flex items-center gap-3">
                      <input type="checkbox" id="qr" checked={formData.canGenerateQR} onChange={e => setFormData({ ...formData, canGenerateQR: e.target.checked })} className="w-5 h-5 rounded bg-black text-blue-600" />
                      <label htmlFor="qr" className="text-sm font-bold text-gray-300 cursor-pointer">Puede generar Pases QR</label>
                    </div>
                  </div>
                  <div className="space-y-2">
                    <label className="text-[10px] font-black text-gray-400 uppercase tracking-[0.2em]">Patentes LPR</label>
                    <div className="relative">
                      <Car size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" />
                      <input type="text" value={formData.plates?.join(', ')}
                        onChange={e => setFormData({ ...formData, plates: e.target.value.split(',').map(p => p.trim().toUpperCase()).filter(Boolean) })}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl py-3 pl-11 pr-4 text-white font-mono text-sm" placeholder="ABCD12, FGHI34…" />
                    </div>
                  </div>
                </div>

                <div className="bg-blue-600/5 p-4 rounded-2xl border border-blue-500/20 flex gap-3">
                  <ShieldAlert className="text-blue-500 shrink-0 mt-0.5" size={18} />
                  <p className="text-[10px] text-blue-400 font-black tracking-wide leading-relaxed uppercase">Al guardar se autorizará el correo en el sistema de autenticación.</p>
                </div>

                <button type="submit" disabled={saving}
                  className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-4 rounded-2xl transition-all shadow-2xl shadow-blue-600/30 flex items-center justify-center gap-3 text-base">
                  {saving ? <div className="w-5 h-5 border-4 border-white/30 border-t-white rounded-full animate-spin" /> : (editingResident ? 'Actualizar Ficha' : 'Activar y Registrar')}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

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
                  <button onClick={() => setShowDssModal(false)} className="w-9 h-9 bg-white/5 hover:bg-white/10 text-gray-400 hover:text-white rounded-full flex items-center justify-center transition-all">
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
                  <button onClick={fetchDssPersons} className="flex items-center gap-2 bg-gray-800 hover:bg-gray-700 text-white font-bold py-3 px-6 rounded-xl text-sm transition-all">
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
                      { label: 'Con error', value: importResult.failed, color: 'text-red-400' },
                    ].map(({ label, value, color }) => (
                      <div key={label} className="bg-white/5 rounded-2xl p-4 border border-white/5">
                        <p className={`text-3xl font-black ${color}`}>{value}</p>
                        <p className="text-[10px] text-gray-500 font-bold uppercase tracking-widest mt-1">{label}</p>
                      </div>
                    ))}
                  </div>
                  <button onClick={() => { setShowDssModal(false); setImportResult(null); }}
                    className="bg-blue-600 hover:bg-blue-500 text-white font-black py-3 px-8 rounded-xl transition-all">
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
                  {/* Toolbar */}
                  <div className="flex flex-wrap items-center gap-3 px-5 sm:px-8 py-4 border-b border-white/5 shrink-0 bg-gray-900/50">
                    <div className="relative flex-1 min-w-[160px]">
                      <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                      <input type="text" placeholder="Buscar persona…" value={dssSearch}
                        onChange={e => setDssSearch(e.target.value)}
                        className="w-full bg-gray-950 border border-gray-800 rounded-xl py-2.5 pl-9 pr-4 text-white text-sm focus:border-indigo-600 outline-none" />
                    </div>
                    <button onClick={selectAllQrEnabled} className="flex items-center gap-1.5 bg-green-600/10 hover:bg-green-600/20 border border-green-500/20 text-green-400 font-bold py-2 px-4 rounded-xl text-xs transition-all">
                      <QrCode size={13} /> Solo QR activo
                    </button>
                    <button onClick={selectAll} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-gray-300 font-bold py-2 px-4 rounded-xl text-xs transition-all">
                      <CheckSquare size={13} /> Todos
                    </button>
                    <button onClick={() => setSelected(new Set())} className="flex items-center gap-1.5 bg-white/5 hover:bg-white/10 text-gray-400 font-bold py-2 px-3 rounded-xl text-xs transition-all">
                      <Square size={13} /> Ninguno
                    </button>
                    <button onClick={fetchDssPersons} title="Recargar desde DSS" className="p-2 bg-white/5 hover:bg-white/10 text-gray-400 rounded-xl transition-all">
                      <RefreshCw size={14} />
                    </button>
                  </div>

                  {/* Persons list */}
                  <div className="flex-1 overflow-y-auto no-scrollbar px-4 sm:px-6 py-4 space-y-6">
                    {dssPersons.length === 0 ? (
                      <div className="text-center py-12 text-gray-500 text-sm">No se encontraron personas en DSS Pro.</div>
                    ) : (
                      (Object.entries(groupedDssPersons) as [string, DahuaPerson[]][]).map(([groupId, persons]) => (
                        <div key={groupId}>
                          {/* Group header with condo mapping */}
                          <div className="flex items-center gap-2 mb-3 flex-wrap">
                            <Building2 size={13} className="text-indigo-400 shrink-0" />
                            <span className="text-[10px] font-black text-indigo-400 uppercase tracking-widest">
                              {getGroupName(groupId)}
                            </span>
                            <div className="flex-1 h-px bg-white/5 min-w-[20px]" />
                            {/* Condo selector for this group */}
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
                                  className={`flex items-center gap-3 p-3 rounded-xl border transition-all cursor-pointer select-none ${
                                    isImported  ? 'opacity-40 cursor-not-allowed border-gray-800 bg-gray-900'  :
                                    isSelected  ? 'border-indigo-500/50 bg-indigo-600/10'                      :
                                                  'border-gray-800 bg-gray-950/50 hover:border-gray-700'}`}>
                                  {/* Checkbox */}
                                  <div className={`shrink-0 w-5 h-5 rounded-md border-2 flex items-center justify-center transition-all ${
                                    isImported ? 'border-gray-700 bg-gray-800' :
                                    isSelected ? 'border-indigo-500 bg-indigo-600' : 'border-gray-700'}`}>
                                    {(isSelected || isImported) && <div className="w-2.5 h-2.5 bg-white rounded-sm" />}
                                  </div>
                                  {/* Info */}
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
                                  {/* QR badge */}
                                  <div className={`shrink-0 flex items-center gap-1 px-2 py-1 rounded-lg text-[10px] font-black ${
                                    hasQr ? 'bg-green-500/10 text-green-400 border border-green-500/20' : 'bg-gray-800 text-gray-500'}`}>
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

                  {/* Footer step 1 */}
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
                      className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black py-3 px-6 rounded-xl transition-all text-sm shadow-lg shadow-indigo-600/20"
                    >
                      Configurar <ChevronRight size={16} />
                    </button>
                  </div>
                </>
              )}

              {/* ── STEP 2: Configure + Import ────────────────────────────── */}
              {!dssLoading && !dssError && !importing && !importResult && dssStep === 2 && (
                <>
                  {/* Toolbar */}
                  <div className="px-5 sm:px-8 py-4 border-b border-white/5 shrink-0 space-y-3">
                    <p className="text-xs text-gray-400">Configura email, contraseña, unidad y condominio para cada residente a importar.</p>
                    {/* Global controls */}
                    <div className="flex flex-wrap gap-3">
                      {/* Global password */}
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
                        <button onClick={applyGlobalPassword} className="bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/30 text-indigo-300 hover:text-white font-bold py-2 px-3 rounded-xl text-xs transition-all whitespace-nowrap">
                          Aplicar a todos
                        </button>
                      </div>
                      {/* Default condo */}
                      <div className="flex gap-2 flex-1 min-w-[180px]">
                        <select value={defaultCondoId} onChange={e => setDefaultCondoId(e.target.value)}
                          className="flex-1 bg-gray-950 border border-gray-800 rounded-xl py-2.5 px-3 text-white text-sm focus:border-indigo-600 outline-none">
                          {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                        </select>
                        <button onClick={applyDefaultCondo} className="bg-indigo-600/20 hover:bg-indigo-600 border border-indigo-500/30 text-indigo-300 hover:text-white font-bold py-2 px-3 rounded-xl text-xs transition-all whitespace-nowrap">
                          Aplicar condo
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Per-person config */}
                  <div className="flex-1 overflow-y-auto no-scrollbar px-4 sm:px-6 py-4 space-y-3">
                    {([...selected] as string[]).map((pid: string) => {
                      const person = dssPersons.find(p => p.id === pid);
                      if (!person) return null;
                      const row    = (importRows as Record<string,ImportRow>)[pid];
                      const hasQr  = (person.accessGroupIds?.length ?? 0) > 0 || (person.doorAuthInfo?.acsChannelIds?.length ?? 0) > 0;
                      return (
                        <div key={pid} className="bg-gray-950/70 border border-gray-800 rounded-2xl p-4 space-y-3">
                          {/* Person header */}
                          <div className="flex items-center gap-3">
                            <div className="w-9 h-9 bg-indigo-600/10 rounded-xl flex items-center justify-center text-indigo-400 shrink-0"><User size={16} /></div>
                            <div className="flex-1 min-w-0">
                              <p className="font-bold text-white text-sm truncate">{person.personName}</p>
                              <p className="text-[10px] text-gray-500">{person.orgName} · #{person.personCode}</p>
                            </div>
                            <span className={`text-[10px] font-black px-2 py-0.5 rounded-lg border ${hasQr ? 'bg-green-500/10 text-green-400 border-green-500/20' : 'bg-gray-800 text-gray-500 border-gray-700'}`}>
                              {hasQr ? 'QR activo' : 'Sin acceso'}
                            </span>
                          </div>

                          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                            {/* Email */}
                            <div>
                              <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest ml-1">Email</label>
                              <div className="relative mt-1">
                                <Mail size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                <input type="email" required value={row?.email || ''}
                                  onChange={e => setImportRows(prev => ({ ...prev, [pid]: { ...(prev as Record<string,ImportRow>)[pid], email: (e.target as HTMLInputElement).value } }))}
                                  className="w-full bg-gray-900 border border-gray-800 rounded-xl py-2.5 pl-9 pr-3 text-white text-sm focus:border-indigo-600 outline-none"
                                  placeholder="vecino@correo.com" />
                              </div>
                            </div>
                            {/* Password */}
                            <div>
                              <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest ml-1">Contraseña</label>
                              <div className="relative mt-1">
                                <Lock size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                <input type="text" required value={row?.password || ''}
                                  onChange={e => setImportRows(prev => ({ ...prev, [pid]: { ...(prev as Record<string,ImportRow>)[pid], password: (e.target as HTMLInputElement).value } }))}
                                  className="w-full bg-gray-900 border border-gray-800 rounded-xl py-2.5 pl-9 pr-3 text-white text-sm font-mono focus:border-indigo-600 outline-none" />
                              </div>
                            </div>
                            {/* Phone */}
                            <div>
                              <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest ml-1">Teléfono</label>
                              <div className="relative mt-1">
                                <Phone size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                <input type="tel" value={row?.phone || ''}
                                  onChange={e => setImportRows(prev => ({ ...prev, [pid]: { ...(prev as Record<string,ImportRow>)[pid], phone: (e.target as HTMLInputElement).value } }))}
                                  className="w-full bg-gray-900 border border-gray-800 rounded-xl py-2.5 pl-9 pr-3 text-white text-sm focus:border-indigo-600 outline-none"
                                  placeholder="+56 9 1234 5678" />
                              </div>
                            </div>
                            {/* Unit */}
                            <div>
                              <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest ml-1">Unidad / Código</label>
                              <div className="relative mt-1">
                                <Home size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-500" />
                                <input type="text" value={row?.unit || ''}
                                  onChange={e => setImportRows(prev => ({ ...prev, [pid]: { ...(prev as Record<string,ImportRow>)[pid], unit: (e.target as HTMLInputElement).value } }))}
                                  className="w-full bg-gray-900 border border-gray-800 rounded-xl py-2.5 pl-9 pr-3 text-white text-sm focus:border-indigo-600 outline-none"
                                  placeholder="Torre B-204" />
                              </div>
                            </div>
                            {/* Condo */}
                            <div className="sm:col-span-2">
                              <label className="text-[9px] font-black text-gray-500 uppercase tracking-widest ml-1">Condominio</label>
                              <select value={row?.condoId || ''} onChange={e => setImportRows(prev => ({ ...prev, [pid]: { ...(prev as Record<string,ImportRow>)[pid], condoId: (e.target as HTMLSelectElement).value } }))}
                                className="w-full mt-1 bg-gray-900 border border-gray-800 rounded-xl py-2.5 px-3 text-white text-sm focus:border-indigo-600 outline-none">
                                {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                              </select>
                            </div>
                          </div>

                          {/* QR toggle */}
                          <div className="flex items-center gap-3 pt-1">
                            <input type="checkbox" id={`qr-${pid}`} checked={row?.canGenerateQR ?? hasQr}
                              onChange={e => setImportRows(prev => ({ ...prev, [pid as string]: { ...(prev as Record<string,ImportRow>)[pid], canGenerateQR: e.target.checked } }))}
                              className="w-4 h-4 rounded bg-black text-indigo-600" />
                            <label htmlFor={`qr-${pid}`} className="text-xs font-bold text-gray-300 cursor-pointer">Habilitar generación de Pases QR en esta app</label>
                            {hasQr && <span className="text-[9px] text-green-400 font-black bg-green-500/10 px-2 py-0.5 rounded-full border border-green-500/20">Tiene acceso en DSS</span>}
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer step 2 */}
                  <div className="flex items-center justify-between px-5 sm:px-8 py-4 border-t border-white/5 shrink-0 bg-gray-900/50">
                    <button onClick={() => setDssStep(1)} className="flex items-center gap-2 bg-white/5 hover:bg-white/10 text-gray-300 font-bold py-3 px-5 rounded-xl text-sm transition-all">
                      ← Volver
                    </button>
                    <button
                      onClick={handleImport}
                      disabled={([...selected] as string[]).some((pid: string) => !(importRows as Record<string,ImportRow>)[pid]?.email)}
                      className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black py-3 px-6 rounded-xl transition-all text-sm shadow-lg shadow-indigo-600/20"
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
      <AnimatePresence>
        {deletingResident && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeletingResident(null)} className="absolute inset-0 bg-black/90 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.95, opacity: 0 }}
              className="relative w-full max-w-sm bg-gray-900 border border-gray-800 rounded-2xl sm:rounded-[2.5rem] p-6 sm:p-10 text-center shadow-2xl">
              <AlertOctagon className="text-red-500 mx-auto mb-5" size={48} />
              <h3 className="text-xl sm:text-2xl font-black text-white mb-2 italic">¿Anular Residente?</h3>
              <p className="text-gray-500 text-sm font-medium mb-8 leading-relaxed">Se revocará el acceso de <span className="text-white font-bold">{deletingResident.name}</span> a todas las instalaciones.</p>
              <div className="flex gap-4">
                <button onClick={() => setDeletingResident(null)} className="flex-1 bg-gray-800 text-white py-4 rounded-2xl font-black transition-all">Cancelar</button>
                <button onClick={handleDelete} className="flex-1 bg-red-600 text-white py-4 rounded-2xl font-black transition-all shadow-xl shadow-red-600/20">Anular</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

    </motion.div>
  );
};

export default Residents;
