import React, { useState, useEffect } from 'react';
import { db, storage } from '../firebase';
import {
  collection, query, where, onSnapshot, addDoc, doc, updateDoc, deleteDoc,
  Timestamp, collectionGroup, orderBy, getDocs,
} from 'firebase/firestore';
import { ref, uploadBytes, getDownloadURL, deleteObject } from 'firebase/storage';
import { useAuth } from '../hooks/useAuth';
import {
  CreditCard, Calendar, FileText, CheckCircle2, Clock, AlertTriangle,
  Plus, Trash2, Edit2, TrendingUp, TrendingDown, ChevronDown,
  Settings, Zap, BarChart3, Printer, Users, Receipt,
  LayoutDashboard, DollarSign, ToggleLeft, ToggleRight,
  Paperclip, ExternalLink, FileImage, X as XIcon, Upload,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType, cn } from '../lib/utils';
import { PageHeader, Button, Card, Field, Input, Modal, Badge, StatCard, EmptyState, Spinner } from '../components/ui';

// ── Types ────────────────────────────────────────────────────────────────────
interface Expense {
  id: string;
  userId: string;
  userName: string;
  condoId: string;
  condoName: string;
  unit: string;
  month: string;
  year: string;
  amount: string;
  status: 'paid' | 'pending' | 'overdue';
  date: string;
  items?: { nombre: string; monto: number }[];
  documentUrl?: string;
  documentName?: string;
  documentType?: string;
  createdAt: any;
}

interface GastoItem {
  id: string;
  condoId: string;
  nombre: string;
  monto: number;
  activo: boolean;
  createdAt?: any;
}

type AdminTab = 'resumen' | 'items' | 'emision' | 'morosidad';

// ── Constants ─────────────────────────────────────────────────────────────────
const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

const STATUS_BADGE: Record<Expense['status'], { variant: 'success'|'warn'|'danger'; label: string }> = {
  paid:    { variant: 'success', label: 'Pagado' },
  pending: { variant: 'warn',    label: 'Pendiente' },
  overdue: { variant: 'danger',  label: 'Vencido' },
};

const selectClass =
  'block w-full bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition cursor-pointer';

// ── Utilities ──────────────────────────────────────────────────────────────────
const parseAmount = (raw: string) =>
  Number(String(raw).replace(/\./g, '').replace(',', '.')) || 0;

const formatCLPFull = (n: number) =>
  `$${Math.round(n).toLocaleString('es-CL')}`;

const formatCLPCompact = (n: number) =>
  n >= 1_000_000
    ? `$${(n / 1_000_000).toFixed(1)}M`
    : n >= 1_000
    ? `$${(n / 1_000).toFixed(0)}K`
    : `$${n}`;

// ── Receipt printer ────────────────────────────────────────────────────────────
function printReceipt(expense: Expense) {
  const total = parseAmount(expense.amount);
  const win = window.open('', '_blank', 'width=620,height=850');
  if (!win) return;
  const statusLabel = STATUS_BADGE[expense.status]?.label ?? expense.status;
  const itemRows = (expense.items ?? [])
    .map(i => `<tr><td>${i.nombre}</td><td style="text-align:right">${formatCLPFull(i.monto)}</td></tr>`)
    .join('');
  win.document.write(`<!DOCTYPE html><html lang="es"><head><meta charset="UTF-8"/>
<title>Boleta ${expense.month} ${expense.year}</title>
<style>
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:Arial,sans-serif;font-size:13px;color:#111;padding:36px}
.hdr{text-align:center;border-bottom:2px solid #222;padding-bottom:16px;margin-bottom:20px}
.hdr h1{font-size:22px;font-weight:bold}
.hdr p{font-size:12px;color:#555;margin-top:3px}
h2{font-size:10px;text-transform:uppercase;letter-spacing:.08em;color:#888;margin:16px 0 8px}
table{width:100%;border-collapse:collapse}
td{padding:5px 0;border-bottom:1px solid #eee}
td:last-child{text-align:right}
tr:last-child td{border:none}
.total{display:flex;justify-content:space-between;padding:12px 0;font-size:17px;font-weight:bold;border-top:2px solid #222;margin-top:10px}
.badge{display:inline-block;padding:2px 8px;border-radius:4px;font-size:11px;font-weight:bold}
.paid{background:#dcfce7;color:#166534}.pending{background:#fef9c3;color:#854d0e}.overdue{background:#fee2e2;color:#991b1b}
.ftr{text-align:center;font-size:11px;color:#aaa;margin-top:32px;border-top:1px solid #eee;padding-top:12px}
</style></head><body>
<div class="hdr"><h1>Portería Virtual</h1><p>Boleta de Gastos Comunes</p><p>${expense.condoName || ''}</p></div>
<h2>Información</h2>
<table>
<tr><td>Período</td><td>${expense.month} ${expense.year}</td></tr>
<tr><td>Fecha emisión</td><td>${expense.date}</td></tr>
<tr><td>Residente</td><td>${expense.userName || '—'}</td></tr>
<tr><td>Unidad</td><td>${expense.unit || '—'}</td></tr>
<tr><td>Estado</td><td><span class="badge ${expense.status}">${statusLabel}</span></td></tr>
</table>
${itemRows ? `<h2>Detalle</h2><table>${itemRows}</table>` : ''}
<div class="total"><span>Total</span><span>${formatCLPFull(total)}</span></div>
<div class="ftr"><p>Generado por Portería Virtual · porteriavirtual.cl</p></div>
<script>window.onload=function(){window.print()}<\/script>
</body></html>`);
  win.document.close();
}

