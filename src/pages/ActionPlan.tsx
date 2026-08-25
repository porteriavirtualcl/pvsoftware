import React, { useEffect, useMemo, useState } from 'react';
import { db } from '../firebase';
import {
  collection, doc, onSnapshot, setDoc, deleteDoc, getDocs, query, where, serverTimestamp,
} from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  ClipboardCheck, Phone, MessageCircle, Mail, Car, Plus, Edit2, Trash2, Search,
  AlertTriangle, Building2, Users, Download, ChevronDown, ChevronRight,
} from 'lucide-react';
import { Button, Card, PageHeader, Field, Input, Modal, Badge, EmptyState, Spinner } from '../components/ui';

/* ─────────────────────────────────────────────────────────────
   Plan de Acción por condominio.

   Datos (Firestore):
     condos/{condoId}/actionPlan/config          → cabecera + emergencias
     condos/{condoId}/actionPlanUnits/{unidad}   → un doc por unidad con sus contactos

   Los contactos son copia propia del plan (no se derivan de Residentes en vivo):
   la lista incluye gente sin cuenta en la app y un orden de llamada propio. El botón
   "Importar residentes" precarga las unidades para no tipearlas a mano.

   Quién ve qué: el operador solo sus condominios asignados (condoId / condoIds /
   condoScope, lo mismo que usa el resto del sistema). Editan super_admin y la
   administración del condominio.
   ──────────────────────────────────────────────────────────── */

type Contacto = {
  nombre: string;
  telefono: string;
  email: string;
  patentes: string;   // texto libre: "ABCD12 / XYZW34"
};

type PlanConfig = {
  direccion: string;
  emergenciaLlamar: string;          // ej: "4200 Seguridad Municipal"
  tiposEmergencia: string;
  tiposAutorizacion: string;
  contactosEmergencia: Contacto[];
};

type Unidad = {
  id: string;
  unidad: string;
  contactos: Contacto[];
};

const CONFIG_VACIA: PlanConfig = {
  direccion: '',
  emergenciaLlamar: '',
  tiposEmergencia: 'Intento de ingreso sin registro, personal en sector delimitado, ingreso a la propiedad, incendio, corte de energía.',
  tiposAutorizacion: 'Visitas no registradas, encomiendas, correspondencia, delivery.',
  contactosEmergencia: [],
};

const CONTACTO_VACIO: Contacto = { nombre: '', telefono: '', email: '', patentes: '' };

/** Deja el teléfono en formato wa.me a partir de lo que haya escrito el administrador. */
function waNumero(tel: string): string {
  const d = String(tel || '').replace(/\D/g, '');
  if (!d) return '';
  if (d.startsWith('56')) return d;
  if (d.length === 9 && d.startsWith('9')) return '56' + d;
  if (d.length === 8) return '569' + d;
  return d;
}

/** Orden natural: "Parcela 2" antes que "Parcela 10". */
function ordenNatural(a: string, b: string) {
  return String(a).localeCompare(String(b), 'es', { numeric: true, sensitivity: 'base' });
}

