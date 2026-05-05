import React, { useState, useEffect, useRef, useCallback } from 'react';
import { db } from '../firebase';
import {
  collection, onSnapshot, orderBy, query, where,
  Timestamp, doc,
} from 'firebase/firestore';
import { motion } from 'motion/react';
import {
  MessageCircle, Send, Search, User, Phone, ChevronDown,
  Wifi, WifiOff, RefreshCw, AlertCircle, Loader2,
} from 'lucide-react';
import { Button, Card, PageHeader, Input, Spinner, Badge } from '../components/ui';
import { api } from '../lib/apiBase';
import { useAuth } from '../hooks/useAuth';
import { cn } from '../lib/utils';

// ── types ─────────────────────────────────────────────────────────────────────

interface WaNumber {
  id: string;
  name: string;
  phone: string;
  status: 'disconnected' | 'connecting' | 'qr' | 'authenticated' | 'ready';
  assignedUsers?: { uid: string; name: string }[];
}

interface Conversation {
  id: string;
  waNumberId: string;
  contactPhone: string;
  contactName: string;
  lastMessage: string;
  lastMessageAt: Timestamp;
  unreadCount: number;
}

interface Message {
  id: string;
  body: string;
  fromMe: boolean;
  senderUserId?: string | null;
  senderName?: string | null;
  timestamp: Timestamp;
}

// ── helpers ───────────────────────────────────────────────────────────────────

function fmtTs(ts: Timestamp | undefined): string {
  if (!ts) return '';
  const d = ts.toDate();
  const now = new Date();
  const isToday = d.toDateString() === now.toDateString();
  if (isToday) return d.toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
  return d.toLocaleDateString('es-CL', { day: '2-digit', month: '2-digit' });
}

function fmtMsgTs(ts: Timestamp | undefined): string {
  if (!ts) return '';
  return ts.toDate().toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
}

function initials(name: string): string {
  return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) || '?';
}

// ── component ─────────────────────────────────────────────────────────────────

