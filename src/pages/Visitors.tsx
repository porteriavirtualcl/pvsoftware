import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import {
  collection, query, where, onSnapshot, addDoc, Timestamp,
  orderBy, doc, updateDoc, deleteDoc, collectionGroup, getDoc,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  QrCode, Plus, Clock, User, Car, AlertCircle,
  Edit2, Trash2, ShieldCheck, Building2, Wifi, WifiOff, RotateCcw,
  CreditCard, MessageCircle, DoorOpen,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType, cn } from '../lib/utils';
import DahuaService from '../services/DahuaService';
import {
  PageHeader, Card, Button, Modal, Field, Input, Badge, EmptyState, Spinner,
} from '../components/ui';

// ─── types ────────────────────────────────────────────────────────────────────

interface Visitor {
  id: string;
  userId: string;
  visitorName: string;
  entryTime: string;
  exitTime: string;
  date: string;
  licensePlate?: string;
  phone?: string;
  rut?: string;
  hostName?: string;
  qrCodeValue: string;
  status: 'pending' | 'entered' | 'exited';
  condoId: string;
  createdAt: any;
  dahuaVisitorId?: string;
  dahuaQrCode?: string;
}

interface CondoOption {
  id: string;
  name: string;
  dahuaChannelIds?: string[];
}

function toUnixSeconds(date: string, time: string): number {
  return Math.floor(new Date(`${date}T${time}:00`).getTime() / 1000);
}

const selectClass = cn(
  'block w-full bg-white dark:bg-slate-950/50',
  'border border-slate-200 dark:border-white/10',
  'rounded-xl px-3.5 py-2.5 text-[15px]',
  'text-slate-900 dark:text-slate-100',
  'outline-none transition',
  'focus:border-blue-600 dark:focus:border-blue-500',
  'focus:ring-2 focus:ring-blue-500/20',
  'appearance-none',
);

const statusMap: Record<Visitor['status'], { variant: 'brand' | 'success' | 'warn' | 'danger' | 'muted'; label: string }> = {
  pending: { variant: 'warn',    label: 'Próximo' },
  entered: { variant: 'success', label: 'En sitio' },
  exited:  { variant: 'muted',   label: 'Finalizado' },
};

const STATUS_TABS: { value: Visitor['status'] | ''; label: string }[] = [
  { value: '',         label: 'Todos' },
  { value: 'pending',  label: 'Próximos' },
  { value: 'entered',  label: 'En sitio' },
  { value: 'exited',   label: 'Finalizados' },
];

// ─── component ────────────────────────────────────────────────────────────────

