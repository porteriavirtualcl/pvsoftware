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
  Calendar,
  CreditCard,
  Clock,
  ChevronLeft,
  ChevronRight,
  CheckCircle2,
  Download,
} from 'lucide-react';
import { motion } from 'motion/react';
import { handleFirestoreError, OperationType, sendNotification } from '../lib/utils';
import { Button, Card, PageHeader, Field, Input, Modal, Badge, EmptyState, Spinner } from '../components/ui';
import { cn } from '../lib/utils';

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
  openTime?: string;
  closeTime?: string;
  slotDurationMinutes?: number;
  availableDays?: number[];
  maxSlotsPerReservation?: number;
  createdAt: any;
  updatedAt: any;
}

interface Reservation {
  id: string;
  userId: string;
  userName: string;
  facilityId: string;
  facilityName: string;
  date: string;
  startTime: string;
  endTime: string;
  status: 'pending' | 'approved' | 'rejected' | 'cancelled';
  condoId: string;
  condoName?: string;
  unit?: string;
  createdAt: any;
}

const DAY_LABELS = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];

const selectClass = cn(
  'block w-full bg-white dark:bg-slate-950/50',
  'border border-slate-200 dark:border-white/10 rounded-xl',
  'px-3.5 py-2.5 text-[15px] text-slate-900 dark:text-slate-100',
  'outline-none transition focus:border-blue-600 dark:focus:border-blue-500',
  'focus:ring-2 focus:ring-blue-500/20 cursor-pointer',
);

