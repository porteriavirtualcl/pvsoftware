import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, onSnapshot, addDoc, serverTimestamp, doc, updateDoc } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { QRCodeSVG } from 'qrcode.react';
import { LayoutGrid, QrCode, Unlock, DoorOpen, ShieldAlert } from 'lucide-react';
import { Modal, Badge, Button } from './ui';

// ─────────────────────────────────────────────────────────────────────────────
// Estado de lockers/buzones por equipo — operator / condo_admin / super_admin.
// Muestra TODOS los recursos del equipo con su disponibilidad actual:
//   ocupado (rojo) · disponible (verde)
// Permite ver/reenviar el QR (valor = parcel.id) y ABRIR manualmente cada
// locker/buzón (envía un comando al kiosco, que abre con su pin local).
// ─────────────────────────────────────────────────────────────────────────────

interface LockerDef { id: string; tamano?: string; operativo?: boolean; }
interface Kiosk {
  id: string; nombre?: string; condoId?: string; condoName?: string;
  lockers?: LockerDef[]; buzon?: { id: string; tamano?: string } | null;
}
interface Parcel {
  id: string; lockerId?: string; residentName?: string; courier?: string;
  status?: 'pending' | 'picked_up'; arrivedAt?: any; unit?: string;
}

function formatTime(ts: any) {
  if (!ts) return '—';
  try {
    const d = ts.toDate ? ts.toDate() : new Date(ts);
    return d.toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch { return '—'; }
}

interface Props {
  open: boolean;
  onClose: () => void;
  condos: { id: string; name: string }[];
}

export default function LockerStatusModal({ open, onClose, condos }: Props) {
  const { user, profile } = useAuth();
  const [kiosks, setKiosks] = useState<Kiosk[]>([]);
  const [selId, setSelId] = useState('');
  const [parcels, setParcels] = useState<Parcel[]>([]);
  const [qr, setQr] = useState<Parcel | null>(null);
  const [opening, setOpening] = useState('');
  const [bulk, setBulk] = useState('');
  const [savingOp, setSavingOp] = useState('');

  // Abrir "todas las puertas" y marcar Operativo/FS son override total del
  // equipo: solo super administrador. Abrir la puerta de la SALA en cambio la
  // usa la operación día a día, así que la pueden hacer los operadores (la regla
  // de kiosks/{id}/commands ya permite crear comandos a operator/condo_admin/
  // technician/super_admin).
  const isSuperAdmin = profile?.role === 'super_admin' || profile?.condoScope === 'all';
  const puedeAbrirEquipo = isSuperAdmin
    || ['operator', 'condo_admin', 'administrador', 'technician'].includes(profile?.role || '');

  const condoIds = new Set(condos.map(c => c.id));

  useEffect(() => {
    if (!open) return;
    const unsub = onSnapshot(collection(db, 'kiosks'), snap => {
      const list = snap.docs
        .map(d => ({ id: d.id, ...(d.data() as Omit<Kiosk, 'id'>) }))
        .filter(k => !k.condoId || condoIds.has(k.condoId));
      setKiosks(list);
      setSelId(prev => prev || list[0]?.id || '');
    });
    return () => unsub();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const sel = kiosks.find(k => k.id === selId);

  useEffect(() => {
    if (!open || !sel?.condoId) { setParcels([]); return; }
    const unsub = onSnapshot(collection(db, `condos/${sel.condoId}/parcels`), snap => {
      setParcels(snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Parcel, 'id'>) })));
    });
    return () => unsub();
  }, [open, sel?.condoId]);

  const recursos: { id: string; tipo: 'locker' | 'buzon' }[] = [
    ...(sel?.lockers || []).map(l => ({ id: l.id, tipo: 'locker' as const })),
    ...(sel?.buzon ? [{ id: sel.buzon.id, tipo: 'buzon' as const }] : []),
  ];

  // Encomienda pendiente (ocupa el casillero) por locker.
  const pendientePorLocker = (lockerId: string): Parcel | undefined =>
    parcels.find(p => p.lockerId === lockerId && p.status === 'pending');

  // Enviar comando de apertura al kiosco.
  const abrir = async (lockerId: string, operacion: 'deposito' | 'retiro') => {
    if (!user || !selId) return;
    setOpening(`${lockerId}:${operacion}`);
    try {
      await addDoc(collection(db, `kiosks/${selId}/commands`), {
        accion: 'abrir', lockerId, operacion, estado: 'pendiente',
        createdBy: user.uid, createdByName: profile?.name || user.email || 'Operador',
        createdAt: serverTimestamp(),
      });
    } finally {
      setTimeout(() => setOpening(''), 800);
    }
  };

  // Encola un comando "de equipo" (sin locker puntual): abrir todas las puertas
  // o liberar la puerta de la sala. El kiosco lo ejecuta con sus pines locales.
  const comandoEquipo = async (accion: 'abrir_todas' | 'abrir_sala') => {
    if (!user || !selId) return;
    setBulk(accion);
    try {
      await addDoc(collection(db, `kiosks/${selId}/commands`), {
        accion, estado: 'pendiente',
        createdBy: user.uid, createdByName: profile?.name || user.email || 'Super administrador',
        createdAt: serverTimestamp(),
      });
    } finally {
      setTimeout(() => setBulk(''), 1200);
    }
  };

  const abrirTodas = () => {
    const nombre = sel?.nombre || sel?.id || 'este equipo';
    if (window.confirm(
      `¿Abrir TODAS las puertas de ${nombre}?\n\nSe liberarán todas las cerraduras (depósito y retiro) de todos los casilleros. Úsalo solo como override manual.`
    )) comandoEquipo('abrir_todas');
  };

  const abrirSala = () => comandoEquipo('abrir_sala');

  // Marca un locker operativo / fuera de servicio. Reescribe el arreglo
  // completo de lockers del equipo (Firestore no permite editar un elemento
  // suelto). Solo super_admin: la regla de kiosks/{id} exige isSuperAdmin.
  const toggleOperativo = async (lockerId: string, operativo: boolean) => {
    if (!sel || !isSuperAdmin) return;
    setSavingOp(lockerId);
    try {
      const nuevos = (sel.lockers || []).map(l =>
        l.id === lockerId ? { ...l, operativo } : l);
      await updateDoc(doc(db, 'kiosks', sel.id), { lockers: nuevos });
    } finally {
      setSavingOp('');
    }
  };

  // Un locker es operativo salvo que esté explícitamente en false.
  const esOperativo = (lockerId: string): boolean =>
    (sel?.lockers || []).find(l => l.id === lockerId)?.operativo !== false;

  return (
    <>
      <Modal
        open={open}
        onClose={onClose}
        title="Estado de Lockers / Buzón"
        description="Disponibilidad en tiempo real y apertura manual de cada casillero"
        icon={LayoutGrid}
        size="lg"
      >
        <div className="space-y-4 pt-1">
          {kiosks.length === 0 && (
            <p className="text-sm text-slate-400 dark:text-slate-500 text-center py-4">
              No hay equipos configurados para tus condominios.
            </p>
          )}

          {kiosks.length > 1 && (
            <div className="flex gap-2 flex-wrap">
              {kiosks.map(k => (
                <button key={k.id} onClick={() => setSelId(k.id)}
                  className={'px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ' +
                    (selId === k.id ? 'bg-blue-600 text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400')}>
                  {k.nombre || k.id}
                </button>
              ))}
            </div>
          )}

          {sel && puedeAbrirEquipo && (
            <div className="rounded-xl border border-amber-300/60 dark:border-amber-500/25 bg-amber-50/70 dark:bg-amber-500/[0.06] p-3">
              <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400 mb-2">
                <ShieldAlert size={14} /> Apertura manual del equipo
              </div>
              <div className="flex gap-2 flex-wrap">
                <Button size="sm" variant="secondary" icon={DoorOpen}
                  loading={bulk === 'abrir_sala'}
                  onClick={abrirSala}>
                  Abrir puerta de sala
                </Button>
                {isSuperAdmin && (
                  <Button size="sm" variant="danger" icon={Unlock}
                    loading={bulk === 'abrir_todas'}
                    onClick={abrirTodas}>
                    Abrir todas las puertas
                  </Button>
                )}
              </div>
              <p className="text-[11px] text-amber-600/80 dark:text-amber-400/70 mt-2">
                Envía la orden al kiosco, que acciona sus cerraduras localmente. La puerta de sala queda liberada unos segundos según su pulso configurado.
              </p>
            </div>
          )}

          {sel && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs font-semibold text-slate-400 dark:text-slate-500 border-b border-slate-200 dark:border-white/5">
                    <th className="py-2 pr-3">Casillero</th>
                    <th className="py-2 pr-3">Encomienda</th>
                    <th className="py-2 pr-3">Llegada</th>
                    <th className="py-2 pr-3">Estado</th>
                    <th className="py-2 pr-3">Servicio</th>
                    <th className="py-2 pr-3">QR</th>
                    <th className="py-2">Abrir</th>
                  </tr>
                </thead>
                <tbody>
                  {recursos.map(r => {
                    const p = pendientePorLocker(r.id);
                    const ocupado = !!p;
                    const esLocker = r.tipo === 'locker';
                    const operativo = !esLocker || esOperativo(r.id);
                    return (
                      <tr key={r.id} className="border-b border-slate-100 dark:border-white/[0.03]">
                        <td className="py-2.5 pr-3 font-semibold text-slate-800 dark:text-slate-200 whitespace-nowrap">
                          {r.id} <span className="text-xs font-normal text-slate-400">({r.tipo})</span>
                        </td>
                        <td className="py-2.5 pr-3 text-slate-600 dark:text-slate-300">
                          {ocupado ? (
                            <span>
                              {p?.residentName || 'Sin destinatario'}
                              {p?.courier ? <span className="text-xs text-slate-400"> · {p.courier}</span> : null}
                            </span>
                          ) : '—'}
                        </td>
                        <td className="py-2.5 pr-3 text-slate-500 dark:text-slate-400 whitespace-nowrap">
                          {ocupado ? formatTime(p?.arrivedAt) : '—'}
                        </td>
                        <td className="py-2.5 pr-3">
                          {!operativo
                            ? <Badge variant="warn">Fuera de servicio</Badge>
                            : ocupado
                              ? <Badge variant="danger">Ocupado</Badge>
                              : <Badge variant="success">Disponible</Badge>}
                        </td>
                        <td className="py-2.5 pr-3">
                          {esLocker ? (
                            isSuperAdmin ? (
                              <label className="inline-flex items-center gap-1.5 cursor-pointer text-xs text-slate-500 dark:text-slate-400 select-none">
                                <input type="checkbox" checked={operativo}
                                  disabled={savingOp === r.id}
                                  onChange={e => toggleOperativo(r.id, e.target.checked)}
                                  className="w-4 h-4 rounded accent-emerald-600 cursor-pointer" />
                                {operativo ? 'Operativo' : 'FS'}
                              </label>
                            ) : (
                              <span className="text-xs text-slate-400">{operativo ? 'Operativo' : 'FS'}</span>
                            )
                          ) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                        </td>
                        <td className="py-2.5 pr-3">
                          {ocupado && p ? (
                            <button onClick={() => setQr(p)} title="Ver QR de retiro"
                              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-500/10 cursor-pointer">
                              <QrCode size={16} />
                            </button>
                          ) : <span className="text-slate-300 dark:text-slate-600">—</span>}
                        </td>
                        <td className="py-2.5">
                          <div className="flex gap-1.5">
                            <Button size="sm" variant="secondary" icon={Unlock}
                              loading={opening === `${r.id}:deposito`}
                              onClick={() => abrir(r.id, 'deposito')}>
                              Dep.
                            </Button>
                            <Button size="sm" icon={Unlock}
                              loading={opening === `${r.id}:retiro`}
                              onClick={() => abrir(r.id, 'retiro')}>
                              Ret.
                            </Button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {recursos.length === 0 && (
                    <tr><td colSpan={7} className="py-4 text-center text-slate-400 dark:text-slate-500">
                      Este equipo no tiene recursos definidos.
                    </td></tr>
                  )}
                </tbody>
              </table>
            </div>
          )}

          {/* Leyenda */}
          <div className="flex gap-3 flex-wrap pt-1">
            <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"><span className="w-2.5 h-2.5 rounded-full bg-red-500" />Ocupado</span>
            <span className="flex items-center gap-1.5 text-xs text-slate-500 dark:text-slate-400"><span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />Disponible</span>
          </div>
        </div>
      </Modal>

      {/* QR para reenviar manualmente al residente */}
      <Modal open={!!qr} onClose={() => setQr(null)} title="Código QR de retiro" icon={QrCode} size="sm">
        {qr && (
          <div className="flex flex-col items-center gap-3 pt-1">
            <div className="bg-white p-3 rounded-xl">
              <QRCodeSVG value={qr.id} size={200} includeMargin />
            </div>
            <p className="text-sm text-center text-slate-600 dark:text-slate-300">
              {qr.residentName || 'Residente'}{qr.unit ? ` — Unidad ${qr.unit}` : ''}
            </p>
            <p className="text-xs text-center text-slate-400 dark:text-slate-500">
              Comparte este QR con el residente para el retiro en {qr.lockerId}.
            </p>
          </div>
        )}
      </Modal>
    </>
  );
}
