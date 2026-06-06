import React, { useState, useRef } from 'react';
import { db } from '../../firebase';
import { collection, addDoc, Timestamp } from 'firebase/firestore';
import {
  FileSpreadsheet, Upload, CheckCircle2, AlertTriangle, Trash2, Zap,
} from 'lucide-react';
import { handleFirestoreError, OperationType, cn } from '../../lib/utils';
import { Button, Card, Field, Input, Modal, Badge, EmptyState } from '../../components/ui';

// ── Types ─────────────────────────────────────────────────────────────────────
interface FilaImport {
  unidad: string;
  residente: string;
  monto: number;
  coeficiente?: number;
  valido: boolean;
  error?: string;
}

interface Props {
  condoId: string;
  condoName: string;
  condos: { id: string; name: string }[];
  isGlobal: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────
const MONTHS = ['Enero','Febrero','Marzo','Abril','Mayo','Junio','Julio','Agosto','Septiembre','Octubre','Noviembre','Diciembre'];
const selectClass = 'block w-full bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2.5 text-sm text-slate-900 dark:text-slate-100 focus:outline-none focus:ring-2 focus:ring-blue-500/40 transition cursor-pointer';
const formatCLP  = (n: number) => `$${Math.round(n).toLocaleString('es-CL')}`;

// ── Template download ─────────────────────────────────────────────────────────
function downloadTemplate() {
  const csv = [
    'unidad,residente,monto,coeficiente',
    'Depto 101,Juan Pérez,65000,0.05',
    'Depto 102,María González,65000,0.05',
    'Depto 201,Carlos Rojas,72000,0.06',
  ].join('\n');
  const blob = new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'alicuotas_template.csv';
  a.click(); URL.revokeObjectURL(url);
}

// ── CSV / XLSX parser ─────────────────────────────────────────────────────────
async function parseFile(file: File): Promise<FilaImport[]> {
  if (file.name.endsWith('.csv') || file.type === 'text/csv') {
    const text = await file.text();
    return parseCSV(text);
  }
  // xlsx
  const xlsx = await import('xlsx');
  const ab = await file.arrayBuffer();
  const wb = xlsx.read(ab, { type: 'array' });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json<Record<string, any>>(ws, { defval: '' });
  return rows.map(validateRow);
}

function parseCSV(text: string): FilaImport[] {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
  if (lines.length < 2) return [];
  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/\s+/g, '_'));
  return lines.slice(1).map(line => {
    const vals = line.split(',');
    const row: Record<string, any> = {};
    headers.forEach((h, i) => { row[h] = vals[i]?.trim() ?? ''; });
    return validateRow(row);
  });
}

