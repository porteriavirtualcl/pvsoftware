import React, { useState, useEffect, useRef } from 'react';
import { db } from '../firebase';
import {
  collection, onSnapshot, query, orderBy, addDoc, getDocs, where, Timestamp,
} from 'firebase/firestore';
import { motion, AnimatePresence } from 'motion/react';
import {
  Megaphone, Send, Users, Building2, User, Search, X,
  CheckCircle2, AlertCircle, ChevronDown,
} from 'lucide-react';
import { Button, Card, PageHeader, Input, Modal, Badge, Spinner, EmptyState } from '../components/ui';
import { cn } from '../lib/utils';
import { sendNotification } from '../lib/utils';
import { useAuth } from '../hooks/useAuth';

// ── Types ─────────────────────────────────────────────────────────────────────

type Audience = 'all' | 'condo' | 'person';

interface Communication {
  id: string;
  title: string;
  body: string;
  audience: Audience;
  condoId?: string | null;
  condoName?: string | null;
  targetUserId?: string | null;
  targetUserName?: string | null;
  sentBy: string;
  sentByName: string;
  sentAt: Timestamp;
  recipientCount: number;
}

interface CondoItem { id: string; name: string; }
interface UserItem  { id: string; displayName?: string; name?: string; email?: string; role?: string; }

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtTs(ts: Timestamp | undefined): string {
  if (!ts) return '';
  const d = ts.toDate();
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit', year: 'numeric' }) +
    ' ' + d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

function userName(u: UserItem) {
  return u.displayName || u.name || u.email || u.id;
}

function audienceLabel(c: Communication) {
  if (c.audience === 'all')    return 'Todos los usuarios';
  if (c.audience === 'condo')  return c.condoName || 'Condominio';
  if (c.audience === 'person') return c.targetUserName || 'Persona';
  return '—';
}

function audienceBadgeVariant(a: Audience): 'danger' | 'warn' | 'info' {
  if (a === 'all')    return 'danger';
  if (a === 'condo')  return 'warn';
  return 'info';
}

// ── Compose Modal ─────────────────────────────────────────────────────────────

function ComposeModal({
  open, onClose, isSuperAdmin, condoId: myCondoId, condoName: myCondoName, uid, displayName,
}: {
  open: boolean;
  onClose: () => void;
  isSuperAdmin: boolean;
  condoId?: string;
  condoName?: string;
  uid: string;
  displayName: string;
}) {
  const [audience, setAudience]       = useState<Audience>('all');
  const [condos, setCondos]           = useState<CondoItem[]>([]);
  const [selectedCondo, setSelectedCondo] = useState<CondoItem | null>(null);
  const [userSearch, setUserSearch]   = useState('');
  const [userResults, setUserResults] = useState<UserItem[]>([]);
  const [selectedUser, setSelectedUser] = useState<UserItem | null>(null);
  const [title, setTitle]             = useState('');
  const [body, setBody]               = useState('');
  const [sending, setSending]         = useState(false);
  const [progress, setProgress]       = useState('');
  const [error, setError]             = useState('');
  const [done, setDone]               = useState(false);
  const [sentCount, setSentCount]     = useState(0);
  const searchRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Load condos when modal opens (super_admin only)
  useEffect(() => {
    if (!open || !isSuperAdmin) return;
    getDocs(collection(db, 'condos')).then(snap =>
      setCondos(snap.docs.map(d => ({ id: d.id, name: d.data().name || d.id })))
    ).catch(() => {});
  }, [open, isSuperAdmin]);

  // For non-super_admin, auto-select their condo
  useEffect(() => {
    if (!open) return;
    if (!isSuperAdmin && myCondoId) {
      setSelectedCondo({ id: myCondoId, name: myCondoName || myCondoId });
    }
  }, [open, isSuperAdmin, myCondoId, myCondoName]);

  // User search with debounce
  useEffect(() => {
    if (audience !== 'person' || userSearch.length < 2) {
      setUserResults([]);
      return;
    }
    if (searchRef.current) clearTimeout(searchRef.current);
    searchRef.current = setTimeout(async () => {
      try {
        const q = isSuperAdmin
          ? query(collection(db, 'users'))
          : query(collection(db, 'users'), where('condoId', '==', myCondoId));
        const snap = await getDocs(q);
        const term = userSearch.toLowerCase();
        const results = snap.docs
          .map(d => ({ id: d.id, ...d.data() } as UserItem))
          .filter(u =>
            (u.displayName || u.name || '').toLowerCase().includes(term) ||
            (u.email || '').toLowerCase().includes(term)
          ).slice(0, 10);
        setUserResults(results);
      } catch { setUserResults([]); }
    }, 350);
  }, [userSearch, audience, isSuperAdmin, myCondoId]);

  const reset = () => {
    setAudience('all'); setSelectedCondo(null); setUserSearch('');
    setSelectedUser(null); setUserResults([]); setTitle(''); setBody('');
    setSending(false); setProgress(''); setError(''); setDone(false); setSentCount(0);
  };

  const handleClose = () => { reset(); onClose(); };

  const handleSend = async () => {
    if (!title.trim())  return setError('El título es requerido.');
    if (!body.trim())   return setError('El mensaje es requerido.');
    if (audience === 'condo' && !selectedCondo) return setError('Selecciona un condominio.');
    if (audience === 'person' && !selectedUser) return setError('Selecciona un destinatario.');

    setSending(true);
    setError('');
    setProgress('Buscando destinatarios…');

    try {
      // 1. Fetch target users
      let targets: UserItem[] = [];
      if (audience === 'all') {
        const snap = await getDocs(collection(db, 'users'));
        targets = snap.docs.map(d => ({ id: d.id, ...d.data() } as UserItem))
          .filter(u => u.role && u.role !== 'usuario');
      } else if (audience === 'condo' && selectedCondo) {
        const snap = await getDocs(
          query(collection(db, 'users'), where('condoId', '==', selectedCondo.id))
        );
        targets = snap.docs.map(d => ({ id: d.id, ...d.data() } as UserItem));
      } else if (audience === 'person' && selectedUser) {
        targets = [selectedUser];
      }

      // 2. Create communication record
      await addDoc(collection(db, 'communications'), {
        title: title.trim(),
        body: body.trim(),
        audience,
        condoId:        audience === 'condo'  ? (selectedCondo?.id  ?? null) : null,
        condoName:      audience === 'condo'  ? (selectedCondo?.name ?? null) : null,
        targetUserId:   audience === 'person' ? (selectedUser?.id    ?? null) : null,
        targetUserName: audience === 'person' ? userName(selectedUser!) : null,
        sentBy:         uid,
        sentByName:     displayName,
        sentAt:         Timestamp.now(),
        recipientCount: targets.length,
      });

      // 3. Send notifications in batches of 20
      const BATCH = 20;
      let sent = 0;
      for (let i = 0; i < targets.length; i += BATCH) {
        const slice = targets.slice(i, i + BATCH);
        await Promise.all(slice.map(u =>
          sendNotification(u.id, title.trim(), body.trim(), 'communication', '/communications')
        ));
        sent += slice.length;
        setProgress(`Enviando… ${sent} / ${targets.length}`);
      }

      setSentCount(targets.length);
      setDone(true);
    } catch {
      setError('Error al enviar. Intenta nuevamente.');
    } finally {
      setSending(false);
      setProgress('');
    }
  };

  return (
    <Modal open={open} onClose={handleClose} title="Nueva Comunicación" icon={Megaphone} size="lg">
      {done ? (
        <div className="flex flex-col items-center gap-4 py-8">
          <div className="w-14 h-14 rounded-2xl bg-emerald-500/10 flex items-center justify-center">
            <CheckCircle2 size={32} className="text-emerald-500" />
          </div>
          <div className="text-center">
            <p className="text-lg font-bold text-slate-900 dark:text-white">¡Enviado!</p>
            <p className="text-sm text-slate-500 dark:text-slate-400 mt-1">
              {sentCount} {sentCount === 1 ? 'notificación enviada' : 'notificaciones enviadas'} correctamente.
            </p>
          </div>
          <Button onClick={handleClose}>Cerrar</Button>
        </div>
      ) : (
        <div className="space-y-6">
          {/* Audience selector */}
          <div>
            <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-3">Destinatarios</p>
            <div className="grid grid-cols-3 gap-3">
              {([
                { key: 'all',    icon: Users,     label: 'Masivo', desc: 'Todos los usuarios', disabled: !isSuperAdmin },
                { key: 'condo',  icon: Building2, label: 'Condominio', desc: 'Usuarios de un condominio', disabled: false },
                { key: 'person', icon: User,      label: 'Persona', desc: 'Usuario específico', disabled: false },
              ] as const).map(({ key, icon: Icon, label, desc, disabled }) => (
                <button
                  key={key}
                  disabled={disabled}
                  onClick={() => { if (!disabled) { setAudience(key); setSelectedUser(null); setUserSearch(''); setUserResults([]); } }}
                  className={cn(
                    'flex flex-col items-center gap-2 p-4 rounded-xl border-2 transition-all cursor-pointer text-center',
                    audience === key && !disabled
                      ? 'border-blue-500 bg-blue-50 dark:bg-blue-600/10'
                      : disabled
                        ? 'border-slate-100 dark:border-white/5 opacity-40 cursor-not-allowed'
                        : 'border-slate-200 dark:border-white/10 hover:border-blue-300 dark:hover:border-blue-500/40',
                  )}
                >
                  <Icon size={20} className={audience === key && !disabled ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'} />
                  <div>
                    <p className={cn('text-xs font-bold', audience === key && !disabled ? 'text-blue-700 dark:text-blue-300' : 'text-slate-700 dark:text-slate-300')}>{label}</p>
                    <p className="text-[10px] text-slate-400 leading-tight mt-0.5">{desc}</p>
                  </div>
                </button>
              ))}
            </div>
            {!isSuperAdmin && (
              <p className="text-[11px] text-slate-400 mt-2 flex items-center gap-1">
                <AlertCircle size={11} /> Solo super admin puede enviar mensajes masivos a todos.
              </p>
            )}
          </div>

          {/* Condo selector */}
          {audience === 'condo' && (
            <div>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Condominio</p>
              {isSuperAdmin ? (
                <div className="relative">
                  <select
                    value={selectedCondo?.id || ''}
                    onChange={e => {
                      const c = condos.find(c => c.id === e.target.value) || null;
                      setSelectedCondo(c);
                    }}
                    className="w-full appearance-none bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-2.5 pr-9 text-sm text-slate-900 dark:text-white outline-none focus:border-blue-500 cursor-pointer"
                  >
                    <option value="">Seleccionar condominio…</option>
                    {condos.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                  <ChevronDown size={14} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 pointer-events-none" />
                </div>
              ) : (
                <div className="flex items-center gap-2 px-4 py-2.5 bg-slate-100 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10">
                  <Building2 size={14} className="text-slate-400 shrink-0" />
                  <span className="text-sm text-slate-700 dark:text-slate-300 font-medium">{myCondoName || myCondoId || '—'}</span>
                </div>
              )}
            </div>
          )}

          {/* Person selector */}
          {audience === 'person' && (
            <div>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Destinatario</p>
              {selectedUser ? (
                <div className="flex items-center gap-3 px-4 py-2.5 bg-blue-50 dark:bg-blue-600/10 rounded-xl border border-blue-200 dark:border-blue-500/30">
                  <div className="w-7 h-7 rounded-full bg-blue-500/20 text-blue-600 dark:text-blue-400 flex items-center justify-center text-xs font-bold shrink-0">
                    {(userName(selectedUser)[0] || '?').toUpperCase()}
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{userName(selectedUser)}</p>
                    <p className="text-xs text-slate-500 truncate">{selectedUser.email}</p>
                  </div>
                  <button onClick={() => setSelectedUser(null)} className="shrink-0 text-slate-400 hover:text-slate-700 dark:hover:text-white cursor-pointer">
                    <X size={14} />
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <Input
                    value={userSearch}
                    onChange={e => setUserSearch(e.target.value)}
                    placeholder="Buscar por nombre o email…"
                    className="pl-9"
                  />
                  {userResults.length > 0 && (
                    <div className="absolute top-full left-0 right-0 mt-1 bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl shadow-xl z-50 overflow-hidden max-h-48 overflow-y-auto">
                      {userResults.map(u => (
                        <button
                          key={u.id}
                          onClick={() => { setSelectedUser(u); setUserSearch(''); setUserResults([]); }}
                          className="w-full flex items-center gap-3 px-4 py-2.5 hover:bg-slate-50 dark:hover:bg-white/5 text-left cursor-pointer transition-colors"
                        >
                          <div className="w-7 h-7 rounded-full bg-slate-200 dark:bg-white/10 flex items-center justify-center text-xs font-bold shrink-0 text-slate-600 dark:text-slate-300">
                            {(userName(u)[0] || '?').toUpperCase()}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-semibold text-slate-900 dark:text-white truncate">{userName(u)}</p>
                            <p className="text-xs text-slate-400 truncate">{u.email}</p>
                          </div>
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Title + Body */}
          <div className="space-y-3">
            <div>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Título</p>
              <Input
                value={title}
                onChange={e => setTitle(e.target.value)}
                placeholder="Asunto del mensaje…"
                maxLength={120}
              />
            </div>
            <div>
              <p className="text-xs font-bold text-slate-500 dark:text-slate-400 uppercase tracking-wider mb-2">Mensaje</p>
              <textarea
                value={body}
                onChange={e => setBody(e.target.value)}
                placeholder="Escribe el contenido del mensaje aquí…"
                rows={5}
                maxLength={1000}
                className="w-full bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 rounded-xl px-4 py-3 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none focus:border-blue-500 resize-none leading-relaxed"
              />
              <p className="text-right text-[11px] text-slate-400 mt-1">{body.length}/1000</p>
            </div>
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-center gap-2 text-sm text-red-500 bg-red-50 dark:bg-red-500/10 px-3 py-2 rounded-lg">
              <AlertCircle size={14} className="shrink-0" />
              {error}
            </div>
          )}

          {/* Footer */}
          <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-white/5">
            <Button variant="secondary" onClick={handleClose} disabled={sending}>Cancelar</Button>
            <Button
              icon={sending ? undefined : Send}
              onClick={handleSend}
              disabled={sending || !title.trim() || !body.trim()}
              loading={sending}
            >
              {sending ? (progress || 'Enviando…') : 'Enviar'}
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ── Main Page ─────────────────────────────────────────────────────────────────

const Communications = () => {
  const { profile } = useAuth();
  const [communications, setCommunications] = useState<Communication[]>([]);
  const [loading, setLoading]   = useState(true);
  const [showCompose, setShowCompose] = useState(false);
  const [filter, setFilter]     = useState<'all' | Audience>('all');

  const isSuperAdmin = profile?.role === 'super_admin';

  useEffect(() => {
    const q = query(collection(db, 'communications'), orderBy('sentAt', 'desc'));
    const unsub = onSnapshot(q, snap => {
      setCommunications(snap.docs.map(d => ({ id: d.id, ...d.data() } as Communication)));
      setLoading(false);
    }, () => setLoading(false));
    return () => unsub();
  }, []);

  const filtered = communications.filter(c => {
    if (filter === 'all')    return true;
    if (filter === 'condo')  return c.audience === 'condo';
    if (filter === 'person') return c.audience === 'person';
    return c.audience === filter;
  });

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="space-y-6">

      <PageHeader
        icon={Megaphone}
        title="Comunicaciones"
        description="Envía mensajes a todos los usuarios, a un condominio o a una persona."
        actions={
          <Button icon={Send} onClick={() => setShowCompose(true)}>
            Nueva Comunicación
          </Button>
        }
      />

      {/* Filter tabs */}
      <div className="flex gap-1 bg-slate-100 dark:bg-white/5 p-1 rounded-xl w-fit">
        {([
          { key: 'all',    label: 'Todas'       },
          { key: 'all' as Audience,    label: 'Masivo',      audienceKey: 'all'    },
          { key: 'condo',  label: 'Condominio'  },
          { key: 'person', label: 'Persona'     },
        ] as { key: string; label: string; audienceKey?: Audience }[]).map(({ key, label }) => (
          <button
            key={key + label}
            onClick={() => setFilter(key === 'all' && label === 'Todas' ? 'all' : key as any)}
            className={cn(
              'px-4 py-1.5 rounded-lg text-xs font-bold transition-all cursor-pointer',
              filter === key
                ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
            )}
          >{label}</button>
        ))}
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex justify-center py-20"><Spinner size={40} /></div>
      ) : filtered.length === 0 ? (
        <EmptyState
          icon={Megaphone}
          title="Sin comunicaciones"
          description={filter === 'all' ? 'Aún no se han enviado comunicaciones.' : 'No hay comunicaciones con este filtro.'}
        />
      ) : (
        <div className="space-y-3">
          {filtered.map(comm => (
            <Card key={comm.id} variant="glass" padding="md">
              <div className="flex items-start gap-4">
                {/* Icon */}
                <div className={cn(
                  'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                  comm.audience === 'all'    ? 'bg-red-500/10 text-red-500'
                  : comm.audience === 'condo'  ? 'bg-amber-500/10 text-amber-500'
                  : 'bg-blue-500/10 text-blue-500',
                )}>
                  {comm.audience === 'all'    ? <Users size={18} />
                  : comm.audience === 'condo'  ? <Building2 size={18} />
                  : <User size={18} />}
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-3 flex-wrap">
                    <div className="flex items-center gap-2 flex-wrap">
                      <Badge variant={audienceBadgeVariant(comm.audience)} className="text-[10px]">
                        {comm.audience === 'all' ? 'Masivo' : comm.audience === 'condo' ? 'Condominio' : 'Persona'}
                      </Badge>
                      <span className="text-[11px] text-slate-400">{audienceLabel(comm)}</span>
                    </div>
                    <span className="text-[11px] text-slate-400 shrink-0">{fmtTs(comm.sentAt)}</span>
                  </div>

                  <h3 className="text-sm font-bold text-slate-900 dark:text-white mt-2">{comm.title}</h3>
                  <p className="text-sm text-slate-600 dark:text-slate-300 mt-1 leading-relaxed line-clamp-3">{comm.body}</p>

                  <div className="flex items-center gap-4 mt-3 text-[11px] text-slate-400 flex-wrap">
                    <span className="flex items-center gap-1">
                      <User size={10} /> {comm.sentByName}
                    </span>
                    <span className="flex items-center gap-1">
                      <Users size={10} />
                      {comm.recipientCount} {comm.recipientCount === 1 ? 'destinatario' : 'destinatarios'}
                    </span>
                  </div>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      <ComposeModal
        open={showCompose}
        onClose={() => setShowCompose(false)}
        isSuperAdmin={isSuperAdmin}
        condoId={profile?.condoId}
        condoName={profile?.condoName}
        uid={profile?.uid || ''}
        displayName={profile?.displayName || profile?.name || profile?.email || ''}
      />
    </motion.div>
  );
};

export default Communications;