const Visitors = () => {
  const { profile, user } = useAuth();
  const [visitors, setVisitors]               = useState<Visitor[]>([]);
  const [loading, setLoading]                 = useState(true);
  const [showAddModal, setShowAddModal]       = useState(false);
  const [selectedVisitor, setSelectedVisitor] = useState<Visitor | null>(null);
  const [editingVisitor, setEditingVisitor]   = useState<Visitor | null>(null);
  const [deletingVisitor, setDeletingVisitor] = useState<Visitor | null>(null);
  const [deleting, setDeleting]               = useState(false);
  const [saving, setSaving]                   = useState(false);
  const [condos, setCondos]                   = useState<CondoOption[]>([]);
  const [filterCondo, setFilterCondo]         = useState('');
  const [filterStatus, setFilterStatus]       = useState<Visitor['status'] | ''>('');
  const [newVisitor, setNewVisitor]           = useState({
    visitorName: '', date: format(new Date(), 'yyyy-MM-dd'),
    entryTime: '12:00', exitTime: '18:00', licensePlate: '', condoId: '',
    phone: '', rut: '',
  });

  // Dahua
  const [dahuaStatus, setDahuaStatus]         = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle');
  const [dahuaChannelIds, setDahuaChannelIds] = useState<string[]>([]);
  const [resyncing, setResyncing]             = useState<string | null>(null);

  // QR ref for image export/share
  const qrRef = useRef<HTMLDivElement>(null);

  const isResident   = profile?.role === 'resident' || profile?.role === 'usuario';
  const isGlobalRole = profile?.role === 'super_admin' || profile?.role === 'technician' || profile?.condoScope === 'all';
  const isGlobalScope = profile?.role === 'super_admin' || profile?.condoScope === 'all';
  const canGenerate  = !!profile?.canGenerateQR || (!isResident);

  // ── data ────────────────────────────────────────────────────────────────────

  useEffect(() => {
    const condosUnsub = onSnapshot(collection(db, 'condos'), (snap) => {
      setCondos(snap.docs.map(d => ({
        id: d.id,
        name: d.data().name,
        dahuaChannelIds: d.data().dahuaChannelIds ?? [],
      })));
    });

    if (!profile || !user) return () => condosUnsub();

    let q;
    const path = 'visitors';

    const isMulti = profile.condoScope === 'multiple' && profile.condoIds?.length > 0;
    if (isGlobalScope) {
      q = query(collectionGroup(db, 'visitors'));
    } else if (isMulti) {
      q = query(collectionGroup(db, 'visitors'), where('condoId', 'in', profile.condoIds));
    } else {
      const colPath = `condos/${profile.condoId || 'default'}/visitors`;
      q = isResident
        ? query(collection(db, colPath), where('userId', '==', user.uid), orderBy('createdAt', 'desc'))
        : query(collection(db, colPath), orderBy('createdAt', 'desc'));
    }

    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Visitor[];
      if (isGlobalScope || isMulti) {
        list.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      }
      setVisitors(list);
      setLoading(false);
    }, (err) => { setLoading(false); handleFirestoreError(err, OperationType.LIST, path); });

    return () => { condosUnsub(); unsub(); };
  }, [profile, user]);

  // Load Dahua channels when condoId changes in the form
  useEffect(() => {
    if (!newVisitor.condoId) { setDahuaChannelIds([]); return; }
    const found = condos.find(c => c.id === newVisitor.condoId);
    if (found) { setDahuaChannelIds(found.dahuaChannelIds ?? []); return; }
    getDoc(doc(db, 'condos', newVisitor.condoId))
      .then(snap => setDahuaChannelIds(snap.data()?.dahuaChannelIds ?? []))
      .catch(() => setDahuaChannelIds([]));
  }, [newVisitor.condoId, condos]);

  // ── handlers ────────────────────────────────────────────────────────────────

  const handleOpenAdd = () => {
    if (isResident && !profile?.canGenerateQR) {
      alert('Tu cuenta no tiene habilitada la generación de QR. Por favor solicita activación a la administración.');
      return;
    }
    setEditingVisitor(null);
    setDahuaStatus('idle');
    setNewVisitor({
      visitorName: '', date: format(new Date(), 'yyyy-MM-dd'),
      entryTime: format(new Date(), 'HH:mm'),
      exitTime: format(new Date(Date.now() + 6 * 3600000), 'HH:mm'),
      licensePlate: '', condoId: profile?.condoId || '',
      phone: '', rut: '',
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (visitor: Visitor) => {
    setEditingVisitor(visitor);
    setDahuaStatus('idle');
    setNewVisitor({
      visitorName: visitor.visitorName, date: visitor.date,
      entryTime: visitor.entryTime, exitTime: visitor.exitTime,
      licensePlate: visitor.licensePlate || '', condoId: visitor.condoId,
      phone: visitor.phone || '', rut: visitor.rut || '',
    });
    setShowAddModal(true);
  };

  const handleSaveVisitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;

    const condoId = isGlobalRole ? newVisitor.condoId : profile.condoId;
    if (!condoId) { alert('Por favor selecciona un condominio.'); return; }

    const path = `condos/${condoId}/visitors`;
    setSaving(true);

    try {
      if (editingVisitor) {
        await updateDoc(doc(db, path, editingVisitor.id), { ...newVisitor, updatedAt: Timestamp.now() });

        if (dahuaChannelIds.length > 0) {
          setDahuaStatus('syncing');
          if (editingVisitor.dahuaVisitorId) {
            await DahuaService.deleteVisitor(editingVisitor.dahuaVisitorId).catch(() => {});
          }
          let synced = false;
          for (let attempt = 1; attempt <= 3 && !synced; attempt++) {
            try {
              const result = await DahuaService.createVisitor({
                visitorName: newVisitor.visitorName,
                hostName: profile.name || 'Portería Virtual',
                plate: newVisitor.licensePlate || undefined,
                startTs: toUnixSeconds(newVisitor.date, newVisitor.entryTime),
                endTs:   toUnixSeconds(newVisitor.date, newVisitor.exitTime),
                acsChannelIds: dahuaChannelIds,
              });
              await updateDoc(doc(db, path, editingVisitor.id), {
                dahuaVisitorId: result.visitorId ?? null,
                dahuaQrCode:    result.qrcode    ?? null,
              });
              setDahuaStatus('ok');
              synced = true;
            } catch (dahuaErr) {
              console.warn(`[Dahua] re-sync attempt ${attempt}/3:`, dahuaErr);
              if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
              else setDahuaStatus('error');
            }
          }
        }
      } else {
        const hexSeed = (Date.now() ^ parseInt(user.uid.replace(/\D/g, '').slice(0, 8) || '0', 10)) >>> 0;
        const qrValue = hexSeed.toString(16).toUpperCase().padStart(8, '0');

        const docRef = await addDoc(collection(db, path), {
          ...newVisitor, userId: user.uid, condoId,
          hostName: profile.name || '',
          qrCodeValue: qrValue, status: 'pending',
          createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
        });
        const savedId = docRef.id;

        let createdVisitor: Visitor = {
          id: savedId, userId: user.uid, condoId,
          visitorName: newVisitor.visitorName, date: newVisitor.date,
          entryTime: newVisitor.entryTime, exitTime: newVisitor.exitTime,
          licensePlate: newVisitor.licensePlate || undefined,
          phone: newVisitor.phone || undefined,
          rut: newVisitor.rut || undefined,
          hostName: profile.name || undefined,
          qrCodeValue: qrValue, status: 'pending', createdAt: Timestamp.now(),
        };

        if (dahuaChannelIds.length > 0) {
          setDahuaStatus('syncing');
          let synced = false;
          for (let attempt = 1; attempt <= 3 && !synced; attempt++) {
            try {
              const result = await DahuaService.createVisitor({
                visitorName: newVisitor.visitorName,
                hostName: profile.name || 'Portería Virtual',
                plate: newVisitor.licensePlate || undefined,
                startTs: toUnixSeconds(newVisitor.date, newVisitor.entryTime),
                endTs:   toUnixSeconds(newVisitor.date, newVisitor.exitTime),
                acsChannelIds: dahuaChannelIds,
              });
              await updateDoc(doc(db, path, savedId), {
                dahuaVisitorId: result.visitorId ?? null,
                dahuaQrCode:    result.qrcode    ?? null,
              });
              createdVisitor = { ...createdVisitor, dahuaVisitorId: result.visitorId ?? undefined, dahuaQrCode: result.qrcode ?? undefined };
              setDahuaStatus('ok');
              synced = true;
            } catch (dahuaErr) {
              console.warn(`[Dahua] sync attempt ${attempt}/3:`, dahuaErr);
              if (attempt < 3) await new Promise(r => setTimeout(r, 3000));
              else {
                setDahuaStatus('error');
                await new Promise(r => setTimeout(r, 1800));
              }
            }
          }
        }

        setShowAddModal(false); setEditingVisitor(null); setDahuaStatus('idle');
        setSelectedVisitor(createdVisitor);
        return;
      }

      setShowAddModal(false); setEditingVisitor(null); setDahuaStatus('idle');
    } catch (err) {
      handleFirestoreError(err, editingVisitor ? OperationType.UPDATE : OperationType.CREATE, path);
    } finally {
      setSaving(false);
    }
  };

  const handleRepeat = (visitor: Visitor) => {
    setEditingVisitor(null);
    setDahuaStatus('idle');
    setNewVisitor({
      visitorName: visitor.visitorName,
      licensePlate: visitor.licensePlate || '',
      condoId: visitor.condoId || profile?.condoId || '',
      date: format(new Date(), 'yyyy-MM-dd'),
      entryTime: format(new Date(), 'HH:mm'),
      exitTime: format(new Date(Date.now() + 6 * 3600000), 'HH:mm'),
      phone: visitor.phone || '', rut: visitor.rut || '',
    });
    setShowAddModal(true);
  };

  const buildWelcomeMessage = (visitor: Visitor) => {
    const condo = condoName(visitor.condoId) || profile?.condoName || 'el condominio';
    const plate = visitor.licensePlate ? `🚗 Patente: ${visitor.licensePlate}` : '🚶 Acceso peatonal';
    const host  = visitor.hostName ? `👤 Autorizado por: ${visitor.hostName}\n` : '';
    return (
      `Hola ${visitor.visitorName}! 👋\n\n` +
      `Has recibido un *Pase de Visita* autorizado para acceder a:\n` +
      `🏢 *${condo}*\n\n` +
      `📅 Fecha de vigencia: ${visitor.date}\n` +
      `🕐 Horario: ${visitor.entryTime} – ${visitor.exitTime}\n` +
      `${plate}\n` +
      `${host}\n` +
      `Al llegar a la portería del condominio, presenta este mensaje en el *Tótem de Portería Virtual* para registrar tu ingreso.\n\n` +
      `¡Te esperamos! 🏠`
    );
  };

  const shareWhatsApp = async (visitor: Visitor) => {
    const message = buildWelcomeMessage(visitor);

    const svgEl = qrRef.current?.querySelector('svg');
    if (svgEl) {
      const size = 500;
      const svgData = new XMLSerializer().serializeToString(svgEl);
      const canvas = document.createElement('canvas');
      canvas.width = size; canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, size, size);
      const blob = new Blob([svgData], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      await new Promise<void>(resolve => {
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0, size, size);
          URL.revokeObjectURL(url);
          canvas.toBlob(async pngBlob => {
            if (!pngBlob) { resolve(); return; }
            const file = new File([pngBlob], `pase-${visitor.visitorName}.png`, { type: 'image/png' });
            if (navigator.canShare?.({ files: [file] })) {
              try { await navigator.share({ title: `Pase QR — ${visitor.visitorName}`, text: message, files: [file] }); }
              catch { /* cancelled */ }
              resolve(); return;
            }
            // Fallback: download image + open wa.me
            const a = document.createElement('a');
            a.href = URL.createObjectURL(pngBlob);
            a.download = `pase-${visitor.visitorName}.png`;
            a.click();
            if (visitor.phone) {
              let phone = visitor.phone.replace(/[\s\-\(\)\.]/g, '');
              if (phone.startsWith('0')) phone = phone.slice(1);
              if (!phone.startsWith('56') && !phone.startsWith('+56')) phone = '56' + phone;
              phone = phone.replace(/^\+/, '');
              setTimeout(() => window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank'), 600);
            }
            resolve();
          }, 'image/png');
        };
        img.onerror = () => { URL.revokeObjectURL(url); resolve(); };
        img.src = url;
      });
      return;
    }

    // No QR element visible — fallback to wa.me text only
    if (!visitor.phone) return;
    let phone = visitor.phone.replace(/[\s\-\(\)\.]/g, '');
    if (phone.startsWith('0')) phone = phone.slice(1);
    if (!phone.startsWith('56') && !phone.startsWith('+56')) phone = '56' + phone;
    phone = phone.replace(/^\+/, '');
    window.open(`https://wa.me/${phone}?text=${encodeURIComponent(message)}`, '_blank');
  };

  const handleRetrySync = async (visitor: Visitor) => {
    const condoId = visitor.condoId || profile?.condoId || '';
    if (!condoId || !profile || !user) return;
    const channelIds = condos.find(c => c.id === condoId)?.dahuaChannelIds ?? [];
    if (!channelIds.length) return;
    setResyncing(visitor.id);
    try {
      const result = await DahuaService.createVisitor({
        visitorName: visitor.visitorName,
        hostName: profile.name || 'Portería Virtual',
        plate: visitor.licensePlate || undefined,
        startTs: toUnixSeconds(visitor.date, visitor.entryTime),
        endTs:   toUnixSeconds(visitor.date, visitor.exitTime),
        acsChannelIds: channelIds,
      });
      await updateDoc(doc(db, `condos/${condoId}/visitors`, visitor.id), {
        dahuaVisitorId: result.visitorId ?? null,
        dahuaQrCode:    result.qrcode    ?? null,
      });
    } catch (err) {
      console.warn('[Dahua] retry sync failed:', err);
    } finally {
      setResyncing(null);
    }
  };

  const handleOpenPass = async (visitor: Visitor) => {
    const path = `condos/${visitor.condoId || profile?.condoId || 'default'}/visitors`;
    try {
      await updateDoc(doc(db, path, visitor.id), { status: 'entered', updatedAt: Timestamp.now() });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    }
  };

  const handleDeleteVisitor = async () => {
    if (!profile || !deletingVisitor) return;
    const path = `condos/${deletingVisitor.condoId || profile.condoId || 'default'}/visitors`;
    setDeleting(true);
    try {
      await deleteDoc(doc(db, path, deletingVisitor.id));
      const toDelete = deletingVisitor;
      setDeletingVisitor(null);
      if (toDelete.dahuaVisitorId) {
        DahuaService.deleteVisitor(toDelete.dahuaVisitorId).catch(err =>
          console.warn('[Dahua] deleteVisitor failed (local delete already done):', err.message)
        );
      }
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    } finally {
      setDeleting(false);
    }
  };

  // ── filtered list for staff ─────────────────────────────────────────────────

  const staffFiltered = visitors.filter(v =>
    (!filterCondo || v.condoId === filterCondo) &&
    (!filterStatus || v.status === filterStatus)
  );

  const condoName = (condoId: string) =>
    condos.find(c => c.id === condoId)?.name ?? condoId;

  // ── render ─────────────────────────────────────────────────────────────────

  if (loading && !visitors.length) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner size={40} />
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto space-y-6">
      <PageHeader
        icon={QrCode}
        title="Pases de Visita"
        description="Genera accesos autorizados y sincronízalos con el control físico del condominio."
        actions={
          canGenerate && (
            <Button icon={Plus} onClick={handleOpenAdd}>
              Generar pase
            </Button>
          )
        }
      />

      {/* QR disabled warning (residents only) */}
      {!profile?.canGenerateQR && isResident && (
        <Card padding="md" className="flex items-start gap-3 border-amber-200 dark:border-amber-500/30 bg-amber-50/50 dark:bg-amber-500/5">
          <AlertCircle className="text-amber-600 dark:text-amber-400 mt-0.5 shrink-0" size={20} />
          <div>
            <h3 className="text-amber-900 dark:text-amber-200">Activación pendiente</h3>
            <p className="subtle mt-0.5">Tu cuenta aún no tiene permiso para generar códigos QR. Por favor contacta a administración.</p>
          </div>
        </Card>
      )}

      {/* ── STAFF VIEW (super_admin, operator, condo_admin, technician) ─────── */}
      {!isResident && (
        <>
          {/* Status tabs */}
          <div className="flex items-center gap-2 flex-wrap">
            {STATUS_TABS.map(tab => (
              <button
                key={tab.value}
                onClick={() => setFilterStatus(tab.value)}
                className={cn(
                  'px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer',
                  filterStatus === tab.value
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                    : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-blue-500/50'
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>

          {/* Condo filter pills (global scope only) */}
          {isGlobalScope && condos.length > 1 && (
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider shrink-0">
                Condominio:
              </span>
              <div className="flex gap-2 flex-wrap">
                <button
                  onClick={() => setFilterCondo('')}
                  className={cn(
                    'px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer',
                    !filterCondo
                      ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                      : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-blue-500/50'
                  )}
                >
                  Todos
                </button>
                {condos.map(c => (
                  <button
                    key={c.id}
                    onClick={() => setFilterCondo(c.id)}
                    className={cn(
                      'px-4 py-2 rounded-xl text-xs font-semibold uppercase tracking-wider transition-all cursor-pointer',
                      filterCondo === c.id
                        ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                        : 'bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-blue-500/50'
                    )}
                  >
                    {c.name}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Table */}
          {staffFiltered.length === 0 ? (
            <EmptyState
              icon={QrCode}
              title="Sin pases para este filtro"
              description="Prueba cambiando el estado o el condominio seleccionado."
              action={<Button icon={Plus} onClick={handleOpenAdd}>Generar pase</Button>}
            />
          ) : (
            <Card variant="glass" padding="none" className="overflow-hidden">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-white/5">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                      Visitante
                    </th>
                    {isGlobalScope && (
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                        Condominio
                      </th>
                    )}
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                      Fecha
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                      Horario
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                      Patente
                    </th>
                    <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                      DSS
                    </th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                      Estado
                    </th>
                    <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wider whitespace-nowrap">
                      Acciones
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                  <AnimatePresence>
                    {staffFiltered.map((visitor) => {
                      const st = statusMap[visitor.status] ?? statusMap.pending;
                      const canEdit = profile?.role === 'super_admin' || profile?.role === 'condo_admin' || profile?.role === 'administrador' || visitor.userId === user?.uid;
                      const canOpen = (profile?.role === 'super_admin' || profile?.role === 'administrador') && visitor.status === 'pending';
                      return (
                        <motion.tr
                          key={visitor.id}
                          layout
                          initial={{ opacity: 0 }}
                          animate={{ opacity: 1 }}
                          exit={{ opacity: 0 }}
                          className="hover:bg-slate-50 dark:hover:bg-white/[0.02] transition-colors"
                        >
                          {/* Visitante */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2.5">
                              <div className="w-7 h-7 rounded-lg bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                                <User size={13} />
                              </div>
                              <div>
                                <span className="font-semibold text-slate-900 dark:text-slate-100 whitespace-nowrap">
                                  {visitor.visitorName}
                                </span>
                                {visitor.hostName && (
                                  <p className="text-[11px] text-slate-400 dark:text-slate-500 whitespace-nowrap">
                                    Por: {visitor.hostName}
                                  </p>
                                )}
                              </div>
                            </div>
                          </td>

                          {/* Condominio */}
                          {isGlobalScope && (
                            <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap text-sm">
                              {condoName(visitor.condoId)}
                            </td>
                          )}

                          {/* Fecha */}
                          <td className="px-4 py-3 text-slate-500 dark:text-slate-400 whitespace-nowrap font-mono text-xs">
                            {visitor.date}
                          </td>

                          {/* Horario (entrada → salida) */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <div className="flex items-center gap-1 text-slate-600 dark:text-slate-300 font-mono text-xs">
                              <Clock size={11} className="text-slate-400 shrink-0" />
                              <span>{visitor.entryTime}</span>
                              <span className="text-slate-400 mx-0.5">–</span>
                              <span>{visitor.exitTime}</span>
                            </div>
                          </td>

                          {/* Patente */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            {visitor.licensePlate ? (
                              <span className="font-mono text-xs font-semibold text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-500/10 px-2 py-0.5 rounded-lg">
                                {visitor.licensePlate}
                              </span>
                            ) : (
                              <span className="text-xs text-slate-400 dark:text-slate-500">Peatonal</span>
                            )}
                          </td>

                          {/* DSS */}
                          <td className="px-4 py-3 text-center">
                            {visitor.dahuaVisitorId ? (
                              <span title="Sincronizado con DSS" className="inline-flex text-emerald-500">
                                <Wifi size={14} />
                              </span>
                            ) : (
                                <button
                                  onClick={() => handleRetrySync(visitor)}
                                  disabled={resyncing === visitor.id}
                                  title="Sin sincronización DSS — clic para reintentar"
                                  className="inline-flex text-slate-400 hover:text-amber-500 transition-colors disabled:opacity-40 cursor-pointer"
                                >
                                  {resyncing === visitor.id ? <Spinner size={14} /> : <WifiOff size={14} />}
                                </button>
                              )}
                            </td>

                          {/* Estado */}
                          <td className="px-4 py-3 whitespace-nowrap">
                            <Badge variant={st.variant}>{st.label}</Badge>
                          </td>

                          {/* Acciones */}
                          <td className="px-4 py-3">
                            <div className="flex items-center justify-end gap-0.5">
                              <IconBtn title="Ver QR" onClick={() => setSelectedVisitor(visitor)}>
                                <QrCode size={14} />
                              </IconBtn>
                              {canOpen && (
                                <IconBtn title="Abrir pase (marcar ingreso)" tone="success" onClick={() => handleOpenPass(visitor)}>
                                  <DoorOpen size={14} />
                                </IconBtn>
                              )}
                              {canEdit && (
                                <>
                                  <IconBtn title="Editar" onClick={() => handleOpenEdit(visitor)}>
                                    <Edit2 size={14} />
                                  </IconBtn>
                                  <IconBtn title="Repetir pase" tone="success" onClick={() => handleRepeat(visitor)}>
                                    <RotateCcw size={14} />
                                  </IconBtn>
                                  <IconBtn title="Eliminar" tone="danger" onClick={() => setDeletingVisitor(visitor)}>
                                    <Trash2 size={14} />
                                  </IconBtn>
                                </>
                              )}
                            </div>
                          </td>
                        </motion.tr>
                      );
                    })}
                  </AnimatePresence>
                </tbody>
              </table>

              {/* Table footer count */}
              <div className="px-4 py-3 border-t border-slate-100 dark:border-white/5">
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {staffFiltered.length} pase{staffFiltered.length !== 1 ? 's' : ''}
                  {filterStatus ? ` · ${STATUS_TABS.find(t => t.value === filterStatus)?.label}` : ''}
                  {filterCondo ? ` · ${condoName(filterCondo)}` : ''}
                </p>
              </div>
            </Card>
          )}
        </>
      )}

      {/* ── RESIDENT VIEW ───────────────────────────────────────────────────── */}
      {isResident && (
        <>
          {visitors.length === 0 && !loading && (
            <EmptyState
              icon={QrCode}
              title="No tienes visitas programadas"
              description="Cuando generes tu primer código QR, aparecerá aquí."
              action={canGenerate && <Button icon={Plus} onClick={handleOpenAdd}>Generar pase</Button>}
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            <AnimatePresence>
              {visitors.map((visitor, i) => {
                const status = statusMap[visitor.status] || statusMap.pending;
                const canEdit = visitor.userId === user?.uid;
                return (
                  <motion.div
                    layout
                    key={visitor.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.2), duration: 0.2 }}
                  >
                    <Card
                      padding="md"
                      hoverable
                      onClick={() => setSelectedVisitor(visitor)}
                      className="cursor-pointer group"
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="w-11 h-11 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center transition-colors group-hover:bg-blue-600 group-hover:text-white">
                          <QrCode size={20} />
                        </div>
                        <div className="flex items-center gap-2">
                          {visitor.dahuaVisitorId ? (
                            <span title="Sincronizado con DSS" className="text-emerald-500"><Wifi size={13} /></span>
                          ) : (
                            <button
                              onClick={e => { e.stopPropagation(); handleRetrySync(visitor); }}
                              disabled={resyncing === visitor.id}
                              aria-label="Reintentar sincronización con DSS"
                              title="Sin sincronización DSS — clic para reintentar"
                              className="text-slate-400 hover:text-amber-500 transition-colors disabled:opacity-40 cursor-pointer"
                            >
                              {resyncing === visitor.id ? <Spinner size={12} /> : <WifiOff size={13} />}
                            </button>
                          )}
                          <Badge variant={status.variant}>{status.label}</Badge>
                        </div>
                      </div>

                      <div className="mb-4 min-w-0">
                        <h3 className="truncate text-slate-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400 transition-colors">
                          {visitor.visitorName}
                        </h3>
                        <div className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400 mt-1 min-w-0">
                          <Building2 size={12} className="shrink-0" />
                          <span className="truncate">{profile?.condoName || 'Condominio'}</span>
                        </div>
                      </div>

                      <div className="grid grid-cols-2 gap-2.5 mb-4">
                        <div className="rounded-lg bg-slate-50 dark:bg-white/[0.03] p-3 border border-slate-200 dark:border-white/5">
                          <p className="eyebrow">Validez</p>
                          <p className="text-sm font-semibold text-slate-900 dark:text-white mt-0.5">{visitor.date}</p>
                        </div>
                        <div className="rounded-lg bg-slate-50 dark:bg-white/[0.03] p-3 border border-slate-200 dark:border-white/5">
                          <p className="eyebrow">Patente</p>
                          <p className="text-sm font-semibold text-blue-600 dark:text-blue-400 mt-0.5 font-mono truncate">
                            {visitor.licensePlate || 'Peatonal'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-between pt-3 border-t border-slate-200 dark:border-white/5">
                        <div className="flex items-center gap-0.5">
                          {canEdit && (
                            <>
                              <IconBtn title="Editar" onClick={() => handleOpenEdit(visitor)}>
                                <Edit2 size={15} />
                              </IconBtn>
                              <IconBtn title="Eliminar" tone="danger" onClick={() => setDeletingVisitor(visitor)}>
                                <Trash2 size={15} />
                              </IconBtn>
                              <IconBtn title="Repetir pase" tone="success" onClick={() => handleRepeat(visitor)}>
                                <RotateCcw size={15} />
                              </IconBtn>
                            </>
                          )}
                        </div>
                        <button
                          onClick={e => { e.stopPropagation(); setSelectedVisitor(visitor); }}
                          className="inline-flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-200 transition-colors cursor-pointer"
                        >
                          Ver QR <QrCode size={12} />
                        </button>
                      </div>
                    </Card>
                  </motion.div>
                );
              })}
            </AnimatePresence>
          </div>
        </>
      )}

      {/* ── Add / Edit Modal ─────────────────────────────────────────────────── */}
      <Modal
        open={showAddModal}
        onClose={() => { if (dahuaStatus !== 'syncing') setShowAddModal(false); }}
        title={editingVisitor ? 'Gestionar pase' : 'Programar visita'}
        description="Completa los datos para generar el acceso automático."
        icon={QrCode}
        size="lg"
      >
        <form onSubmit={handleSaveVisitor} className="space-y-4">
          {isGlobalRole && (
            <Field label="Condominio destino" required>
              <div className="relative">
                <Building2 size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
                <select
                  required
                  value={newVisitor.condoId}
                  onChange={e => setNewVisitor({ ...newVisitor, condoId: e.target.value })}
                  className={cn(selectClass, 'pl-10 pr-8')}
                >
                  <option value="">Seleccionar…</option>
                  {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
              {newVisitor.condoId && (
                <div className="mt-2">
                  {dahuaChannelIds.length > 0 ? (
                    <Badge variant="success" icon={Wifi}>
                      {dahuaChannelIds.length} canal{dahuaChannelIds.length !== 1 ? 'es' : ''} ACS configurado{dahuaChannelIds.length !== 1 ? 's' : ''}
                    </Badge>
                  ) : (
                    <Badge variant="warn" icon={WifiOff}>
                      Sin canales ACS — el pase no se sincronizará con el DSS
                    </Badge>
                  )}
                </div>
              )}
            </Field>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Nombre del invitado" htmlFor="visitor-name" required>
              <div className="relative">
                <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
                <Input
                  id="visitor-name" type="text" required
                  value={newVisitor.visitorName}
                  onChange={e => setNewVisitor({ ...newVisitor, visitorName: e.target.value })}
                  placeholder="Nombre completo" className="pl-10"
                />
              </div>
            </Field>
            <Field label="RUT" hint="Opcional" htmlFor="visitor-rut">
              <div className="relative">
                <CreditCard size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
                <Input
                  id="visitor-rut" type="text"
                  value={newVisitor.rut}
                  onChange={e => setNewVisitor({ ...newVisitor, rut: e.target.value.toUpperCase() })}
                  placeholder="12345678-9" className="pl-10 font-mono"
                />
              </div>
            </Field>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="Patente vehicular" hint="Opcional — deja vacío si es peatonal">
              <div className="relative">
                <Car size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
                <Input
                  type="text"
                  value={newVisitor.licensePlate}
                  onChange={e => setNewVisitor({ ...newVisitor, licensePlate: e.target.value.toUpperCase() })}
                  placeholder="AAAA-00" className="pl-10 font-mono"
                />
              </div>
            </Field>
          </div>

          <div className="rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5 p-4 space-y-3">
            <div className="flex items-center gap-2 text-blue-600 dark:text-blue-400">
              <Clock size={14} />
              <span className="eyebrow text-blue-600 dark:text-blue-400">Ventana de validez</span>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
              <Field label="Fecha" htmlFor="visitor-date" required>
                <Input id="visitor-date" type="date" required value={newVisitor.date}
                  onChange={e => setNewVisitor({ ...newVisitor, date: e.target.value })} />
              </Field>
              <Field label="Entrada" htmlFor="visitor-entry" required>
                <Input id="visitor-entry" type="time" required value={newVisitor.entryTime}
                  onChange={e => setNewVisitor({ ...newVisitor, entryTime: e.target.value })} />
              </Field>
              <Field label="Salida" htmlFor="visitor-exit" required>
                <Input id="visitor-exit" type="time" required value={newVisitor.exitTime}
                  onChange={e => setNewVisitor({ ...newVisitor, exitTime: e.target.value })} />
              </Field>
            </div>
          </div>

          <AnimatePresence>
            {dahuaStatus !== 'idle' && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className={cn(
                  'flex items-center gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium border',
                  dahuaStatus === 'syncing' && 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20 text-blue-700 dark:text-blue-300',
                  dahuaStatus === 'ok'      && 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20 text-emerald-700 dark:text-emerald-300',
                  dahuaStatus === 'error'   && 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-300',
                )}>
                  {dahuaStatus === 'syncing' && <><Spinner size={14} /> Registrando en Dahua DSS…</>}
                  {dahuaStatus === 'ok'      && <><Wifi size={14} /> Sincronizado con DSS — el lector ya acepta el QR.</>}
                  {dahuaStatus === 'error'   && <><WifiOff size={14} /> Pase guardado, pero no se pudo sincronizar con el DSS.</>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <Button type="submit" size="lg" icon={QrCode} fullWidth loading={saving || dahuaStatus === 'syncing'}>
            {dahuaStatus === 'syncing' ? 'Procesando…' : editingVisitor ? 'Actualizar pase' : 'Generar pase autorizado'}
          </Button>
        </form>
      </Modal>

      {/* ── QR Detail Modal ──────────────────────────────────────────────────── */}
      <Modal open={!!selectedVisitor} onClose={() => setSelectedVisitor(null)} size="sm">
        {selectedVisitor && (
          <div className="flex flex-col items-center">
            <Badge variant="brand" className="mb-4">Pase digital activo</Badge>

            <div ref={qrRef} className="p-5 bg-white rounded-2xl border border-slate-200 mb-3 ring-1 ring-slate-100">
              <QRCodeSVG value={selectedVisitor.dahuaQrCode || selectedVisitor.qrCodeValue} size={180} includeMargin />
            </div>

            <Badge variant={selectedVisitor.dahuaQrCode ? 'success' : 'muted'} icon={selectedVisitor.dahuaQrCode ? Wifi : WifiOff}>
              {selectedVisitor.dahuaQrCode ? 'QR Dahua DSS' : 'QR local'}
            </Badge>

            <div className="text-center mt-5 mb-5 px-2">
              <h2 className="truncate text-slate-900 dark:text-white">{selectedVisitor.visitorName}</h2>
              <p className="subtle mt-0.5">
                Acceso · {condoName(selectedVisitor.condoId) || profile?.condoName || 'Condominio'}
              </p>
            </div>

            <div className="w-full space-y-2.5 mb-5">
              <DetailRow label="Validez" value={selectedVisitor.date} />
              <DetailRow label="Horario" value={`${selectedVisitor.entryTime} – ${selectedVisitor.exitTime}`} />
              <DetailRow label="Patente LPR" value={selectedVisitor.licensePlate || 'Peatonal'} accent="brand" />
              {selectedVisitor.rut && (
                <DetailRow label="RUT" value={selectedVisitor.rut} mono />
              )}
              {selectedVisitor.phone && (
                <DetailRow label="Teléfono" value={selectedVisitor.phone} />
              )}
              {selectedVisitor.hostName && (
                <DetailRow label="Generado por" value={selectedVisitor.hostName} />
              )}
              {selectedVisitor.dahuaVisitorId && (
                <DetailRow label="ID Dahua" value={selectedVisitor.dahuaVisitorId} mono accent="success" />
              )}
            </div>

            <button
              onClick={() => shareWhatsApp(selectedVisitor)}
              className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-white font-semibold text-sm transition-colors cursor-pointer"
            >
              <MessageCircle size={16} />
              Compartir por WhatsApp
            </button>
          </div>
        )}
      </Modal>

      {/* ── Delete Confirm Modal ─────────────────────────────────────────────── */}
      <Modal
        open={!!deletingVisitor}
        onClose={() => { if (!deleting) setDeletingVisitor(null); }}
        size="sm"
      >
        <div className="text-center space-y-4 pt-2">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
            <Trash2 size={24} />
          </div>
          <div>
            <h2 className="text-slate-900 dark:text-white">¿Anular invitación?</h2>
            <p className="subtle mt-1">
              El código QR de{' '}
              <span className="font-semibold text-slate-900 dark:text-white">{deletingVisitor?.visitorName}</span>{' '}
              será desactivado.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button variant="secondary" onClick={() => setDeletingVisitor(null)} disabled={deleting}>Cancelar</Button>
            <Button variant="danger" icon={Trash2} onClick={handleDeleteVisitor} loading={deleting}>Anular</Button>
          </div>
        </div>
      </Modal>
    </div>
  );
};

// ─── small helpers ───────────────────────────────────────────────────────────

type IconBtnProps = {
  title: string;
  tone?: 'default' | 'danger' | 'success';
  onClick: () => void;
  children: React.ReactNode;
};
function IconBtn({ title, tone = 'default', onClick, children }: IconBtnProps) {
  const tones = {
    default: 'text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5',
    danger:  'text-slate-500 dark:text-slate-400 hover:text-red-600 hover:bg-red-500/10',
    success: 'text-slate-500 dark:text-slate-400 hover:text-emerald-600 hover:bg-emerald-500/10',
  };
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      className={cn('p-2 rounded-lg transition-colors cursor-pointer', tones[tone])}
    >
      {children}
    </button>
  );
}

type DetailRowProps = {
  label: string;
  value: React.ReactNode;
  mono?: boolean;
  accent?: 'default' | 'brand' | 'success';
};
function DetailRow({ label, value, mono, accent = 'default' }: DetailRowProps) {
  const accentClass = {
    default: 'text-slate-900 dark:text-white',
    brand:   'text-blue-600 dark:text-blue-400',
    success: 'text-emerald-600 dark:text-emerald-400',
  }[accent];
  return (
    <div className="flex justify-between items-center py-2.5 border-b border-slate-100 dark:border-white/5 last:border-0">
      <span className="text-xs font-medium text-slate-500 dark:text-slate-400">{label}</span>
      <span className={cn('text-sm font-semibold', accentClass, mono && 'font-mono text-xs')}>{value}</span>
    </div>
  );
}

export default Visitors;
