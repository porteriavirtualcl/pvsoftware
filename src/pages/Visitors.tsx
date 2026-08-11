import React, { useState, useEffect, useRef, useMemo } from 'react';
import { db } from '../firebase';
import {
  collection, query, where, onSnapshot, addDoc, Timestamp,
  orderBy, limit, doc, updateDoc, deleteDoc, collectionGroup, getDoc, getDocs,
} from 'firebase/firestore';
import type { Query, QueryConstraint, DocumentData } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  QrCode, Plus, Clock, User, Car, AlertCircle,
  Edit2, Trash2, ShieldCheck, Building2, Wifi, WifiOff, RotateCcw,
  CreditCard, MessageCircle, DoorOpen, CheckCircle2, LogIn, ClipboardList,
} from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { format } from 'date-fns';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType, cn, sendNotification } from '../lib/utils';
import DahuaService from '../services/DahuaService';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';
import {
  PageHeader, Card, Button, Modal, Field, Input, Badge, EmptyState, Spinner,
} from '../components/ui';

// ─── types ────────────────────────────────────────────────────────────────────

interface AccessedDoor {
  channelId: string;
  channelName: string;
  accessTime: number;
  direction: 'in' | 'out' | '';
}

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
  unit?: string;
  hostName?: string;
  qrCodeValue: string;
  status: 'pending' | 'entered' | 'exited';
  condoId: string;
  createdAt: any;
  dahuaVisitorId?: string;
  dahuaPersonId?: string;
  dahuaQrCode?: string;
  dahuaPassportCardNo?: string;
  accessedDoors?: AccessedDoor[];
  startTs?: number;
  endTs?: number;
  // Unix seconds — momento a partir del cual el QR ya está sincronizado en los
  // lectores y se puede escanear (createTime + ventana de settle del sistema).
  qrReadyAt?: number;
  // true cuando el sistema confirmó la sincronización del pase (lo marca el poller).
  // Corta la cuenta regresiva antes de qrReadyAt si la confirmación llega primero.
  dssAuthVerified?: boolean;
  // Pase de "ingreso manual" creado por el operador (sin QR, sin sync DSS).
  manualEntry?: boolean;
  createdByName?: string;
  // Motivo de visita (lo agrega el operador en el ingreso manual). Opcional.
  visitReason?: string;
  dssStatus?: string;
}

// Residente para el selector del pase de ingreso manual.
interface ResidentOption { uid: string; name: string; unit: string; }

interface CondoOption {
  id: string;
  name: string;
  address?: string;
  dahuaChannelIds?: string[];
  // IDs de "puntos de entrada/salida" (positions) = barreras vehiculares ANPR.
  // Se mandan al crear el pase para que la PATENTE funcione en esas barreras.
  dahuaPositionIds?: string[];
}

function toUnixSeconds(date: string, time: string): number {
  // Using numeric Date constructor — always local time, no ISO string ambiguity
  const [y, mo, d] = date.split('-').map(Number);
  const [h, mi]    = time.split(':').map(Number);
  return Math.floor(new Date(y, mo - 1, d, h, mi, 0).getTime() / 1000);
}