// ── Tab button ─────────────────────────────────────────────────────────────────
function TabBtn({ active, onClick, icon: Icon, children }: {
  active: boolean; onClick: () => void; icon: React.ElementType; children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex items-center gap-1.5 px-4 py-2 text-sm font-semibold rounded-lg transition-colors cursor-pointer whitespace-nowrap',
        active
          ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/20'
          : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-white/5',
      )}
    >
      <Icon size={14} strokeWidth={2.2} />
      {children}
    </button>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────
const Expenses = () => {
  const { profile, user } = useAuth();
  const isAdmin    = profile?.role === 'super_admin' || profile?.role === 'condo_admin' || profile?.role === 'administrador';
  const isResident = profile?.role === 'resident' || profile?.role === 'usuario';
  const isGlobal   = profile?.role === 'super_admin' || profile?.condoScope === 'all';

  const [activeTab, setActiveTab] = useState<AdminTab>('resumen');

  // ── Data ─────────────────────────────────────────────────────────────────────
  const [expenses,     setExpenses]     = useState<Expense[]>([]);
  const [gastoItems,   setGastoItems]   = useState<GastoItem[]>([]);
  const [condos,       setCondos]       = useState<{ id: string; name: string }[]>([]);
  const [residents,    setResidents]    = useState<any[]>([]);
  const [loadingExp,   setLoadingExp]   = useState(true);
  const [loadingItems, setLoadingItems] = useState(true);

  // super_admin: which condo to manage items/emit for
  const [itemsCondoId, setItemsCondoId] = useState('');

  // ── Expense CRUD ─────────────────────────────────────────────────────────────
  const [showExpModal,    setShowExpModal]    = useState(false);
  const [editingExp,      setEditingExp]      = useState<Expense | null>(null);
  const [deletingExp,     setDeletingExp]     = useState<Expense | null>(null);
  const [savingExp,       setSavingExp]       = useState(false);
  const [confirmDelExp,   setConfirmDelExp]   = useState(false);
  const [expForm, setExpForm] = useState({
    userName: '', unit: '', month: MONTHS[new Date().getMonth()],
    year: new Date().getFullYear().toString(), amount: '',
    status: 'pending' as Expense['status'],
    date: new Date().toISOString().split('T')[0], condoId: '',
  });

  // ── GastoItem CRUD ───────────────────────────────────────────────────────────
  const [showItemModal,  setShowItemModal]  = useState(false);
  const [editingItem,    setEditingItem]    = useState<GastoItem | null>(null);
  const [deletingItem,   setDeletingItem]   = useState<GastoItem | null>(null);
  const [savingItem,     setSavingItem]     = useState(false);
  const [confirmDelItem, setConfirmDelItem] = useState(false);
  const [itemForm, setItemForm] = useState({ nombre: '', monto: '' });

  // ── Adjuntar comprobante ──────────────────────────────────────────────────────
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [attachFile,    setAttachFile]    = useState<File | null>(null);
  const [uploadingDoc,  setUploadingDoc]  = useState(false);
  // per-card quick-attach (outside modal)
  const quickAttachRef = React.useRef<HTMLInputElement>(null);
  const [quickAttachId, setQuickAttachId] = useState<string | null>(null);

  // ── Emisión ───────────────────────────────────────────────────────────────────
  const [emisionMonth,      setEmisionMonth]      = useState(MONTHS[new Date().getMonth()]);
  const [emisionYear,       setEmisionYear]        = useState(new Date().getFullYear().toString());
  const [emisionCondoId,    setEmisionCondoId]    = useState('');
  const [emisionVence,      setEmisionVence]      = useState('');
  const [selectedItemIds,   setSelectedItemIds]   = useState<Set<string>>(new Set());
  const [emisionLoading,    setEmisionLoading]    = useState(false);
  const [emisionSuccess,    setEmisionSuccess]    = useState(false);

  // ── Subscriptions ─────────────────────────────────────────────────────────────
  useEffect(() => {
    return onSnapshot(collection(db, 'condos'), snap =>
      setCondos(snap.docs.map(d => ({ id: d.id, name: d.data().name as string }))));
  }, []);

  useEffect(() => {
    if (!profile || !user) return;
    setLoadingExp(true);
    let q: ReturnType<typeof query>;
    if (isGlobal) {
      q = query(collectionGroup(db, 'expenses'));
    } else if (isResident) {
      q = query(collectionGroup(db, 'expenses'), where('userId', '==', user.uid));
    } else {
      q = query(collection(db, `condos/${profile.condoId}/expenses`), orderBy('date', 'desc'));
    }
    return onSnapshot(q, snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Expense[];
      if (isGlobal || isResident) list.sort((a, b) => (b.date > a.date ? 1 : b.date < a.date ? -1 : 0));
      setExpenses(list);
      setLoadingExp(false);
    }, () => setLoadingExp(false));
  }, [profile?.uid]);

  // gasto_items: for admin, scoped to the effective condo
  const effectiveItemsCondoId = isGlobal
    ? (itemsCondoId || condos[0]?.id || '')
    : (profile?.condoId || '');

  useEffect(() => {
    if (!isAdmin || !effectiveItemsCondoId) { setLoadingItems(false); return; }
    setLoadingItems(true);
    return onSnapshot(
      collection(db, `condos/${effectiveItemsCondoId}/gasto_items`),
      snap => {
        setGastoItems(snap.docs.map(d => ({ id: d.id, ...d.data() })) as GastoItem[]);
        setLoadingItems(false);
      },
      () => setLoadingItems(false),
    );
  }, [effectiveItemsCondoId, isAdmin]);

  // Load residents for the emission target condo
  const emisionEffectiveCondoId = emisionCondoId || profile?.condoId || condos[0]?.id || '';
  useEffect(() => {
    if (!isAdmin || !emisionEffectiveCondoId) return;
    getDocs(query(
      collection(db, 'users'),
      where('condoId', '==', emisionEffectiveCondoId),
      where('role', 'in', ['resident', 'usuario']),
    )).then(snap => setResidents(snap.docs.map(d => ({ id: d.id, ...d.data() }))))
      .catch(() => {});
  }, [emisionEffectiveCondoId, isAdmin]);

  // ── File upload helper ────────────────────────────────────────────────────────
  const uploadComprobante = async (file: File, condoId: string, expenseId: string) => {
    const ext = file.name.split('.').pop()?.toLowerCase() || 'bin';
    const storageRef = ref(storage, `condos/${condoId}/expenses/${expenseId}/comprobante.${ext}`);
    await uploadBytes(storageRef, file);
    return getDownloadURL(storageRef);
  };

  const handleQuickAttach = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !quickAttachId) return;
    const expense = expenses.find(ex => ex.id === quickAttachId);
    if (!expense) return;
    setUploadingDoc(true);
    try {
      const url = await uploadComprobante(file, expense.condoId, expense.id);
      await updateDoc(doc(db, `condos/${expense.condoId}/expenses`, expense.id), {
        documentUrl: url,
        documentName: file.name,
        documentType: file.type,
        updatedAt: Timestamp.now(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'expenses/doc');
    } finally {
      setUploadingDoc(false);
      setQuickAttachId(null);
      if (quickAttachRef.current) quickAttachRef.current.value = '';
    }
  };

  const handleRemoveDocument = async (expense: Expense) => {
    try {
      const ext = expense.documentName?.split('.').pop()?.toLowerCase() || 'bin';
      const storageRef = ref(storage, `condos/${expense.condoId}/expenses/${expense.id}/comprobante.${ext}`);
      await deleteObject(storageRef).catch(() => {});
      await updateDoc(doc(db, `condos/${expense.condoId}/expenses`, expense.id), {
        documentUrl: null,
        documentName: null,
        documentType: null,
        updatedAt: Timestamp.now(),
      });
    } catch (err) {
      handleFirestoreError(err, OperationType.UPDATE, 'expenses/doc');
    }
  };

  // ── Expense handlers ──────────────────────────────────────────────────────────
  const openCreateExp = () => {
    setEditingExp(null);
    setAttachFile(null);
    setExpForm({
      userName: '', unit: '', month: MONTHS[new Date().getMonth()],
      year: new Date().getFullYear().toString(), amount: '', status: 'pending',
      date: new Date().toISOString().split('T')[0],
      condoId: profile?.condoId || '',
    });
    setShowExpModal(true);
  };

  const openEditExp = (e: Expense) => {
    setEditingExp(e);
    setAttachFile(null);
    setExpForm({ userName: e.userName, unit: e.unit, month: e.month, year: e.year,
      amount: e.amount, status: e.status, date: e.date, condoId: e.condoId });
    setShowExpModal(true);
  };

  const handleSaveExp = async (ev: React.FormEvent) => {
    ev.preventDefault();
    setSavingExp(true);
    const condoId = expForm.condoId || profile?.condoId || 'default';
    const path = `condos/${condoId}/expenses`;
    try {
      const data = {
        ...expForm,
        userId: editingExp?.userId || user?.uid || '',
        condoName: condos.find(c => c.id === condoId)?.name || profile?.condoName || '',
        updatedAt: Timestamp.now(),
      };
      let expenseId: string;
      if (editingExp) {
        await updateDoc(doc(db, path, editingExp.id), data);
        expenseId = editingExp.id;
      } else {
        const docRef = await addDoc(collection(db, path), { ...data, createdAt: Timestamp.now() });
        expenseId = docRef.id;
      }
      // Upload comprobante if a file was selected
      if (attachFile) {
        setUploadingDoc(true);
        const url = await uploadComprobante(attachFile, condoId, expenseId);
        await updateDoc(doc(db, path, expenseId), {
          documentUrl: url,
          documentName: attachFile.name,
          documentType: attachFile.type,
        });
        setUploadingDoc(false);
      }
      setAttachFile(null);
      setShowExpModal(false);
    } catch (err) {
      handleFirestoreError(err, editingExp ? OperationType.UPDATE : OperationType.CREATE, path);
      setUploadingDoc(false);
    } finally {
      setSavingExp(false);
    }
  };

  const handleDeleteExp = async () => {
    if (!deletingExp) return;
    setConfirmDelExp(true);
    try {
      await deleteDoc(doc(db, `condos/${deletingExp.condoId}/expenses`, deletingExp.id));
      setDeletingExp(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'expenses');
    } finally {
      setConfirmDelExp(false);
    }
  };

  const updateStatus = async (expense: Expense, status: Expense['status']) => {
    try {
      await updateDoc(doc(db, `condos/${expense.condoId}/expenses`, expense.id), {
        status, updatedAt: Timestamp.now(),
      });
    } catch { /* silent */ }
  };

  // ── GastoItem handlers ────────────────────────────────────────────────────────
  const openCreateItem = () => {
    setEditingItem(null);
    setItemForm({ nombre: '', monto: '' });
    setShowItemModal(true);
  };

  const openEditItem = (item: GastoItem) => {
    setEditingItem(item);
    setItemForm({ nombre: item.nombre, monto: item.monto.toString() });
    setShowItemModal(true);
  };

  const handleSaveItem = async (ev: React.FormEvent) => {
    ev.preventDefault();
    if (!effectiveItemsCondoId) return;
    setSavingItem(true);
    try {
      const data = {
        condoId: effectiveItemsCondoId,
        nombre: itemForm.nombre.trim(),
        monto: parseFloat(itemForm.monto) || 0,
        activo: editingItem?.activo ?? true,
        updatedAt: Timestamp.now(),
      };
      if (editingItem) {
        await updateDoc(doc(db, `condos/${effectiveItemsCondoId}/gasto_items`, editingItem.id), data);
      } else {
        await addDoc(collection(db, `condos/${effectiveItemsCondoId}/gasto_items`), {
          ...data, createdAt: Timestamp.now(),
        });
      }
      setShowItemModal(false);
    } catch (err) {
      handleFirestoreError(err, editingItem ? OperationType.UPDATE : OperationType.CREATE, 'gasto_items');
    } finally {
      setSavingItem(false);
    }
  };

  const handleDeleteItem = async () => {
    if (!deletingItem || !effectiveItemsCondoId) return;
    setConfirmDelItem(true);
    try {
      await deleteDoc(doc(db, `condos/${effectiveItemsCondoId}/gasto_items`, deletingItem.id));
      setDeletingItem(null);
    } catch (err) {
      handleFirestoreError(err, OperationType.DELETE, 'gasto_items');
    } finally {
      setConfirmDelItem(false);
    }
  };

  const toggleActivo = async (item: GastoItem) => {
    if (!effectiveItemsCondoId) return;
    await updateDoc(doc(db, `condos/${effectiveItemsCondoId}/gasto_items`, item.id), {
      activo: !item.activo,
    });
  };

  // ── Emisión handler ───────────────────────────────────────────────────────────
  const handleEmitir = async () => {
    if (!emisionEffectiveCondoId || selectedItemIds.size === 0) return;
    setEmisionLoading(true);
    const condoName = condos.find(c => c.id === emisionEffectiveCondoId)?.name || '';
    const chosenItems = gastoItems.filter(i => selectedItemIds.has(i.id) && i.activo);
    const total = chosenItems.reduce((s, i) => s + i.monto, 0);
    const itemsDetail = chosenItems.map(i => ({ nombre: i.nombre, monto: i.monto }));
    try {
      await Promise.all(residents.map(r =>
        addDoc(collection(db, `condos/${emisionEffectiveCondoId}/expenses`), {
          userId: r.uid || r.id,
          userName: r.name || r.email || '',
          unit: r.unitId || r.unit || '',
          condoId: emisionEffectiveCondoId,
          condoName,
          month: emisionMonth,
          year: emisionYear,
          amount: total.toString(),
          items: itemsDetail,
          status: 'pending',
          date: new Date().toISOString().split('T')[0],
          vencimiento: emisionVence || '',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        })
      ));
      setEmisionSuccess(true);
      setSelectedItemIds(new Set());
      setTimeout(() => setEmisionSuccess(false), 3500);
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'expenses/bulk');
    } finally {
      setEmisionLoading(false);
    }
  };

  // ── Derived stats ─────────────────────────────────────────────────────────────
  const paidTotal    = expenses.filter(e => e.status === 'paid').reduce((s, e) => s + parseAmount(e.amount), 0);
  const overdueTotal = expenses.filter(e => e.status === 'overdue').reduce((s, e) => s + parseAmount(e.amount), 0);
  const pendingTotal = expenses.filter(e => e.status === 'pending').reduce((s, e) => s + parseAmount(e.amount), 0);
  const activeItemsTotal = gastoItems.filter(i => i.activo).reduce((s, i) => s + i.monto, 0);
  const emisionSelectedTotal = gastoItems
    .filter(i => selectedItemIds.has(i.id) && i.activo)
    .reduce((s, i) => s + i.monto, 0);

  // Morosidad grouped by resident
  const morosidadMap = new Map<string, { name: string; unit: string; total: number; count: number }>();
  expenses.filter(e => e.status === 'overdue').forEach(e => {
    const key = e.userId || e.userName;
    const prev = morosidadMap.get(key) ?? { name: e.userName, unit: e.unit, total: 0, count: 0 };
    morosidadMap.set(key, { ...prev, total: prev.total + parseAmount(e.amount), count: prev.count + 1 });
  });
  const morosidadList = Array.from(morosidadMap.values()).sort((a, b) => b.total - a.total);

  if (loadingExp) return (
    <div className="flex items-center justify-center min-h-[400px]"><Spinner size={36} /></div>
  );

  // ── RESIDENT VIEW ─────────────────────────────────────────────────────────────
  if (isResident) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Mis finanzas"
          title="Estado de Cuenta"
          description="Historial de cobros y estado de tus gastos comunes."
          icon={CreditCard}
        />
        <div className="grid grid-cols-3 gap-4">
          <StatCard label="Pendiente"  value={formatCLPCompact(pendingTotal)} icon={Clock}        accent="warn"    />
          <StatCard label="Vencido"    value={formatCLPCompact(overdueTotal)} icon={AlertTriangle} accent="danger"  />
          <StatCard label="Pagado"     value={formatCLPCompact(paidTotal)}    icon={CheckCircle2} accent="success" />
        </div>
        {expenses.length === 0 ? (
          <EmptyState
            icon={CreditCard}
            title="Sin cobros registrados"
            description="Tu administración aún no ha emitido cobros de gastos comunes."
          />
        ) : (
          <div className="space-y-3">
            {expenses.map(expense => {
              const badge = STATUS_BADGE[expense.status];
              return (
                <Card key={expense.id} hoverable className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                    <Receipt size={18} strokeWidth={2.2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white">
                      {expense.month} {expense.year}
                      {expense.unit ? ` · ${expense.unit}` : ''}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{expense.date}</p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-slate-900 dark:text-white">${expense.amount}</p>
                    <Badge variant={badge.variant}>{badge.label}</Badge>
                  </div>
                  <button
                    onClick={() => printReceipt(expense)}
                    className="p-2 rounded-lg text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 transition-colors cursor-pointer shrink-0"
                    aria-label="Imprimir boleta"
                  >
                    <Printer size={16} />
                  </button>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    );
  }

  // ── ADMIN VIEW ────────────────────────────────────────────────────────────────
  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Finanzas"
        title="Gastos Comunes"
        description="Control financiero, cobranza y reportes de tesorería."
        icon={CreditCard}
        actions={
          activeTab === 'resumen' ? <Button icon={Plus} onClick={openCreateExp}>Nueva boleta</Button>
          : activeTab === 'items' ? <Button icon={Plus} onClick={openCreateItem}>Nuevo ítem</Button>
          : null
        }
      />

      {/* Tabs */}
      <div className="flex gap-2 overflow-x-auto pb-1 no-scrollbar">
        <TabBtn active={activeTab === 'resumen'}   onClick={() => setActiveTab('resumen')}   icon={LayoutDashboard}>Resumen</TabBtn>
        <TabBtn active={activeTab === 'items'}     onClick={() => setActiveTab('items')}     icon={Settings}>Ítems de Gasto</TabBtn>
        <TabBtn active={activeTab === 'emision'}   onClick={() => setActiveTab('emision')}   icon={Zap}>Emisión Masiva</TabBtn>
        <TabBtn active={activeTab === 'morosidad'} onClick={() => setActiveTab('morosidad')} icon={BarChart3}>Morosidad</TabBtn>
      </div>

      {/* ── TAB: RESUMEN ─────────────────────────────────────────────────────── */}
      {activeTab === 'resumen' && (
        <div className="space-y-6">
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
            <StatCard label="Recaudado"      value={formatCLPCompact(paidTotal)}    icon={TrendingUp}   accent="success" />
            <StatCard label="Morosidad"      value={formatCLPCompact(overdueTotal)} icon={TrendingDown}  accent="danger"  />
            <StatCard label="Pendiente"      value={formatCLPCompact(pendingTotal)} icon={Clock}         accent="warn"    />
            <StatCard label="Total registros" value={expenses.length}               icon={FileText}      accent="brand"   />
          </div>

          {expenses.length === 0 ? (
            <EmptyState
              icon={CreditCard}
              title="Sin gastos comunes registrados"
              description="Emite la primera boleta para comenzar el control de cobranza."
              action={<Button icon={Plus} onClick={openCreateExp}>Nueva boleta</Button>}
            />
          ) : (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-4">
              <AnimatePresence mode="popLayout">
                {expenses.map(expense => {
                  const badge = STATUS_BADGE[expense.status];
                  return (
                    <motion.div
                      layout key={expense.id}
                      initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, scale: 0.97 }} transition={{ duration: 0.18 }}
                    >
                      <Card hoverable className="flex flex-col gap-4 h-full">
                        <div className="flex items-start justify-between gap-3">
                          <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
                            <FileText size={18} strokeWidth={2.2} />
                          </div>
                          <Badge variant={badge.variant}>{badge.label}</Badge>
                        </div>

                        <div>
                          <p className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight">
                            ${expense.amount}
                          </p>
                          <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1 mt-0.5">
                            <Calendar size={12} />{expense.month} {expense.year}
                          </p>
                          {expense.condoName && (
                            <p className="text-xs text-blue-600 dark:text-blue-400 font-medium mt-0.5">{expense.condoName}</p>
                          )}
                        </div>

                        <div className="flex gap-4 py-3 border-t border-slate-100 dark:border-white/5">
                          <div className="flex-1 min-w-0">
                            <p className="eyebrow mb-0.5">Residente</p>
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{expense.userName || '—'}</p>
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="eyebrow mb-0.5">Unidad</p>
                            <p className="text-sm font-semibold text-slate-700 dark:text-slate-200 truncate">{expense.unit || '—'}</p>
                          </div>
                        </div>

                        {/* Comprobante badge */}
                        {expense.documentUrl && (
                          <div className="flex items-center gap-2 px-1">
                            <a
                              href={expense.documentUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline"
                            >
                              {expense.documentType?.startsWith('image/') ? <FileImage size={13} /> : <FileText size={13} />}
                              Ver comprobante
                              <ExternalLink size={10} />
                            </a>
                          </div>
                        )}

                        <div className="flex gap-2 pt-1 border-t border-slate-100 dark:border-white/5 flex-wrap">
                          {expense.status !== 'paid' && (
                            <Button variant="secondary" size="sm" icon={CheckCircle2} className="flex-1"
                              onClick={() => updateStatus(expense, 'paid')}>
                              Pagado
                            </Button>
                          )}
                          {expense.status === 'pending' && (
                            <Button variant="secondary" size="sm" icon={AlertTriangle}
                              onClick={() => updateStatus(expense, 'overdue')}>
                              Vencer
                            </Button>
                          )}
                          {/* Quick attach button */}
                          <button
                            onClick={() => { setQuickAttachId(expense.id); quickAttachRef.current?.click(); }}
                            className={cn(
                              'p-1.5 rounded-lg transition-colors cursor-pointer',
                              expense.documentUrl
                                ? 'bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 hover:bg-blue-100'
                                : 'bg-slate-100 dark:bg-white/5 text-slate-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400',
                            )}
                            aria-label="Adjuntar comprobante"
                            title={expense.documentUrl ? 'Reemplazar comprobante' : 'Adjuntar comprobante'}
                          >
                            <Paperclip size={14} />
                          </button>
                          <button onClick={() => printReceipt(expense)}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-blue-50 dark:hover:bg-blue-500/10 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                            aria-label="Imprimir">
                            <Printer size={14} />
                          </button>
                          <button onClick={() => openEditExp(expense)}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-blue-50 dark:hover:bg-blue-500/10 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                            aria-label="Editar">
                            <Edit2 size={14} />
                          </button>
                          <button onClick={() => setDeletingExp(expense)}
                            className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-red-50 dark:hover:bg-red-500/10 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
                            aria-label="Eliminar">
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </Card>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
            </div>
          )}
        </div>
      )}

      {/* ── TAB: ÍTEMS ───────────────────────────────────────────────────────── */}
      {activeTab === 'items' && (
        <div className="space-y-5">
          {/* Condo selector for super_admin */}
          {isGlobal && condos.length > 0 && (
            <Field label="Condominio">
              <div className="relative">
                <select
                  value={itemsCondoId}
                  onChange={e => setItemsCondoId(e.target.value)}
                  className={selectClass}
                >
                  {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </Field>
          )}

          <Card>
            <div className="flex items-center justify-between">
              <div>
                <p className="font-semibold text-slate-900 dark:text-white">Total mensual configurado</p>
                <p className="text-xs text-slate-500 dark:text-slate-400">Suma de ítems activos</p>
              </div>
              <p className="text-2xl font-bold text-blue-600 dark:text-blue-400">{formatCLPFull(activeItemsTotal)}</p>
            </div>
          </Card>

          {loadingItems ? (
            <div className="flex justify-center py-12"><Spinner size={32} /></div>
          ) : gastoItems.length === 0 ? (
            <EmptyState
              icon={Settings}
              title="Sin ítems configurados"
              description="Define los componentes del gasto común mensual: administración, fondo de reserva, agua, etc."
              action={<Button icon={Plus} onClick={openCreateItem}>Agregar ítem</Button>}
            />
          ) : (
            <div className="space-y-3">
              {gastoItems.map(item => (
                <Card key={item.id} hoverable className="flex items-center gap-4">
                  <div className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                    item.activo ? 'bg-blue-600/10 text-blue-600 dark:text-blue-400' : 'bg-slate-100 dark:bg-white/5 text-slate-400',
                  )}>
                    <DollarSign size={18} strokeWidth={2.2} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className={cn('font-semibold truncate', item.activo ? 'text-slate-900 dark:text-white' : 'text-slate-400 dark:text-slate-500')}>
                      {item.nombre}
                    </p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">{item.activo ? 'Activo' : 'Inactivo'}</p>
                  </div>
                  <p className={cn('font-bold text-lg shrink-0', item.activo ? 'text-slate-900 dark:text-white' : 'text-slate-400')}>
                    {formatCLPFull(item.monto)}
                  </p>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <button
                      onClick={() => toggleActivo(item)}
                      className={cn(
                        'p-1.5 rounded-lg transition-colors cursor-pointer',
                        item.activo
                          ? 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100'
                          : 'bg-slate-100 dark:bg-white/5 text-slate-400 hover:bg-slate-200',
                      )}
                      aria-label={item.activo ? 'Desactivar' : 'Activar'}
                    >
                      {item.activo ? <ToggleRight size={16} /> : <ToggleLeft size={16} />}
                    </button>
                    <button onClick={() => openEditItem(item)}
                      className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-blue-50 dark:hover:bg-blue-500/10 text-slate-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
                      aria-label="Editar"><Edit2 size={14} /></button>
                    <button onClick={() => setDeletingItem(item)}
                      className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-red-50 dark:hover:bg-red-500/10 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer"
                      aria-label="Eliminar"><Trash2 size={14} /></button>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── TAB: EMISIÓN ─────────────────────────────────────────────────────── */}
      {activeTab === 'emision' && (
        <div className="space-y-5">
          <Card>
            <h3 className="font-semibold text-slate-900 dark:text-white mb-4">Configurar período</h3>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Mes">
                <div className="relative">
                  <select value={emisionMonth} onChange={e => setEmisionMonth(e.target.value)} className={selectClass}>
                    {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                  <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              </Field>
              <Field label="Año">
                <Input value={emisionYear} onChange={e => setEmisionYear(e.target.value)} placeholder="2026" />
              </Field>
            </div>
            {isGlobal && (
              <div className="mt-4">
                <Field label="Condominio">
                  <div className="relative">
                    <select value={emisionCondoId} onChange={e => setEmisionCondoId(e.target.value)} className={selectClass}>
                      <option value="">Seleccionar condominio…</option>
                      {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                    <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                  </div>
                </Field>
              </div>
            )}
            <div className="mt-4">
              <Field label="Fecha de vencimiento (opcional)">
                <Input type="date" value={emisionVence} onChange={e => setEmisionVence(e.target.value)} />
              </Field>
            </div>
          </Card>

          {/* Item selection */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <p className="font-semibold text-slate-900 dark:text-white">Seleccionar ítems a cobrar</p>
              <p className="text-xs text-slate-500 dark:text-slate-400">{gastoItems.filter(i => i.activo).length} activos</p>
            </div>
            {gastoItems.filter(i => i.activo).length === 0 ? (
              <Card className="text-center py-6">
                <p className="text-sm text-slate-500 dark:text-slate-400">
                  Primero configura ítems en la pestaña <strong>Ítems de Gasto</strong>.
                </p>
              </Card>
            ) : (
              <div className="space-y-2">
                {gastoItems.filter(i => i.activo).map(item => (
                  <Card
                    key={item.id}
                    hoverable
                    className={cn(
                      'flex items-center gap-4 cursor-pointer transition-all',
                      selectedItemIds.has(item.id) && 'ring-2 ring-blue-500/40 bg-blue-50/50 dark:bg-blue-500/5',
                    )}
                    onClick={() => setSelectedItemIds(prev => {
                      const next = new Set(prev);
                      next.has(item.id) ? next.delete(item.id) : next.add(item.id);
                      return next;
                    })}
                  >
                    <div className={cn(
                      'w-5 h-5 rounded-md border-2 flex items-center justify-center shrink-0 transition-colors',
                      selectedItemIds.has(item.id) ? 'bg-blue-600 border-blue-600' : 'border-slate-300 dark:border-white/20',
                    )}>
                      {selectedItemIds.has(item.id) && <CheckCircle2 size={12} className="text-white" />}
                    </div>
                    <p className="flex-1 font-medium text-slate-900 dark:text-white">{item.nombre}</p>
                    <p className="font-bold text-slate-900 dark:text-white shrink-0">{formatCLPFull(item.monto)}</p>
                  </Card>
                ))}
              </div>
            )}
          </div>

          {/* Emission summary */}
          {selectedItemIds.size > 0 && (
            <Card className="bg-blue-50 dark:bg-blue-500/5 border-blue-200 dark:border-blue-500/20">
              <div className="flex items-center justify-between mb-4">
                <div>
                  <p className="font-semibold text-blue-900 dark:text-blue-100">Resumen de emisión</p>
                  <p className="text-sm text-blue-700 dark:text-blue-300">
                    {residents.length} residente{residents.length !== 1 ? 's' : ''} · {selectedItemIds.size} ítem{selectedItemIds.size !== 1 ? 's' : ''}
                  </p>
                </div>
                <div className="text-right">
                  <p className="text-2xl font-bold text-blue-700 dark:text-blue-300">{formatCLPFull(emisionSelectedTotal)}</p>
                  <p className="text-xs text-blue-600 dark:text-blue-400">por residente</p>
                </div>
              </div>
              {emisionSuccess ? (
                <div className="flex items-center gap-2 text-emerald-700 dark:text-emerald-400 font-semibold">
                  <CheckCircle2 size={18} /> Cobros emitidos exitosamente
                </div>
              ) : (
                <>
                  <Button fullWidth icon={Zap} loading={emisionLoading} onClick={handleEmitir}
                    disabled={residents.length === 0 || !emisionEffectiveCondoId}>
                    {emisionLoading ? 'Emitiendo…' : `Emitir a ${residents.length} residente${residents.length !== 1 ? 's' : ''}`}
                  </Button>
                  {residents.length === 0 && (
                    <p className="text-xs text-amber-600 dark:text-amber-400 mt-2">
                      No se encontraron residentes registrados para este condominio.
                    </p>
                  )}
                </>
              )}
            </Card>
          )}
        </div>
      )}

      {/* ── TAB: MOROSIDAD ───────────────────────────────────────────────────── */}
      {activeTab === 'morosidad' && (
        <div className="space-y-5">
          <div className="grid grid-cols-2 gap-4">
            <StatCard label="Total moroso"       value={formatCLPCompact(overdueTotal)} icon={TrendingDown} accent="danger" />
            <StatCard label="Residentes morosos" value={morosidadList.length}            icon={Users}        accent="danger" />
          </div>

          {morosidadList.length === 0 ? (
            <EmptyState
              icon={CheckCircle2}
              title="Sin morosidad"
              description="No hay cobros vencidos. ¡Excelente recaudación!"
            />
          ) : (
            <div className="space-y-3">
              {morosidadList.map((m, i) => (
                <Card key={i} hoverable className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0 font-bold text-sm">
                    #{i + 1}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-slate-900 dark:text-white truncate">{m.name || 'Residente'}</p>
                    <p className="text-xs text-slate-500 dark:text-slate-400">
                      {m.unit || 'Sin unidad'} · {m.count} cobro{m.count !== 1 ? 's' : ''} vencido{m.count !== 1 ? 's' : ''}
                    </p>
                  </div>
                  <div className="text-right shrink-0">
                    <p className="font-bold text-red-600 dark:text-red-400 text-lg">{formatCLPCompact(m.total)}</p>
                    <p className="text-xs text-slate-400">deuda total</p>
                  </div>
                </Card>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Hidden file input for quick-attach from card buttons */}
      <input
        ref={quickAttachRef}
        type="file"
        accept="image/*,.pdf"
        className="hidden"
        onChange={handleQuickAttach}
      />
      {uploadingDoc && quickAttachId && (
        <div className="fixed bottom-24 lg:bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 text-sm font-semibold shadow-xl">
          <span className="inline-block w-4 h-4 border-2 border-white/40 dark:border-slate-900/40 border-t-white dark:border-t-slate-900 rounded-full animate-spin" />
          Subiendo comprobante…
        </div>
      )}

      {/* ── MODALS ────────────────────────────────────────────────────────────── */}

      {/* Expense modal */}
      <Modal
        open={showExpModal}
        onClose={() => { setShowExpModal(false); setEditingExp(null); }}
        title={editingExp ? 'Editar boleta' : 'Emitir gasto común'}
        icon={CreditCard}
        size="md"
      >
        <form onSubmit={handleSaveExp} className="space-y-4">
          <div className="grid grid-cols-2 gap-4">
            <Field label="Mes" required>
              <div className="relative">
                <select value={expForm.month} onChange={e => setExpForm(f => ({ ...f, month: e.target.value }))} className={selectClass}>
                  {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </Field>
            <Field label="Año" required>
              <Input required value={expForm.year} onChange={e => setExpForm(f => ({ ...f, year: e.target.value }))} placeholder="2026" />
            </Field>
          </div>
          <Field label="Monto ($)" required>
            <Input required value={expForm.amount} onChange={e => setExpForm(f => ({ ...f, amount: e.target.value }))} placeholder="65.000" className="text-lg font-semibold" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Residente / Nombre" required>
              <Input required value={expForm.userName} onChange={e => setExpForm(f => ({ ...f, userName: e.target.value }))} placeholder="Nombre o email" />
            </Field>
            <Field label="Unidad">
              <Input value={expForm.unit} onChange={e => setExpForm(f => ({ ...f, unit: e.target.value }))} placeholder="Depto 101" />
            </Field>
          </div>
          {isGlobal && (
            <Field label="Condominio">
              <div className="relative">
                <select value={expForm.condoId} onChange={e => setExpForm(f => ({ ...f, condoId: e.target.value }))} className={selectClass}>
                  <option value="">Sin asignar</option>
                  {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
                <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
              </div>
            </Field>
          )}
          <Field label="Estado">
            <div className="relative">
              <select value={expForm.status} onChange={e => setExpForm(f => ({ ...f, status: e.target.value as Expense['status'] }))} className={selectClass}>
                <option value="pending">Pendiente</option>
                <option value="paid">Pagado</option>
                <option value="overdue">Vencido</option>
              </select>
              <ChevronDown size={15} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
            </div>
          </Field>
          {/* Comprobante upload */}
          <div className="space-y-2">
            <p className="block text-xs font-semibold text-slate-600 dark:text-slate-400">
              Comprobante (opcional)
            </p>
            {/* Show existing document when editing */}
            {editingExp?.documentUrl && !attachFile && (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
                {editingExp.documentType?.startsWith('image/') ? (
                  <FileImage size={16} className="text-blue-600 dark:text-blue-400 shrink-0" />
                ) : (
                  <FileText size={16} className="text-red-600 dark:text-red-400 shrink-0" />
                )}
                <p className="flex-1 text-sm text-slate-700 dark:text-slate-300 truncate min-w-0">
                  {editingExp.documentName || 'Comprobante adjunto'}
                </p>
                <a href={editingExp.documentUrl} target="_blank" rel="noopener noreferrer"
                  className="text-blue-600 dark:text-blue-400 hover:underline shrink-0 text-xs font-semibold flex items-center gap-1">
                  <ExternalLink size={12} /> Ver
                </a>
                <button
                  type="button"
                  onClick={() => editingExp && handleRemoveDocument(editingExp)}
                  className="text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors cursor-pointer shrink-0"
                  aria-label="Quitar comprobante"
                >
                  <XIcon size={14} />
                </button>
              </div>
            )}
            {/* New file selected */}
            {attachFile ? (
              <div className="flex items-center gap-3 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20">
                {attachFile.type.startsWith('image/') ? (
                  <FileImage size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                ) : (
                  <FileText size={16} className="text-emerald-600 dark:text-emerald-400 shrink-0" />
                )}
                <p className="flex-1 text-sm text-emerald-800 dark:text-emerald-200 truncate min-w-0">{attachFile.name}</p>
                <button type="button" onClick={() => { setAttachFile(null); if (fileInputRef.current) fileInputRef.current.value = ''; }}
                  className="text-emerald-600 hover:text-red-600 transition-colors cursor-pointer shrink-0" aria-label="Quitar">
                  <XIcon size={14} />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl border-2 border-dashed border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-600 dark:hover:border-blue-500 dark:hover:text-blue-400 transition-colors cursor-pointer text-sm font-medium"
              >
                <Upload size={16} />
                {editingExp?.documentUrl ? 'Reemplazar comprobante' : 'Adjuntar imagen o PDF'}
              </button>
            )}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,.pdf"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) setAttachFile(f); }}
            />
          </div>

          <Button type="submit" fullWidth loading={savingExp || uploadingDoc} icon={CreditCard}>
            {uploadingDoc ? 'Subiendo comprobante…' : savingExp ? 'Guardando…' : editingExp ? 'Guardar cambios' : 'Emitir cobranza'}
          </Button>
        </form>
      </Modal>

      {/* Delete expense modal */}
      <Modal
        open={!!deletingExp}
        onClose={() => setDeletingExp(null)}
        title="¿Eliminar boleta?"
        icon={Trash2}
        size="sm"
      >
        {deletingExp && (
          <div className="space-y-4">
            <div className="p-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5">
              <p className="text-sm font-semibold text-slate-900 dark:text-white">
                ${deletingExp.amount} — {deletingExp.month} {deletingExp.year}
              </p>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">{deletingExp.userName}</p>
            </div>
            <p className="text-xs font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 rounded-lg px-3 py-2">
              Esta acción no se puede deshacer.
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" fullWidth onClick={() => setDeletingExp(null)}>Cancelar</Button>
              <Button variant="danger" fullWidth loading={confirmDelExp} onClick={handleDeleteExp}>
                {confirmDelExp ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </div>
          </div>
        )}
      </Modal>

      {/* GastoItem modal */}
      <Modal
        open={showItemModal}
        onClose={() => { setShowItemModal(false); setEditingItem(null); }}
        title={editingItem ? 'Editar ítem' : 'Nuevo ítem de gasto'}
        icon={Settings}
        size="sm"
      >
        <form onSubmit={handleSaveItem} className="space-y-4">
          <Field label="Nombre del ítem" required>
            <Input
              required
              autoFocus
              value={itemForm.nombre}
              onChange={e => setItemForm(f => ({ ...f, nombre: e.target.value }))}
              placeholder="Ej: Gastos Administración, Fondo Reserva…"
            />
          </Field>
          <Field label="Monto ($)" required>
            <Input
              required
              type="number"
              min="0"
              step="1"
              value={itemForm.monto}
              onChange={e => setItemForm(f => ({ ...f, monto: e.target.value }))}
              placeholder="45000"
              className="text-lg font-semibold"
            />
          </Field>
          <Button type="submit" fullWidth loading={savingItem} icon={Settings}>
            {savingItem ? 'Guardando…' : editingItem ? 'Guardar cambios' : 'Agregar ítem'}
          </Button>
        </form>
      </Modal>

      {/* Delete item modal */}
      <Modal
        open={!!deletingItem}
        onClose={() => setDeletingItem(null)}
        title="¿Eliminar ítem?"
        icon={Trash2}
        size="sm"
      >
        {deletingItem && (
          <div className="space-y-4">
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Se eliminará el ítem{' '}
              <strong className="text-slate-900 dark:text-white">{deletingItem.nombre}</strong>{' '}
              ({formatCLPFull(deletingItem.monto)}).
            </p>
            <div className="grid grid-cols-2 gap-2">
              <Button variant="secondary" fullWidth onClick={() => setDeletingItem(null)}>Cancelar</Button>
              <Button variant="danger" fullWidth loading={confirmDelItem} onClick={handleDeleteItem}>
                {confirmDelItem ? 'Eliminando…' : 'Eliminar'}
              </Button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Expenses;
