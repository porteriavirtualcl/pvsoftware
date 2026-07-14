import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import {
  collection, onSnapshot, doc, setDoc, deleteDoc, serverTimestamp,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { Plus, Trash2, Pencil, X, Package } from 'lucide-react';
import { Button, Field, Input, Modal, Badge } from './ui';
import { cn } from '../lib/utils';

// ─────────────────────────────────────────────────────────────────────────────
// Configuración de dispositivos (lockers/buzones) — solo super_admin.
// Administra la colección Firestore `kiosks/{kioskId}` (config LÓGICA).
// Los pines GPIO y el hardware quedan en el config.json local de cada equipo.
// Ver: PVLocker/docs/kiosks-backend-model.md
// ─────────────────────────────────────────────────────────────────────────────

type Tamano = 'chica' | 'mediana' | 'grande';

interface LockerDef {
  id: string;
  tamano: Tamano;
}

interface Kiosk {
  id?: string;                 // doc id (= kioskId)
  kioskId: string;
  nombre: string;
  condoId: string;
  condoName: string;
  activo: boolean;
  tipo: 'locker' | 'buzon' | 'mixto';
  operacionPuertas: 'unidireccional' | 'bidireccional';
  tipoUnidad: 'departamento' | 'casa';
  orientacion: 'vertical' | 'horizontal';
  retiroAutomatico: boolean;
  lockers: LockerDef[];
  buzon: { id: string; tamano: Tamano } | null;
}

function nuevoKiosk(): Kiosk {
  return {
    kioskId: '', nombre: '', condoId: '', condoName: '', activo: true,
    tipo: 'mixto', operacionPuertas: 'bidireccional', tipoUnidad: 'departamento',
    orientacion: 'vertical', retiroAutomatico: false,
    lockers: [], buzon: null,
  };
}

const selectCls = cn(
  'block w-full bg-white dark:bg-slate-950/50',
  'border border-slate-200 dark:border-white/10 rounded-xl',
  'px-3.5 py-2.5 text-[15px] text-slate-900 dark:text-slate-100',
  'outline-none transition focus:border-blue-600 dark:focus:border-blue-500',
  'focus:ring-2 focus:ring-blue-500/20 cursor-pointer',
);

interface Props {
  open: boolean;
  onClose: () => void;
  condos: { id: string; name: string }[];
}

export default function KioskConfigModal({ open, onClose, condos }: Props) {
  const { user } = useAuth();
  const [kiosks, setKiosks] = useState<Kiosk[]>([]);
  const [editing, setEditing] = useState<Kiosk | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<Kiosk | null>(null);
  const [error, setError] = useState('');

  // Cargar dispositivos mientras el modal está abierto.
  useEffect(() => {
    if (!open) return;
    const unsub = onSnapshot(collection(db, 'kiosks'), snap => {
      setKiosks(snap.docs.map(d => ({ id: d.id, ...(d.data() as Kiosk) })));
    });
    return () => unsub();
  }, [open]);

  const cerrar = () => { setEditing(null); setError(''); onClose(); };

  const abrirNuevo = () => { setError(''); setIsNew(true); setEditing(nuevoKiosk()); };
  const abrirEditar = (k: Kiosk) => { setError(''); setIsNew(false); setEditing({ ...k }); };

  const upd = (patch: Partial<Kiosk>) => setEditing(e => e ? { ...e, ...patch } : e);

  // --- Editor de lockers ---
  const agregarLocker = () => {
    if (!editing) return;
    const n = editing.lockers.length + 1;
    upd({ lockers: [...editing.lockers, { id: `L${n}`, tamano: 'mediana' }] });
  };
  const quitarLocker = (idx: number) =>
    editing && upd({ lockers: editing.lockers.filter((_, i) => i !== idx) });
  const editarLocker = (idx: number, patch: Partial<LockerDef>) =>
    editing && upd({ lockers: editing.lockers.map((l, i) => i === idx ? { ...l, ...patch } : l) });

  const guardar = async () => {
    if (!editing) return;
    const id = editing.kioskId.trim();
    if (!id) { setError('El identificador del equipo (kioskId) es obligatorio.'); return; }
    if (!editing.condoId) { setError('Selecciona el condominio.'); return; }
    if (isNew && kiosks.some(k => k.id === id)) {
      setError(`Ya existe un equipo con id "${id}".`); return;
    }
    setSaving(true);
    setError('');
    try {
      const condo = condos.find(c => c.id === editing.condoId);
      const data = {
        kioskId: id,
        nombre: editing.nombre.trim() || id,
        condoId: editing.condoId,
        condoName: condo?.name || editing.condoName || '',
        activo: editing.activo,
        tipo: editing.tipo,
        operacionPuertas: editing.operacionPuertas,
        tipoUnidad: editing.tipoUnidad,
        orientacion: editing.orientacion,
        retiroAutomatico: editing.retiroAutomatico,
        lockers: editing.tipo === 'buzon' ? [] : editing.lockers,
        buzon: editing.tipo === 'locker' ? null : editing.buzon,
        updatedAt: serverTimestamp(),
        updatedBy: user?.uid || '',
      };
      await setDoc(doc(db, 'kiosks', id), data, { merge: true });
      setEditing(null);
    } catch (e: any) {
      setError(e?.message || 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const confirmarEliminar = async () => {
    if (!deleting?.id) return;
    try {
      await deleteDoc(doc(db, 'kiosks', deleting.id));
      setDeleting(null);
    } catch (e: any) {
      setError(e?.message || 'No se pudo eliminar.');
    }
  };

  return (
    <>
      <Modal
        open={open}
        onClose={cerrar}
        title="Configuración de Lockers / Buzones"
        description="Administra los equipos (kioscos) y su configuración lógica"
        icon={Package}
        size="lg"
      >
        {/* ── Vista LISTA ── */}
        {!editing && (
          <div className="space-y-3 pt-1">
            {kiosks.length === 0 && (
              <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">
                Sin equipos registrados
              </p>
            )}
            {kiosks.map(k => (
              <div
                key={k.id}
                className="flex items-center justify-between gap-3 px-3.5 py-3 rounded-xl bg-slate-50 dark:bg-white/[0.03] border border-slate-200 dark:border-white/5"
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-semibold text-slate-800 dark:text-slate-200 truncate">{k.nombre || k.kioskId}</span>
                    <Badge variant={k.activo ? 'success' : 'muted'}>{k.activo ? 'Activo' : 'Inactivo'}</Badge>
                  </div>
                  <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                    {k.condoName || k.condoId} · {k.tipo} · {k.operacionPuertas}
                  </p>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <button
                    onClick={() => abrirEditar(k)}
                    title="Editar"
                    className="p-2 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-500/10 transition-colors cursor-pointer"
                  >
                    <Pencil size={15} />
                  </button>
                  <button
                    onClick={() => setDeleting(k)}
                    title="Eliminar"
                    className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-500/10 transition-colors cursor-pointer"
                  >
                    <Trash2 size={15} />
                  </button>
                </div>
              </div>
            ))}

            <Button icon={Plus} onClick={abrirNuevo} fullWidth variant="secondary">
              Nuevo equipo
            </Button>
          </div>
        )}

        {/* ── Vista FORM ── */}
        {editing && (
          <div className="space-y-4 pt-1">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="ID del equipo (kioskId)" htmlFor="k-id" required>
                <Input
                  id="k-id"
                  value={editing.kioskId}
                  disabled={!isNew}
                  onChange={e => upd({ kioskId: e.target.value })}
                  placeholder="ej. kiosk-losaromos-01"
                />
              </Field>
              <Field label="Nombre / ubicación" htmlFor="k-nombre">
                <Input
                  id="k-nombre"
                  value={editing.nombre}
                  onChange={e => upd({ nombre: e.target.value })}
                  placeholder="ej. Lockers Torre A"
                />
              </Field>
            </div>

            <Field label="Condominio" htmlFor="k-condo" required>
              <select
                id="k-condo"
                value={editing.condoId}
                onChange={e => upd({ condoId: e.target.value })}
                className={selectCls}
              >
                <option value="">— Seleccionar condominio —</option>
                {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Tipo de sistema" htmlFor="k-tipo">
                <select id="k-tipo" value={editing.tipo}
                  onChange={e => upd({ tipo: e.target.value as Kiosk['tipo'] })} className={selectCls}>
                  <option value="mixto">Mixto (lockers + buzón)</option>
                  <option value="locker">Solo lockers</option>
                  <option value="buzon">Solo buzón</option>
                </select>
              </Field>
              <Field label="Operación de puertas" htmlFor="k-op">
                <select id="k-op" value={editing.operacionPuertas}
                  onChange={e => upd({ operacionPuertas: e.target.value as Kiosk['operacionPuertas'] })} className={selectCls}>
                  <option value="bidireccional">Bidireccional (2 puertas)</option>
                  <option value="unidireccional">Unidireccional (1 puerta)</option>
                </select>
              </Field>
              <Field label="Tipo de unidad" htmlFor="k-unidad">
                <select id="k-unidad" value={editing.tipoUnidad}
                  onChange={e => upd({ tipoUnidad: e.target.value as Kiosk['tipoUnidad'] })} className={selectCls}>
                  <option value="departamento">Departamento (N° Depto)</option>
                  <option value="casa">Casa (N° Casa)</option>
                </select>
              </Field>
              <Field label="Orientación pantalla" htmlFor="k-orient">
                <select id="k-orient" value={editing.orientacion}
                  onChange={e => upd({ orientacion: e.target.value as Kiosk['orientacion'] })} className={selectCls}>
                  <option value="vertical">Vertical</option>
                  <option value="horizontal">Horizontal</option>
                </select>
              </Field>
            </div>

            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                <input type="checkbox" checked={editing.activo}
                  onChange={e => upd({ activo: e.target.checked })} className="w-4 h-4 cursor-pointer" />
                Equipo activo
              </label>
              <label className="flex items-center gap-2 text-sm text-slate-700 dark:text-slate-300 cursor-pointer">
                <input type="checkbox" checked={editing.retiroAutomatico}
                  onChange={e => upd({ retiroAutomatico: e.target.checked })} className="w-4 h-4 cursor-pointer" />
                Retiro automático (lector dedicado)
              </label>
            </div>

            {/* Lockers */}
            {editing.tipo !== 'buzon' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-sm font-semibold text-slate-700 dark:text-slate-300">Lockers</span>
                  <Button size="sm" variant="secondary" icon={Plus} onClick={agregarLocker}>Agregar</Button>
                </div>
                {editing.lockers.length === 0 && (
                  <p className="text-xs text-slate-400 dark:text-slate-500">Sin lockers definidos.</p>
                )}
                {editing.lockers.map((l, i) => (
                  <div key={i} className="flex items-center gap-2">
                    <Input value={l.id} onChange={e => editarLocker(i, { id: e.target.value })}
                      placeholder="ID (ej. L1)" className="flex-1" />
                    <select value={l.tamano} onChange={e => editarLocker(i, { tamano: e.target.value as Tamano })}
                      className={cn(selectCls, 'w-40')}>
                      <option value="chica">Chica</option>
                      <option value="mediana">Mediana</option>
                      <option value="grande">Grande</option>
                    </select>
                    <button onClick={() => quitarLocker(i)} title="Quitar"
                      className="p-2 rounded-lg text-slate-400 hover:text-red-600 hover:bg-red-500/10 cursor-pointer">
                      <X size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {/* Buzón */}
            {editing.tipo !== 'locker' && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700 dark:text-slate-300 cursor-pointer">
                  <input type="checkbox" checked={!!editing.buzon}
                    onChange={e => upd({ buzon: e.target.checked ? { id: 'B1', tamano: 'chica' } : null })}
                    className="w-4 h-4 cursor-pointer" />
                  Incluye buzón
                </label>
                {editing.buzon && (
                  <div className="flex items-center gap-2">
                    <Input value={editing.buzon.id}
                      onChange={e => upd({ buzon: { ...editing.buzon!, id: e.target.value } })}
                      placeholder="ID (ej. B1)" className="flex-1" />
                    <select value={editing.buzon.tamano}
                      onChange={e => upd({ buzon: { ...editing.buzon!, tamano: e.target.value as Tamano } })}
                      className={cn(selectCls, 'w-40')}>
                      <option value="chica">Chica</option>
                      <option value="mediana">Mediana</option>
                      <option value="grande">Grande</option>
                    </select>
                  </div>
                )}
              </div>
            )}

            {error && <p className="text-sm text-red-600 dark:text-red-400">{error}</p>}

            <div className="grid grid-cols-2 gap-2 pt-1">
              <Button variant="secondary" onClick={() => setEditing(null)} disabled={saving}>Cancelar</Button>
              <Button onClick={guardar} loading={saving}>Guardar</Button>
            </div>
          </div>
        )}
      </Modal>

      {/* Confirmar eliminación */}
      <Modal open={!!deleting} onClose={() => setDeleting(null)} size="sm">
        <div className="text-center space-y-4 pt-2">
          <div className="w-14 h-14 rounded-2xl bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center mx-auto">
            <Trash2 size={24} />
          </div>
          <div>
            <h2 className="text-slate-900 dark:text-white">¿Eliminar equipo?</h2>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              Se eliminará la configuración de{' '}
              <span className="font-semibold text-slate-900 dark:text-white">{deleting?.nombre || deleting?.kioskId}</span>.
              Esta acción no se puede deshacer.
            </p>
          </div>
          <div className="grid grid-cols-2 gap-2 pt-2">
            <Button variant="secondary" onClick={() => setDeleting(null)}>Cancelar</Button>
            <Button variant="danger" icon={Trash2} onClick={confirmarEliminar}>Eliminar</Button>
          </div>
        </div>
      </Modal>
    </>
  );
}