/** Id de documento seguro a partir del nombre de la unidad. */
function idUnidad(nombre: string) {
  return nombre.trim().replace(/[/\\#?]/g, '-');
}

/* ─────────────────────────────────────────────────────────────
   Ficha de contacto: lo que el operador realmente usa (llamar / WhatsApp)
   ──────────────────────────────────────────────────────────── */
/* `key` en el tipo: este proyecto usa @types/react sin el key implícito en JSX
   (el resto de las páginas arrastra el mismo error de tipos). */
function FichaContacto({ c, orden }: { c: Contacto; orden: number; key?: React.Key }) {
  const wa = waNumero(c.telefono);
  return (
    <div className="flex items-start gap-3 py-2.5 border-t border-slate-100 dark:border-white/5 first:border-t-0">
      <span className="shrink-0 w-6 h-6 mt-0.5 rounded-full bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 text-xs font-bold flex items-center justify-center">
        {orden}
      </span>
      <div className="min-w-0 flex-1">
        <p className="font-semibold text-slate-900 dark:text-white text-sm truncate">{c.nombre || '—'}</p>
        {c.email && (
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate flex items-center gap-1">
            <Mail size={11} /> {c.email}
          </p>
        )}
        {c.patentes && (
          <p className="text-xs text-slate-500 dark:text-slate-400 truncate flex items-center gap-1 mt-0.5">
            <Car size={11} /> {c.patentes}
          </p>
        )}
      </div>
      {c.telefono && (
        <div className="shrink-0 flex items-center gap-1.5">
          <a
            href={`tel:${c.telefono.replace(/\s/g, '')}`}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-blue-600 text-white text-xs font-semibold hover:bg-blue-700 transition"
          >
            <Phone size={13} /> Llamar
          </a>
          {wa && (
            <a
              href={`https://wa.me/${wa}`}
              target="_blank"
              rel="noreferrer"
              title="WhatsApp"
              className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-emerald-600 text-white hover:bg-emerald-700 transition"
            >
              <MessageCircle size={14} />
            </a>
          )}
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Editor de lista de contactos (emergencias y unidades usan el mismo)
   ──────────────────────────────────────────────────────────── */
function EditorContactos({
  contactos, onChange,
}: { contactos: Contacto[]; onChange: (c: Contacto[]) => void }) {
  const set = (i: number, patch: Partial<Contacto>) =>
    onChange(contactos.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const mover = (i: number, delta: number) => {
    const j = i + delta;
    if (j < 0 || j >= contactos.length) return;
    const copia = [...contactos];
    const tmp = copia[i];
    copia[i] = copia[j];
    copia[j] = tmp;
    onChange(copia);
  };

  return (
    <div className="space-y-3">
      {contactos.map((c, i) => (
        <div key={i} className="rounded-xl border border-slate-200 dark:border-white/10 p-3 space-y-2">
          <div className="flex items-center gap-2">
            <Badge variant="brand">Orden {i + 1}</Badge>
            <div className="ml-auto flex items-center gap-1">
              <button type="button" title="Subir" disabled={i === 0} onClick={() => mover(i, -1)}
                className="px-1.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30">▲</button>
              <button type="button" title="Bajar" disabled={i === contactos.length - 1} onClick={() => mover(i, 1)}
                className="px-1.5 rounded text-slate-500 hover:bg-slate-100 dark:hover:bg-white/5 disabled:opacity-30">▼</button>
              <button type="button" title="Quitar" onClick={() => onChange(contactos.filter((_, idx) => idx !== i))}
                className="p-1 rounded text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10">
                <Trash2 size={14} />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <Input placeholder="Nombre" value={c.nombre} onChange={e => set(i, { nombre: e.target.value })} />
            <Input placeholder="Teléfono móvil" value={c.telefono} onChange={e => set(i, { telefono: e.target.value })} />
            <Input placeholder="Email para la app" value={c.email} onChange={e => set(i, { email: e.target.value })} />
            <Input placeholder="Patentes" value={c.patentes} onChange={e => set(i, { patentes: e.target.value })} />
          </div>
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" icon={Plus}
        onClick={() => onChange([...contactos, { ...CONTACTO_VACIO }])}>
        Agregar contacto
      </Button>
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────
   Página
   ──────────────────────────────────────────────────────────── */
const ActionPlan = () => {
  const { profile } = useAuth();
  const isSuperAdmin = profile?.role === 'super_admin' || profile?.condoScope === 'all';
  const isMultiCondo = !isSuperAdmin && profile?.condoScope === 'multiple' && (profile?.condoIds?.length ?? 0) > 0;
  const canEdit = ['super_admin', 'condo_admin', 'administrador'].includes(profile?.role || '');

  const [condos, setCondos] = useState<{ id: string; name: string }[]>([]);
  const [condoId, setCondoId] = useState('');
  const [config, setConfig] = useState<PlanConfig | null>(null);
  const [unidades, setUnidades] = useState<Unidad[]>([]);
  const [loading, setLoading] = useState(true);
  const [busca, setBusca] = useState('');
  const [abierta, setAbierta] = useState<string | null>(null);

  const [editandoConfig, setEditandoConfig] = useState<PlanConfig | null>(null);
  const [editandoUnidad, setEditandoUnidad] = useState<Unidad | null>(null);
  const [nuevaUnidad, setNuevaUnidad] = useState(false);
  const [borrando, setBorrando] = useState<Unidad | null>(null);
  const [importando, setImportando] = useState(false);
  const [previoImport, setPrevioImport] = useState<Unidad[] | null>(null);
  const [guardando, setGuardando] = useState(false);

  /* Condominios visibles según la asignación del usuario. */
  useEffect(() => {
    const unsub = onSnapshot(collection(db, 'condos'), snap => {
      const todos = snap.docs.map(d => ({ id: d.id, name: (d.data() as { name?: string }).name || d.id }));
      const mios = isSuperAdmin
        ? todos
        : isMultiCondo
          ? todos.filter(c => (profile?.condoIds ?? []).includes(c.id))
          : todos.filter(c => c.id === profile?.condoId);
      mios.sort((a, b) => ordenNatural(a.name, b.name));
      setCondos(mios);
      setCondoId(prev => prev || profile?.condoId || mios[0]?.id || '');
    });
    return () => unsub();
  }, [profile, isSuperAdmin, isMultiCondo]);

  /* Plan del condominio seleccionado. */
  useEffect(() => {
    if (!condoId) { setConfig(null); setUnidades([]); setLoading(false); return; }
    setLoading(true);
    const unsubCfg = onSnapshot(doc(db, `condos/${condoId}/actionPlan/config`), d => {
      setConfig(d.exists() ? { ...CONFIG_VACIA, ...(d.data() as PlanConfig) } : null);
      setLoading(false);
    }, () => setLoading(false));
    const unsubUni = onSnapshot(collection(db, `condos/${condoId}/actionPlanUnits`), snap => {
      const list = snap.docs.map(d => ({ id: d.id, ...(d.data() as Omit<Unidad, 'id'>) }));
      list.sort((a, b) => ordenNatural(a.unidad, b.unidad));
      setUnidades(list);
    });
    return () => { unsubCfg(); unsubUni(); };
  }, [condoId]);

  const condoNombre = condos.find(c => c.id === condoId)?.name || '';

  const unidadesFiltradas = useMemo(() => {
    const q = busca.trim().toLowerCase();
    if (!q) return unidades;
    return unidades.filter(u =>
      u.unidad.toLowerCase().includes(q) ||
      (u.contactos || []).some(c =>
        `${c.nombre} ${c.telefono} ${c.email} ${c.patentes}`.toLowerCase().includes(q)),
    );
  }, [unidades, busca]);

  const guardarConfig = async () => {
    if (!editandoConfig || !condoId) return;
    setGuardando(true);
    try {
      await setDoc(doc(db, `condos/${condoId}/actionPlan/config`), {
        ...editandoConfig,
        updatedAt: serverTimestamp(),
        updatedBy: profile?.email || '',
      }, { merge: true });
      setEditandoConfig(null);
    } finally { setGuardando(false); }
  };

  const guardarUnidad = async () => {
    if (!editandoUnidad || !condoId) return;
    const nombre = editandoUnidad.unidad.trim();
    if (!nombre) return;
    setGuardando(true);
    try {
      await setDoc(doc(db, `condos/${condoId}/actionPlanUnits/${editandoUnidad.id || idUnidad(nombre)}`), {
        unidad: nombre,
        contactos: editandoUnidad.contactos || [],
        updatedAt: serverTimestamp(),
        updatedBy: profile?.email || '',
      }, { merge: true });
      setEditandoUnidad(null);
      setNuevaUnidad(false);
    } finally { setGuardando(false); }
  };

  const borrarUnidad = async () => {
    if (!borrando || !condoId) return;
    setGuardando(true);
    try {
      await deleteDoc(doc(db, `condos/${condoId}/actionPlanUnits/${borrando.id}`));
      setBorrando(null);
    } finally { setGuardando(false); }
  };

  /* Importar desde Residentes: arma la vista previa, no escribe hasta confirmar. */
  const prepararImport = async () => {
    if (!condoId) return;
    setImportando(true);
    try {
      const snap = await getDocs(query(collection(db, 'users'), where('condoId', '==', condoId)));
      const porUnidad = new Map<string, Contacto[]>();
      snap.forEach(d => {
        const u = d.data() as {
          role?: string; unit?: string; name?: string; displayName?: string;
          phone?: string; tel?: string; email?: string; plates?: string[] | string;
        };
        if (!['resident', 'usuario'].includes(u.role || '')) return;
        const unidad = String(u.unit || '').trim();
        if (!unidad) return;
        const lista = porUnidad.get(unidad) || [];
        lista.push({
          nombre: u.name || u.displayName || '',
          telefono: String(u.phone || u.tel || ''),
          email: String(u.email || ''),
          patentes: Array.isArray(u.plates) ? u.plates.join(' / ') : String(u.plates || ''),
        });
        porUnidad.set(unidad, lista);
      });
      const yaExisten = new Set(unidades.map(u => u.unidad));
      const nuevas: Unidad[] = [...porUnidad.entries()]
        .filter(([unidad]) => !yaExisten.has(unidad))
        .map(([unidad, contactos]) => ({
          id: idUnidad(unidad),
          unidad,
          contactos: contactos.sort((a, b) => ordenNatural(a.nombre, b.nombre)),
        }))
        .sort((a, b) => ordenNatural(a.unidad, b.unidad));
      setPrevioImport(nuevas);
    } finally { setImportando(false); }
  };

  const confirmarImport = async () => {
    if (!previoImport || !condoId) return;
    setGuardando(true);
    try {
      for (const u of previoImport) {
        await setDoc(doc(db, `condos/${condoId}/actionPlanUnits/${u.id}`), {
          unidad: u.unidad,
          contactos: u.contactos,
          updatedAt: serverTimestamp(),
          updatedBy: profile?.email || '',
          importadoDeResidentes: true,
        }, { merge: true });
      }
      setPrevioImport(null);
    } finally { setGuardando(false); }
  };

  if (loading && !config && unidades.length === 0) {
    return <div className="flex justify-center py-20"><Spinner size={28} /></div>;
  }

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto">
      <PageHeader
        eyebrow="Operación"
        title="Plan de Acción"
        description="A quién llamar ante una emergencia o para autorizar un ingreso, en orden de prioridad."
        icon={ClipboardCheck}
        actions={canEdit && config ? (
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" icon={Download} loading={importando} onClick={prepararImport}>
              Importar residentes
            </Button>
            <Button variant="secondary" size="sm" icon={Edit2} onClick={() => setEditandoConfig(config)}>
              Editar cabecera
            </Button>
            <Button size="sm" icon={Plus}
              onClick={() => { setNuevaUnidad(true); setEditandoUnidad({ id: '', unidad: '', contactos: [{ ...CONTACTO_VACIO }] }); }}>
              Unidad
            </Button>
          </div>
        ) : undefined}
      />

      {condos.length > 1 && (
        <div className="mb-5">
          <Field label="Condominio">
            <select
              value={condoId}
              onChange={e => { setCondoId(e.target.value); setAbierta(null); }}
              className="block w-full sm:w-80 bg-white dark:bg-slate-950/50 border border-slate-200 dark:border-white/10 rounded-xl px-3.5 py-2.5 text-[15px] text-slate-900 dark:text-slate-100 outline-none focus:border-blue-600 focus:ring-2 focus:ring-blue-500/20"
            >
              {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </Field>
        </div>
      )}

      {!condoId ? (
        <EmptyState icon={Building2} title="Sin condominios asignados"
          description="Pídele a la administración que te asigne al menos un condominio." />
      ) : !config ? (
        <EmptyState
          icon={ClipboardCheck}
          title={`${condoNombre} todavía no tiene plan de acción`}
          description={canEdit
            ? 'Créalo y luego importa las unidades desde Residentes.'
            : 'La administración aún no lo ha cargado.'}
          action={canEdit
            ? <Button icon={Plus} onClick={() => setEditandoConfig({ ...CONFIG_VACIA })}>Crear plan</Button>
            : undefined}
        />
      ) : (
        <div className="space-y-5">
          {/* 1 · Emergencias */}
          <Card className="border-l-4 border-l-red-500">
            <div className="flex items-start gap-3 mb-3">
              <div className="w-9 h-9 rounded-xl bg-red-50 dark:bg-red-500/10 text-red-600 dark:text-red-400 flex items-center justify-center shrink-0">
                <AlertTriangle size={18} />
              </div>
              <div className="min-w-0">
                <h2 className="font-bold text-slate-900 dark:text-white">1 · Emergencias</h2>
                {config.direccion && <p className="text-xs text-slate-500 dark:text-slate-400">{config.direccion}</p>}
              </div>
              {config.emergenciaLlamar && (
                <div className="ml-auto text-right shrink-0">
                  <p className="text-[11px] uppercase tracking-wide text-slate-400">Emergencia</p>
                  <p className="text-sm font-bold text-red-600 dark:text-red-400">{config.emergenciaLlamar}</p>
                </div>
              )}
            </div>
            {config.tiposEmergencia && (
              <p className="text-xs text-slate-600 dark:text-slate-400 mb-2">{config.tiposEmergencia}</p>
            )}
            {(config.contactosEmergencia || []).length === 0 ? (
              <p className="text-sm text-slate-500 dark:text-slate-400">Sin contactos de emergencia cargados.</p>
            ) : (
              <div>
                {(config.contactosEmergencia || []).map((c, i) => <FichaContacto key={i} c={c} orden={i + 1} />)}
              </div>
            )}
          </Card>

          {/* 2 · Autorizaciones por unidad */}
          <div>
            <div className="flex flex-wrap items-center gap-3 mb-3">
              <div>
                <h2 className="font-bold text-slate-900 dark:text-white">2 · Autorizaciones de ingreso</h2>
                {config.tiposAutorizacion && (
                  <p className="text-xs text-slate-600 dark:text-slate-400">{config.tiposAutorizacion}</p>
                )}
              </div>
              <div className="ml-auto relative w-full sm:w-72">
                <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <Input
                  className="pl-9"
                  placeholder="Buscar unidad, nombre o patente…"
                  value={busca}
                  onChange={e => setBusca(e.target.value)}
                />
              </div>
            </div>

            {unidadesFiltradas.length === 0 ? (
              <Card>
                <EmptyState
                  icon={Users}
                  title={busca ? 'Sin resultados' : 'Sin unidades cargadas'}
                  description={busca
                    ? 'Prueba con otro nombre, unidad o patente.'
                    : canEdit ? 'Importa las unidades desde Residentes o agrégalas a mano.' : undefined}
                  action={!busca && canEdit
                    ? <Button variant="secondary" icon={Download} loading={importando} onClick={prepararImport}>
                        Importar desde Residentes
                      </Button>
                    : undefined}
                />
              </Card>
            ) : (
              <div className="space-y-2">
                {unidadesFiltradas.map(u => {
                  const open = abierta === u.id || !!busca;
                  return (
                    <Card key={u.id} padding="none" className="overflow-hidden">
                      <div className="w-full flex items-center gap-3 px-4 py-3">
                        <button
                          type="button"
                          onClick={() => setAbierta(open && !busca ? null : u.id)}
                          className="flex items-center gap-3 flex-1 min-w-0 text-left"
                        >
                          {open
                            ? <ChevronDown size={16} className="text-slate-400 shrink-0" />
                            : <ChevronRight size={16} className="text-slate-400 shrink-0" />}
                          <span className="font-semibold text-slate-900 dark:text-white truncate">{u.unidad}</span>
                          <Badge variant="muted">{(u.contactos || []).length}</Badge>
                        </button>
                        {canEdit && (
                          <div className="flex items-center gap-1 shrink-0">
                            <button type="button" title="Editar" onClick={() => setEditandoUnidad(u)}
                              className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10">
                              <Edit2 size={14} />
                            </button>
                            <button type="button" title="Eliminar" onClick={() => setBorrando(u)}
                              className="p-1.5 rounded-lg text-red-500 hover:bg-red-50 dark:hover:bg-red-500/10">
                              <Trash2 size={14} />
                            </button>
                          </div>
                        )}
                      </div>
                      {open && (
                        <div className="px-4 pb-3 border-t border-slate-100 dark:border-white/5">
                          {(u.contactos || []).length === 0
                            ? <p className="text-sm text-slate-500 py-3">Sin contactos.</p>
                            : (u.contactos || []).map((c, i) => <FichaContacto key={i} c={c} orden={i + 1} />)}
                        </div>
                      )}
                    </Card>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Cabecera y emergencias */}
      <Modal
        open={!!editandoConfig}
        onClose={() => setEditandoConfig(null)}
        title="Cabecera y emergencias"
        description={condoNombre}
        icon={AlertTriangle}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setEditandoConfig(null)}>Cancelar</Button>
            <Button onClick={guardarConfig} loading={guardando}>Guardar</Button>
          </>
        }
      >
        {editandoConfig && (
          <div className="space-y-4">
            <Field label="Dirección">
              <Input value={editandoConfig.direccion}
                onChange={e => setEditandoConfig({ ...editandoConfig, direccion: e.target.value })} />
            </Field>
            <Field label="Teléfono de emergencia" hint="Ej: 4200 Seguridad Municipal">
              <Input value={editandoConfig.emergenciaLlamar}
                onChange={e => setEditandoConfig({ ...editandoConfig, emergenciaLlamar: e.target.value })} />
            </Field>
            <Field label="Tipos de emergencia">
              <Input value={editandoConfig.tiposEmergencia}
                onChange={e => setEditandoConfig({ ...editandoConfig, tiposEmergencia: e.target.value })} />
            </Field>
            <Field label="Tipos de autorización">
              <Input value={editandoConfig.tiposAutorizacion}
                onChange={e => setEditandoConfig({ ...editandoConfig, tiposAutorizacion: e.target.value })} />
            </Field>
            <Field label="Llamar en orden de prioridad">
              <EditorContactos
                contactos={editandoConfig.contactosEmergencia || []}
                onChange={c => setEditandoConfig({ ...editandoConfig, contactosEmergencia: c })}
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* Unidad */}
      <Modal
        open={!!editandoUnidad}
        onClose={() => { setEditandoUnidad(null); setNuevaUnidad(false); }}
        title={nuevaUnidad ? 'Nueva unidad' : 'Editar unidad'}
        description={condoNombre}
        icon={Users}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => { setEditandoUnidad(null); setNuevaUnidad(false); }}>Cancelar</Button>
            <Button onClick={guardarUnidad} loading={guardando} disabled={!editandoUnidad?.unidad.trim()}>Guardar</Button>
          </>
        }
      >
        {editandoUnidad && (
          <div className="space-y-4">
            <Field label="Unidad" required hint="Como se conoce en el condominio: Parcela 07, Depto 302, Casa 12…">
              <Input
                value={editandoUnidad.unidad}
                disabled={!nuevaUnidad}
                onChange={e => setEditandoUnidad({ ...editandoUnidad, unidad: e.target.value })}
              />
            </Field>
            <Field label="Llamar en orden de prioridad">
              <EditorContactos
                contactos={editandoUnidad.contactos || []}
                onChange={c => setEditandoUnidad({ ...editandoUnidad, contactos: c })}
              />
            </Field>
          </div>
        )}
      </Modal>

      {/* Confirmación de importación */}
      <Modal
        open={!!previoImport}
        onClose={() => setPrevioImport(null)}
        title="Importar desde Residentes"
        description={`${previoImport?.length ?? 0} unidades nuevas en ${condoNombre}`}
        icon={Download}
        size="lg"
        footer={
          <>
            <Button variant="ghost" onClick={() => setPrevioImport(null)}>Cancelar</Button>
            <Button onClick={confirmarImport} loading={guardando} disabled={!previoImport?.length}>
              Importar {previoImport?.length ?? 0}
            </Button>
          </>
        }
      >
        {previoImport && (previoImport.length === 0 ? (
          <p className="text-sm text-slate-600 dark:text-slate-400">
            No hay unidades nuevas: todas las de Residentes ya están en el plan. Las existentes no se tocan.
          </p>
        ) : (
          <>
            <p className="text-sm text-slate-600 dark:text-slate-400 mb-3">
              Se crearán estas unidades con sus residentes como contactos. Las que ya están en el plan no se modifican.
            </p>
            <div className="max-h-72 overflow-y-auto space-y-1.5">
              {previoImport.map(u => (
                <div key={u.id} className="flex items-center gap-2 text-sm">
                  <Badge variant="success">{u.contactos.length}</Badge>
                  <span className="font-medium text-slate-800 dark:text-slate-200">{u.unidad}</span>
                  <span className="text-xs text-slate-500 truncate">
                    {u.contactos.map(c => c.nombre).filter(Boolean).join(', ')}
                  </span>
                </div>
              ))}
            </div>
          </>
        ))}
      </Modal>

      {/* Eliminar unidad */}
      <Modal
        open={!!borrando}
        onClose={() => setBorrando(null)}
        title="Eliminar unidad"
        icon={Trash2}
        footer={
          <>
            <Button variant="ghost" onClick={() => setBorrando(null)}>Cancelar</Button>
            <Button variant="danger" onClick={borrarUnidad} loading={guardando}>Eliminar</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          Se eliminará <strong>{borrando?.unidad}</strong> del plan de acción de {condoNombre}, con sus{' '}
          {(borrando?.contactos || []).length} contactos. No afecta a Residentes.
        </p>
      </Modal>
    </div>
  );
};

export default ActionPlan;