function validateRow(row: Record<string, any>): FilaImport {
  const unidad    = String(row.unidad || row.Unidad || row.UNIDAD || '').trim();
  const residente = String(row.residente || row.Residente || row.nombre || row.Nombre || '').trim();
  const monto     = parseFloat(String(row.monto || row.Monto || row.MONTO || '0').replace(/\./g, '').replace(',', '.')) || 0;
  const coef      = parseFloat(String(row.coeficiente || row.Coeficiente || row.alicuota || '0').replace(',', '.')) || undefined;

  if (!unidad) return { unidad, residente, monto, coeficiente: coef, valido: false, error: 'Falta unidad' };
  if (monto <= 0 && !coef) return { unidad, residente, monto, coeficiente: coef, valido: false, error: 'Monto o coeficiente requerido' };
  return { unidad, residente, monto, coeficiente: coef, valido: true };
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ExcelImportTab({ condoId, condoName, condos, isGlobal }: Props) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [filas,      setFilas]      = useState<FilaImport[]>([]);
  const [importing,  setImporting]  = useState(false);
  const [importado,  setImportado]  = useState(false);
  const [mes,        setMes]        = useState(MONTHS[new Date().getMonth()]);
  const [anio,       setAnio]       = useState(new Date().getFullYear().toString());
  const [condoSel,   setCondoSel]   = useState(condoId || condos[0]?.id || '');
  const [totalFact,  setTotalFact]  = useState('');
  const [useTotal,   setUseTotal]   = useState(false);
  const [fileName,   setFileName]   = useState('');

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    setImportado(false);
    try {
      const rows = await parseFile(file);
      setFilas(rows);
    } catch {
      setFilas([]);
    }
  };

  const filasValidas  = filas.filter(f => f.valido);
  const filasInvalidas = filas.filter(f => !f.valido);
  const total = useTotal
    ? parseFloat(totalFact.replace(/\./g, '').replace(',', '.')) || 0
    : 0;

  // If using total + coeficientes, recalculate montos
  const filasParaImportar: FilaImport[] = filasValidas.map(f => {
    if (useTotal && f.coeficiente && total > 0) {
      return { ...f, monto: Math.round(total * f.coeficiente) };
    }
    return f;
  });

  const handleImport = async () => {
    const cid = condoSel || condoId;
    if (!cid || filasParaImportar.length === 0) return;
    setImporting(true);
    const cName = condos.find(c => c.id === cid)?.name || condoName;
    try {
      await Promise.all(filasParaImportar.map(f =>
        addDoc(collection(db, `condos/${cid}/expenses`), {
          userId: '',
          userName: f.residente || f.unidad,
          unit: f.unidad,
          condoId: cid,
          condoName: cName,
          month: mes,
          year: anio,
          amount: f.monto.toString(),
          status: 'pending',
          date: new Date().toISOString().split('T')[0],
          tipo: 'alicuota',
          createdAt: Timestamp.now(),
          updatedAt: Timestamp.now(),
        })
      ));
      setImportado(true);
      setFilas([]);
      setFileName('');
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      handleFirestoreError(err, OperationType.CREATE, 'expenses/import');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* Instructions */}
      <Card className="bg-blue-50 dark:bg-blue-500/5 border-blue-200 dark:border-blue-500/20">
        <div className="flex items-start gap-3">
          <FileSpreadsheet size={20} className="text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
          <div>
            <p className="font-semibold text-blue-900 dark:text-blue-100 text-sm">Importación masiva de alícuotas</p>
            <p className="text-xs text-blue-700 dark:text-blue-300 mt-1">
              Sube un archivo <strong>.xlsx</strong> o <strong>.csv</strong> con columnas: <code className="bg-blue-100 dark:bg-blue-500/20 px-1 rounded">unidad, residente, monto, coeficiente</code>.
              Descarga la plantilla para ver el formato correcto.
            </p>
            <button
              onClick={downloadTemplate}
              className="mt-2 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
            >
              Descargar plantilla CSV →
            </button>
          </div>
        </div>
      </Card>

      {/* Period + Condo */}
      <Card>
        <p className="font-semibold text-slate-900 dark:text-white mb-4">Configurar importación</p>
        <div className="grid grid-cols-2 gap-4 mb-4">
          <Field label="Mes">
            <div className="relative">
              <select value={mes} onChange={e => setMes(e.target.value)} className={selectClass}>
                {MONTHS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
            </div>
          </Field>
          <Field label="Año">
            <Input value={anio} onChange={e => setAnio(e.target.value)} placeholder="2026" />
          </Field>
        </div>

        {isGlobal && (
          <Field label="Condominio">
            <div className="relative">
              <select value={condoSel} onChange={e => setCondoSel(e.target.value)} className={selectClass}>
                {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
          </Field>
        )}

        {/* Option: calculate montos from total + coeficiente */}
        <div className="mt-4 flex items-center gap-3">
          <button
            onClick={() => setUseTotal(v => !v)}
            className={cn(
              'w-10 h-6 rounded-full transition-colors cursor-pointer shrink-0 relative',
              useTotal ? 'bg-blue-600' : 'bg-slate-200 dark:bg-white/10',
            )}
          >
            <span className={cn('absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white shadow transition-transform', useTotal && 'translate-x-4')} />
          </button>
          <p className="text-sm text-slate-700 dark:text-slate-300">Calcular montos desde total × coeficiente</p>
        </div>

        {useTotal && (
          <div className="mt-3">
            <Field label="Total a distribuir ($)">
              <Input value={totalFact} onChange={e => setTotalFact(e.target.value)}
                placeholder="1.250.000" className="text-lg font-semibold" />
            </Field>
          </div>
        )}
      </Card>

      {/* File upload */}
      <div>
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={handleFile} />
        <button
          onClick={() => fileRef.current?.click()}
          className="w-full flex flex-col items-center justify-center gap-3 px-6 py-10 rounded-2xl border-2 border-dashed border-slate-200 dark:border-white/10 text-slate-500 dark:text-slate-400 hover:border-blue-400 hover:text-blue-600 dark:hover:border-blue-500 dark:hover:text-blue-400 transition-colors cursor-pointer"
        >
          <FileSpreadsheet size={32} />
          <div className="text-center">
            <p className="font-semibold text-sm">{fileName || 'Seleccionar archivo .xlsx o .csv'}</p>
            <p className="text-xs mt-0.5">Arrastra o haz click para seleccionar</p>
          </div>
        </button>
      </div>

      {/* Preview */}
      {filas.length > 0 && (
        <Card className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="font-semibold text-slate-900 dark:text-white">
              Vista previa — {filasValidas.length} válidas
              {filasInvalidas.length > 0 && `, ${filasInvalidas.length} con error`}
            </p>
            <button onClick={() => { setFilas([]); setFileName(''); if (fileRef.current) fileRef.current.value = ''; }}
              className="text-slate-400 hover:text-red-500 transition-colors cursor-pointer">
              <Trash2 size={16} />
            </button>
          </div>

          <div className="rounded-xl border border-slate-200 dark:border-white/10 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 dark:bg-white/[0.03]">
                <tr>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Unidad</th>
                  <th className="text-left px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Residente</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Monto</th>
                  <th className="text-right px-3 py-2 text-xs font-semibold text-slate-500 dark:text-slate-400">Coef.</th>
                  <th className="px-3 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-white/5">
                {(useTotal && total > 0 ? filasParaImportar : filas).map((f, i) => (
                  <tr key={i} className={cn(!f.valido && 'bg-red-50 dark:bg-red-500/5')}>
                    <td className="px-3 py-2 font-medium text-slate-900 dark:text-white">{f.unidad || '—'}</td>
                    <td className="px-3 py-2 text-slate-600 dark:text-slate-400 truncate max-w-[120px]">{f.residente || '—'}</td>
                    <td className="px-3 py-2 text-right font-semibold text-slate-900 dark:text-white">{f.monto > 0 ? formatCLP(f.monto) : '—'}</td>
                    <td className="px-3 py-2 text-right text-slate-500">{f.coeficiente != null ? `${(f.coeficiente * 100).toFixed(2)}%` : '—'}</td>
                    <td className="px-3 py-2 text-right">
                      {f.valido
                        ? <CheckCircle2 size={14} className="text-emerald-500 inline" />
                        : <span title={f.error}><AlertTriangle size={14} className="text-red-500 inline" /></span>
                      }
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="flex items-center justify-between pt-2">
            <p className="text-sm font-semibold text-slate-700 dark:text-slate-300">
              Total: {formatCLP((useTotal && total > 0 ? filasParaImportar : filasValidas).reduce((s, f) => s + f.monto, 0))}
            </p>
            {importado ? (
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400 font-semibold text-sm">
                <CheckCircle2 size={16} /> Importado exitosamente
              </div>
            ) : (
              <Button icon={Zap} loading={importing} onClick={handleImport}
                disabled={filasValidas.length === 0}>
                {importing ? 'Importando…' : `Importar ${filasValidas.length} registros`}
              </Button>
            )}
          </div>
        </Card>
      )}
    </div>
  );
}
