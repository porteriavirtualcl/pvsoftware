import React, { useState, useEffect } from 'react';
import { db } from '../../firebase';
import {
  collection, doc, onSnapshot, setDoc, Timestamp, getDocs,
  addDoc,
} from 'firebase/firestore';
import { Droplets, Save, Zap, ChevronDown, RefreshCw } from 'lucide-react';
import { handleFirestoreError, OperationType, cn } from '../../lib/utils';
import { Button, Card, Field, Input, Modal, StatCard, EmptyState, Spinner } from '../../components/ui';

// ── Types ─────────────────────────────────────────────────────────────────────
interface Alicuota {
  unidad: string;
  coeficiente: number; // 0–1, sum must be 1
  residenteNombre?: string;
  residenteId?: string;
}

interface Props {
  condoId: string;
  condoName: string;
  condos: { id: string; name: string }[];
  isGlobal: boolean;
}

const formatCLP = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

// ── Component ─────────────────────────────────────────────────────────────────
export default function AguaCalienteTab({ condoId, condoName, condos, isGlobal }: Props) {
  const [alicuotas,    setAlicuotas]    = useState<Alicuota[]>([]);
  const [loading,      setLoading]      = useState(true);
  const [savingAliq,   setSavingAliq]   = useState(false);
  const [totalFactura, setTotalFactura] = useState('');
  const [esComun,      setEsComun]      = useState(false);
  const [resultado,    setResultado]    = useState<{ unidad: string; monto: number }[]>([]);
  const [emitiendo,    setEmitiendo]    = useState(false);
  const [emitido,      setEmitido]      = useState(false);
  const [periodo,      setPeriodo]      = useState('');
  const [showAddUnit,  setShowAddUnit]  = useState(false);
  const [newUnidad,    setNewUnidad]    = useState('');
  const [newNombre,    setNewNombre]    = useState('');
  const [newCoef,      setNewCoef]      = useState('');

  const targetCondoId = condoId || condos[0]?.id || '';

  // ── Load alícuotas ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!targetCondoId) { setLoading(false); return; }
    setLoading(true);
    return onSnapshot(
      collection(db, `condos/${targetCondoId}/alicuotas_agua`),
      snap => {
        const list = snap.docs.map(d => ({ ...(d.data() as Alicuota) }));
        list.sort((a, b) => a.unidad.localeCompare(b.unidad, 'es', { numeric: true }));
        setAlicuotas(list);
        setLoading(false);
      },
      () => setLoading(false),
    );
  }, [targetCondoId]);

  // ── Helpers ─────────────────────────────────────────────────────────────────
  const sumaCoeficientes = alicuotas.reduce((s, a) => s + a.coeficiente, 0);
  const sumaOk = Math.abs(sumaCoeficientes - 1) < 0.001;

  const calcular = () => {
    const total = parseFloat(totalFactura.replace(/\./g, '').replace(',', '.')) || 0;
    if (total <= 0) return;
    if (esComun) {
      // Distribución igualitaria
      const n = alicuotas.length;
      setResultado(alicuotas.map(a => ({ unidad: a.unidad, monto: total / n })));
    } else {
      setResultado(alicuotas.map(a => ({ unidad: a.unidad, monto: total * a.coeficiente })));
    }
    setEmitido(false);
  };

  const emitirCobros = async () => {
    if (!targetCondoId || resultado.length === 0) return;
    setEmitiendo(true);
    const cName = condos.find(c => c.id === targetCondoId)?.name || condoName;
    const mes = periodo || new Date().toISOString().slice(0, 7);
    const [year, monthIdx] = mes.split('-');
    const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
    const month = MONTHS[parseInt(monthIdx) - 1] || '';
    try {
      await Promise.all(resultado.map(r => {
        const aliq = alicuotas.find(a => a.unidad === r.unidad);
        return addDoc(collection(db, `condos/${targetCondoId}/expenses`), {
          userId: aliq?.residenteId || '',
          userName: aliq?.residenteNombre || r.unidad,
          unit: r.unidad,
          condoId: targetCondoId,
          condoName: cName,
          month,
          year,
          amount: Math.round(r.monto).toString(),
          items: [{ nombre: 'Agua Caliente', monto: Math.round(r.monto) }],
          status: 'pending',
          date: new Date().toISOString().split('T')[0],
          tipo: 'agua_caliente',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        });
      }));
      setEmitido(true);
      setResultado([]);
      setTotalFactura('');
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'expenses/agua');
    } finally {
      setEmitiendo(false);
    }
  };

  const handleAddUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetCondoId || !newUnidad) return;
    const coef = parseFloat(newCoef) || 0;
    await setDoc(doc(db, `condos/${targetCondoId}/alicuotas_agua`, newUnidad), {
      unidad: newUnidad,
      coeficiente: coef,
      residenteNombre: newNombre,
      residenteId: '',
      updatedAt: Timestamp.now(),
    });
    setNewUnidad(''); setNewNombre(''); setNewCoef('');
    setShowAddUnit(false);
  };

  const updateCoef = async (unidad: string, val: number) => {
    if (!targetCondoId) return;
    await setDoc(doc(db, `condos/${targetCondoId}/alicuotas_agua`, unidad),
      { coeficiente: val, updatedAt: Timestamp.now() }, { merge: true });
  };

  const distribuirIgual = async () => {
    if (!targetCondoId || alicuotas.length === 0) return;
    const coef = Math.round((1 / alicuotas.length) * 10000) / 10000;
    await Promise.all(alicuotas.map(a =>
      setDoc(doc(db, `condos/${targetCondoId}/alicuotas_agua`, a.unidad),
        { coeficiente: coef, updatedAt: Timestamp.now() }, { merge: true })
    ));
  };

  const MONTHS_LIST = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];

  if (loading) return <div className="flex justify-center py-12"><Spinner size={32} /></div>;

  return (
    <div className="space-y-5">
      {/* Alícuotas table */}
      <Card>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="font-semibold text-slate-900 dark:text-white">Tabla de alícuotas</p>
            <p className={cn('text-xs mt-0.5', sumaOk ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400')}>
              Suma de coeficientes: {sumaCoeficientes.toFixed(4)} {sumaOk ? '✓' : '(debe ser 1.000)'}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              onClick={distribuirIgual}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-blue-50 dark:hover:bg-blue-500/10 hover:text-blue-600 dark:hover:text-blue-400 transition-colors cursor-pointer"
              title="Distribuir equitativamente"
            >
              <RefreshCw size={12} /> Distribuir igual
            </button>
            <button
              onClick={() => setShowAddUnit(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-600 text-white hover:bg-blue-700 transition-colors cursor-pointer"
            >
              + Unidad
            </button>
          </div>
        </div>

        {alicuotas.length === 0 ? (
          <EmptyState
            icon={Droplets}
            title="Sin unidades configuradas"
            description="Agrega las unidades del condominio con sus coeficientes de agua caliente."
          />
        ) : (
          <div className="space-y-2">
            {alicuotas.map(a => (
              <div key={a.unidad} className="flex items-center gap-3 py-2 border-b border-slate-100 dark:border-white/5 last:border-0">
                <div className="w-24 shrink-0">
                  <p className="text-sm font-semibold text-slate-900 dark:text-white">{a.unidad}</p>
                  {a.residenteNombre && <p className="text-xs text-slate-400 truncate">{a.residenteNombre}</p>}
                </div>
                <div className="flex-1">
                  <input
                    type="number"
                    step="0.0001"
                    min="0"
                    max="1"
                    defaultValue={a.coeficiente}
                    onBlur={e => updateCoef(a.unidad, parseFloat(e.target.value) || 0)}
                    className="w-28 bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40"
                  />
                </div>
                <p className="text-xs text-slate-500 dark:text-slate-400 shrink-0">
                  {(a.coeficiente * 100).toFixed(2)}%
                </p>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Calculator */}
      {alicuotas.length > 0 && (
        <Card>
          <p className="font-semibold text-slate-900 dark:text-white mb-4">Calcular prorrateo</p>
          <div className="grid grid-cols-2 gap-4 mb-4">
            <Field label="Total factura agua caliente ($)">
              <Input
                value={totalFactura}
                onChange={e => setTotalFactura(e.target.value)}
                placeholder="1.250.000"
                className="text-lg font-semibold"
              />
            </Field>
            <Field label="Período (mes/año)">
              <Input
                type="month"
                value={periodo}
                onChange={e => setPeriodo(e.target.value)}
              />
            </Field>
          </div>

          <div className="flex items-center gap-3 mb-4">
            <button
              onClick={() => setEsComun(v => !v)}
              className={cn(
                'w-10 h-6 rounded-full transition-colors cursor-pointer shrink-0 relative',
                esComun ? 'bg-blue-600' : 'bg-slate-200 dark:bg-white/10',
              )}
            >
              <span className={cn(
                'absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform',
                esComun && 'translate-x-4',
              )} />
            </button>
            <p className="text-sm text-slate-700 dark:text-slate-300">
              {esComun ? 'Distribución igualitaria (N unidades)' : 'Distribución por coeficiente'}
            </p>
          </div>

          <Button icon={Droplets} onClick={calcular} disabled={!totalFactura}>
            Calcular
          </Button>
        </Card>
      )}

      {/* Results */}
      {resultado.length > 0 && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between mb-2">
            <p className="font-semibold text-slate-900 dark:text-white">Resultado del prorrateo</p>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              Total: {formatCLP(resultado.reduce((s, r) => s + r.monto, 0))}
            </p>
          </div>
          <div className="space-y-2">
            {resultado.map(r => (
              <div key={r.unidad} className="flex items-center justify-between py-2 border-b border-slate-100 dark:border-white/5 last:border-0">
                <p className="text-sm font-medium text-slate-700 dark:text-slate-300">{r.unidad}</p>
                <p className="font-bold text-slate-900 dark:text-white">{formatCLP(r.monto)}</p>
              </div>
            ))}
          </div>
          {emitido ? (
            <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold pt-2">
              <Zap size={16} /> Cobros emitidos exitosamente
            </div>
          ) : (
            <Button fullWidth icon={Zap} loading={emitiendo} onClick={emitirCobros}>
              {emitiendo ? 'Emitiendo cobros…' : 'Emitir cobros a residentes'}
            </Button>
          )}
        </Card>
      )}

      {/* Add unit modal */}
      <Modal open={showAddUnit} onClose={() => setShowAddUnit(false)}
        title="Agregar unidad" icon={Droplets} size="sm">
        <form onSubmit={handleAddUnit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Unidad" required>
              <Input required value={newUnidad} onChange={e => setNewUnidad(e.target.value)} placeholder="Depto 101" />
            </Field>
            <Field label="Coeficiente (0–1)" required>
              <Input required type="number" step="0.0001" min="0" max="1"
                value={newCoef} onChange={e => setNewCoef(e.target.value)} placeholder="0.0500" />
            </Field>
          </div>
          <Field label="Residente (opcional)">
            <Input value={newNombre} onChange={e => setNewNombre(e.target.value)} placeholder="Nombre del residente" />
          </Field>
          <Button type="submit" fullWidth icon={Save}>Agregar unidad</Button>
        </form>
      </Modal>
    </div>
  );
}