// ─── calendar helpers ─────────────────────────────────────────────────────────

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
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

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
    maxSlotsPerReservation: 1,
  };

  const [formData, setFormData] = useState(blankForm);
  const [editingFacility, setEditingFacility] = useState<Facility | null>(null);
  const [deletingFacility, setDeletingFacility] = useState<Facility | null>(null);

  // ── Booking state ─────────────────────────────────────────────────────────
  const [bookingFacility, setBookingFacility] = useState<Facility | null>(null);
  const [bookingDate, setBookingDate] = useState(toDateInputValue(new Date()));
  const [selectedSlots, setSelectedSlots] = useState<{ start: string; end: string }[]>([]);
  const [facilityReservations, setFacilityReservations] = useState<Reservation[]>([]);
  const [savingBooking, setSavingBooking] = useState(false);
  const [bookingSuccess, setBookingSuccess] = useState(false);
  const [bookingResult, setBookingResult] = useState<{
    facilityName: string; location: string;
    date: string; startTime: string; endTime: string;
  } | null>(null);

  const [view, setView] = useState<'facilities' | 'reservations'>('facilities');
  const [allReservations, setAllReservations] = useState<Reservation[]>([]);

  const canViewReservations = profile?.role !== 'resident';

  useEffect(() => {
    const condosUnsub = onSnapshot(collection(db, 'condos'), (snap) => {
      setCondos(snap.docs.map((d) => ({ id: d.id, name: d.data().name })));
    });

    if (!profile || !user) return () => condosUnsub();

    const isGlobal = profile.role === 'super_admin' || profile.condoScope === 'all';
    const q = isGlobal
      ? query(collectionGroup(db, 'facilities'))
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

  useEffect(() => {
    if (!bookingFacility) { setFacilityReservations([]); return; }
    const path = `condos/${bookingFacility.condoId}/reservations`;
    const q = query(collection(db, path), where('facilityId', '==', bookingFacility.id));
    const unsub = onSnapshot(q, (snap) => {
      setFacilityReservations(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Reservation[]);
    });
    return () => unsub();
  }, [bookingFacility]);

  // Lista global de reservas (quién reservó) — super_admin: todos los condominios; roles acotados: su condominio.
  useEffect(() => {
    if (!profile || !user || profile.role === 'resident') { setAllReservations([]); return; }
    const isGlobal = profile.role === 'super_admin' || profile.condoScope === 'all';
    const q = isGlobal
      ? query(collectionGroup(db, 'reservations'))
      : query(collection(db, `condos/${profile.condoId || 'default'}/reservations`));
    const unsub = onSnapshot(q, (snap) => {
      setAllReservations(snap.docs.map((d) => ({ id: d.id, ...d.data() })) as Reservation[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, 'reservations'));
    return () => unsub();
  }, [profile, user]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!profile || !user) return;
    setSaving(true);
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
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingFacility) return;
    setDeleting(true);
    const path = `condos/${deletingFacility.condoId}/facilities`;
    try {
      await deleteDoc(doc(db, path, deletingFacility.id));
      setDeletingFacility(null);
    } catch (error) {
      handleFirestoreError(error, OperationType.DELETE, path);
    } finally {
      setDeleting(false);
    }
  };

  const handleBook = async () => {
    if (!bookingFacility || !bookingDate || selectedSlots.length === 0 || !profile || !user) return;
    setSavingBooking(true);
    const path = `condos/${bookingFacility.condoId}/reservations`;
    const startTime = selectedSlots[0].start;
    const endTime   = selectedSlots[selectedSlots.length - 1].end;
    try {
      await addDoc(collection(db, path), {
        userId: user.uid,
        userName: profile.name || user.email || 'Usuario',
        facilityId: bookingFacility.id,
        facilityName: bookingFacility.name,
        date: bookingDate,
        startTime,
        endTime,
        status: 'approved',
        condoId: bookingFacility.condoId,
        condoName: bookingFacility.condoName,
        unit: profile.unit || '',
        createdAt: Timestamp.now(),
      });

      sendNotification(
        user.uid,
        'Reserva Confirmada',
        `Tu reserva de ${bookingFacility.name} el ${bookingDate} de ${startTime} a ${endTime} ha sido confirmada.`,
        'reservation',
        '/facilities'
      );

      setBookingResult({
        facilityName: bookingFacility.name,
        location: `${bookingFacility.location} · ${bookingFacility.condoName}`,
        date: bookingDate,
        startTime,
        endTime,
      });
      setBookingSuccess(true);
      setSelectedSlots([]);
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    } finally {
      setSavingBooking(false);
    }
  };

  const slots = useMemo(() => {
    if (!bookingFacility?.openTime || !bookingFacility?.closeTime || !bookingFacility?.slotDurationMinutes) return [];
    return generateSlots(bookingFacility.openTime, bookingFacility.closeTime, bookingFacility.slotDurationMinutes);
  }, [bookingFacility]);

  const takenSlots = useMemo(() => {
    const dur = bookingFacility?.slotDurationMinutes || 60;
    const taken = new Set<string>();
    facilityReservations
      .filter(r => r.date === bookingDate && r.status !== 'cancelled' && r.status !== 'rejected')
      .forEach(r => {
        const [sh, sm] = r.startTime.split(':').map(Number);
        const [eh, em] = r.endTime.split(':').map(Number);
        let cur = sh * 60 + sm;
        const end = eh * 60 + em;
        while (cur < end) {
          taken.add(`${String(Math.floor(cur / 60)).padStart(2, '0')}:${String(cur % 60).padStart(2, '0')}`);
          cur += dur;
        }
      });
    return taken;
  }, [facilityReservations, bookingDate, bookingFacility]);

  const selectedDayOfWeek = useMemo(() => {
    if (!bookingDate) return -1;
    return new Date(bookingDate + 'T12:00:00').getDay();
  }, [bookingDate]);

  const isDayAvailable = useMemo(() => {
    if (!bookingFacility?.availableDays) return true;
    return bookingFacility.availableDays.includes(selectedDayOfWeek);
  }, [bookingFacility, selectedDayOfWeek]);

  const filteredFacilities = filterCondo ? facilities.filter(f => f.condoId === filterCondo) : facilities;

  const filteredReservations = useMemo(() => {
    const list = filterCondo ? allReservations.filter(r => r.condoId === filterCondo) : allReservations;
    return [...list].sort((a, b) =>
      `${b.date ?? ''} ${b.startTime ?? ''}`.localeCompare(`${a.date ?? ''} ${a.startTime ?? ''}`),
    );
  }, [allReservations, filterCondo]);

  const toggleDay = (day: number) => {
    setFormData((prev) => ({
      ...prev,
      availableDays: prev.availableDays.includes(day)
        ? prev.availableDays.filter((d) => d !== day)
        : [...prev.availableDays, day].sort((a, b) => a - b),
    }));
  };

  const reservationStatusBadge = (status: Reservation['status']) => {
    if (status === 'approved') return <Badge variant="success">Confirmada</Badge>;
    if (status === 'pending') return <Badge variant="warn">Pendiente</Badge>;
    if (status === 'rejected') return <Badge variant="danger">Rechazada</Badge>;
    if (status === 'cancelled') return <Badge variant="muted">Cancelada</Badge>;
    return <Badge variant="muted">{status || '—'}</Badge>;
  };

  const statusBadge = (status: Facility['status']) => {
    if (status === 'active') return <Badge variant="success">Disponible</Badge>;
    if (status === 'maintenance') return <Badge variant="warn">Mantención</Badge>;
    return <Badge variant="danger">Cerrado</Badge>;
  };

  if (loading && !facilities.length)
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <Spinner size={40} />
      </div>
    );

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Package}
        title="Instalaciones"
        description="Gestión de quinchos, piscinas, salones y amenidades."
        actions={
          profile?.role !== 'resident' && view === 'facilities' && (
            <Button
              icon={Plus}
              onClick={() => { setEditingFacility(null); setFormData(blankForm); setShowAddModal(true); }}
            >
              Nueva Instalación
            </Button>
          )
        }
      />

      {/* Tabs: Instalaciones / Reservas */}
      {canViewReservations && (
        <div className="flex gap-1 p-1 rounded-xl bg-slate-100 dark:bg-white/5 w-fit">
          {([
            { key: 'facilities' as const, label: 'Instalaciones', icon: Package },
            { key: 'reservations' as const, label: 'Reservas', icon: Calendar },
          ]).map((t) => (
            <button
              key={t.key}
              onClick={() => setView(t.key)}
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-colors cursor-pointer',
                view === t.key
                  ? 'bg-white dark:bg-white/10 text-slate-900 dark:text-white shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200',
              )}
            >
              <t.icon size={15} />
              {t.label}
              {t.key === 'reservations' && allReservations.length > 0 && (
                <span className="text-[11px] font-bold px-1.5 py-0.5 rounded-full bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300">
                  {allReservations.length}
                </span>
              )}
            </button>
          ))}
        </div>
      )}

      {/* Condo filter — super_admin only */}
      {(profile?.role === 'super_admin' || profile?.condoScope === 'all') && condos.length > 1 && (
        <div className="flex items-center gap-3 flex-wrap">
          <span className="text-xs font-semibold text-slate-500 dark:text-slate-400">Condominio:</span>
          <div className="flex gap-2 flex-wrap">
            <button
              onClick={() => setFilterCondo('')}
              className={cn(
                'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                !filterCondo
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10',
              )}
            >
              Todos
            </button>
            {condos.map(c => (
              <button
                key={c.id}
                onClick={() => setFilterCondo(c.id)}
                className={cn(
                  'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                  filterCondo === c.id
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10',
                )}
              >
                {c.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Empty state */}
      {view === 'facilities' && filteredFacilities.length === 0 && !loading && (
        <EmptyState
          icon={Package}
          title="Sin instalaciones"
          description="No hay espacios comunes registrados aún."
          action={
            profile?.role !== 'resident' && (
              <Button icon={Plus} onClick={() => { setEditingFacility(null); setFormData(blankForm); setShowAddModal(true); }}>
                Nueva Instalación
              </Button>
            )
          }
        />
      )}

      {/* Cards grid */}
      {view === 'facilities' && (
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-5">
        {filteredFacilities.map((facility) => (
          <Card key={facility.id} variant="glass" padding="none" hoverable className="flex flex-col overflow-hidden">
            {/* Card header */}
            <div className="p-5 pb-4 flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <p className="font-semibold text-slate-900 dark:text-white truncate">{facility.name}</p>
                <p className="text-sm text-slate-500 dark:text-slate-400 mt-0.5 line-clamp-2">{facility.description}</p>
                <p className="text-xs font-medium text-blue-600 dark:text-blue-400 mt-1">{facility.condoName}</p>
              </div>
              <div className="shrink-0 mt-0.5">{statusBadge(facility.status)}</div>
            </div>

            {/* Metadata */}
            <div className="px-5 py-3 border-y border-slate-100 dark:border-white/5 grid grid-cols-2 gap-x-4 gap-y-2.5">
              <div className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
                <Users size={13} className="text-slate-400 dark:text-slate-500 shrink-0" />
                <span>{facility.capacity} personas</span>
              </div>
              <div className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300">
                <MapPin size={13} className="text-slate-400 dark:text-slate-500 shrink-0" />
                <span className="truncate">{facility.location}</span>
              </div>
              {facility.openTime && facility.closeTime && (
                <div className="flex items-center gap-1.5 text-sm text-slate-600 dark:text-slate-300 col-span-2">
                  <Clock size={13} className="text-slate-400 dark:text-slate-500 shrink-0" />
                  <span>{facility.openTime} – {facility.closeTime}</span>
                  {facility.slotDurationMinutes && (
                    <span className="text-slate-400 dark:text-slate-500 text-xs">· {facility.slotDurationMinutes} min/turno</span>
                  )}
                </div>
              )}
              {facility.availableDays && facility.availableDays.length > 0 && (
                <div className="col-span-2 flex gap-1 flex-wrap">
                  {[0,1,2,3,4,5,6].map((d) => (
                    <span
                      key={d}
                      className={cn(
                        'text-[10px] px-2 py-0.5 rounded-full font-semibold',
                        facility.availableDays!.includes(d)
                          ? 'bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300'
                          : 'bg-slate-100 dark:bg-white/5 text-slate-400 dark:text-slate-600',
                      )}
                    >
                      {DAY_LABELS[d]}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className="px-5 py-3.5 flex items-center justify-between gap-3 mt-auto">
              <div className="flex items-center gap-1.5 text-sm font-semibold text-slate-700 dark:text-slate-300">
                <CreditCard size={13} className="text-slate-400 dark:text-slate-500" />
                {facility.price && facility.price !== '0' ? `$${facility.price}` : 'Gratuito'}
              </div>
              <div className="flex items-center gap-2">
                {profile?.role !== 'resident' && (
                  <>
                    <button
                      onClick={() => { setEditingFacility(facility); setFormData({ ...blankForm, ...facility, availableDays: facility.availableDays ?? blankForm.availableDays, slotDurationMinutes: facility.slotDurationMinutes ?? blankForm.slotDurationMinutes, maxSlotsPerReservation: facility.maxSlotsPerReservation ?? blankForm.maxSlotsPerReservation }); setShowAddModal(true); }}
                      aria-label="Editar instalación"
                      className="p-2 rounded-lg text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/5 transition-colors cursor-pointer"
                    >
                      <Edit2 size={15} />
                    </button>
                    <button
                      onClick={() => setDeletingFacility(facility)}
                      aria-label="Eliminar instalación"
                      className="p-2 rounded-lg text-slate-500 hover:text-red-600 dark:hover:text-red-400 hover:bg-red-50 dark:hover:bg-red-500/10 transition-colors cursor-pointer"
                    >
                      <Trash2 size={15} />
                    </button>
                  </>
                )}
                {facility.status === 'active' && (
                  <Button
                    size="sm"
                    icon={Calendar}
                    onClick={() => { setBookingFacility(facility); setBookingDate(toDateInputValue(new Date())); setSelectedSlots([]); setBookingSuccess(false); }}
                  >
                    Reservar
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>
      )}

      {/* ── Reservas: quién reservó ──────────────────────────────────────────── */}
      {view === 'reservations' && (
        filteredReservations.length === 0 ? (
          <EmptyState
            icon={Calendar}
            title="Sin reservas"
            description="Aún no hay reservas de instalaciones registradas."
          />
        ) : (
          <Card variant="glass" padding="none" className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100 dark:border-white/5 text-left text-xs font-semibold text-slate-500 dark:text-slate-400">
                    <th className="px-4 py-3">Residente</th>
                    <th className="px-4 py-3">Instalación</th>
                    <th className="px-4 py-3 hidden md:table-cell">Condominio</th>
                    <th className="px-4 py-3">Fecha</th>
                    <th className="px-4 py-3 hidden sm:table-cell">Horario</th>
                    <th className="px-4 py-3">Estado</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredReservations.map((r) => (
                    <tr key={r.id} className="border-b border-slate-50 dark:border-white/[0.03] last:border-0 hover:bg-slate-50 dark:hover:bg-white/[0.02]">
                      <td className="px-4 py-3">
                        <p className="font-semibold text-slate-900 dark:text-white">{r.userName || '—'}</p>
                        {r.unit && <p className="text-xs text-slate-400 dark:text-slate-500">Unidad {r.unit}</p>}
                      </td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300">{r.facilityName || '—'}</td>
                      <td className="px-4 py-3 hidden md:table-cell text-blue-600 dark:text-blue-400 font-medium">{r.condoName || '—'}</td>
                      <td className="px-4 py-3 text-slate-700 dark:text-slate-300 whitespace-nowrap">{r.date || '—'}</td>
                      <td className="px-4 py-3 hidden sm:table-cell text-slate-500 dark:text-slate-400 whitespace-nowrap">
                        {r.startTime && r.endTime ? `${r.startTime} – ${r.endTime}` : '—'}
                      </td>
                      <td className="px-4 py-3">{reservationStatusBadge(r.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )
      )}

      {/* ── Create / Edit Modal ─────────────────────────────────────────────── */}
      <Modal
        open={showAddModal}
        onClose={() => { setShowAddModal(false); setEditingFacility(null); }}
        title={editingFacility ? 'Editar Instalación' : 'Nueva Instalación'}
        icon={Package}
        size="lg"
      >
        <form onSubmit={handleSave} className="space-y-4">
          <Field label="Nombre" htmlFor="fac-name" required>
            <Input
              id="fac-name"
              required
              type="text"
              value={formData.name}
              onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              placeholder="Ej: Quincho Principal"
            />
          </Field>

          <Field label="Descripción" htmlFor="fac-desc" required>
            <textarea
              id="fac-desc"
              required
              value={formData.description}
              onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              rows={3}
              className={cn(selectClass, 'resize-none')}
            />
          </Field>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Capacidad" htmlFor="fac-cap" required>
              <Input
                id="fac-cap"
                required
                type="number"
                min={1}
                value={formData.capacity}
                onChange={(e) => setFormData({ ...formData, capacity: Number(e.target.value) })}
              />
            </Field>
            <Field label="Costo ($)" htmlFor="fac-price">
              <Input
                id="fac-price"
                type="text"
                value={formData.price}
                onChange={(e) => setFormData({ ...formData, price: e.target.value })}
                placeholder="0"
              />
            </Field>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <Field label="Estado" htmlFor="fac-status">
              <select
                id="fac-status"
                value={formData.status}
                onChange={(e) => setFormData({ ...formData, status: e.target.value as Facility['status'] })}
                className={selectClass}
              >
                <option value="active">Disponible</option>
                <option value="maintenance">Mantenimiento</option>
                <option value="inactive">Fuera de Servicio</option>
              </select>
            </Field>
            <Field label="Ubicación" htmlFor="fac-loc" required>
              <Input
                id="fac-loc"
                required
                type="text"
                value={formData.location}
                onChange={(e) => setFormData({ ...formData, location: e.target.value })}
                placeholder="Sector A / Terraza"
              />
            </Field>
          </div>

          {/* Schedule */}
          <div className="pt-3 border-t border-slate-200 dark:border-white/5 space-y-3">
            <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Horario de Reservas</p>
            <div className="grid grid-cols-4 gap-3">
              <Field label="Apertura" htmlFor="fac-open">
                <Input
                  id="fac-open"
                  type="time"
                  required
                  value={formData.openTime}
                  onChange={(e) => setFormData({ ...formData, openTime: e.target.value })}
                />
              </Field>
              <Field label="Cierre" htmlFor="fac-close">
                <Input
                  id="fac-close"
                  type="time"
                  required
                  value={formData.closeTime}
                  onChange={(e) => setFormData({ ...formData, closeTime: e.target.value })}
                />
              </Field>
              <Field label="Turno (min)" htmlFor="fac-slot">
                <select
                  id="fac-slot"
                  value={formData.slotDurationMinutes}
                  onChange={(e) => setFormData({ ...formData, slotDurationMinutes: Number(e.target.value) })}
                  className={selectClass}
                >
                  {[30, 60, 90, 120, 180, 240].map(m => (
                    <option key={m} value={m}>{m} min</option>
                  ))}
                </select>
              </Field>
              <Field label="Máx. turnos/reserva" htmlFor="fac-maxslots">
                <select
                  id="fac-maxslots"
                  value={formData.maxSlotsPerReservation}
                  onChange={(e) => setFormData({ ...formData, maxSlotsPerReservation: Number(e.target.value) })}
                  className={selectClass}
                >
                  {[1, 2, 3, 4, 6, 8].map(n => (
                    <option key={n} value={n}>{n} turno{n > 1 ? 's' : ''}</option>
                  ))}
                </select>
              </Field>
            </div>

            <Field label="Días Disponibles">
              <div className="flex gap-2 flex-wrap pt-0.5">
                {DAY_LABELS.map((label, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => toggleDay(idx)}
                    className={cn(
                      'px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer',
                      formData.availableDays.includes(idx)
                        ? 'bg-blue-600 text-white'
                        : 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-white/10',
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </Field>
          </div>

          {/* Condo selector (super_admin only) */}
          {profile?.role === 'super_admin' && (
            <Field label="Condominio" htmlFor="fac-condo">
              <select
                id="fac-condo"
                value={formData.condoId}
                onChange={(e) => setFormData({ ...formData, condoId: e.target.value })}
                className={selectClass}
              >
                {condos.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </Field>
          )}

          <Button type="submit" loading={saving} fullWidth size="lg" className="mt-2">
            {editingFacility ? 'Guardar Cambios' : 'Crear Instalación'}
          </Button>
        </form>
      </Modal>

      {/* ── Delete confirm ──────────────────────────────────────────────────── */}
      <Modal
        open={!!deletingFacility}
        onClose={() => setDeletingFacility(null)}
        title="Eliminar instalación"
        size="sm"
        footer={
          <>
            <Button variant="secondary" onClick={() => setDeletingFacility(null)}>Cancelar</Button>
            <Button variant="danger" loading={deleting} onClick={handleDelete}>Eliminar</Button>
          </>
        }
      >
        <p className="text-sm text-slate-600 dark:text-slate-400">
          ¿Eliminar <strong className="text-slate-900 dark:text-white">«{deletingFacility?.name}»</strong>? Esta acción no se puede deshacer.
        </p>
      </Modal>

      {/* ── Booking / Calendar Modal ─────────────────────────────────────────── */}
      <Modal
        open={!!bookingFacility}
        onClose={() => { setBookingFacility(null); setBookingSuccess(false); setBookingResult(null); }}
        title={bookingSuccess ? '¡Reserva Confirmada!' : bookingFacility?.name}
        description={!bookingSuccess ? `${bookingFacility?.condoName} · ${bookingFacility?.location}` : undefined}
        icon={bookingSuccess ? CheckCircle2 : Calendar}
        size="md"
      >
        {bookingSuccess && bookingResult ? (
          <div className="space-y-5">
            {/* Booking summary */}
            <div className="rounded-xl bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/5 divide-y divide-slate-200 dark:divide-white/5 overflow-hidden text-sm">
              {[
                { label: 'Instalación', value: bookingResult.facilityName },
                { label: 'Fecha', value: new Date(bookingResult.date + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'short', day: 'numeric', month: 'long' }) },
                { label: 'Horario', value: `${bookingResult.startTime} – ${bookingResult.endTime}` },
              ].map(({ label, value }) => (
                <div key={label} className="flex justify-between px-4 py-2.5">
                  <span className="text-slate-500 dark:text-slate-400">{label}</span>
                  <span className="font-semibold text-slate-900 dark:text-white">{value}</span>
                </div>
              ))}
            </div>

            {/* Calendar options */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Guardar en calendario</p>
              <div className="grid grid-cols-2 gap-3">
                <a
                  href={getGoogleCalendarUrl(bookingResult.facilityName, bookingResult.location, bookingResult.date, bookingResult.startTime, bookingResult.endTime)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-blue-50 dark:bg-blue-500/10 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/20 hover:bg-blue-100 dark:hover:bg-blue-500/20 transition-colors cursor-pointer"
                >
                  <Calendar size={14} /> Google
                </a>
                <button
                  onClick={() => downloadICS(bookingResult.facilityName, bookingResult.location, bookingResult.date, bookingResult.startTime, bookingResult.endTime)}
                  className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-sm font-semibold bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-white/10 hover:bg-slate-200 dark:hover:bg-white/10 transition-colors cursor-pointer"
                >
                  <Download size={14} /> iCal / Outlook
                </button>
              </div>
            </div>

            <Button
              variant="secondary"
              fullWidth
              onClick={() => { setBookingSuccess(false); setBookingResult(null); setBookingFacility(null); }}
            >
              Cerrar
            </Button>
          </div>
        ) : (
          <div className="space-y-5">
            {/* Date picker */}
            <div className="space-y-2">
              <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Seleccionar Fecha</p>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  aria-label="Día anterior"
                  onClick={() => {
                    const d = new Date(bookingDate + 'T12:00:00');
                    d.setDate(d.getDate() - 1);
                    setBookingDate(toDateInputValue(d));
                    setSelectedSlots([]);
                  }}
                  className="p-2 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                >
                  <ChevronLeft size={16} />
                </button>
                <Input
                  type="date"
                  value={bookingDate}
                  min={toDateInputValue(new Date())}
                  onChange={(e) => { setBookingDate(e.target.value); setSelectedSlots([]); }}
                  className="flex-1 text-center"
                />
                <button
                  type="button"
                  aria-label="Día siguiente"
                  onClick={() => {
                    const d = new Date(bookingDate + 'T12:00:00');
                    d.setDate(d.getDate() + 1);
                    setBookingDate(toDateInputValue(d));
                    setSelectedSlots([]);
                  }}
                  className="p-2 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                >
                  <ChevronRight size={16} />
                </button>
              </div>
              {bookingDate && (
                <p className="text-center text-sm text-slate-500 dark:text-slate-400">
                  {new Date(bookingDate + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
                </p>
              )}
            </div>

            {/* Slots grid */}
            {!isDayAvailable ? (
              <p className="text-center py-6 text-sm text-slate-500 dark:text-slate-400">
                Esta instalación no está disponible el {DAY_LABELS[selectedDayOfWeek]}.
              </p>
            ) : slots.length === 0 ? (
              <p className="text-center py-6 text-sm text-slate-500 dark:text-slate-400">
                Esta instalación no tiene horario configurado.
              </p>
            ) : (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500 dark:text-slate-400">Turnos Disponibles</p>
                  {(bookingFacility?.maxSlotsPerReservation ?? 1) > 1 && (
                    <p className="text-xs text-blue-500 dark:text-blue-400">
                      Máx. {bookingFacility?.maxSlotsPerReservation} turnos · {selectedSlots.length} seleccionado{selectedSlots.length !== 1 ? 's' : ''}
                    </p>
                  )}
                </div>
                <div className="grid grid-cols-3 gap-2">
                  {slots.map((slot) => {
                    const taken  = takenSlots.has(slot.start);
                    const isSelected = selectedSlots.some(s => s.start === slot.start);
                    const maxReached = selectedSlots.length >= (bookingFacility?.maxSlotsPerReservation ?? 1);
                    const lastSelected = selectedSlots[selectedSlots.length - 1];
                    const isConsecutive = lastSelected?.end === slot.start;
                    const canAdd = !taken && !isSelected && (!maxReached) && (selectedSlots.length === 0 || isConsecutive);
                    const handleClick = () => {
                      if (taken) return;
                      if (isSelected) {
                        // Deselect this and all after it
                        const idx = selectedSlots.findIndex(s => s.start === slot.start);
                        setSelectedSlots(selectedSlots.slice(0, idx));
                      } else if (canAdd) {
                        setSelectedSlots([...selectedSlots, slot]);
                      } else if (!isSelected && selectedSlots.length > 0 && !isConsecutive) {
                        // Non-consecutive: restart from this slot
                        setSelectedSlots([slot]);
                      }
                    };
                    return (
                      <button
                        key={slot.start}
                        type="button"
                        disabled={taken || (!canAdd && !isSelected && selectedSlots.length > 0 && !isConsecutive && maxReached)}
                        onClick={handleClick}
                        className={cn(
                          'py-2.5 px-2 rounded-xl text-xs font-semibold transition-colors border cursor-pointer',
                          taken && 'bg-red-50 dark:bg-red-500/10 text-red-400 border-red-200 dark:border-red-500/20 cursor-not-allowed line-through opacity-60',
                          isSelected && 'bg-blue-600 text-white border-blue-600 shadow-sm shadow-blue-600/30',
                          !taken && !isSelected && 'bg-slate-100 dark:bg-white/5 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-white/10 hover:bg-slate-200 dark:hover:bg-white/10',
                        )}
                      >
                        {slot.start}
                        <span className="block text-[10px] font-normal opacity-70">{slot.end}</span>
                      </button>
                    );
                  })}
                </div>
                <div className="flex gap-4 text-xs text-slate-500 dark:text-slate-400">
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-blue-600 inline-block" /> Seleccionado</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-red-400 inline-block opacity-60" /> Ocupado</span>
                  <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded bg-slate-200 dark:bg-white/10 inline-block" /> Libre</span>
                </div>
              </div>
            )}

            {/* Selected slot summary */}
            {selectedSlots.length > 0 && (
              <motion.div
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 rounded-xl bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20"
              >
                <p className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                  {selectedSlots.length} turno{selectedSlots.length !== 1 ? 's' : ''} seleccionado{selectedSlots.length !== 1 ? 's' : ''}
                </p>
                <p className="text-base font-semibold text-slate-900 dark:text-white mt-0.5">
                  {selectedSlots[0].start} – {selectedSlots[selectedSlots.length - 1].end}
                </p>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  {new Date(bookingDate + 'T12:00:00').toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
                </p>
              </motion.div>
            )}

            <Button
              onClick={handleBook}
              disabled={selectedSlots.length === 0}
              loading={savingBooking}
              icon={Calendar}
              fullWidth
              size="lg"
            >
              Confirmar Reserva
            </Button>
          </div>
        )}
      </Modal>
    </div>
  );
};

export default Facilities;
