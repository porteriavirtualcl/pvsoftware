import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, limit } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { Bell, X, Check, Circle, ShieldAlert, CreditCard, Calendar, Info, QrCode, Package } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { NotificationType } from '../lib/utils';
import { setAppBadge } from '../lib/badge';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  read: boolean;
  createdAt: any;
  link?: string | null;
}

const NotificationCenter = () => {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const unreadCount = notifications.filter(n => !n.read).length;

  useEffect(() => {
    if (!user) return;

    const q = query(
      collection(db, 'notifications'),
      where('userId', '==', user.uid),
      orderBy('createdAt', 'desc'),
      limit(20)
    );

    const unsubscribe = onSnapshot(q, (snapshot) => {
      const data = snapshot.docs.map(doc => ({
        id: doc.id,
        ...doc.data()
      })) as Notification[];
      setNotifications(data);
    }, (error) => {
      console.warn("Notifications listener error (likely index building):", error.message);
    });

    return () => unsubscribe();
  }, [user]);

  // Keep app-icon badge in sync with unread count
  useEffect(() => { setAppBadge(unreadCount); }, [unreadCount]);

  const markAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  };

  const getIcon = (type: NotificationType) => {
    switch (type) {
      case 'incident':    return <ShieldAlert size={16} className="text-red-400" />;
      case 'expense':     return <CreditCard size={16} className="text-green-400" />;
      case 'reservation': return <Calendar size={16} className="text-blue-400" />;
      case 'visitor':     return <QrCode size={16} className="text-purple-400" />;
      case 'info':        return <Package size={16} className="text-amber-400" />;
      default:            return <Info size={16} className="text-gray-400" />;
    }
  };

  // Default route per type if no explicit link is stored
  const getDefaultLink = (type: NotificationType): string => {
    switch (type) {
      case 'incident':    return '/incidents';
      case 'expense':     return '/expenses';
      case 'reservation': return '/facilities';
      case 'visitor':     return '/visitors';
      case 'info':        return '/parcels';
      default:            return '/';
    }
  };

  const handleNotificationClick = async (n: Notification) => {
    if (!n.read) await markAsRead(n.id);
    const target = n.link || getDefaultLink(n.type);
    setIsOpen(false);
    navigate(target);
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-400 hover:text-white bg-white/5 rounded-2xl transition-all active:scale-90"
      >
        <Bell size={22} />
        {unreadCount > 0 && (
          <span className="absolute top-1 right-1 w-4 h-4 bg-red-500 text-white text-[10px] font-black rounded-full flex items-center justify-center border border-gray-900 shadow">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => setIsOpen(false)}
              className="fixed inset-0 z-[80]"
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 10 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 10 }}
              className="absolute right-0 mt-2 w-80 max-w-[calc(100vw-1rem)] bg-white dark:bg-slate-900 border border-slate-200 dark:border-white/10 backdrop-blur-xl rounded-2xl shadow-xl dark:shadow-[0_20px_50px_rgba(0,0,0,0.6)] z-[90] overflow-hidden"
            >
              <div className="px-4 py-3 border-b border-slate-100 dark:border-white/5 flex items-center justify-between">
                <h3 className="text-sm font-bold text-slate-900 dark:text-white">Notificaciones</h3>
                <button onClick={() => setIsOpen(false)} className="p-1 text-slate-400 dark:text-slate-500 hover:text-slate-900 dark:hover:text-white rounded-lg hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer">
                  <X size={16} />
                </button>
              </div>

              <div className="max-h-[360px] overflow-y-auto no-scrollbar">
                {notifications.length === 0 ? (
                  <div className="py-10 px-6 text-center space-y-2">
                    <div className="w-10 h-10 bg-slate-100 dark:bg-white/5 rounded-xl flex items-center justify-center mx-auto text-slate-400 dark:text-slate-600">
                      <Bell size={18} />
                    </div>
                    <p className="text-xs font-semibold text-slate-400 dark:text-slate-500">Sin notificaciones</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-100 dark:divide-white/5">
                    {notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`px-4 py-3 flex gap-3 transition-colors cursor-pointer hover:bg-slate-50 dark:hover:bg-white/5 ${!n.read ? 'bg-blue-50/50 dark:bg-blue-600/[0.05]' : ''}`}
                        onClick={() => handleNotificationClick(n)}
                      >
                        <div className="mt-0.5 shrink-0 w-7 h-7 rounded-lg bg-slate-100 dark:bg-white/5 flex items-center justify-center">
                          {getIcon(n.type)}
                        </div>
                        <div className="flex-1 min-w-0 space-y-0.5">
                          <div className="flex items-center justify-between gap-2">
                            <h4 className={`text-[13px] font-semibold leading-snug truncate ${!n.read ? 'text-slate-900 dark:text-white' : 'text-slate-500 dark:text-slate-400'}`}>{n.title}</h4>
                            {!n.read && <div className="w-2 h-2 bg-blue-500 rounded-full shrink-0" />}
                          </div>
                          <p className={`text-xs leading-relaxed ${!n.read ? 'text-slate-600 dark:text-slate-300' : 'text-slate-400 dark:text-slate-500'}`}>
                            {n.message}
                          </p>
                          <p className="text-[11px] text-slate-400 dark:text-slate-600 pt-0.5">
                            {n.createdAt?.toDate().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                          </p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {unreadCount > 0 && (
                <button
                  onClick={() => notifications.forEach(n => !n.read && markAsRead(n.id))}
                  className="w-full py-3 text-xs font-semibold text-blue-600 dark:text-blue-400 uppercase tracking-wider hover:bg-slate-50 dark:hover:bg-white/5 transition-colors border-t border-slate-100 dark:border-white/5 cursor-pointer"
                >
                  Marcar todo como leído
                </button>
              )}
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};

export default NotificationCenter;
