import React, { useEffect, useState } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';
import { useAuth } from '../hooks/useAuth';
import { authedFetch } from '../lib/apiBase';
import { ShieldCheck, ScanFace, Users, Check, Copy, AlertCircle } from 'lucide-react';

type Relation = 'self' | 'minor' | 'adult';
interface Member {
  uid: string;
  name: string;
  isSelf: boolean;
  hasPhoto: boolean;
  dahuaPersonId: string | null;
  source: 'app' | 'dss';
  relation: Relation;
  biometric: boolean;
}
interface RatifyLink { uid: string; name: string; token: string; }

/**
 * Aviso de consentimiento (Ley 21.719). Aparece de forma bloqueante a residentes cuando
 * `config/consent.enabled` está activo y el usuario no ha aceptado la versión vigente.
 * El titular consiente por sí mismo, por los menores a su cargo y declara por los adultos
 * del hogar (estos reciben un enlace de ratificación). Inerte mientras el flag esté apagado.
 */
const ConsentModal: React.FC = () => {
  const { user, profile } = useAuth();
  const [cfg, setCfg] = useState<{ enabled: boolean; version: number } | null>(null);
  const [members, setMembers] = useState<Member[] | null>(null);
  const [ack, setAck] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<RatifyLink[] | null>(null);

  const isResident = profile?.role === 'resident' || profile?.role === 'usuario';

  // Flag global de consentimiento.
  useEffect(() => {
    const unsub = onSnapshot(doc(db, 'config', 'consent'), s => {
      const d = s.data();
      setCfg(d ? { enabled: !!d.enabled, version: Number(d.version) || 1 } : { enabled: false, version: 1 });
    }, () => setCfg({ enabled: false, version: 1 }));
    return () => unsub();
  }, []);

  const needsConsent = !!cfg?.enabled && isResident && !!user &&
    (Number((profile as any)?.consentVersion || 0) < cfg.version);

  // Carga los integrantes del hogar al activarse.
  useEffect(() => {
    if (!needsConsent || members) return;
    let alive = true;
    authedFetch('/api/household/members')
      .then(r => r.json())
      .then(d => {
        if (!alive) return;
        const list: Member[] = (d.members || []).map((m: any) => ({
          uid: m.uid, name: m.name, isSelf: !!m.isSelf, hasPhoto: !!m.hasPhoto,
          dahuaPersonId: m.dahuaPersonId ?? null, source: m.source === 'dss' ? 'dss' : 'app',
          relation: m.isSelf ? 'self' : 'adult',
          biometric: true,
        }));
        setMembers(list);
      })
      .catch(() => setError('No se pudieron cargar los integrantes del hogar. Intenta nuevamente.'));
    return () => { alive = false; };
  }, [needsConsent, members]);

  if (!needsConsent) return null;

  const setMember = (uid: string, patch: Partial<Member>) =>
    setMembers(ms => ms!.map(m => (m.uid === uid ? { ...m, ...patch } : m)));

  const accept = async () => {
    if (!members) return;
    setSaving(true); setError(null);
    try {
      const res = await authedFetch('/api/consent/accept', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          version: cfg!.version,
          members: members.map(m => ({ uid: m.uid, name: m.name, dahuaPersonId: m.dahuaPersonId, relation: m.relation, biometric: m.biometric })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al registrar el consentimiento');
      const links: RatifyLink[] = data.ratifyLinks || [];
      if (links.length > 0) setDone(links);   // hay adultos por ratificar → mostrar enlaces
      // Si no hay adultos, el flujo termina: el listener de profile.consentVersion cerrará el modal.
    } catch (e: any) {
      setError(e.message || 'Error al registrar el consentimiento');
    } finally {
      setSaving(false);
    }
  };

  const ratifyUrl = (t: string) => `${window.location.origin}/ratify/${t}`;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-900/70 backdrop-blur-sm">
      <div className="w-full max-w-lg max-h-[92vh] overflow-y-auto rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 shadow-2xl">
        {done ? (
          /* ── Confirmación + enlaces de ratificación de adultos ── */
          <div className="p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-3">
              <div className="w-10 h-10 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center"><Check size={20} /></div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Consentimiento registrado</h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
              Registramos tu consentimiento y el de los menores a tu cargo. Los siguientes <strong>integrantes adultos</strong> deben
              confirmar su propio consentimiento — comparte con cada uno su enlace personal:
            </p>
            <div className="space-y-2 mb-6">
              {done.map(l => (
                <div key={l.uid} className="flex items-center justify-between gap-3 rounded-lg bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 px-3 py-2.5">
                  <span className="text-sm font-medium text-slate-800 dark:text-slate-200 truncate">{l.name}</span>
                  <button
                    onClick={() => { navigator.clipboard?.writeText(ratifyUrl(l.token)).catch(() => {}); }}
                    className="shrink-0 inline-flex items-center gap-1.5 text-xs font-semibold text-blue-600 dark:text-blue-400 hover:underline cursor-pointer"
                  >
                    <Copy size={13} /> Copiar enlace
                  </button>
                </div>
              ))}
            </div>
            <button
              onClick={() => window.location.reload()}
              className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 text-white font-semibold text-sm transition-colors cursor-pointer"
            >
              Continuar a la aplicación
            </button>
          </div>
        ) : (
          /* ── Formulario de consentimiento ── */
          <div className="p-6 sm:p-8">
            <div className="flex items-center gap-3 mb-2">
              <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 flex items-center justify-center"><ShieldCheck size={20} /></div>
              <h2 className="text-xl font-bold text-slate-900 dark:text-white">Consentimiento de tus datos</h2>
            </div>
            <p className="text-sm text-slate-600 dark:text-slate-300 mb-5 leading-relaxed">
              Conforme a la Ley N° 21.719 necesitamos tu consentimiento para tratar los datos del control de
              acceso. El <strong>reconocimiento facial</strong> es un dato sensible y requiere tu aprobación
              explícita. Puedes autorizarlo por ti y por los integrantes de tu unidad, o usar acceso por
              <strong> código QR</strong> si prefieres no usar el rostro.
            </p>

            {error && (
              <div className="flex items-start gap-2 p-3 mb-4 rounded-lg bg-red-50 dark:bg-red-500/10 border border-red-200 dark:border-red-500/20 text-red-700 dark:text-red-300 text-sm">
                <AlertCircle size={16} className="mt-0.5 shrink-0" /><span>{error}</span>
              </div>
            )}

            {!members ? (
              <div className="py-10 text-center text-sm text-slate-400">Cargando integrantes del hogar…</div>
            ) : (
              <>
                <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500 mb-2">
                  <Users size={13} /> Integrantes de tu unidad {profile?.unit ? `· ${profile.unit}` : ''}
                </div>
                <div className="space-y-2.5 mb-5">
                  {members.map(m => (
                    <div key={m.uid} className="rounded-xl border border-slate-200 dark:border-white/10 p-3.5">
                      <div className="flex items-center justify-between gap-3">
                        <span className="font-semibold text-sm text-slate-900 dark:text-white truncate">
                          {m.name}{m.isSelf && <span className="ml-2 text-[11px] font-medium text-blue-600 dark:text-blue-400">(tú)</span>}
                        </span>
                        <label className="shrink-0 inline-flex items-center gap-2 cursor-pointer">
                          <ScanFace size={15} className={m.biometric ? 'text-emerald-600' : 'text-slate-400'} />
                          <input
                            type="checkbox" checked={m.biometric}
                            onChange={e => setMember(m.uid, { biometric: e.target.checked })}
                            className="w-4 h-4 rounded accent-emerald-600"
                          />
                          <span className="text-xs text-slate-600 dark:text-slate-400">Facial</span>
                        </label>
                      </div>
                      {!m.isSelf && (
                        <div className="mt-2.5 flex gap-1.5">
                          {([['minor', 'Menor de edad'], ['adult', 'Adulto']] as [Relation, string][]).map(([val, lbl]) => (
                            <button
                              key={val} type="button"
                              onClick={() => setMember(m.uid, { relation: val })}
                              className={`px-2.5 py-1 rounded-lg text-xs font-semibold transition-colors cursor-pointer ${
                                m.relation === val
                                  ? 'bg-blue-600 text-white'
                                  : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-white/10'
                              }`}
                            >{lbl}</button>
                          ))}
                          {m.relation === 'adult' && (
                            <span className="self-center text-[11px] text-slate-400 dark:text-slate-500">— confirmará por sí mismo</span>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>

                <label className="flex items-start gap-2.5 mb-5 cursor-pointer">
                  <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} className="mt-0.5 w-4 h-4 rounded accent-blue-600" />
                  <span className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                    He leído y acepto la{' '}
                    <a href="/privacy" target="_blank" rel="noopener noreferrer" className="text-blue-600 dark:text-blue-400 underline">Política de Privacidad</a>{' '}
                    y autorizo el tratamiento de datos indicado (incluido el reconocimiento facial de los integrantes marcados).
                  </span>
                </label>

                <button
                  onClick={accept}
                  disabled={!ack || saving}
                  className="w-full py-3 rounded-xl bg-blue-600 hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold text-sm transition-colors cursor-pointer"
                >
                  {saving ? 'Registrando…' : 'Aceptar y continuar'}
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default ConsentModal;