function toEndUnixSeconds(date: string, entryTime: string, exitTime: string): number {
  const startTs = toUnixSeconds(date, entryTime);
  let   endTs   = toUnixSeconds(date, exitTime);
  // If exit is same time or earlier than entry on the same date, exit is next day
  if (endTs <= startTs) endTs += 86400;
  return endTs;
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

// Tamaño de la ventana de pases que se trae de Firestore. La lista NO carga el
// historial completo: se suscribe a los N más recientes y "Cargar más" amplía la
// ventana en bloques de este tamaño. Antes se traía la colección entera en cada
// apertura de la página (miles de lecturas + miles de filas) y por eso demoraba.
const PAGE_SIZE = 100;

// ─── fila de la tabla (staff) ─────────────────────────────────────────────────
// Extraída y memoizada: sin esto, cualquier cambio de estado del contenedor
// (p.ej. marcar un pase como "visto" al pasar el mouse) re-renderizaba TODAS las
// filas. Las acciones llegan en un objeto de identidad estable (ver rowActions).

interface RowActions {
  retrySync: (v: Visitor) => void;
  openPass:  (v: Visitor) => void;
  finalize:  (v: Visitor) => void;
  edit:      (v: Visitor) => void;
  repeat:    (v: Visitor) => void;
  remove:    (v: Visitor) => void;
  showQr:    (v: Visitor) => void;
  markSeen:  (id: string) => void;
}

interface VisitorRowProps {
  visitor: Visitor;
  showCondo: boolean;
  condoLabel: string;
  isNew: boolean;
  canEdit: boolean;
  canOpen: boolean;
  isResyncing: boolean;
  actions: RowActions;
}

const VisitorRow = React.memo(function VisitorRow({
  visitor, showCondo, condoLabel, isNew, canEdit, canOpen, isResyncing, actions,
}: VisitorRowProps) {
  const st = statusMap[visitor.status] ?? statusMap.pending;
  return (
    <motion.tr
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      onMouseEnter={() => actions.markSeen(visitor.id)}
      className={cn(
        'transition-colors',
        isNew
          ? 'bg-blue-50 dark:bg-blue-500/10 border-l-2 border-l-blue-500 hover:bg-slate-50 dark:hover:bg-white/[0.02]'
          : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]',
      )}
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
      {showCondo && (
        <td className="px-4 py-3 text-slate-600 dark:text-slate-300 whitespace-nowrap text-sm">
          {condoLabel}
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

      {/* Sincronización */}
      <td className="px-4 py-3 text-center">
        {visitor.dahuaVisitorId ? (
          <span title="Sincronizado con Portería Virtual" className="inline-flex text-emerald-500">
            <Wifi size={14} />
          </span>
        ) : (
          <button
            onClick={() => actions.retrySync(visitor)}
            disabled={isResyncing}
            title="Sin sincronización — clic para reintentar"
            className="inline-flex text-slate-400 hover:text-amber-500 transition-colors disabled:opacity-40 cursor-pointer"
          >
            {isResyncing ? <Spinner size={14} /> : <WifiOff size={14} />}
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
          <IconBtn title="Ver QR" onClick={() => actions.showQr(visitor)}>
            <QrCode size={14} />
          </IconBtn>
          {canOpen && (
            <IconBtn title="Abrir pase (marcar ingreso)" tone="success" onClick={() => actions.openPass(visitor)}>
              <DoorOpen size={14} />
            </IconBtn>
          )}
          {visitor.status === 'entered' && (
            <IconBtn title="Finalizar pase (marcar salida)" tone="success" onClick={() => actions.finalize(visitor)}>
              <CheckCircle2 size={14} />
            </IconBtn>
          )}
          {canEdit && (
            <>
              <IconBtn title="Editar" onClick={() => actions.edit(visitor)}>
                <Edit2 size={14} />
              </IconBtn>
              <IconBtn title="Repetir pase" tone="success" onClick={() => actions.repeat(visitor)}>
                <RotateCcw size={14} />
              </IconBtn>
              <IconBtn title="Eliminar" tone="danger" onClick={() => actions.remove(visitor)}>
                <Trash2 size={14} />
              </IconBtn>
            </>
          )}
        </div>
      </td>
    </motion.tr>
  );
});

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
  const [terminating, setTerminating]         = useState(false);
  const [saving, setSaving]                   = useState(false);
  const [condos, setCondos]                   = useState<CondoOption[]>([]);
  const [filterCondo, setFilterCondo]         = useState('');
  const [filterStatus, setFilterStatus]       = useState<Visitor['status'] | ''>('');

  // ── paginación de la lista ──────────────────────────────────────────────────
  // pageSize crece con "Cargar más"; hasMore indica que la ventana vino llena
  // (es decir, que probablemente hay pases más antiguos sin traer).
  const [pageSize, setPageSize]       = useState(PAGE_SIZE);
  const [hasMore, setHasMore]         = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // El filtro por estado se resuelve en el servidor (where + orderBy), lo que
  // necesita el índice compuesto status+createdAt. Si ese índice todavía no
  // existe, Firestore responde 'failed-precondition' y aquí se cae a filtrar en
  // el cliente para NO dejar la lista vacía (mismo síntoma que tuvo el operador
  // multi-condominio cuando faltaba el índice de collectionGroup).
  const [statusServerSide, setStatusServerSide] = useState(true);

  // Cambiar de filtro reinicia la ventana al primer bloque.
  const changeFilterStatus = (v: Visitor['status'] | '') => { setFilterStatus(v); setPageSize(PAGE_SIZE); };
  const changeFilterCondo  = (v: string)                  => { setFilterCondo(v);  setPageSize(PAGE_SIZE); };

  const [newVisitor, setNewVisitor]           = useState({
    visitorName: '', date: format(new Date(), 'yyyy-MM-dd'),
    entryTime: '12:00', exitTime: '18:00', licensePlate: '', condoId: '',
    phone: '', rut: '', unit: '',
  });

  // Ingreso manual (operador / super admin) — pase sin QR
  const [showManualModal, setShowManualModal] = useState(false);
  const [savingManual, setSavingManual]       = useState(false);
  const [residents, setResidents]             = useState<ResidentOption[]>([]);
  const [manualForm, setManualForm]           = useState({
    condoId: '', unit: '', residentUid: '', visitorName: '', licensePlate: '', rut: '', phone: '', visitReason: '',
  });

  // Dahua
  const [dahuaStatus, setDahuaStatus]         = useState<'idle' | 'syncing' | 'ok' | 'error'>('idle');
  const [plateWasStripped, setPlateWasStripped] = useState(false);
  const [dahuaChannelIds, setDahuaChannelIds] = useState<string[]>([]);
  const [resyncing, setResyncing]             = useState<string | null>(null);

  // Tick de reloj (segundos) para refrescar el aviso de "QR activándose" sin
  // recargar. Se actualiza cada 15 s; suficiente para una ventana de ~2-3 min.
  const [nowTs, setNowTs] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const id = setInterval(() => setNowTs(Math.floor(Date.now() / 1000)), 15000);
    return () => clearInterval(id);
  }, []);

  // QR ref for image export/share
  const qrRef = useRef<HTMLDivElement>(null);

  // ── "Pase nuevo" (no visto) por operador ────────────────────────────────────
  // Los pases que aún no fueron vistos por este usuario se resaltan en la lista;
  // al pasar el mouse por encima se marcan como vistos y vuelven al color normal.
  // Se persiste en localStorage para sobrevivir recargas. En el primer uso se
  // marca todo lo existente como visto (bootstrap) para no resaltar el historial.
  const [seenIds, setSeenIds] = useState<Set<string>>(new Set());
  const seenBootstrapped = useRef(false);
  // Se activa al pulsar "Cargar más": la tanda que llegue se marca como vista.
  const bulkSeenPending = useRef(false);

  const isResident   = profile?.role === 'resident' || profile?.role === 'usuario';
  const isGlobalRole = profile?.role === 'super_admin' || profile?.role === 'technician' || profile?.condoScope === 'all';
  const isGlobalScope = profile?.role === 'super_admin' || profile?.condoScope === 'all';
  const canGenerate  = !!profile?.canGenerateQR || (!isResident);
  // Solo operador y super administrador pueden registrar un ingreso manual (sin QR).
  const canManualEntry = profile?.role === 'operator' || profile?.role === 'super_admin';

  // Condominios que el usuario puede elegir en un pase manual: roles globales → todos;
  // el resto (operador, etc.) → solo los asignados (condoId + condoIds). Si tiene más de
  // uno, se muestra el selector de condominio en la cascada.
  const assignableCondos = useMemo(() => {
    if (isGlobalRole) return condos;
    const allowed = new Set<string>();
    if (profile?.condoId) allowed.add(profile.condoId);
    (profile?.condoIds || []).forEach(id => allowed.add(id));
    return condos.filter(c => allowed.has(c.id));
  }, [isGlobalRole, condos, profile]);
  const manualNeedsCondoPicker = isGlobalRole || assignableCondos.length > 1;
  const manualSingleCondoId = assignableCondos.length === 1 ? assignableCondos[0].id : (profile?.condoId || '');

  // ── data ────────────────────────────────────────────────────────────────────

  // Condominios (nombres, selector de pase manual y canales Dahua). Listener
  // propio: así los cambios de filtro/paginación de la lista no lo reinician.
  useEffect(() => onSnapshot(collection(db, 'condos'), (snap) => {
    setCondos(snap.docs.map(d => ({
      id: d.id,
      name: d.data().name,
      address: d.data().address ?? '',
      dahuaChannelIds: d.data().dahuaChannelIds ?? [],
      dahuaPositionIds: d.data().dahuaPositionIds ?? [],
    })));
  }), []);

  useEffect(() => {
    if (!profile || !user) return;

    const path = 'visitors';
    const isMulti = profile.condoScope === 'multiple' && (profile.condoIds?.length ?? 0) > 0;

    // Filtro de estado empujado al servidor: el tab "Finalizados" (el que crece
    // sin techo) pasa a costar lo mismo que cualquier otro. Si falta el índice,
    // statusServerSide cae a false y se filtra en cliente (ver onError).
    const statusWhere: QueryConstraint[] = (statusServerSide && filterStatus)
      ? [where('status', '==', filterStatus)]
      : [];

    const onError = (err: any) => {
      if (err?.code === 'failed-precondition' && statusServerSide && filterStatus) {
        console.warn('[Visitors] falta el índice status+createdAt — filtrando estado en el cliente');
        setStatusServerSide(false);   // re-suscribe sin el where
        return;
      }
      setLoading(false);
      setLoadingMore(false);
      handleFirestoreError(err, OperationType.LIST, path);
    };

    // Operador/usuario con VARIOS condominios: un listener por condominio asignado.
    // (Antes se usaba collectionGroup(visitors).where(condoId in condoIds), que requería
    //  un índice collectionGroup en condoId inexistente → la query reventaba y la lista
    //  quedaba vacía: el operador no veía sus pases, incluidos los ingresos manuales.)
    if (isMulti) {
      const ids = (profile.condoIds as string[]).slice(0, 12);
      const perCondo = new Map<string, Visitor[]>();
      const perCondoFull = new Map<string, boolean>();
      const emit = () => {
        // Cada condominio aporta sus `pageSize` más recientes, así que el corte
        // de los `pageSize` primeros del merge es exacto.
        const merged = ([] as Visitor[]).concat(...perCondo.values())
          .sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0))
          .slice(0, pageSize);
        setVisitors(merged);
        setSelectedVisitor(prev => prev ? (merged.find(v => v.id === prev.id) ?? prev) : prev);
        setHasMore([...perCondoFull.values()].some(Boolean));
        setLoading(false);
        setLoadingMore(false);
      };
      const unsubs = ids.map(cid => onSnapshot(
        query(
          collection(db, `condos/${cid}/visitors`),
          ...statusWhere, orderBy('createdAt', 'desc'), limit(pageSize),
        ),
        (snap) => {
          perCondo.set(cid, snap.docs.map(d => ({ id: d.id, ...d.data() })) as Visitor[]);
          perCondoFull.set(cid, snap.size >= pageSize);
          emit();
        },
        onError,
      ));
      return () => unsubs.forEach(u => u());
    }

    let q: Query<DocumentData>;
    if (isGlobalScope && !filterCondo) {
      // Todos los condominios: ventana ordenada por el servidor. El índice de
      // campo único createdAt DESC en scope COLLECTION_GROUP ya está declarado.
      q = query(
        collectionGroup(db, 'visitors'),
        ...statusWhere, orderBy('createdAt', 'desc'), limit(pageSize),
      );
    } else {
      // Un solo condominio: el filtro de condominio también baja al servidor, así
      // el super admin que elige un condo deja de leer los pases de los demás.
      const cid = (isGlobalScope ? filterCondo : profile.condoId) || 'default';
      const colPath = `condos/${cid}/visitors`;
      q = isResident
        ? query(collection(db, colPath), where('userId', '==', user.uid), orderBy('createdAt', 'desc'), limit(pageSize))
        : query(collection(db, colPath), ...statusWhere, orderBy('createdAt', 'desc'), limit(pageSize));
    }

    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Visitor[];
      setVisitors(list);
      // Mantener el visitante abierto en el modal sincronizado con los cambios en
      // vivo (p.ej. cuando el poller marca dssAuthVerified, el QR pasa a "listo").
      setSelectedVisitor(prev => prev ? (list.find(v => v.id === prev.id) ?? prev) : prev);
      setHasMore(snap.size >= pageSize);
      setLoading(false);
      setLoadingMore(false);
    }, onError);

    return () => unsub();
  }, [profile, user, filterStatus, filterCondo, pageSize, statusServerSide]);

  // Bootstrap de "vistos" una vez cargada la primera tanda de pases.
  useEffect(() => {
    if (!user || seenBootstrapped.current || loading) return;
    const key = `pv:seenVisitors:${user.uid}`;
    let stored: Set<string>;
    try { stored = new Set(JSON.parse(localStorage.getItem(key) || '[]')); } catch { stored = new Set(); }
    if (!localStorage.getItem(`${key}:init`)) {
      visitors.forEach(v => stored.add(v.id));
      try {
        localStorage.setItem(key, JSON.stringify([...stored].slice(-800)));
        localStorage.setItem(`${key}:init`, '1');
      } catch { /* almacenamiento lleno — ignorar */ }
    }
    setSeenIds(stored);
    seenBootstrapped.current = true;
  }, [user, loading, visitors]);

  const markSeen = (id: string) => {
    if (!user) return;
    setSeenIds(prev => {
      if (prev.has(id)) return prev;
      const next = new Set(prev); next.add(id);
      try { localStorage.setItem(`pv:seenVisitors:${user.uid}`, JSON.stringify([...next].slice(-800))); } catch { /* */ }
      return next;
    });
  };
  const isNewPass = (id: string) => seenBootstrapped.current && !seenIds.has(id);

  // "Cargar más" trae historial antiguo. Ese historial no es "pase nuevo", así que
  // se marca como visto en bloque; si no, al ampliar la ventana la lista se
  // pintaría de azul entera (el bootstrap solo cubre la primera tanda).
  useEffect(() => {
    if (!bulkSeenPending.current || loadingMore || !user) return;
    bulkSeenPending.current = false;
    setSeenIds(prev => {
      const next = new Set(prev);
      visitors.forEach(v => next.add(v.id));
      try { localStorage.setItem(`pv:seenVisitors:${user.uid}`, JSON.stringify([...next].slice(-800))); } catch { /* */ }
      return next;
    });
  }, [loadingMore, visitors, user]);

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
    setDahuaStatus('idle'); setPlateWasStripped(false);
    setNewVisitor({
      visitorName: '', date: format(new Date(), 'yyyy-MM-dd'),
      entryTime: format(new Date(), 'HH:mm'),
      exitTime: format(new Date(Date.now() + 6 * 3600000), 'HH:mm'),
      licensePlate: '', condoId: profile?.condoId || '',
      phone: '', rut: '', unit: profile?.unit || '',
    });
    setShowAddModal(true);
  };

  const handleOpenEdit = (visitor: Visitor) => {
    setEditingVisitor(visitor);
    setDahuaStatus('idle'); setPlateWasStripped(false);
    setNewVisitor({
      visitorName: visitor.visitorName, date: visitor.date,
      entryTime: visitor.entryTime, exitTime: visitor.exitTime,
      licensePlate: visitor.licensePlate || '', condoId: visitor.condoId,
      phone: visitor.phone || '', rut: visitor.rut || '', unit: visitor.unit || '',
    });
    setShowAddModal(true);
  };

  // ── Ingreso manual (operador) ───────────────────────────────────────────────
  // Carga los residentes del condominio seleccionado para el selector "a quién visita".
  useEffect(() => {
    if (!showManualModal) { return; }
    const cid = (manualNeedsCondoPicker ? manualForm.condoId : manualSingleCondoId) || '';
    if (!cid) { setResidents([]); return; }
    let cancelled = false;
    (async () => {
      try {
        const snap = await getDocs(query(
          collection(db, 'users'),
          where('condoId', '==', cid),
          where('role', 'in', ['resident', 'usuario']),
        ));
        if (cancelled) return;
        const list: ResidentOption[] = snap.docs.map(d => ({
          uid: d.id,
          name: (d.data().name as string) || (d.data().email as string) || 'Residente',
          unit: (d.data().unit as string) || '',
        })).sort((a, b) => (a.unit || a.name).localeCompare(b.unit || b.name));
        setResidents(list);
      } catch (err) {
        console.warn('[ManualEntry] no se pudieron cargar residentes:', err);
        setResidents([]);
      }
    })();
    return () => { cancelled = true; };
  }, [showManualModal, manualForm.condoId, manualNeedsCondoPicker, manualSingleCondoId]);

  const handleOpenManual = () => {
    setManualForm({
      condoId: manualNeedsCondoPicker ? '' : manualSingleCondoId,
      unit: '', residentUid: '', visitorName: '', licensePlate: '', rut: '', phone: '', visitReason: '',
    });
    setShowManualModal(true);
  };

  const handleSaveManualEntry = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;
    const condoId = manualNeedsCondoPicker ? manualForm.condoId : manualSingleCondoId;
    if (!condoId) { alert('Selecciona un condominio.'); return; }
    const resident = residents.find(r => r.uid === manualForm.residentUid);
    if (!resident) { alert('Selecciona el residente que autoriza/recibe la visita.'); return; }
    if (!manualForm.visitorName.trim()) { alert('Ingresa el nombre del visitante.'); return; }

    setSavingManual(true);
    try {
      const now = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
      const entryTime = `${pad(now.getHours())}:${pad(now.getMinutes())}`;
      const startTs = Math.floor(now.getTime() / 1000);
      const endTs = startTs + 12 * 3600; // ventana por defecto: 12 h

      await addDoc(collection(db, `condos/${condoId}/visitors`), {
        userId: resident.uid,                       // dueño = residente visitado
        visitorName: manualForm.visitorName.trim(),
        date, entryTime, exitTime: '23:59',
        licensePlate: manualForm.licensePlate.trim().toUpperCase() || '',
        rut: manualForm.rut.trim() || '',
        phone: manualForm.phone.trim() || '',
        visitReason: manualForm.visitReason.trim() || '',
        unit: resident.unit || '',
        hostName: resident.name || '',
        condoId,
        qrCodeValue: '',                            // sin QR
        status: 'entered',                          // ya ingresó
        dssStatus: '1',                             // en sitio también en DSS
        manualEntry: true,
        createdByName: profile.name || '',
        createdByUid: user.uid,
        startTs, endTs,
        createdAt: Timestamp.now(), updatedAt: Timestamp.now(),
      });

      // Notificar al residente visitado.
      await sendNotification(
        resident.uid,
        'Visita ingresó',
        `${manualForm.visitorName.trim()} ha ingresado al condominio (registrado por portería).`,
        'visitor',
        '/visitors',
      );

      setShowManualModal(false);
    } catch (err) {
      console.error('[ManualEntry] error:', err);
      alert('No se pudo registrar el ingreso. Intenta nuevamente.');
    } finally {
      setSavingManual(false);
    }
  };

  const handleSaveVisitor = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;

    const condoId = isGlobalRole ? newVisitor.condoId : profile.condoId;
    if (!condoId) { alert('Por favor selecciona un condominio.'); return; }

    const path = `condos/${condoId}/visitors`;
    setSaving(true);

    // Always resolve channel IDs fresh at save time — the dahuaChannelIds state
    // can be stale on mobile if condos data hadn't finished loading when the
    // modal opened (race condition on slow cellular networks).
    let resolvedChannelIds: string[] =
      condos.find(c => c.id === condoId)?.dahuaChannelIds ?? dahuaChannelIds;
    let resolvedPositionIds: string[] =
      condos.find(c => c.id === condoId)?.dahuaPositionIds ?? [];
    if (!resolvedChannelIds.length || !resolvedPositionIds.length) {
      try {
        const snap = await getDoc(doc(db, 'condos', condoId));
        if (!resolvedChannelIds.length) resolvedChannelIds = snap.data()?.dahuaChannelIds ?? [];
        if (!resolvedPositionIds.length) resolvedPositionIds = snap.data()?.dahuaPositionIds ?? [];
      } catch { /* keep what we have */ }
    }

    try {
      if (editingVisitor) {
        await updateDoc(doc(db, path, editingVisitor.id), {
          ...newVisitor,
          startTs: toUnixSeconds(newVisitor.date, newVisitor.entryTime),
          endTs:   toEndUnixSeconds(newVisitor.date, newVisitor.entryTime, newVisitor.exitTime),
          updatedAt: Timestamp.now(),
        });

        if (resolvedChannelIds.length > 0) {
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
                endTs:   toEndUnixSeconds(newVisitor.date, newVisitor.entryTime, newVisitor.exitTime),
                acsChannelIds: resolvedChannelIds,
                positionIds: resolvedPositionIds,
              });
              await updateDoc(doc(db, path, editingVisitor.id), {
                dahuaVisitorId: result.visitorId ?? null,
                dahuaPersonId:  result.personId  ?? null,
                dahuaQrCode:    result.qrcode    ?? null,
                dahuaPassportCardNo: result.passportCardNo ?? null,
                qrReadyAt:      result.qrReadyAt ?? null,
              });
              setDahuaStatus('ok');
              if (result.plateStripped) setPlateWasStripped(true);
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
          startTs: toUnixSeconds(newVisitor.date, newVisitor.entryTime),
          endTs:   toEndUnixSeconds(newVisitor.date, newVisitor.entryTime, newVisitor.exitTime),
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
          unit: newVisitor.unit || undefined,
          hostName: profile.name || undefined,
          qrCodeValue: qrValue, status: 'pending', createdAt: Timestamp.now(),
        };

        if (resolvedChannelIds.length > 0) {
          setDahuaStatus('syncing');
          let synced = false;
          for (let attempt = 1; attempt <= 3 && !synced; attempt++) {
            try {
              const result = await DahuaService.createVisitor({
                visitorName: newVisitor.visitorName,
                hostName: profile.name || 'Portería Virtual',
                plate: newVisitor.licensePlate || undefined,
                startTs: toUnixSeconds(newVisitor.date, newVisitor.entryTime),
                endTs:   toEndUnixSeconds(newVisitor.date, newVisitor.entryTime, newVisitor.exitTime),
                acsChannelIds: resolvedChannelIds,
                positionIds: resolvedPositionIds,
              });
              await updateDoc(doc(db, path, savedId), {
                dahuaVisitorId: result.visitorId ?? null,
                dahuaPersonId:  result.personId  ?? null,
                dahuaQrCode:    result.qrcode    ?? null,
                dahuaPassportCardNo: result.passportCardNo ?? null,
                qrReadyAt:      result.qrReadyAt ?? null,
              });
              createdVisitor = { ...createdVisitor, dahuaVisitorId: result.visitorId ?? undefined, dahuaPersonId: result.personId ?? undefined, dahuaQrCode: result.qrcode ?? undefined, dahuaPassportCardNo: result.passportCardNo ?? undefined, qrReadyAt: result.qrReadyAt ?? undefined };
              setDahuaStatus('ok');
              if (result.plateStripped) setPlateWasStripped(true);
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

        setShowAddModal(false); setEditingVisitor(null); setDahuaStatus('idle'); setPlateWasStripped(false);
        setSelectedVisitor(createdVisitor);
        return;
      }

      setShowAddModal(false); setEditingVisitor(null); setDahuaStatus('idle'); setPlateWasStripped(false);
    } catch (err) {
      handleFirestoreError(err, editingVisitor ? OperationType.UPDATE : OperationType.CREATE, path);
    } finally {
      setSaving(false);
    }
  };

  const handleRepeat = (visitor: Visitor) => {
    setEditingVisitor(null);
    setDahuaStatus('idle'); setPlateWasStripped(false);
    setNewVisitor({
      visitorName: visitor.visitorName,
      licensePlate: visitor.licensePlate || '',
      condoId: visitor.condoId || profile?.condoId || '',
      date: format(new Date(), 'yyyy-MM-dd'),
      entryTime: format(new Date(), 'HH:mm'),
      exitTime: format(new Date(Date.now() + 6 * 3600000), 'HH:mm'),
      phone: visitor.phone || '', rut: visitor.rut || '', unit: visitor.unit || profile?.unit || '',
    });
    setShowAddModal(true);
  };

  const buildWelcomeMessage = (visitor: Visitor) => {
    const condo = condoName(visitor.condoId) || profile?.condoName || 'el condominio';
    const address = condos.find(c => c.id === visitor.condoId)?.address?.trim();
    const mapsUrl = address ? `https://maps.google.com/?q=${encodeURIComponent(address)}` : '';
    const addressLine = address ? `📍 ${address}\n🗺️ Ver en Google Maps: ${mapsUrl}\n` : '';
    const unitLine = visitor.unit ? `🏠 Unidad: ${visitor.unit}\n` : '';
    const plate = visitor.licensePlate ? `🚗 Patente: ${visitor.licensePlate}` : '🚶 Acceso peatonal';
    const host  = visitor.hostName ? `👤 Autorizado por: ${visitor.hostName}\n` : '';
    return (
      `Hola ${visitor.visitorName}! 👋\n\n` +
      `Has recibido un *Pase de Visita* autorizado para acceder a:\n` +
      `🏢 *${condo}*\n` +
      `${addressLine}` +
      `${unitLine}` +
      `\n` +
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
    const isNative = Capacitor.isNativePlatform();

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

            if (isNative) {
              try {
                const dataUrl: string = await new Promise((res, rej) => {
                  const reader = new FileReader();
                  reader.onloadend = () => res(reader.result as string);
                  reader.onerror = () => rej(reader.error);
                  reader.readAsDataURL(pngBlob);
                });
                const base64 = dataUrl.split(',')[1];
                const fileName = `pase-${Date.now()}.png`;
                const written = await Filesystem.writeFile({
                  path: fileName,
                  data: base64,
                  directory: Directory.Cache,
                });
                await Share.share({
                  title: `Pase QR — ${visitor.visitorName}`,
                  text: message,
                  files: [written.uri],
                  dialogTitle: 'Compartir pase',
                });
              } catch { /* cancelled or unavailable */ }
              resolve(); return;
            }

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

    // No QR element visible — text-only fallback
    if (isNative) {
      try {
        await Share.share({ text: message, dialogTitle: 'Compartir pase' });
      } catch { /* cancelled */ }
      return;
    }
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
    const condo = condos.find(c => c.id === condoId);
    const channelIds = condo?.dahuaChannelIds ?? [];
    const positionIds = condo?.dahuaPositionIds ?? [];
    if (!channelIds.length) return;
    setResyncing(visitor.id);
    try {
      const result = await DahuaService.createVisitor({
        visitorName: visitor.visitorName,
        hostName: profile.name || 'Portería Virtual',
        plate: visitor.licensePlate || undefined,
        startTs: toUnixSeconds(visitor.date, visitor.entryTime),
        endTs:   toEndUnixSeconds(visitor.date, visitor.entryTime, visitor.exitTime),
        acsChannelIds: channelIds,
        positionIds,
      });
      await updateDoc(doc(db, `condos/${condoId}/visitors`, visitor.id), {
        dahuaVisitorId: result.visitorId ?? null,
        dahuaPersonId:  result.personId  ?? null,
        dahuaQrCode:    result.qrcode    ?? null,
        dahuaPassportCardNo: result.passportCardNo ?? null,
        qrReadyAt:      result.qrReadyAt ?? null,
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
    const toDelete = deletingVisitor;
    if (toDelete.dahuaVisitorId) {
      DahuaService.deleteVisitor(toDelete.dahuaVisitorId).catch(() => {});
    }
    try {
      await deleteDoc(doc(db, path, toDelete.id));
      setDeletingVisitor(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, path);
    } finally {
      setDeleting(false);
    }
  };

  // Finaliza un pase en sitio (marca salida). Para pases manuales notifica al residente.
  const handleFinalizePass = async (visitor: Visitor) => {
    const path = `condos/${visitor.condoId || profile?.condoId || 'default'}/visitors`;
    setResyncing(visitor.id);
    try {
      if (visitor.dahuaVisitorId) DahuaService.terminateVisitor(visitor.dahuaVisitorId).catch(() => {});
      // Registrar la hora REAL de salida (no la programada) al finalizar.
      const nowExit = new Date();
      const pad = (n: number) => String(n).padStart(2, '0');
      const actualExitTime = `${pad(nowExit.getHours())}:${pad(nowExit.getMinutes())}`;
      await updateDoc(doc(db, path, visitor.id), {
        status: 'exited', dssStatus: '4',
        exitTime: actualExitTime,
        exitedAt: Timestamp.now(),
        updatedAt: Timestamp.now(),
      });
      if (visitor.manualEntry && visitor.userId) {
        await sendNotification(
          visitor.userId,
          'Visita finalizada',
          `${visitor.visitorName} se ha retirado del condominio.`,
          'visitor',
          '/visitors',
        );
      }
      setSelectedVisitor(prev => prev && prev.id === visitor.id ? { ...prev, status: 'exited', exitTime: actualExitTime } : prev);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    } finally {
      setResyncing(null);
    }
  };

  const handleTerminateVisitor = async () => {
    if (!profile || !deletingVisitor) return;
    const path = `condos/${deletingVisitor.condoId || profile.condoId || 'default'}/visitors`;
    setTerminating(true);
    const toTerminate = deletingVisitor;
    if (toTerminate.dahuaVisitorId) {
      DahuaService.terminateVisitor(toTerminate.dahuaVisitorId).catch(() => {});
    }
    try {
      await updateDoc(doc(db, path, toTerminate.id), {
        status: 'exited',
        dssStatus: '4',
        updatedAt: Timestamp.now(),
      });
      setDeletingVisitor(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, path);
    } finally {
      setTerminating(false);
    }
  };

  // ── filtered list for staff ─────────────────────────────────────────────────
  // Los filtros ya se aplican en la query; esto queda como red de seguridad (y es
  // el filtro real cuando statusServerSide cayó a false por falta de índice).
  const staffFiltered = useMemo(() => visitors.filter(v =>
    (!filterCondo || v.condoId === filterCondo) &&
    (!filterStatus || v.status === filterStatus)
  ), [visitors, filterCondo, filterStatus]);

  const activeVisitors = useMemo(() => visitors.filter(v => v.status !== 'exited'), [visitors]);
  const pastVisitors   = useMemo(() => visitors.filter(v => v.status === 'exited'), [visitors]);

  const condoNameById = useMemo(() => {
    const m = new Map<string, string>();
    condos.forEach(c => m.set(c.id, c.name));
    return m;
  }, [condos]);
  const condoName = (condoId: string) => condoNameById.get(condoId) ?? condoId;

  // Acciones de fila con identidad estable: el ref se refresca en cada render (no
  // hay closures obsoletos) y el objeto no cambia, así React.memo puede cortar el
  // re-render de las filas que no cambiaron.
  const handlersRef = useRef<any>({});
  handlersRef.current = {
    handleRetrySync, handleOpenPass, handleFinalizePass,
    handleOpenEdit, handleRepeat, setDeletingVisitor, setSelectedVisitor, markSeen,
  };
  const rowActions = useMemo<RowActions>(() => ({
    retrySync: (v) => handlersRef.current.handleRetrySync(v),
    openPass:  (v) => handlersRef.current.handleOpenPass(v),
    finalize:  (v) => handlersRef.current.handleFinalizePass(v),
    edit:      (v) => handlersRef.current.handleOpenEdit(v),
    repeat:    (v) => handlersRef.current.handleRepeat(v),
    remove:    (v) => handlersRef.current.setDeletingVisitor(v),
    showQr:    (v) => handlersRef.current.setSelectedVisitor(v),
    markSeen:  (id) => handlersRef.current.markSeen(id),
  }), []);

  const handleLoadMore = () => {
    bulkSeenPending.current = true;
    setLoadingMore(true);
    setPageSize(p => p + PAGE_SIZE);
  };

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
          <div className="flex items-center gap-2">
            {canManualEntry && (
              <Button variant="secondary" icon={LogIn} onClick={handleOpenManual}>
                Registrar ingreso
              </Button>
            )}
            {canGenerate && (
              <Button icon={Plus} onClick={handleOpenAdd}>
                Generar pase
              </Button>
            )}
          </div>
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
                onClick={() => changeFilterStatus(tab.value)}
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
                  onClick={() => changeFilterCondo('')}
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
                    onClick={() => changeFilterCondo(c.id)}
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
              <div className="overflow-x-auto">
              <table className="w-full text-sm min-w-[760px]">
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
                      Sincronización
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
                  {staffFiltered.map((visitor) => (
                    <VisitorRow
                      key={visitor.id}
                      visitor={visitor}
                      showCondo={isGlobalScope}
                      condoLabel={isGlobalScope ? condoName(visitor.condoId) : ''}
                      isNew={isNewPass(visitor.id)}
                      canEdit={
                        profile?.role === 'super_admin' || profile?.role === 'condo_admin' ||
                        profile?.role === 'administrador' || visitor.userId === user?.uid
                      }
                      canOpen={
                        ['super_admin', 'administrador', 'condo_admin', 'operator'].includes(profile?.role || '') &&
                        visitor.status === 'pending'
                      }
                      isResyncing={resyncing === visitor.id}
                      actions={rowActions}
                    />
                  ))}
                </tbody>
              </table>
              </div>

              {/* Table footer count + paginación */}
              <div className="px-4 py-3 border-t border-slate-100 dark:border-white/5 flex items-center justify-between gap-3 flex-wrap">
                <p className="text-xs text-slate-400 dark:text-slate-500">
                  {staffFiltered.length} pase{staffFiltered.length !== 1 ? 's' : ''}
                  {filterStatus ? ` · ${STATUS_TABS.find(t => t.value === filterStatus)?.label}` : ''}
                  {filterCondo ? ` · ${condoName(filterCondo)}` : ''}
                  {hasMore ? ' · más recientes' : ''}
                </p>
                {hasMore && (
                  <Button variant="secondary" loading={loadingMore} onClick={handleLoadMore}>
                    Cargar más
                  </Button>
                )}
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
            />
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 sm:gap-5">
            {[...activeVisitors, ...pastVisitors].map((visitor, i) => {
              const isFirstPast = visitor.status === 'exited' && i === activeVisitors.length;
              const status = statusMap[visitor.status] || statusMap.pending;
              const canEdit = visitor.userId === user?.uid;
              return (
                <React.Fragment key={visitor.id}>
                  {isFirstPast && (
                    <div className="col-span-full flex items-center gap-3 pt-2 pb-1">
                      <span className="text-xs font-semibold text-slate-400 dark:text-slate-500 uppercase tracking-wider shrink-0">Últimas visitas</span>
                      <div className="flex-1 h-px bg-slate-200 dark:bg-white/5" />
                    </div>
                  )}
                  {/* Sin `layout`: la animación de layout obliga a medir cada tarjeta
                      en cada render y es el costo dominante con muchas visitas. */}
                  <motion.div
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: Math.min(i * 0.04, 0.2), duration: 0.2 }}
                    className={cn(visitor.status === 'exited' && 'opacity-70')}
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
                            <span title="Sincronizado con Portería Virtual" className="text-emerald-500"><Wifi size={13} /></span>
                          ) : (
                            <button
                              onClick={e => { e.stopPropagation(); handleRetrySync(visitor); }}
                              disabled={resyncing === visitor.id}
                              aria-label="Reintentar sincronización"
                              title="Sin sincronización — clic para reintentar"
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
                              {visitor.status !== 'exited' && (
                                <IconBtn title="Editar" onClick={() => handleOpenEdit(visitor)}>
                                  <Edit2 size={15} />
                                </IconBtn>
                              )}
                              <IconBtn title="Eliminar" tone="danger" onClick={() => setDeletingVisitor(visitor)}>
                                <Trash2 size={15} />
                              </IconBtn>
                              <IconBtn title="Volver a invitar" tone="success" onClick={() => handleRepeat(visitor)}>
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
                </React.Fragment>
              );
            })}
          </div>

          {hasMore && (
            <div className="flex justify-center pt-2">
              <Button variant="secondary" loading={loadingMore} onClick={handleLoadMore}>
                Ver visitas anteriores
              </Button>
            </div>
          )}
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
                      {dahuaChannelIds.length} puerta{dahuaChannelIds.length !== 1 ? 's' : ''} autorizada{dahuaChannelIds.length !== 1 ? 's' : ''}
                    </Badge>
                  ) : (
                    <Badge variant="warn" icon={WifiOff}>
                      Sin puertas asignadas — el pase no se sincronizará con Portería Virtual
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
            <Field label="Unidad / Depto" hint="A quién visita — se muestra al visitante">
              <div className="relative">
                <Building2 size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
                <Input
                  type="text"
                  value={newVisitor.unit}
                  onChange={e => setNewVisitor({ ...newVisitor, unit: e.target.value })}
                  placeholder="Ej: 602" className="pl-10"
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
                  {dahuaStatus === 'syncing' && <><Spinner size={14} /> Registrando en Portería Virtual…</>}
                  {dahuaStatus === 'ok'      && <><Wifi size={14} /> Sincronizado — el QR se activa en los lectores en ~2-3 min.</>}
                  {dahuaStatus === 'error'   && <><WifiOff size={14} /> Pase guardado, pero no se pudo sincronizar con Portería Virtual.</>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <AnimatePresence>
            {plateWasStripped && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="overflow-hidden"
              >
                <div className="flex items-start gap-2.5 px-3.5 py-2.5 rounded-xl text-sm font-medium border bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20 text-amber-700 dark:text-amber-300">
                  <WifiOff size={14} className="mt-0.5 shrink-0" />
                  <span>Ya existe un pase activo con la patente ingresada en el Sistema de Portería Virtual. El pase fue sincronizado sin número de vehículo.</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <Button type="submit" size="lg" icon={QrCode} fullWidth loading={saving || dahuaStatus === 'syncing'}>
            {dahuaStatus === 'syncing' ? 'Procesando…' : editingVisitor ? 'Actualizar pase' : 'Generar pase autorizado'}
          </Button>
        </form>
      </Modal>

      {/* ── Ingreso Manual Modal (operador / super admin) ───────────────────── */}
      <Modal
        open={showManualModal}
        onClose={() => { if (!savingManual) setShowManualModal(false); }}
        title="Registrar ingreso (sin QR)"
        description="Para visitas que llegan sin pase. El residente recibe la notificación y el registro queda en su app."
        icon={LogIn}
        size="md"
      >
        <form onSubmit={handleSaveManualEntry} className="space-y-4">
          {manualNeedsCondoPicker && (
            <Field label="Condominio" required>
              <div className="relative">
                <Building2 size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
                <select
                  required
                  value={manualForm.condoId}
                  onChange={e => setManualForm({ ...manualForm, condoId: e.target.value, unit: '', residentUid: '' })}
                  className={cn(selectClass, 'pl-10 pr-8')}
                >
                  <option value="">Seleccionar…</option>
                  {assignableCondos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              </div>
            </Field>
          )}

          <Field label="Unidad / Depto" required hint="Selecciona la unidad visitada">
            <div className="relative">
              <Building2 size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
              <select
                required
                value={manualForm.unit}
                onChange={e => setManualForm({ ...manualForm, unit: e.target.value, residentUid: '' })}
                disabled={!residents.length}
                className={cn(selectClass, 'pl-10 pr-8', !residents.length && 'opacity-60')}
              >
                <option value="">{residents.length ? 'Seleccionar unidad…' : 'Selecciona un condominio con residentes'}</option>
                {Array.from(new Set(residents.map(r => r.unit).filter(Boolean))).sort((a, b) => a.localeCompare(b)).map(u => (
                  <option key={u} value={u}>{u}</option>
                ))}
              </select>
            </div>
          </Field>

          <Field label="Residente que recibe la visita" required hint="Recibirá la notificación">
            <div className="relative">
              <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
              <select
                required
                value={manualForm.residentUid}
                onChange={e => setManualForm({ ...manualForm, residentUid: e.target.value })}
                disabled={!manualForm.unit}
                className={cn(selectClass, 'pl-10 pr-8', !manualForm.unit && 'opacity-60')}
              >
                <option value="">{manualForm.unit ? 'Seleccionar residente…' : 'Primero selecciona la unidad'}</option>
                {residents.filter(r => r.unit === manualForm.unit).map(r => (
                  <option key={r.uid} value={r.uid}>{r.name}</option>
                ))}
              </select>
            </div>
          </Field>

          <Field label="Nombre del visitante" required>
            <div className="relative">
              <User size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
              <Input
                type="text" required
                value={manualForm.visitorName}
                onChange={e => setManualForm({ ...manualForm, visitorName: e.target.value })}
                placeholder="Nombre completo" className="pl-10"
              />
            </div>
          </Field>

          <Field label="Motivo de visita" hint="Opcional">
            <div className="relative">
              <ClipboardList size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
              <Input
                type="text" list="manual-visit-reasons"
                value={manualForm.visitReason}
                onChange={e => setManualForm({ ...manualForm, visitReason: e.target.value })}
                placeholder="Ej: Familiar, Delivery, Servicio técnico, Mudanza…" className="pl-10"
              />
              <datalist id="manual-visit-reasons">
                <option value="Familiar / Amigo" />
                <option value="Delivery / Encomienda" />
                <option value="Servicio técnico" />
                <option value="Mudanza" />
                <option value="Proveedor" />
                <option value="Visita comercial" />
                <option value="Retiro / Entrega" />
              </datalist>
            </div>
          </Field>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Field label="RUT" hint="Opcional">
              <div className="relative">
                <CreditCard size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
                <Input type="text" value={manualForm.rut}
                  onChange={e => setManualForm({ ...manualForm, rut: e.target.value.toUpperCase() })}
                  placeholder="12345678-9" className="pl-10 font-mono" />
              </div>
            </Field>
            <Field label="Patente" hint="Opcional">
              <div className="relative">
                <Car size={16} className="absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" aria-hidden />
                <Input type="text" value={manualForm.licensePlate}
                  onChange={e => setManualForm({ ...manualForm, licensePlate: e.target.value.toUpperCase() })}
                  placeholder="AAAA-00" className="pl-10 font-mono" />
              </div>
            </Field>
          </div>

          <Button type="submit" size="lg" icon={LogIn} fullWidth loading={savingManual}>
            Registrar ingreso
          </Button>
        </form>
      </Modal>

      {/* ── QR Detail Modal ──────────────────────────────────────────────────── */}
      <Modal open={!!selectedVisitor} onClose={() => setSelectedVisitor(null)} size="sm">
        {selectedVisitor && (
          <div className="flex flex-col items-center pt-2">
            <Badge
              variant={selectedVisitor.status === 'exited' ? 'muted' : 'brand'}
              className="mt-2 mb-4"
            >
              {selectedVisitor.status === 'exited' ? 'Visita finalizada' : selectedVisitor.manualEntry ? 'Ingreso registrado' : 'Pase digital activo'}
            </Badge>

            <div
              ref={qrRef}
              className={cn(
                'relative p-5 bg-white rounded-2xl border mb-3 ring-1',
                selectedVisitor.status === 'exited'
                  ? 'border-slate-300 ring-slate-200'
                  : 'border-slate-200 ring-slate-100',
              )}
            >
              {(() => {
                // El QR está "activándose" mientras el sistema no haya confirmado la
                // sincronización (dssAuthVerified) Y no se haya cumplido el tiempo
                // máximo (qrReadyAt). Si la confirmación llega antes, la cuenta se
                // corta de inmediato y el QR pasa a listo.
                const activating =
                  selectedVisitor.status !== 'exited' &&
                  !selectedVisitor.dssAuthVerified &&
                  !!selectedVisitor.qrReadyAt &&
                  nowTs < (selectedVisitor.qrReadyAt as number);
                const remainSec = Math.max(1, (selectedVisitor.qrReadyAt as number) - nowTs);
                const remainLabel = remainSec >= 60 ? `~${Math.ceil(remainSec / 60)} min` : `~${remainSec} s`;
                return (
                  <>
                    <div className={cn(
                      (selectedVisitor.status === 'exited' || activating) && 'opacity-25 grayscale pointer-events-none',
                    )}>
                      {selectedVisitor.manualEntry ? (
                        <div className="w-[180px] h-[180px] flex flex-col items-center justify-center text-center gap-2 px-3">
                          <LogIn className="text-green-600" size={40} />
                          <p className="text-sm font-semibold text-slate-700">Ingreso registrado por portería</p>
                          <p className="text-xs text-slate-400">Este pase no usa QR</p>
                        </div>
                      ) : (
                        <QRCodeSVG value={selectedVisitor.dahuaQrCode || selectedVisitor.qrCodeValue} size={180} includeMargin />
                      )}
                    </div>
                    {selectedVisitor.status === 'exited' && (
                      <div className="absolute inset-0 flex items-center justify-center rounded-2xl">
                        <div className="w-14 h-14 bg-red-500/90 rounded-full flex items-center justify-center shadow-lg">
                          <AlertCircle size={28} className="text-white" />
                        </div>
                      </div>
                    )}
                    {activating && (
                      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl">
                        <Spinner size={26} />
                        <p className="text-[11px] font-semibold text-slate-600 text-center px-4 leading-tight">
                          Activándose en los lectores…<br />{remainLabel}
                        </p>
                      </div>
                    )}
                  </>
                );
              })()}
            </div>

            {selectedVisitor.status !== 'exited' && !selectedVisitor.manualEntry && (
              (!selectedVisitor.dssAuthVerified && selectedVisitor.qrReadyAt && nowTs < selectedVisitor.qrReadyAt) ? (
                <Badge variant="warn" icon={Clock}>
                  {(() => { const r = Math.max(1, (selectedVisitor.qrReadyAt as number) - nowTs); return r >= 60 ? `El QR se activa en ~${Math.ceil(r / 60)} min` : `El QR se activa en ~${r} s`; })()}
                </Badge>
              ) : (
                <Badge variant={selectedVisitor.dahuaQrCode ? 'success' : 'muted'} icon={selectedVisitor.dahuaQrCode ? Wifi : WifiOff}>
                  {selectedVisitor.dahuaQrCode ? 'QR Portería Virtual' : 'QR local'}
                </Badge>
              )
            )}

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
              {selectedVisitor.unit && (
                <DetailRow label="Unidad" value={selectedVisitor.unit} accent="brand" />
              )}
              {selectedVisitor.visitReason && (
                <DetailRow label="Motivo" value={selectedVisitor.visitReason} />
              )}
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
                <DetailRow label="ID de pase" value={selectedVisitor.dahuaVisitorId} mono accent="success" />
              )}
            </div>

            {selectedVisitor.accessedDoors && selectedVisitor.accessedDoors.length > 0 && (
              <div className="w-full mb-5">
                <p className="text-xs font-semibold text-slate-500 dark:text-slate-400 uppercase tracking-wide mb-2">Puertas accedidas</p>
                <div className="space-y-1.5">
                  {selectedVisitor.accessedDoors.map((door, i) => (
                    <div key={i} className="flex items-center justify-between rounded-lg bg-slate-50 dark:bg-white/5 px-3 py-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className={`shrink-0 w-1.5 h-1.5 rounded-full ${door.direction === 'in' ? 'bg-emerald-400' : door.direction === 'out' ? 'bg-amber-400' : 'bg-slate-400'}`} />
                        <span className="text-sm text-slate-800 dark:text-slate-200 truncate">{door.channelName || door.channelId || '—'}</span>
                      </div>
                      <span className="text-xs text-slate-400 dark:text-slate-500 shrink-0 ml-2">
                        {door.accessTime ? new Date(door.accessTime * 1000).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : '—'}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {selectedVisitor.status === 'exited' ? (
              <button
                onClick={() => { handleRepeat(selectedVisitor); setSelectedVisitor(null); }}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-colors cursor-pointer"
              >
                <RotateCcw size={16} />
                Volver a invitar
              </button>
            ) : !selectedVisitor.manualEntry ? (
              <button
                onClick={() => shareWhatsApp(selectedVisitor)}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-[#25D366] hover:bg-[#20bd5a] text-white font-semibold text-sm transition-colors cursor-pointer"
              >
                <MessageCircle size={16} />
                Compartir por WhatsApp
              </button>
            ) : (
              <button
                onClick={() => handleFinalizePass(selectedVisitor)}
                disabled={resyncing === selectedVisitor.id}
                className="w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-colors cursor-pointer disabled:opacity-50"
              >
                {resyncing === selectedVisitor.id ? <Spinner size={16} /> : <CheckCircle2 size={16} />}
                Finalizar pase
              </button>
            )}

            <button
              onClick={() => setSelectedVisitor(null)}
              className="w-full mt-2 flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 font-semibold text-sm transition-colors cursor-pointer"
            >
              Cerrar
            </button>
          </div>
        )}
      </Modal>

      {/* ── Delete Confirm Modal ─────────────────────────────────────────────── */}
      <Modal
        open={!!deletingVisitor}
        onClose={() => {
          if (deleting || terminating) return;
          setDeletingVisitor(null);
        }}
        size="sm"
      >
        <div className="text-center space-y-4 pt-2">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
            <Trash2 size={24} />
          </div>
          <div>
            <h2 className="text-slate-900 dark:text-white">¿Anular invitación?</h2>
            <p className="subtle mt-1">
              El pase de{' '}
              <span className="font-semibold text-slate-900 dark:text-white">{deletingVisitor?.visitorName}</span>{' '}
              dejará de aparecer como activo.
            </p>
            <p className="subtle mt-2 text-xs">
              <span className="font-semibold">Finalizar</span> mantiene el registro en el historial.{' '}
              <span className="font-semibold">Eliminar</span> lo borra por completo.
            </p>
          </div>
          <div className="rounded-xl bg-amber-500/10 border border-amber-500/30 text-amber-700 dark:text-amber-300 text-[11px] text-left p-3 leading-relaxed">
            <strong>Nota:</strong> si el invitado aún no ingresó al condominio, su código QR podría seguir siendo aceptado por los lectores hasta la hora de expiración programada del pase.
          </div>
          <div className="space-y-2 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <Button
                icon={CheckCircle2}
                onClick={handleTerminateVisitor}
                loading={terminating}
                disabled={deleting}
                className="bg-amber-500 text-white hover:bg-amber-600 shadow-sm shadow-amber-500/20"
              >
                Finalizar
              </Button>
              <Button
                variant="danger"
                icon={Trash2}
                onClick={handleDeleteVisitor}
                loading={deleting}
                disabled={terminating}
              >
                Eliminar
              </Button>
            </div>
            <Button
              variant="secondary"
              fullWidth
              onClick={() => setDeletingVisitor(null)}
              disabled={deleting || terminating}
            >
              Cancelar
            </Button>
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