const WhatsAppChat: React.FC = () => {
  const { user, profile } = useAuth();

  const [waNumbers, setWaNumbers]     = useState<WaNumber[]>([]);
  const [selectedNum, setSelectedNum] = useState<string>('all');
  const [conversations, setConvs]     = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages]       = useState<Message[]>([]);
  const [search, setSearch]           = useState('');
  const [messageText, setMessageText] = useState('');
  const [sending, setSending]         = useState(false);
  const [sendError, setSendError]     = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  // ── Firestore: WA numbers ───────────────────────────────────────────────
  useEffect(() => {
    const q = query(collection(db, 'waNumbers'), orderBy('createdAt'));
    const unsub = onSnapshot(q, snap => {
      const nums = snap.docs.map(d => ({ id: d.id, ...d.data() } as WaNumber));
      setWaNumbers(nums);

      // Auto-select: operators see only their assigned number(s)
      if (profile?.role === 'operator' || profile?.role === 'administrador') {
        const assigned = nums.find(n => n.assignedUsers?.some(u => u.uid === user?.uid));
        if (assigned) setSelectedNum(assigned.id);
      }
    });
    return () => unsub();
  }, [user?.uid, profile?.role]);

  // ── Firestore: conversations ────────────────────────────────────────────
  useEffect(() => {
    let q = query(collection(db, 'waConversations'), orderBy('lastMessageAt', 'desc'));
    if (selectedNum !== 'all') {
      q = query(
        collection(db, 'waConversations'),
        where('waNumberId', '==', selectedNum),
        orderBy('lastMessageAt', 'desc'),
      );
    }
    const unsub = onSnapshot(q, snap => {
      setConvs(snap.docs.map(d => ({ id: d.id, ...d.data() } as Conversation)));
    });
    return () => unsub();
  }, [selectedNum]);

  // ── Firestore: messages for active conversation ─────────────────────────
  useEffect(() => {
    if (!activeConvId) { setMessages([]); return; }
    const q = query(
      collection(db, 'waConversations', activeConvId, 'messages'),
      orderBy('timestamp'),
    );
    const unsub = onSnapshot(q, snap => {
      setMessages(snap.docs.map(d => ({ id: d.id, ...d.data() } as Message)));
    });
    // Mark as read
    fetch(api(`/api/wa/conversations/${activeConvId}/read`), { method: 'POST' }).catch(() => {});
    return () => unsub();
  }, [activeConvId]);

  // Auto-scroll on new messages
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Send message ─────────────────────────────────────────────────────────
  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!messageText.trim() || !activeConvId || sending) return;
    setSending(true);
    setSendError(null);
    try {
      const res = await fetch(api(`/api/wa/conversations/${activeConvId}/send`), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body: messageText.trim(),
          senderUserId: user?.uid || null,
          senderName: profile?.name || user?.email || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al enviar');
      setMessageText('');
    } catch (err: any) {
      setSendError(err.message);
    } finally {
      setSending(false);
    }
  };

  // ── Derived ──────────────────────────────────────────────────────────────
  const filteredConvs = conversations.filter(c =>
    !c.contactPhone.includes('broadcast') &&
    (
      !search ||
      c.contactName.toLowerCase().includes(search.toLowerCase()) ||
      c.contactPhone.includes(search)
    ),
  );

  const activeConv = conversations.find(c => c.id === activeConvId);
  const activeNumber = waNumbers.find(n => n.id === activeConv?.waNumberId);
  const isReady = activeNumber?.status === 'ready';

  const isSuperAdmin = profile?.role === 'super_admin' || profile?.role === 'condo_admin';

  // ── Layout ────────────────────────────────────────────────────────────────

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} className="flex flex-col h-[calc(100vh-7rem)]">
      <PageHeader
        icon={MessageCircle}
        title="Conversaciones WhatsApp"
        description="Historial de mensajes de todos los números conectados."
      />

      <div className="flex gap-0 flex-1 min-h-0 mt-4 rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 bg-white dark:bg-slate-900/60 shadow-sm">

        {/* ── Left: conversation list ── */}
        <div className="w-80 shrink-0 flex flex-col border-r border-slate-200 dark:border-white/10">

          {/* Filters */}
          <div className="p-3 border-b border-slate-100 dark:border-white/5 space-y-2">
            {isSuperAdmin && (
              <select
                value={selectedNum}
                onChange={e => { setSelectedNum(e.target.value); setActiveConvId(null); }}
                className="w-full text-xs rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-700 dark:text-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              >
                <option value="all">Todos los números</option>
                {waNumbers.map(n => (
                  <option key={n.id} value={n.id}>
                    {n.name}{n.phone ? ` (${n.phone})` : ''} — {n.status === 'ready' ? '🟢' : '🔴'}
                  </option>
                ))}
              </select>
            )}
            <div className="relative">
              <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                value={search}
                onChange={e => setSearch(e.target.value)}
                placeholder="Buscar contacto…"
                className="w-full text-sm pl-8 pr-3 py-2 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30"
              />
            </div>
          </div>

          {/* Conversation list */}
          <div className="flex-1 overflow-y-auto">
            {filteredConvs.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-full py-10 text-center px-4">
                <MessageCircle size={32} className="text-slate-300 dark:text-slate-600 mb-2" />
                <p className="text-sm text-slate-500 dark:text-slate-400">Sin conversaciones</p>
              </div>
            ) : (
              filteredConvs.map(conv => {
                const num = waNumbers.find(n => n.id === conv.waNumberId);
                const isActive = activeConvId === conv.id;
                return (
                  <button
                    key={conv.id}
                    onClick={() => setActiveConvId(conv.id)}
                    className={cn(
                      'w-full flex items-start gap-3 px-3 py-3 text-left transition-colors border-b border-slate-50 dark:border-white/[0.03] cursor-pointer',
                      isActive
                        ? 'bg-blue-50 dark:bg-blue-600/10'
                        : 'hover:bg-slate-50 dark:hover:bg-white/[0.02]',
                    )}
                  >
                    {/* Avatar */}
                    <div className="w-9 h-9 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-xs font-bold shrink-0">
                      {initials(conv.contactName)}
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center justify-between gap-1">
                        <p className={cn('text-sm font-semibold truncate',
                          isActive ? 'text-blue-700 dark:text-blue-300' : 'text-slate-900 dark:text-white')}>
                          {conv.contactName}
                        </p>
                        <span className="text-[10px] text-slate-400 shrink-0">{fmtTs(conv.lastMessageAt)}</span>
                      </div>
                      <p className="text-xs text-slate-500 dark:text-slate-400 truncate">{conv.lastMessage}</p>
                      {isSuperAdmin && num && (
                        <p className="text-[10px] text-slate-400 truncate mt-0.5">{num.name}</p>
                      )}
                    </div>
                    {conv.unreadCount > 0 && (
                      <span className="w-5 h-5 rounded-full bg-emerald-500 text-white text-[10px] font-bold flex items-center justify-center shrink-0">
                        {conv.unreadCount > 9 ? '9+' : conv.unreadCount}
                      </span>
                    )}
                  </button>
                );
              })
            )}
          </div>
        </div>

        {/* ── Right: message thread ── */}
        <div className="flex-1 flex flex-col min-w-0">
          {!activeConv ? (
            <div className="flex flex-col items-center justify-center h-full text-center px-8">
              <MessageCircle size={48} className="text-slate-200 dark:text-slate-700 mb-3" />
              <p className="font-semibold text-slate-500 dark:text-slate-400">Selecciona una conversación</p>
              <p className="text-sm text-slate-400 dark:text-slate-500 mt-1">Elige un chat de la lista para leer y responder.</p>
            </div>
          ) : (
            <>
              {/* Chat header */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-slate-100 dark:border-white/5 bg-white dark:bg-slate-900/40">
                <div className="w-9 h-9 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 flex items-center justify-center text-sm font-bold shrink-0">
                  {initials(activeConv.contactName)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="font-semibold text-slate-900 dark:text-white truncate">{activeConv.contactName}</p>
                  <p className="text-xs text-slate-500 dark:text-slate-400 flex items-center gap-1">
                    <Phone size={10} />{activeConv.contactPhone}
                    {activeNumber && (
                      <span className="ml-2 opacity-70">· {activeNumber.name}</span>
                    )}
                  </p>
                </div>
                {activeNumber && (
                  <div className="shrink-0">
                    {activeNumber.status === 'ready'
                      ? <Badge variant="success"><Wifi size={11} />Conectado</Badge>
                      : <Badge variant="muted"><WifiOff size={11} />Desconectado</Badge>
                    }
                  </div>
                )}
              </div>

              {/* Messages */}
              <div className="flex-1 overflow-y-auto px-4 py-4 space-y-2">
                {messages.map((msg, i) => {
                  const isMe = msg.fromMe;
                  const showDate = i === 0 || (
                    messages[i - 1].timestamp?.toDate().toDateString() !==
                    msg.timestamp?.toDate().toDateString()
                  );
                  return (
                    <React.Fragment key={msg.id}>
                      {showDate && (
                        <div className="flex items-center justify-center my-3">
                          <span className="text-[10px] text-slate-400 dark:text-slate-500 bg-slate-100 dark:bg-white/5 px-3 py-1 rounded-full">
                            {msg.timestamp?.toDate().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
                          </span>
                        </div>
                      )}
                      <div className={cn('flex', isMe ? 'justify-end' : 'justify-start')}>
                        <div className={cn(
                          'max-w-[72%] rounded-2xl px-3.5 py-2 text-sm shadow-sm',
                          isMe
                            ? 'bg-emerald-500 text-white rounded-br-md'
                            : 'bg-white dark:bg-white/10 text-slate-900 dark:text-white border border-slate-100 dark:border-white/5 rounded-bl-md',
                        )}>
                          {/* Sender attribution (only for outgoing msgs from operators) */}
                          {isMe && msg.senderName && (
                            <p className="text-[10px] font-semibold text-emerald-100 mb-0.5">{msg.senderName}</p>
                          )}
                          <p className="leading-relaxed whitespace-pre-wrap break-words">{msg.body}</p>
                          <p className={cn('text-[10px] mt-1 text-right',
                            isMe ? 'text-emerald-100/80' : 'text-slate-400 dark:text-slate-500')}>
                            {fmtMsgTs(msg.timestamp)}
                          </p>
                        </div>
                      </div>
                    </React.Fragment>
                  );
                })}
                <div ref={bottomRef} />
              </div>

              {/* Send input */}
              <div className="px-4 py-3 border-t border-slate-100 dark:border-white/5">
                {!isReady && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 mb-2 flex items-center gap-1.5">
                    <AlertCircle size={12} />
                    El número "{activeNumber?.name}" está desconectado. Conéctalo en Números de WhatsApp para enviar mensajes.
                  </p>
                )}
                {sendError && (
                  <p className="text-xs text-red-500 mb-2">{sendError}</p>
                )}
                <form onSubmit={handleSend} className="flex items-end gap-2">
                  <textarea
                    value={messageText}
                    onChange={e => setMessageText(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(e as any); }
                    }}
                    placeholder={isReady ? 'Escribe un mensaje…' : 'WhatsApp desconectado'}
                    disabled={!isReady || sending}
                    rows={1}
                    className="flex-1 resize-none rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/5 text-slate-900 dark:text-white placeholder-slate-400 px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-50 max-h-32"
                    style={{ minHeight: 42 }}
                  />
                  <Button
                    type="submit"
                    disabled={!messageText.trim() || !isReady || sending}
                    loading={sending}
                    icon={Send}
                    className="shrink-0 bg-emerald-600 hover:bg-emerald-700 text-white border-0"
                    aria-label="Enviar"
                  >
                    Enviar
                  </Button>
                </form>
              </div>
            </>
          )}
        </div>
      </div>
    </motion.div>
  );
};

export default WhatsAppChat;
