import React, { useState, useEffect } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, orderBy, updateDoc, doc, limit } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import { Bell, X, Check, Circle, ShieldAlert, CreditCard, Calendar, Info } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { NotificationType } from '../lib/utils';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: NotificationType;
  read: boolean;
  createdAt: any;
}

const NotificationCenter = () => {
  const { user } = useAuth();
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
    });

    return () => unsubscribe();
  }, [user]);

  const markAsRead = async (id: string) => {
    try {
      await updateDoc(doc(db, 'notifications', id), { read: true });
    } catch (error) {
      console.error("Error marking notification as read:", error);
    }
  };

  const getIcon = (type: NotificationType) => {
    switch (type) {
      case 'incident': return <ShieldAlert size={16} className="text-red-400" />;
      case 'expense': return <CreditCard size={16} className="text-green-400" />;
      case 'reservation': return <Calendar size={16} className="text-blue-400" />;
      default: return <Info size={16} className="text-gray-400" />;
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="relative p-2 text-gray-400 hover:text-white bg-white/5 rounded-2xl transition-all active:scale-90"
      >
        <Bell size={22} />
        {unreadCount > 0 && (
          <span className="absolute top-1.5 right-1.5 w-5 h-5 bg-red-600 text-white text-base font-black rounded-full flex items-center justify-center border-2 border-gray-900 shadow-lg">
            {unreadCount > 9 ? '+9' : unreadCount}
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
              className="absolute right-0 mt-4 w-80 sm:w-96 glass-card rounded-[2rem] shadow-[0_20px_50px_rgba(0,0,0,0.5)] z-[90] overflow-hidden"
            >
              <div className="p-6 border-b border-white/5 flex items-center justify-between">
                <h3 className="text-lg font-black text-white px-2">Notificaciones</h3>
                <button onClick={() => setIsOpen(false)} className="text-gray-500 hover:text-white">
                  <X size={20} />
                </button>
              </div>

              <div className="max-h-[400px] overflow-y-auto no-scrollbar">
                {notifications.length === 0 ? (
                  <div className="p-10 text-center space-y-3">
                    <div className="w-12 h-12 bg-gray-800 rounded-full flex items-center justify-center mx-auto text-gray-600">
                      <Bell size={24} />
                    </div>
                    <p className="text-base font-bold text-gray-500 uppercase tracking-widest">Sin notificaciones</p>
                  </div>
                ) : (
                  <div className="divide-y divide-white/5">
                    {notifications.map((n) => (
                      <div
                        key={n.id}
                        className={`p-5 flex gap-4 transition-colors hover:bg-white/5 group ${!n.read ? 'bg-blue-600/[0.03]' : ''}`}
                        onClick={() => !n.read && markAsRead(n.id)}
                      >
                        <div className="mt-1 shrink-0">
                          {getIcon(n.type)}
                        </div>
                        <div className="flex-1 space-y-1">
                          <div className="flex items-center justify-between">
                            <h4 className={`text-base font-black ${!n.read ? 'text-white' : 'text-gray-400'}`}>{n.title}</h4>
                            {!n.read && <div className="w-2 h-2 bg-blue-500 rounded-full shadow-[0_0_8px_rgba(59,130,246,0.5)]" />}
                          </div>
                          <p className={`text-base leading-relaxed ${!n.read ? 'text-gray-300 font-medium' : 'text-gray-500'}`}>
                            {n.message}
                          </p>
                          <p className="text-base font-black text-gray-600 uppercase tracking-widest pt-2">
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
                   className="w-full py-4 text-base font-black text-blue-500 uppercase tracking-[0.2em] hover:bg-white/5 transition-colors border-t border-white/5"
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
