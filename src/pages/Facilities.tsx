import React, { useState, useEffect, useMemo } from 'react';
import { db } from '../firebase';
import { collection, query, where, onSnapshot, addDoc, updateDoc, doc, deleteDoc, Timestamp, orderBy, collectionGroup } from 'firebase/firestore';
import { useAuth } from '../hooks/useAuth';
import {
  Package,
  Plus,
  MapPin,
  Users,
  Edit2,
  Trash2,
  X,
  Calendar,
  CreditCard,
  Clock,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Download,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { handleFirestoreError, OperationType, sendNotification } from '../lib/utils';

interface Facility {
  id: string;
  name: string;
  description: string;
  capacity: number;
  status: 'active' | 'maintenance' | 'inactive';
  location: string;
  price?: string;
  condoId: string;
  condoName: string;
  rules?: string;
  // Schedule config
  openTime?: string;           // "HH:MM"
  closeTime?: string;          // "HH:MM"
  slotDurationMinutes?: number;
  availableDays?: number[];    // 0=Sun, 1=Mon … 6=Sat
  createdAt: any;
  updatedAt: any;
}

interface Reservation {
  id: string;
  userId: string;
  userName: string;
  facilityId: string;
  facilityName: string;
  date: string;       // "YYYY-MM-DD"
  startTime: string;  // "HH:MM"
  endTime: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  condoId: string;
  condoName?: string;
  unit?: string;
  createdAt: any;
}

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

// ─── calendar helpers ──────────────────────────────────────────────────────────

function fmtDT(date: string, time: string) {
  return `${date.replace(/-/g, '')}T${time.replace(':', '')}00`;
}

function getGoogleCalendarUrl(facilityName: string, location: string, date: string, start: string, end: string) {
  const params = new URLSearchParams({
    action: 'TEMPLATE',
    text: `Reserva ${facilityName}`,
    dates: `${fmtDT(date, start)}/${fmtDT(date, end)}`,
    details: 'Reserva confirmada en Portería Virtual',
    location,
  });
  return `https://calendar.google.com/calendar/render?${params.toString()}`;
}

function downloadICS(facilityName: string, location: string, date: string, start: string, end: string) {
  const ics = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Portería Virtual//ES',
    'BEGIN:VEVENT',
    `DTSTART:${fmtDT(date, start)}`,
    `DTEND:${fmtDT(date, end)}`,
    `SUMMARY:Reserva ${facilityName}`,
    `LOCATION:${location}`,
    'DESCRIPTION:Reserva confirmada en Portería Virtual',
    'STATUS:TENTATIVE',
    'END:VEVENT',
    'END:VCALENDAR',
  ].join('\r\n');
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `reserva-${facilityName.toLowerCase().replace(/\s+/g, '-')}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}

function generateSlots(openTime: string, closeTime: string, durationMin: number) {
  const [oh, om] = openTime.split(':').map(Number);
  const [ch, cm] = closeTime.split(':').map(Number);
  const openMins = oh * 60 + om;
  const closeMins = ch * 60 + cm;
  const slots: { start: string; end: string }[] = [];
  for (let t = openMins; t + durationMin <= closeMins; t += durationMin) {
    const sH = Math.floor(t / 60).toString().padStart(2, '0');
    const sM = (t % 60).toString().padStart(2, '0');
    const eH = Math.floor((t + durationMin) / 60).toString().padStart(2, '0');
    const eM = ((t + durationMin) % 60).toString().padStart(2, '0');
    slots.push({ start: `${sH}:${sM}`, end: `${eH}:${eM}` });
  }
  return slots;
}

function toDateInputValue(d: Date) {
  return d.toISOString().slice(0, 10);
}

const Facilities = () => {
  const { profile, user } = useAuth();
  const [facilities, setFacilities] = useState<Facility[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [condos, setCondos] = useState<{ id: string; name: string }[]>([]);
  const [filterCondo, setFilterCondo] = useState('');

  const blankForm = {
    name: '',
    description: '',
    capacity: 0,
    status: 'active' as Facility['status'],
    location: '',
    price: '',
    condoId: profile?.condoId || '',
    rules: '',
    openTime: '08:00',
    closeTime: '22:00',
    slotDurationMinutes: 60,
    availableDays: [1, 2, 3, 4, 5, 6] as number[],
  };

  const [formData, setFormData] = useState(blankForm);
  const [editingFacility, setEditingFacility] = useState<Facility | null>(null);
  const [deletingFacility, setDeletingFacility] = useState<Facility | null>(null);

  // ── Booking state ─────────────────────────────────────────────────────────
  const [bookingFacility, setBookingFacility] = useState<Facility | null>(null);
  const [bookingDate, setBookingDate] = useState(toDateInputValue(new Date()));
  const [bookingSlot, setBookingSlot] = useState<{ start: string; end: string } | null>(null);
  const [facilityReservations, setFacilityReservations] = useState<Reservation[]>([]);
  const [savingBooking, setSavingBooking] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [bookingResult, setBookingResult] = useState<{
    facilityName: string; location: string;
    date: string; startTime: string; endTime: string;
  } | null>(null);

  useEffect(() => {
    const condosUnsub = onSnapshot(collection(db, 'condos'), (snap) => {
      setCondos(snap.docs.map((d) => ({ id: d.id, name: d.data().name })));
    });

    if (!profile || !user) return () => condosUnsub();

    const isGlobal = profile.role === 'super_admin' || profile.condoScope === 'all';
    const q = isGlobal
      ? query(collectionGroup(db, 'facilities'))  // no orderBy → no index needed; sort client-side
      : query(collection(db, `condos/${profile.condoId || 'default'}/facilities`), orderBy('createdAt', 'desc'));

    const unsub = onSnapshot(q, (snap) => {
      const list = snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Facility[];
      if (isGlobal) {
        list.sort((a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0));
      }
      setFacilities(list);
      setLoading(false);
    }, (error) => {
      setLoading(false);
      handleFirestoreError(error, OperationType.LIST, 'facilities');
    });

    return () => { unsub(); condosUnsub(); };
  }, [profile, user]);

  // Listen to reservations for the facility being booked
  useEffect(() => {
    if (!bookingFacility) { setFacilityReservations([]); return; }
    const path = `condos/${bookingFacility.condoId}/reservations`;
    const q = query(collection(db, path), where('facilityId', '==', bookingFacility.id));
    const unsub = onSnapshot(q, (snap) => {
      setFacilityReservations(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Reservation[]);
    });
    return () => unsub();
  }, [bookingFacility]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;
    const selectedCondo = condos.find((c) => c.id === formData.condoId);
    const condoIdToUse = formData.condoId || profile.condoId || 'default';
    const path = `condos/${condoIdToUse}/facilities`;
    try {
      const dataToSave = {
        ...formData,
        capacity: Number(formData.capacity),
        slotDurationMinutes: Number(formData.slotDurationMinutes),
        condoName: selectedCondo?.name || profile.condoName || 'Condominio',
        updatedAt: Timestamp.now(),
      };
      if (editingFacility) {
        await updateDoc(doc(db, path, editingFacility.id), dataToSave);
      } else {
        await addDoc(collection(db, path), { ...dataToSave, createdAt: Timestamp.now() });
      }
      setShowAddModal(false);
      setEditingFacility(null);
      setFormData(blankForm);
    } catch (error) {
      handleFirestoreError(error, editingFacility ? OperationType.UPDATE : OperationType.CREATE, path);
    }
  };

  const handleDelete = async () => {
    if (!deletingFacility) return;
    const path = `condos/${deletingFacility.condoId}/facilities`;
    try {
      await deleteDoc(doc(db, path, deletingFacility.id));
      setDeletingFacility(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    }
  };

  const handleBook = async () => {
    if (!bookingFacility || !bookingDate || !bookingSlot || !profile || !user) return;
    setSavingBooking(true);
    const path = `condos/${bookingFacility.condoId}/reservations`;
    try {
      await addDoc(collection(db, path), {
        userId: user.uid,
        userName: profile.name || user.email || 'Usuario',
        facilityId: bookingFacility.id,
        facilityName: bookingFacility.name,
        date: bookingDate,
        startTime: bookingSlot.start,
        endTime: bookingSlot.end,
        status: 'approved',
        condoId: bookingFacility.condoId,
        condoName: bookingFacility.condoName,
        unit: profile.unit || '',
        createdAt: Timestamp.now(),
      });

      // Notify the resident
      sendNotification(
        user.uid,
        'Reserva Confirmada',
        `Tu reserva de ${bookingFacility.name} el ${bookingDate} de ${bookingSlot.start} a ${bookingSlot.end} ha sido confirmada.`,
        'reservation'
      );

      setBookingResult({
        facilityName: bookingFacility.name,
        location: `${bookingFacility.location} · ${bookingFacility.condoName}`,
        date: bookingDate,
        startTime: bookingSlot.start,
        endTime: bookingSlot.end,
      });
      setBookingSuccess(true);
      setBookingSlot(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    } finally {
      setSavingBooking(false);
    }
  };

  // Slots & taken logic
  const slots = useMemo(() => {
    if (!bookingFacility?.openTime || !bookingFacility?.closeTime || !bookingFacility?.slotDurationMinutes) return [];
    return generateSlots(bookingFacility.openTime, bookingFacility.closeTime, bookingFacility.slotDurationMinutes);
  }, [bookingFacility]);

  const takenSlots = useMemo(() => {
    return new Set(
      facilityReservations
        .filter((r) => r.date === bookingDate && r.status !== 'cancelled' && r.status !== 'rejected')
        .map((r) => r.startTime)
    );
  }, [facilityReservations, bookingDate]);

  const selectedDayOfWeek = useMemo(() => {
    if (!bookingDate) return -1;
    return new Date(bookingDate + 'T12:00:00').getDay();
  }, [bookingDate]);

  const isDayAvailable = useMemo(() => {
    if (!bookingFacility?.availableDays) return true;
    return bookingFacility.availableDays.includes(selectedDayOfWeek);
  }, [bookingFacility, selectedDayOfWeek]);

  const filteredFacilities = filterCondo ? facilities.filter(f => f.condoId === filterCondo) : facilities;

  const toggleDay = (day: number) => {
    setFormData((prev) => ({
      ...prev,
      availableDays: prev.availableDays.includes(day)
        ? prev.availableDays.filter((d) => d !== day)
        : [...prev.availableDays, day].sort((a, b) => a - b),
    }));
  };

  if (loading && !facilities.length)
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="animate-spin rounded-full h-12 w-12 border-t-2 border-b-2 border-blue-500" />
      </div>
    );

  return (
    <div className="space-y-10">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-6 bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 p-10 rounded-[2.5rem] shadow-sm dark:shadow-none">
        <div className="flex items-center gap-5">
          <div className="w-16 h-16 bg-blue-600/10 rounded-3xl flex items-center justify-center text-blue-500 border border-blue-500/20 shadow-xl shadow-blue-600/10">
            <Package size={36} />
          </div>
          <div>
            <h2 className="text-4xl font-black text-slate-900 dark:text-white italic uppercase tracking-tight">Espacios Comunes</h2>
            <p className="text-slate-500 dark:text-gray-500 font-medium">Gestión de quinchos, piscinas, salones y amenidades.</p>
          </div>
        </div>
        {profile?.role !== 'resident' && (
          <button
            onClick={() => { setEditingFacility(null); setFormData(blankForm); setShowAddModal(true); }}
            className="bg-blue-600 hover:bg-blue-500 text-white font-black py-4 px-8 rounded-2xl transition-all shadow-2xl flex items-center gap-3 text-lg"
          >
            <Plus size={24} /> Nueva Instalación
          </button>
        )}
      </div>

      {/* Condo filter — super_admin only */}
      {(profile?.role === 'super_admin' || profile?.condoScope === 'all') && condos.length > 1 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest">Condominio:</span>
          <div className="flex gap-2 flex-wrap">
            <button onClick={() => setFilterCondo('')} className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${!filterCondo ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-slate-500 dark:text-gray-400 hover:border-blue-500/50'}`}>
              Todos
            </button>
            {condos.map(c => (
              <button key={c.id} onClick={() => setFilterCondo(c.id)} className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest transition-all ${filterCondo === c.id ? 'bg-blue-600 text-white shadow-lg shadow-blue-600/30' : 'bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 text-slate-500 dark:text-gray-400 hover:border-blue-500/50'}`}>
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
        <AnimatePresence>
          {filteredFacilities.map((facility) => (
            <motion.div layout key={facility.id} className="group bg-white/50 dark:bg-gray-900/50 backdrop-blur-xl border border-slate-200 dark:border-gray-800 rounded-[2.5rem] p-10 hover:border-blue-500/30 transition-all shadow-sm dark:shadow-none">
              <div className="flex items-start justify-between gap-4 mb-8">
                <div className="space-y-2 flex-1 min-w-0">
                  <h3 className="text-xl font-black text-slate-900 dark:text-white italic uppercase tracking-tight">{facility.name}</h3>
                  <p className="text-base text-slate-500 dark:text-gray-400 font-medium line-clamp-2 leading-relaxed">{facility.description}</p>
                  <div className="flex items-center gap-2 text-base text-blue-500 font-black uppercase italic mt-2">{facility.condoName}</div>
                </div>
                <div className={`px-3 py-1.5 rounded-full text-xs font-black uppercase tracking-widest border shrink-0 mt-1 ${
                  facility.status === 'active' ? 'bg-green-500/10 text-green-500 border-green-500/20' :
                  facility.status === 'maintenance' ? 'bg-yellow-500/10 text-yellow-500 border-yellow-500/20' :
                  'bg-red-500/10 text-red-500 border-red-500/20'
                }`}>
                  {facility.status === 'active' ? 'Disponible' : facility.status === 'maintenance' ? 'Mantención' : 'Cerrado'}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-6 py-8 border-y border-slate-200 dark:border-gray-800">
                <div className="space-y-1">
                  <p className="text-base font-black text-slate-400 dark:text-gray-600 uppercase tracking-widest italic">Aforo Máximo</p>
                  <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold"><Users size={14} className="text-blue-500" /> {facility.capacity} Personas</div>
                </div>
                <div className="space-y-1">
                  <p className="text-base font-black text-slate-400 dark:text-gray-600 uppercase tracking-widest italic">Ubicación</p>
                  <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold"><MapPin size={14} className="text-blue-500" /> {facility.location}</div>
                </div>
                {facility.openTime && facility.closeTime && (
                  <div className="space-y-1 col-span-2">
                    <p className="text-base font-black text-slate-400 dark:text-gray-600 uppercase tracking-widest italic">Horario</p>
                    <div className="flex items-center gap-2 text-slate-900 dark:text-white font-bold">
                      <Clock size={14} className="text-blue-500" />
                      {facility.openTime} – {facility.closeTime}
                      {facility.slotDurationMinutes && (
                        <span className="text-slate-500 dark:text-gray-500 font-normal text-sm ml-1">· {facility.slotDurationMinutes} min/turno</span>
                      )}
                    </div>
                    {facility.availableDays && facility.availableDays.length > 0 && (
                      <div className="flex gap-1 mt-1 flex-wrap">
                        {[0,1,2,3,4,5,6].map((d) => (
                          <span key={d} className={`text-xs px-2 py-0.5 rounded-full font-black uppercase ${
                            facility.availableDays!.includes(d)
                              ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                              : 'bg-slate-100 dark:bg-gray-800 text-slate-400 dark:text-gray-600'
                          }`}>{DAY_LABELS[d]}</span>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>

              <div className="flex items-center justify-between pt-8">
                <div className="flex items-center gap-2">
                  <CreditCard size={16} className="text-slate-400 dark:text-gray-600" />
                  <span className="text-base font-black text-slate-700 dark:text-gray-300">{facility.price && facility.price !== '0' ? `$${facility.price}` : 'Gratuito'}</span>
                </div>
                <div className="flex gap-2">
                  {profile?.role !== 'resident' && (
                    <>
                      <button
                        onClick={() => { setEditingFacility(facility); setFormData({ ...blankForm, ...facility, availableDays: facility.availableDays ?? blankForm.availableDays, slotDurationMinutes: facility.slotDurationMinutes ?? blankForm.slotDurationMinutes }); setShowAddModal(true); }}
                        className="p-3 bg-slate-100 dark:bg-gray-800 hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-700 dark:text-white rounded-xl transition-all shadow-xl"
                      ><Edit2 size={18} /></button>
                      <button
                        onClick={() => setDeletingFacility(facility)}
                        className="p-3 bg-red-600/10 text-red-500 rounded-xl hover:bg-red-600 hover:text-white transition-all shadow-xl"
                      ><Trash2 size={18} /></button>
                    </>
                  )}
                  {facility.status === 'active' && (
                    <button
                      onClick={() => { setBookingFacility(facility); setBookingDate(toDateInputValue(new Date())); setBookingSlot(null); setBookingSuccess(false); }}
                      className="px-6 py-3 bg-blue-600 text-white font-black rounded-xl text-base uppercase tracking-widest hover:bg-blue-500 transition-all flex items-center gap-2"
                    >
                      <Calendar size={14} /> Reservar
                    </button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {/* ── Create / Edit Modal ─────────────────────────────────────────────── */}
      <AnimatePresence>
        {showAddModal && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setShowAddModal(false)} className="absolute inset-0 bg-black/40 dark:bg-black/95 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="relative w-full max-w-xl bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-[3rem] p-10 overflow-y-auto max-h-[90vh]">
              <button onClick={() => setShowAddModal(false)} className="absolute top-8 right-8 p-2 text-slate-500 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white"><X size={22} /></button>
              <h3 className="text-xl font-black text-slate-900 dark:text-white italic uppercase tracking-tight mb-10">
                {editingFacility ? 'Editar Instalación' : 'Nueva Instalación'}
              </h3>
              <form onSubmit={handleSave} className="space-y-6">
                {/* Name */}
                <div className="space-y-2">
                  <label className="text-base font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest ml-1">Nombre</label>
                  <input required type="text" value={formData.name} onChange={(e) => setFormData({ ...formData, name: e.target.value })} className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-black" placeholder="Ej: Quincho Principal" />
                </div>
                {/* Description */}
                <div className="space-y-2">
                  <label className="text-base font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest ml-1">Descripción</label>
                  <textarea required value={formData.description} onChange={(e) => setFormData({ ...formData, description: e.target.value })} className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white h-24 resize-none" />
                </div>
                {/* Capacity / Price */}
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-base font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest ml-1">Capacidad</label>
                    <input required type="number" min={1} value={formData.capacity} onChange={(e) => setFormData({ ...formData, capacity: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-black" />
                  </div>
                  <div className="space-y-2">
                    <label className="text-base font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest ml-1">Costo ($)</label>
                    <input type="text" value={formData.price} onChange={(e) => setFormData({ ...formData, price: e.target.value })} className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-black" placeholder="0" />
                  </div>
                </div>
                {/* Status / Location */}
                <div className="grid grid-cols-2 gap-8">
                  <div className="space-y-2">
                    <label className="text-base font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest ml-1">Estado</label>
                    <select value={formData.status} onChange={(e) => setFormData({ ...formData, status: e.target.value as Facility['status'] })} className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-black">
                      <option value="active">Disponible</option>
                      <option value="maintenance">Mantenimiento</option>
                      <option value="inactive">Fuera de Servicio</option>
                    </select>
                  </div>
                  <div className="space-y-2">
                    <label className="text-base font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest ml-1">Ubicación</label>
                    <input required type="text" value={formData.location} onChange={(e) => setFormData({ ...formData, location: e.target.value })} className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-black" placeholder="Sector A / Terraza" />
                  </div>
                </div>

                {/* ── Schedule section ── */}
                <div className="pt-2 border-t border-slate-200 dark:border-gray-800">
                  <p className="text-base font-black text-slate-500 dark:text-gray-400 uppercase tracking-widest mb-5">Horario de Reservas</p>
                  <div className="grid grid-cols-3 gap-4 mb-5">
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest ml-1">Apertura</label>
                      <input type="time" required value={formData.openTime} onChange={(e) => setFormData({ ...formData, openTime: e.target.value })} className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-4 text-slate-900 dark:text-white font-black" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest ml-1">Cierre</label>
                      <input type="time" required value={formData.closeTime} onChange={(e) => setFormData({ ...formData, closeTime: e.target.value })} className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-4 text-slate-900 dark:text-white font-black" />
                    </div>
                    <div className="space-y-2">
                      <label className="text-xs font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest ml-1">Turno (min)</label>
                      <select value={formData.slotDurationMinutes} onChange={(e) => setFormData({ ...formData, slotDurationMinutes: Number(e.target.value) })} className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-4 text-slate-900 dark:text-white font-black">
                        <option value={30}>30 min</option>
                        <option value={60}>60 min</option>
                        <option value={90}>90 min</option>
                        <option value={120}>120 min</option>
                        <option value={180}>180 min</option>
                        <option value={240}>240 min</option>
                      </select>
                    </div>
                  </div>
                  {/* Days of week */}
                  <div className="space-y-2">
                    <label className="text-xs font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest ml-1">Días Disponibles</label>
                    <div className="flex gap-2 flex-wrap">
                      {DAY_LABELS.map((label, idx) => (
                        <button key={idx} type="button" onClick={() => toggleDay(idx)}
                          className={`px-4 py-2 rounded-xl text-sm font-black uppercase transition-all ${
                            formData.availableDays.includes(idx)
                              ? 'bg-blue-600 text-white'
                              : 'bg-slate-100 dark:bg-gray-800 text-slate-500 dark:text-gray-500 hover:bg-slate-200 dark:hover:bg-gray-700'
                          }`}
                        >{label}</button>
                      ))}
                    </div>
                  </div>
                </div>

                {/* Condo selector (super_admin only) */}
                {profile?.role === 'super_admin' && (
                  <div className="space-y-2">
                    <label className="text-base font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest ml-1">Condominio</label>
                    <select value={formData.condoId} onChange={(e) => setFormData({ ...formData, condoId: e.target.value })} className="w-full bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-black italic">
                      {condos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                    </select>
                  </div>
                )}

                <button type="submit" className="w-full bg-blue-600 hover:bg-blue-500 text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-blue-600/30">
                  {editingFacility ? 'Guardar Cambios' : 'Crear Instalación'}
                </button>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Delete confirm ──────────────────────────────────────────────────── */}
      <AnimatePresence>
        {deletingFacility && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setDeletingFacility(null)} className="absolute inset-0 bg-black/40 dark:bg-black/95 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="relative bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-[2.5rem] p-10 max-w-sm w-full text-center space-y-6">
              <p className="text-slate-900 dark:text-white font-black text-lg">¿Eliminar «{deletingFacility.name}»?</p>
              <p className="text-slate-500 dark:text-gray-500 text-sm">Esta acción no se puede deshacer.</p>
              <div className="flex gap-4">
                <button onClick={() => setDeletingFacility(null)} className="flex-1 py-4 bg-slate-100 dark:bg-gray-800 text-slate-900 dark:text-white rounded-2xl font-black hover:bg-slate-200 dark:hover:bg-gray-700">Cancelar</button>
                <button onClick={handleDelete} className="flex-1 py-4 bg-red-600 text-white rounded-2xl font-black hover:bg-red-500">Eliminar</button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {/* ── Booking / Calendar Modal ─────────────────────────────────────────── */}
      <AnimatePresence>
        {bookingFacility && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setBookingFacility(null)} className="absolute inset-0 bg-black/40 dark:bg-black/95 backdrop-blur-md" />
            <motion.div initial={{ scale: 0.95 }} animate={{ scale: 1 }} className="relative w-full max-w-lg bg-white dark:bg-gray-900 border border-slate-200 dark:border-gray-800 rounded-[3rem] p-10 overflow-y-auto max-h-[90vh]">
              <button onClick={() => setBookingFacility(null)} className="absolute top-8 right-8 p-2 text-slate-500 dark:text-gray-500 hover:text-slate-900 dark:hover:text-white"><X size={22} /></button>

              {bookingSuccess && bookingResult ? (
                <div className="flex flex-col items-center py-8 gap-5">
                  <CheckCircle2 size={56} className="text-green-500" />
                  <div className="text-center">
                    <p className="text-slate-900 dark:text-white font-black text-xl uppercase italic">¡Reserva Confirmada!</p>
                    <p className="text-slate-500 dark:text-gray-500 text-sm mt-1">Tu reserva ha sido registrada exitosamente.</p>
                  </div>

                  {/* Booking summary */}
                  <div className="w-full bg-slate-50 dark:bg-gray-800 rounded-2xl p-5 space-y-2 text-sm">
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-gray-400 font-bold">Instalación</span><span className="text-slate-900 dark:text-white font-black">{bookingResult.facilityName}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-gray-400 font-bold">Fecha</span><span className="text-slate-900 dark:text-white font-black">{new Date(bookingResult.date + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'long' })}</span></div>
                    <div className="flex justify-between"><span className="text-slate-500 dark:text-gray-400 font-bold">Horario</span><span className="text-slate-900 dark:text-white font-black">{bookingResult.startTime} – {bookingResult.endTime}</span></div>
                  </div>

                  {/* Calendar options */}
                  <div className="w-full space-y-3">
                    <p className="text-xs font-black text-slate-400 dark:text-gray-500 uppercase tracking-widest text-center">Guardar en calendario</p>
                    <div className="grid grid-cols-2 gap-3">
                      <a
                        href={getGoogleCalendarUrl(bookingResult.facilityName, bookingResult.location, bookingResult.date, bookingResult.startTime, bookingResult.endTime)}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center justify-center gap-2 py-3 bg-blue-600/10 border border-blue-500/20 text-blue-600 dark:text-blue-400 rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-blue-600/20 transition-all"
                      >
                        <Calendar size={15} /> Google
                      </a>
                      <button
                        onClick={() => downloadICS(bookingResult.facilityName, bookingResult.location, bookingResult.date, bookingResult.startTime, bookingResult.endTime)}
                        className="flex items-center justify-center gap-2 py-3 bg-slate-100 dark:bg-gray-800 border border-slate-200 dark:border-gray-700 text-slate-700 dark:text-white rounded-2xl font-black text-xs uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-gray-700 transition-all"
                      >
                        <Download size={15} /> iCal / Outlook
                      </button>
                    </div>
                  </div>

                  <button
                    onClick={() => { setBookingSuccess(false); setBookingResult(null); setBookingFacility(null); }}
                    className="w-full py-3 bg-slate-100 dark:bg-gray-800 text-slate-700 dark:text-white rounded-2xl font-black text-sm uppercase tracking-widest hover:bg-slate-200 dark:hover:bg-gray-700 transition-all"
                  >
                    Cerrar
                  </button>
                </div>
              ) : (
                <>
                  <div className="mb-8">
                    <p className="text-xs font-black text-blue-500 uppercase tracking-widest mb-1">Reservar</p>
                    <h3 className="text-2xl font-black text-slate-900 dark:text-white italic uppercase">{bookingFacility.name}</h3>
                    <p className="text-slate-500 dark:text-gray-500 text-sm mt-1">{bookingFacility.condoName} · {bookingFacility.location}</p>
                  </div>

                  {/* Date picker */}
                  <div className="mb-8 space-y-3">
                    <label className="text-xs font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest ml-1">Seleccionar Fecha</label>
                    <div className="flex items-center gap-3">
                      <button type="button" onClick={() => {
                        const d = new Date(bookingDate + 'T12:00:00');
                        d.setDate(d.getDate() - 1);
                        setBookingDate(toDateInputValue(d));
                        setBookingSlot(null);
                      }} className="p-3 bg-slate-100 dark:bg-gray-800 hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-700 dark:text-white rounded-xl transition-all">
                        <ChevronLeft size={18} />
                      </button>
                      <input
                        type="date"
                        value={bookingDate}
                        min={toDateInputValue(new Date())}
                        onChange={(e) => { setBookingDate(e.target.value); setBookingSlot(null); }}
                        className="flex-1 bg-slate-50 dark:bg-gray-950 border border-slate-200 dark:border-gray-800 rounded-2xl py-4 px-6 text-slate-900 dark:text-white font-black text-center"
                      />
                      <button type="button" onClick={() => {
                        const d = new Date(bookingDate + 'T12:00:00');
                        d.setDate(d.getDate() + 1);
                        setBookingDate(toDateInputValue(d));
                        setBookingSlot(null);
                      }} className="p-3 bg-slate-100 dark:bg-gray-800 hover:bg-slate-200 dark:hover:bg-gray-700 text-slate-700 dark:text-white rounded-xl transition-all">
                        <ChevronRight size={18} />
                      </button>
                    </div>
                    {bookingDate && (
                      <p className="text-center text-sm font-black uppercase tracking-widest text-slate-500 dark:text-gray-400">
                        {new Date(bookingDate + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
                      </p>
                    )}
                  </div>

                  {/* Slots grid */}
                  {!isDayAvailable ? (
                    <div className="text-center py-8 text-slate-500 dark:text-gray-500 font-black uppercase text-sm italic">
                      Esta instalación no está disponible el {DAY_LABELS[selectedDayOfWeek]}.
                    </div>
                  ) : slots.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 dark:text-gray-500 text-sm">
                      Esta instalación no tiene horario configurado.
                    </div>
                  ) : (
                    <>
                      <div className="mb-4">
                        <p className="text-xs font-black text-slate-500 dark:text-gray-500 uppercase tracking-widest ml-1 mb-3">Turnos Disponibles</p>
                        <div className="grid grid-cols-3 gap-3">
                          {slots.map((slot) => {
                            const taken = takenSlots.has(slot.start);
                            const selected = bookingSlot?.start === slot.start;
                            return (
                              <button
                                key={slot.start}
                                type="button"
                                disabled={taken}
                                onClick={() => setBookingSlot(selected ? null : slot)}
                                className={`py-2.5 px-2 rounded-2xl text-xs font-black transition-all border ${
                                  taken
                                    ? 'bg-red-500/10 text-red-400 border-red-500/20 cursor-not-allowed line-through'
                                    : selected
                                    ? 'bg-blue-600 text-white border-blue-500 shadow-lg shadow-blue-600/30'
                                    : 'bg-slate-100 dark:bg-gray-800 text-slate-900 dark:text-white border-slate-200 dark:border-gray-700 hover:bg-slate-200 dark:hover:bg-gray-700 hover:border-blue-500/50'
                                }`}
                              >
                                {slot.start}
                                <span className="block text-xs font-normal opacity-70">{slot.end}</span>
                              </button>
                            );
                          })}
                        </div>
                        <div className="flex gap-4 mt-4 text-xs text-slate-500 dark:text-gray-500">
                          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-blue-600 inline-block" /> Seleccionado</span>
                          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-red-500/20 inline-block" /> Ocupado</span>
                          <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded bg-slate-200 dark:bg-gray-800 inline-block" /> Libre</span>
                        </div>
                      </div>

                      {bookingSlot && (
                        <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="mt-4 p-6 bg-blue-600/10 border border-blue-500/20 rounded-2xl mb-6">
                          <p className="text-blue-400 font-black text-sm uppercase tracking-widest">Turno seleccionado</p>
                          <p className="text-slate-900 dark:text-white font-black text-lg mt-1">{bookingSlot.start} – {bookingSlot.end}</p>
                          <p className="text-slate-500 dark:text-gray-500 text-xs mt-1">{new Date(bookingDate + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
                        </motion.div>
                      )}

                      <button
                        onClick={handleBook}
                        disabled={!bookingSlot || savingBooking}
                        className="w-full bg-blue-600 hover:bg-blue-500 disabled:opacity-40 disabled:cursor-not-allowed text-white font-black py-5 rounded-2xl transition-all shadow-xl shadow-blue-600/30 flex items-center justify-center gap-3"
                      >
                        {savingBooking ? <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <Calendar size={20} />}
                        Confirmar Reserva
                      </button>
                    </>
                  )}
                </>
              )}
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};

export default Facilities;
