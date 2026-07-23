import React, { useState } from 'react';
import {
  BookOpen, LogIn, Home, Users, QrCode, AlertTriangle, Calendar,
  Package, ClipboardList, MessageCircle, Megaphone, ChevronDown,
  CheckCircle2, AlertTriangle as Warn2, Info, Shield, Bell,
  Search, Clock, UserCheck, FileText, Zap, Smartphone, Lock,
} from 'lucide-react';
import { PageHeader, Card } from '../components/ui';
import { cn } from '../lib/utils';

interface Section {
  id: string;
  icon: React.ReactNode;
  title: string;
  badge?: string;
  content: React.ReactNode;
}

const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <div className="flex items-start gap-3 py-2 border-b border-slate-100 dark:border-white/5 last:border-0">
    <span className="w-5 h-5 rounded-full bg-indigo-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">{n}</span>
    <span className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{children}</span>
  </div>
);

const Tip = ({ children }: { children: React.ReactNode }) => (
  <div className="flex gap-2.5 bg-blue-50 dark:bg-blue-500/10 border border-blue-200 dark:border-blue-500/20 rounded-xl p-3 mt-3">
    <Info size={15} className="text-blue-500 shrink-0 mt-0.5" />
    <p className="text-xs text-blue-700 dark:text-blue-300 leading-relaxed">{children}</p>
  </div>
);

const Warn = ({ children }: { children: React.ReactNode }) => (
  <div className="flex gap-2.5 bg-amber-50 dark:bg-amber-500/10 border border-amber-200 dark:border-amber-500/20 rounded-xl p-3 mt-3">
    <Warn2 size={15} className="text-amber-500 shrink-0 mt-0.5" />
    <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">{children}</p>
  </div>
);

const Ok = ({ children }: { children: React.ReactNode }) => (
  <div className="flex gap-2.5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl p-3 mt-3">
    <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />
    <p className="text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">{children}</p>
  </div>
);

const Mockup = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 shadow-md my-4">
    <div className="flex items-center justify-between px-3 py-2 bg-slate-900">
      <div className="flex gap-1.5">
        <span className="w-2.5 h-2.5 rounded-full bg-red-500" />
        <span className="w-2.5 h-2.5 rounded-full bg-yellow-400" />
        <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
      </div>
      <span className="text-[8px] font-semibold tracking-widest text-slate-400 uppercase">{title}</span>
      <div className="w-12" />
    </div>
    <div className="bg-slate-50 dark:bg-slate-800/50">{children}</div>
  </div>
);

const Pill = ({ color, children }: { color: 'yellow' | 'blue' | 'green' | 'red' | 'slate'; children: React.ReactNode }) => {
  const cls: Record<string, string> = {
    yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300',
    blue:   'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
    green:  'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
    red:    'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
    slate:  'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-400',
  };
  return <span className={cn('inline-block rounded-full px-2 py-0.5 text-[10px] font-bold', cls[color])}>{children}</span>;
};

/* ─── Sections ──────────────────────────────────────────────────────────── */

const SecIngreso = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      El administrador te enviará por correo tus credenciales de acceso. Puedes ingresar desde cualquier navegador o desde la app móvil en <strong className="text-slate-900 dark:text-white">app.porteriavirtual.cl</strong>.
    </p>
    <div className="space-y-1 mb-3">
      <Step n={1}>Abre el navegador y ve a <strong>app.porteriavirtual.cl</strong></Step>
      <Step n={2}>Ingresa tu <strong>correo electrónico</strong> y <strong>contraseña</strong></Step>
      <Step n={3}>Pulsa <strong>"Iniciar sesión"</strong></Step>
      <Step n={4}>Serás dirigido al <strong>Panel de Inicio</strong> con el resumen de actividad del condominio</Step>
    </div>
    <Warn>Si ves el mensaje <em>"Acceso denegado"</em>, verifica con el administrador que tu cuenta tenga el rol <strong>Operador</strong> asignado correctamente.</Warn>
    <Tip>Puedes iniciar sesión con Google si el administrador habilitó esa opción. Recomendamos usar una cuenta corporativa del condominio.</Tip>
    <Mockup title="Pantalla de acceso">
      <div className="bg-gradient-to-b from-slate-900 to-slate-800 px-6 py-8 flex flex-col items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center">
          <Shield size={26} className="text-indigo-400" />
        </div>
        <div className="text-center">
          <p className="font-bold text-white text-base">Portería Virtual</p>
          <p className="text-xs text-slate-400 mt-0.5">Panel de Operador</p>
        </div>
        <div className="w-full space-y-2">
          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5">
            <p className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide mb-1">Correo electrónico</p>
            <p className="text-xs text-slate-300">operador@condominio.cl</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5">
            <p className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide mb-1">Contraseña</p>
            <p className="text-xs text-slate-300">••••••••••</p>
          </div>
        </div>
        <div className="w-full bg-indigo-600 rounded-xl py-2.5 text-center">
          <p className="text-xs font-bold text-white">Iniciar sesión</p>
        </div>
      </div>
    </Mockup>
  </div>
);

const SecDashboard = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      El <strong className="text-slate-900 dark:text-white">Panel de Inicio</strong> muestra en tiempo real el estado del condominio: visitas activas, incidentes abiertos, encomiendas pendientes y últimos accesos.
    </p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
      {[
        { color: 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20', tc: 'text-blue-700 dark:text-blue-300', lc: 'text-blue-500', n: '4', label: 'Visitas activas' },
        { color: 'bg-red-50 dark:bg-red-500/10 border-red-200 dark:border-red-500/20',     tc: 'text-red-700 dark:text-red-300',   lc: 'text-red-500',  n: '2', label: 'Incidentes abiertos' },
        { color: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20', tc: 'text-amber-700 dark:text-amber-300', lc: 'text-amber-500', n: '7', label: 'Encomiendas pendientes' },
        { color: 'bg-emerald-50 dark:bg-emerald-500/10 border-emerald-200 dark:border-emerald-500/20', tc: 'text-emerald-700 dark:text-emerald-300', lc: 'text-emerald-500', n: '12', label: 'Accesos hoy' },
      ].map(s => (
        <div key={s.label} className={cn('border rounded-xl p-3 flex items-center gap-3', s.color)}>
          <p className={cn('text-2xl font-black leading-none', s.tc)}>{s.n}</p>
          <p className={cn('text-xs font-semibold', s.lc)}>{s.label}</p>
        </div>
      ))}
    </div>
    <Tip>Los contadores del panel se actualizan en tiempo real. Si ves un número en rojo, prioriza revisar esa sección.</Tip>
    <Ok>El dashboard es solo de lectura — no puedes modificar nada desde aquí, pero te da una vista completa de la situación actual.</Ok>
  </div>
);

const SecResidentes = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      El módulo <strong className="text-slate-900 dark:text-white">Residentes</strong> te permite consultar la información de contacto de los habitantes del condominio y sus unidades.
    </p>
    <div className="space-y-1 mb-3">
      <Step n={1}>Ve a <strong>Residentes</strong> en el menú lateral</Step>
      <Step n={2}>Usa la <strong>barra de búsqueda</strong> para encontrar a un residente por nombre, unidad o correo</Step>
      <Step n={3}>Haz clic en un residente para ver su información de contacto y unidad</Step>
    </div>
    <Mockup title="Módulo Residentes">
      <div className="p-4">
        <div className="flex items-center gap-2 bg-white dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-xl px-3 py-2 mb-3">
          <Search size={12} className="text-slate-400" />
          <p className="text-xs text-slate-400">Buscar por nombre, unidad o correo…</p>
        </div>
        {[
          { name: 'María González',  unit: 'Depto 304', phone: '+56 9 8765 4321' },
          { name: 'Carlos Pérez',    unit: 'Depto 201', phone: '+56 9 1234 5678' },
          { name: 'Ana Martínez',    unit: 'Casa 5',    phone: '+56 9 9876 5432' },
        ].map(r => (
          <div key={r.name} className="flex items-center gap-3 p-2.5 bg-white dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-xl mb-2">
            <div className="w-8 h-8 rounded-lg bg-indigo-100 dark:bg-indigo-500/15 flex items-center justify-center text-xs font-bold text-indigo-700 dark:text-indigo-300">
              {r.name.split(' ').map(w => w[0]).join('').slice(0,2)}
            </div>
            <div className="flex-1">
              <p className="text-xs font-semibold text-slate-900 dark:text-white">{r.name}</p>
              <p className="text-[10px] text-slate-400">{r.unit} · {r.phone}</p>
            </div>
          </div>
        ))}
      </div>
    </Mockup>
    <Tip>El módulo de residentes es de <strong>solo lectura</strong> para el operador. Si necesitas modificar datos de un residente, contacta al administrador.</Tip>
  </div>
);

const SecVisitas = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      El módulo <strong className="text-slate-900 dark:text-white">Visitas</strong> es uno de los más importantes. Desde aquí validas la entrada de visitantes escaneando su código QR y registras los eventos de ingreso y salida.
    </p>
    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2">Validar entrada con QR</h4>
    <div className="space-y-1 mb-3">
      <Step n={1}>Ve a <strong>Visitas</strong> en el menú lateral</Step>
      <Step n={2}>Pulsa el botón <strong>"Escanear QR"</strong> y apunta la cámara al código del visitante</Step>
      <Step n={3}>El sistema mostrará los datos del pase: nombre, unidad destino, fecha y horario autorizado</Step>
      <Step n={4}>Si es válido, pulsa <strong>"Confirmar Entrada"</strong>. Si está vencido o inválido, deniega el acceso</Step>
    </div>
    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2 mt-4">Registrar salida</h4>
    <div className="space-y-1 mb-3">
      <Step n={1}>Busca la visita en la lista con estado <Pill color="blue">En Visita</Pill></Step>
      <Step n={2}>Haz clic en la visita y pulsa <strong>"Registrar Salida"</strong></Step>
    </div>
    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2 mt-4">Crear pase manual</h4>
    <div className="space-y-1 mb-3">
      <Step n={1}>Pulsa <strong>"+ Nueva Visita"</strong></Step>
      <Step n={2}>Completa: nombre, RUT, unidad destino, fecha y horario</Step>
      <Step n={3}>Pulsa <strong>"Guardar"</strong> — el pase queda registrado en el sistema</Step>
    </div>
    <Warn>Solo autoriza visitas que tengan un pase válido o que el residente haya confirmado verbalmente. Nunca ingreses visitas sin autorización.</Warn>
    <div className="grid grid-cols-2 gap-2 mt-3">
      {[
        { c: 'yellow', label: 'Pendiente',  desc: 'No ha llegado aún' },
        { c: 'blue',   label: 'En Visita',  desc: 'Ingresó al condominio' },
        { c: 'green',  label: 'Se fue',     desc: 'Registró salida' },
        { c: 'slate',  label: 'Expirado',   desc: 'Fuera del horario' },
      ].map(s => (
        <div key={s.label} className="flex items-center gap-2 p-2 rounded-lg border border-slate-100 dark:border-white/5 bg-white dark:bg-white/[0.02]">
          <Pill color={s.c as 'yellow'|'blue'|'green'|'slate'}>{s.label}</Pill>
          <span className="text-[10px] text-slate-500 dark:text-slate-400">{s.desc}</span>
        </div>
      ))}
    </div>
  </div>
);

const SecIncidentes = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      Los <strong className="text-slate-900 dark:text-white">Incidentes</strong> son eventos o problemas que ocurren en el condominio: daños, ruidos, problemas de seguridad, etc. El operador los registra y hace seguimiento hasta su resolución.
    </p>
    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2">Registrar un incidente</h4>
    <div className="space-y-1 mb-3">
      <Step n={1}>Ve a <strong>Incidentes</strong> y pulsa <strong>"+ Nuevo Incidente"</strong></Step>
      <Step n={2}>Selecciona el <strong>tipo</strong> (seguridad, infraestructura, ruidos, etc.) y la <strong>prioridad</strong></Step>
      <Step n={3}>Describe el incidente con el mayor detalle posible: lugar, hora, personas involucradas</Step>
      <Step n={4}>Asigna el incidente a un técnico si requiere intervención</Step>
      <Step n={5}>Pulsa <strong>"Guardar"</strong> — el incidente queda abierto hasta su resolución</Step>
    </div>
    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2 mt-4">Cerrar un incidente</h4>
    <div className="space-y-1 mb-3">
      <Step n={1}>Abre el incidente desde la lista</Step>
      <Step n={2}>Agrega una nota de resolución describiendo cómo se solucionó</Step>
      <Step n={3}>Cambia el estado a <Pill color="green">Resuelto</Pill></Step>
    </div>
    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2 mt-4 flex items-center gap-1.5">
      <Zap size={13} className="text-amber-500" /> Contingencia — Corte de electricidad
    </h4>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
      Ante un <strong className="text-slate-900 dark:text-white">corte de electricidad</strong> en un recinto (pérdida de cámaras/equipos, aviso de residentes o conserje), el operador coordina de inmediato:
    </p>
    <div className="space-y-1 mb-3">
      <Step n={1}>Informar de inmediato al <strong>supervisor</strong>, que gestiona con los <strong>técnicos disponibles</strong> la revisión en terreno.</Step>
      <Step n={2}>Verificar si el condominio cuenta con <strong>generador</strong> y si realizó el <strong>encendido automático</strong>.</Step>
      <Step n={3}>Si <strong>no encendió</strong>, puede tratarse de una <strong>baja de voltaje</strong> (no un corte total): el generador, mediante el <strong>ATS</strong>, necesita que el voltaje esté en <strong>cero</strong> para partir automáticamente.</Step>
      <Step n={4}>Solicitar a la <strong>persona designada por el condominio</strong> que realice un <strong>corte del automático general</strong> asociado a nuestro sistema, para que el <strong>ATS detecte energía cero</strong> y encienda de manera automática.</Step>
      <Step n={5}>Todo lo anterior, <strong>mientras el personal técnico va en camino</strong>. Registrar el evento (hora, recinto, acciones) y mantener informado al supervisor hasta el restablecimiento.</Step>
    </div>
    <Warn>El operador <strong>no manipula tableros eléctricos</strong>: solo coordina a distancia. El corte del automático general lo realiza <strong>únicamente la persona designada por el condominio</strong>. Ante riesgo eléctrico, priorizar la seguridad de las personas y esperar al personal técnico.</Warn>
    <Mockup title="Lista de Incidentes">
      <div className="p-4 space-y-2">
        {[
          { title: 'Filtración en pasillo 3', type: 'Infraestructura', pri: 'Alta',  estado: 'red'   as const, estadoLabel: 'Abierto'    },
          { title: 'Ruidos nocturnos D-502',  type: 'Convivencia',     pri: 'Media', estado: 'yellow'as const, estadoLabel: 'En gestión' },
          { title: 'Puerta garaje atascada',  type: 'Seguridad',       pri: 'Alta',  estado: 'green' as const, estadoLabel: 'Resuelto'   },
        ].map(i => (
          <div key={i.title} className="flex items-start gap-3 p-3 bg-white dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-xl">
            <div className="flex-1">
              <p className="text-xs font-semibold text-slate-900 dark:text-white mb-0.5">{i.title}</p>
              <p className="text-[10px] text-slate-400">{i.type} · Prioridad {i.pri}</p>
            </div>
            <Pill color={i.estado}>{i.estadoLabel}</Pill>
          </div>
        ))}
      </div>
    </Mockup>
    <Ok>Registrar incidentes con detalle es fundamental para el historial del condominio y para que los administradores tomen decisiones informadas.</Ok>
  </div>
);

const SecInstalaciones = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      En <strong className="text-slate-900 dark:text-white">Instalaciones</strong> puedes gestionar las reservas de espacios comunes: ver el calendario de reservas, aprobar o rechazar solicitudes y bloquear horarios por mantenimiento.
    </p>
    <div className="space-y-1 mb-3">
      <Step n={1}>Ve a <strong>Instalaciones</strong> en el menú lateral</Step>
      <Step n={2}>Selecciona el espacio para ver su calendario de reservas</Step>
      <Step n={3}>Para confirmar una reserva pendiente, ábrela y pulsa <strong>"Confirmar"</strong></Step>
      <Step n={4}>Para bloquear un horario (ej. mantenimiento), usa la opción <strong>"Agregar bloqueo"</strong></Step>
    </div>
    <Tip>Las reservas confirmadas envían una notificación automática al residente. Las rechazadas también — siempre incluye una razón al rechazar.</Tip>
    <Warn>No puedes modificar una reserva ya confirmada. Si el residente necesita cambiar el horario, debe cancelar y hacer una nueva reserva.</Warn>
  </div>
);

const SecEncomiendas = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      El operador es responsable de <strong className="text-slate-900 dark:text-white">registrar los paquetes</strong> que llegan a portería y notificar al residente. También marca los paquetes cuando son retirados.
    </p>
    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2">Registrar encomienda nueva</h4>
    <div className="space-y-1 mb-3">
      <Step n={1}>Ve a <strong>Encomiendas</strong> y pulsa <strong>"+ Registrar Encomienda"</strong></Step>
      <Step n={2}>Selecciona al residente destinatario buscando por nombre o unidad</Step>
      <Step n={3}>Ingresa el courier (Starken, Chilexpress, DHL, etc.) y una descripción opcional</Step>
      <Step n={4}>Pulsa <strong>"Guardar"</strong> — el residente recibe una notificación automática</Step>
    </div>
    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2 mt-4">Marcar como retirado</h4>
    <div className="space-y-1 mb-3">
      <Step n={1}>Busca la encomienda en la lista (estado <Pill color="yellow">Pendiente</Pill>)</Step>
      <Step n={2}>Haz clic y pulsa <strong>"Marcar como Retirado"</strong></Step>
      <Step n={3}>Confirma la acción — la encomienda pasa a estado <Pill color="green">Retirado</Pill></Step>
    </div>
    <Mockup title="Módulo Encomiendas">
      <div className="p-4">
        {[
          { r: 'María González — D304', courier: 'Starken',     est: 'yellow' as const, label: 'Pendiente' },
          { r: 'Carlos Pérez — D201',   courier: 'Chilexpress',  est: 'yellow' as const, label: 'Pendiente' },
          { r: 'Ana Martínez — Casa 5', courier: 'DHL',          est: 'green'  as const, label: 'Retirado'  },
        ].map(p => (
          <div key={p.r} className="flex items-center gap-3 p-3 bg-white dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-xl mb-2">
            <Package size={14} className="text-amber-500 shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-semibold text-slate-900 dark:text-white">{p.r}</p>
              <p className="text-[10px] text-slate-400 flex items-center gap-1"><Clock size={8} /> {p.courier}</p>
            </div>
            <Pill color={p.est}>{p.label}</Pill>
          </div>
        ))}
      </div>
    </Mockup>
    <Ok>Registrar las encomiendas rápido mejora la experiencia del residente y evita acumulación de paquetes en portería.</Ok>
  </div>
);

const SecAccesos = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      <strong className="text-slate-900 dark:text-white">Registros de Acceso</strong> muestra el historial completo de entradas y salidas registradas en el Sistema de Portería Virtual. Útil para verificar eventos pasados.
    </p>
    <div className="space-y-1 mb-3">
      <Step n={1}>Ve a <strong>Registros de Acceso</strong> en el menú</Step>
      <Step n={2}>Usa los filtros de <strong>fecha</strong> para acotar el rango de búsqueda</Step>
      <Step n={3}>Usa la <strong>barra de búsqueda</strong> para buscar por nombre de persona o unidad</Step>
      <Step n={4}>Cambia entre las pestañas <strong>Accesos</strong>, <strong>Visitas</strong> y <strong>Vehículos</strong></Step>
    </div>
    <Tip>Los registros se cargan desde el servidor con caché de 5 minutos para no sobrecargar el sistema. Si necesitas datos al instante, espera y recarga.</Tip>
    <Warn>Los registros de acceso son de <strong>solo lectura</strong>. No se pueden modificar ni eliminar desde este módulo.</Warn>
    <Mockup title="Registros de Acceso">
      <div className="p-4">
        <div className="flex gap-2 mb-3">
          {['Accesos', 'Visitas', 'Vehículos'].map((t, i) => (
            <div key={t} className={cn('px-3 py-1.5 rounded-lg text-[10px] font-bold', i === 0 ? 'bg-indigo-600 text-white' : 'bg-slate-100 dark:bg-white/5 text-slate-500')}>
              {t}
            </div>
          ))}
        </div>
        {[
          { name: 'María González', unit: 'D304', hora: '08:32', dir: 'Entrada' },
          { name: 'Carlos Pérez',   unit: 'D201', hora: '08:45', dir: 'Entrada' },
          { name: 'Delivery DHL',   unit: 'Portería', hora: '09:10', dir: 'Entrada' },
          { name: 'María González', unit: 'D304', hora: '18:20', dir: 'Salida' },
        ].map((a, i) => (
          <div key={i} className="flex items-center gap-3 p-2.5 border-b border-slate-100 dark:border-white/5 last:border-0">
            <UserCheck size={12} className={a.dir === 'Entrada' ? 'text-emerald-500' : 'text-slate-400'} />
            <div className="flex-1">
              <p className="text-xs font-semibold text-slate-900 dark:text-white">{a.name}</p>
              <p className="text-[10px] text-slate-400">{a.unit}</p>
            </div>
            <div className="text-right">
              <p className="text-[10px] text-slate-500">{a.hora}</p>
              <Pill color={a.dir === 'Entrada' ? 'green' : 'slate'}>{a.dir}</Pill>
            </div>
          </div>
        ))}
      </div>
    </Mockup>
  </div>
);

const SecWhatsApp = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      El módulo <strong className="text-slate-900 dark:text-white">WhatsApp Chat</strong> permite atender mensajes entrantes de residentes a través del número de WhatsApp del condominio asignado a tu cuenta.
    </p>
    <div className="space-y-1 mb-3">
      <Step n={1}>Ve a <strong>WhatsApp — Chats</strong> en el menú lateral</Step>
      <Step n={2}>Verás la lista de conversaciones del número asignado a ti</Step>
      <Step n={3}>Haz clic en una conversación para ver el historial de mensajes</Step>
      <Step n={4}>Escribe tu respuesta en la caja de texto inferior y pulsa <strong>Enviar</strong></Step>
    </div>
    <Tip>Solo verás las conversaciones del número de WhatsApp que el administrador te asignó. Si necesitas acceso a otro número, contáctalo.</Tip>
    <Warn>Los mensajes enviados desde aquí salen con el número del condominio. Mantén un tono profesional y responde dentro del horario de turno.</Warn>
    <Mockup title="WhatsApp Chat">
      <div className="flex h-40">
        <div className="w-32 border-r border-slate-200 dark:border-white/10 p-2 space-y-1">
          {['María G. · D304', 'Carlos P. · D201', 'Ana M. · Casa 5'].map((c, i) => (
            <div key={c} className={cn('p-2 rounded-lg', i === 0 ? 'bg-indigo-50 dark:bg-indigo-500/15' : '')}>
              <p className="text-[9px] font-semibold text-slate-900 dark:text-white truncate">{c}</p>
              <p className="text-[8px] text-slate-400 truncate">Hola, consulta sobre…</p>
            </div>
          ))}
        </div>
        <div className="flex-1 flex flex-col p-2">
          <div className="flex-1 space-y-1.5">
            <div className="bg-slate-100 dark:bg-white/10 rounded-lg p-2 max-w-[80%]">
              <p className="text-[9px] text-slate-700 dark:text-slate-300">Hola, ¿pueden abrir el portón? Llegó mi visita.</p>
            </div>
            <div className="bg-indigo-600 rounded-lg p-2 max-w-[80%] ml-auto">
              <p className="text-[9px] text-white">Claro, ya le abro. ¿A qué unidad va?</p>
            </div>
          </div>
          <div className="flex gap-1 mt-1">
            <div className="flex-1 bg-slate-100 dark:bg-white/5 rounded-lg px-2 py-1">
              <p className="text-[8px] text-slate-400">Escribir mensaje…</p>
            </div>
            <div className="bg-indigo-600 rounded-lg px-2 py-1 flex items-center">
              <p className="text-[8px] text-white font-bold">→</p>
            </div>
          </div>
        </div>
      </div>
    </Mockup>
  </div>
);

const SecComunicaciones = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      El módulo <strong className="text-slate-900 dark:text-white">Comunicaciones</strong> permite enviar mensajes y avisos a los residentes — ya sea a todo el condominio, a una unidad específica, o a una persona en particular.
    </p>
    <div className="space-y-1 mb-3">
      <Step n={1}>Ve a <strong>Comunicaciones</strong> en el menú lateral</Step>
      <Step n={2}>Pulsa <strong>"+ Nueva Comunicación"</strong></Step>
      <Step n={3}>Selecciona el <strong>destinatario</strong>: condominio completo, un condo específico, o una persona</Step>
      <Step n={4}>Escribe el <strong>asunto</strong> y el <strong>mensaje</strong></Step>
      <Step n={5}>Pulsa <strong>"Enviar"</strong> — los destinatarios recibirán una notificación en la app</Step>
    </div>
    <div className="grid grid-cols-3 gap-2 mb-3">
      {[
        { color: 'bg-red-50 dark:bg-red-500/10 border-red-200', tc: 'text-red-700 dark:text-red-300', label: 'Masivo', desc: 'Todos los usuarios' },
        { color: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200', tc: 'text-amber-700 dark:text-amber-300', label: 'Condominio', desc: 'Un condo específico' },
        { color: 'bg-blue-50 dark:bg-blue-500/10 border-blue-200', tc: 'text-blue-700 dark:text-blue-300', label: 'Persona', desc: 'Un residente' },
      ].map(t => (
        <div key={t.label} className={cn('border rounded-xl p-3 text-center', t.color)}>
          <p className={cn('text-xs font-bold mb-1', t.tc)}>{t.label}</p>
          <p className="text-[10px] text-slate-500 dark:text-slate-400">{t.desc}</p>
        </div>
      ))}
    </div>
    <Warn>Los mensajes masivos los ve <strong>toda la plataforma</strong>. Úsalos solo para avisos importantes (corte de agua, mantención general, etc.).</Warn>
    <Ok>El historial de comunicaciones queda guardado y los administradores pueden revisarlo en cualquier momento.</Ok>
  </div>
);

const SecAppResidentes = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      Como parte de la <strong className="text-slate-900 dark:text-white">acreditación</strong>, el operador orienta al residente para <strong>descargar la app</strong> e <strong>iniciar sesión</strong> con los datos que se le entregan.
    </p>
    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2">Dónde descargarla</h4>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
      Está disponible como <strong>app nativa</strong>. Indicar al residente que busque exactamente <strong>"Portería Virtual App"</strong> y verifique que el desarrollador sea <strong>porteriavirtual.cl</strong>.
    </p>
    <div className="grid grid-cols-2 gap-2 mb-3">
      {[
        { icon: '🍎', t: 'App Store', s: 'iPhone / iPad', b: 'Obtener' },
        { icon: '🤖', t: 'Google Play', s: 'Android', b: 'Instalar' },
      ].map(x => (
        <div key={x.t} className="border border-slate-200 dark:border-white/10 rounded-xl p-3 bg-white dark:bg-white/[0.02]">
          <div className="flex items-center gap-2 mb-2">
            <span className="text-lg">{x.icon}</span>
            <div>
              <p className="text-xs font-bold text-slate-900 dark:text-white leading-tight">Portería Virtual App</p>
              <p className="text-[10px] text-slate-400">{x.t} · {x.s}</p>
            </div>
          </div>
          <div className="text-center text-[11px] font-bold text-indigo-600 dark:text-indigo-300 bg-indigo-50 dark:bg-indigo-500/10 rounded-lg py-1.5">{x.b}</div>
        </div>
      ))}
    </div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">También puede usarse desde el navegador en <strong>app.porteriavirtual.cl</strong>, sin instalar nada.</p>
    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2">Datos que entrega el operador</h4>
    <div className="space-y-1 mb-3">
      <Step n={1}>El <strong>correo electrónico</strong> del residente (el mismo enrolado en el sistema).</Step>
      <Step n={2}>La <strong>contraseña inicial</strong> asignada al crear su cuenta de acceso.</Step>
    </div>
    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2 mt-4">Ingreso (indicar al residente)</h4>
    <div className="space-y-1 mb-3">
      <Step n={1}>Abrir la app <strong>Portería Virtual</strong> (o entrar a app.porteriavirtual.cl).</Step>
      <Step n={2}>Escribir el <strong>correo</strong> y la <strong>contraseña</strong> entregados (el ícono 👁️ muestra la clave).</Step>
      <Step n={3}>Pulsar <strong>"Iniciar sesión"</strong>.</Step>
      <Step n={4}>Recomendar <strong>cambiar la contraseña</strong> inicial desde <strong>Mi perfil</strong>.</Step>
    </div>
    <Tip>Para el residente, comparte el instructivo visual: <strong>app.porteriavirtual.cl/manual-residente.html</strong>. En iPhone también puede entrar con <strong>Apple</strong> y, en ambos sistemas, con <strong>Google</strong>, siempre usando el mismo correo con el que fue acreditado.</Tip>
    <Warn>Si el residente <strong>no puede ingresar</strong>: verifica que tenga <strong>cuenta de acceso creada</strong> con su correo (no basta con estar enrolado). Si su correo es hotmail/outlook, <strong>no</strong> debe usar "Continuar con Google". Ante dudas, escala al supervisor/administrador para restablecer la clave.</Warn>
  </div>
);

const SecLey21719 = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      La <strong className="text-slate-900 dark:text-white">Ley N° 21.719</strong> regula el tratamiento y protección de los <strong>datos personales</strong> en Chile. Como el control de acceso opera con <strong>reconocimiento facial</strong> —un <strong>dato sensible</strong>—, todo el personal debe conocer y respetar estas obligaciones. El operador maneja datos personales a diario (nombres, RUT, patentes, imágenes) y es responsable de su uso correcto.
    </p>
    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2">Consentimiento del residente</h4>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
      La app solicita a cada residente su <strong>consentimiento explícito</strong> para el uso del reconocimiento facial, del titular y de los integrantes de su hogar. Quien no desee usar el rostro puede acceder mediante <strong>código QR</strong>, sin que ello afecte su ingreso.
    </p>
    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2">Obligaciones del operador</h4>
    <div className="space-y-1 mb-3">
      <Step n={1}><strong>Confidencialidad:</strong> los datos son de uso interno; no se comparten con terceros no autorizados.</Step>
      <Step n={2}><strong>Finalidad:</strong> usar los datos solo para el control de acceso y la seguridad del recinto; nunca para fines personales.</Step>
      <Step n={3}><strong>Mínimo necesario:</strong> solicitar y registrar únicamente los datos requeridos para autorizar un ingreso.</Step>
      <Step n={4}><strong>Resguardo de credenciales:</strong> no compartir usuarios/contraseñas y cerrar sesión al terminar el turno.</Step>
    </div>
    <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 uppercase tracking-wide mb-2 mt-4">Derechos de los titulares</h4>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-3">
      Los residentes pueden <strong>acceder, rectificar, eliminar o portar</strong> sus datos y <strong>revocar</strong> su consentimiento. El operador <strong>deriva</strong> estas solicitudes al supervisor/administrador — no las resuelve por su cuenta.
    </p>
    <Warn><strong>Prohibido:</strong> sacar fotos de pantallas, exportar o enviar datos de residentes por canales personales, comentar información de personas fuera del servicio, o usar imágenes/datos para fines ajenos al control de acceso. El incumplimiento es una <strong>falta grave</strong>.</Warn>
    <Ok>La ley entra en plena vigencia el <strong>1 de diciembre de 2026</strong>. Portería Virtual ya incorporó el flujo de consentimiento y las medidas de resguardo; aplícalas desde ya.</Ok>
  </div>
);

const SecFAQ = () => {
  const faqs = [
    { q: '¿Qué hago si el QR de una visita no escanea?', a: 'Pide al residente que reenvíe el pase. Si persiste, puedes registrar la visita manualmente desde "Nueva Visita" y verificar la identidad con documento.' },
    { q: '¿Puedo registrar una visita sin QR?', a: 'Sí. Usa el botón "+ Nueva Visita" para crear un pase manual. Necesitas nombre del visitante, unidad destino y horario.' },
    { q: '¿Qué hago si un residente dice que no recibió la notificación de su encomienda?', a: 'Verifica que la encomienda esté registrada en el sistema con la unidad correcta. Si está correcto, el residente debe revisar sus notificaciones en la campana de la app.' },
    { q: '¿Cómo sé si un incidente fue asignado a un técnico?', a: 'En la lista de incidentes verás el nombre del técnico asignado junto al estado. Si dice "Sin asignar", debes asignarlo manualmente desde el detalle del incidente.' },
    { q: '¿Puedo ver mensajes de WhatsApp de otros números del condominio?', a: 'No. Solo puedes ver las conversaciones del número que el administrador te asignó. Esto es por seguridad y privacidad de las comunicaciones.' },
    { q: '¿Qué hago si el sistema muestra un error de conexión?', a: 'Recarga la página. Si el problema persiste, contacta al administrador o al soporte técnico de Portería Virtual.' },
  ];
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">Respuestas a situaciones frecuentes durante la operación.</p>
      <div className="space-y-2">
        {faqs.map((f, i) => (
          <div key={i} className="border border-slate-200 dark:border-white/10 rounded-xl overflow-hidden">
            <button
              onClick={() => setOpen(open === i ? null : i)}
              className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left bg-white dark:bg-white/[0.02] hover:bg-slate-50 dark:hover:bg-white/5 transition-colors cursor-pointer"
            >
              <span className="text-sm font-semibold text-slate-900 dark:text-white">{f.q}</span>
              <ChevronDown size={15} className={cn('text-slate-400 shrink-0 transition-transform duration-200', open === i && 'rotate-180')} />
            </button>
            {open === i && (
              <div className="px-4 pb-3 pt-1 bg-slate-50 dark:bg-white/[0.02] border-t border-slate-100 dark:border-white/5">
                <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed">{f.a}</p>
              </div>
            )}
          </div>
        ))}
      </div>
      <div className="mt-6 p-4 rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-700 text-white flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
          <FileText size={22} className="text-indigo-200" />
        </div>
        <div>
          <p className="font-bold text-sm mb-0.5">¿Necesitas más ayuda?</p>
          <p className="text-xs text-indigo-200 leading-relaxed">
            Contacta al <strong className="text-white">administrador del condominio</strong> para permisos o configuraciones, o escribe a <strong className="text-white">soporte@porteriavirtual.cl</strong> para soporte técnico.
          </p>
        </div>
      </div>
    </div>
  );
};

/* ─── Main ──────────────────────────────────────────────────────────────── */

const SECTIONS: Section[] = [
  { id: 'ingreso',        icon: <LogIn size={16} />,         title: '¿Cómo ingresar al sistema?',      badge: '1',  content: <SecIngreso /> },
  { id: 'dashboard',      icon: <Home size={16} />,          title: 'Panel de Inicio',                  badge: '2',  content: <SecDashboard /> },
  { id: 'residentes',     icon: <Users size={16} />,         title: 'Consultar Residentes',             badge: '3',  content: <SecResidentes /> },
  { id: 'visitas',        icon: <QrCode size={16} />,        title: 'Gestión de Visitas y Pases QR',    badge: '4',  content: <SecVisitas /> },
  { id: 'incidentes',     icon: <AlertTriangle size={16} />, title: 'Registro de Incidentes',           badge: '5',  content: <SecIncidentes /> },
  { id: 'instalaciones',  icon: <Calendar size={16} />,      title: 'Gestión de Instalaciones',         badge: '6',  content: <SecInstalaciones /> },
  { id: 'encomiendas',    icon: <Package size={16} />,       title: 'Registro de Encomiendas',          badge: '7',  content: <SecEncomiendas /> },
  { id: 'accesos',        icon: <ClipboardList size={16} />, title: 'Registros de Acceso',              badge: '8',  content: <SecAccesos /> },
  { id: 'whatsapp',       icon: <MessageCircle size={16} />, title: 'WhatsApp Chat',                    badge: '9',  content: <SecWhatsApp /> },
  { id: 'comunicaciones', icon: <Megaphone size={16} />,     title: 'Enviar Comunicaciones',            badge: '10', content: <SecComunicaciones /> },
  { id: 'app-residentes', icon: <Smartphone size={16} />,    title: 'Descarga de la App (Residentes)',  badge: '11', content: <SecAppResidentes /> },
  { id: 'ley21719',       icon: <Lock size={16} />,          title: 'Protección de Datos · Ley 21.719', badge: '12', content: <SecLey21719 /> },
  { id: 'faq',            icon: <CheckCircle2 size={16} />,  title: 'Preguntas frecuentes',             badge: '?',  content: <SecFAQ /> },
];

export default function OperatorManual() {
  const [openSection, setOpenSection] = useState<string | null>('ingreso');
  const toggle = (id: string) => setOpenSection(prev => prev === id ? null : id);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <PageHeader
        eyebrow="Ayuda"
        title="Manual del Operador"
        description="Guía de procedimientos operativos para el uso de Portería Virtual."
        icon={BookOpen}
      />

      <Card className="!p-0 overflow-hidden">
        <div className="bg-gradient-to-r from-indigo-600 to-violet-700 px-6 py-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
            <Shield size={22} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-white text-base leading-snug">Panel de Operador — Portería Virtual</p>
            <p className="text-sm text-indigo-200 mt-0.5">
              Gestiona visitas, incidentes, encomiendas y comunicaciones del condominio.
            </p>
          </div>
        </div>
        <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-5 gap-3">
          {[
            { icon: <QrCode size={13} className="text-indigo-600 dark:text-indigo-400" />,    text: 'Visitas y QR' },
            { icon: <AlertTriangle size={13} className="text-red-600 dark:text-red-400" />,    text: 'Incidentes' },
            { icon: <Package size={13} className="text-amber-600 dark:text-amber-400" />,      text: 'Encomiendas' },
            { icon: <MessageCircle size={13} className="text-emerald-600 dark:text-emerald-400" />, text: 'WhatsApp' },
            { icon: <Bell size={13} className="text-violet-600 dark:text-violet-400" />,       text: 'Comunicaciones' },
          ].map(f => (
            <div key={f.text} className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-white/5 flex items-center justify-center shrink-0">{f.icon}</span>
              <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 leading-tight">{f.text}</span>
            </div>
          ))}
        </div>
      </Card>

      <div className="space-y-2">
        {SECTIONS.map(sec => {
          const isOpen = openSection === sec.id;
          return (
            <Card key={sec.id} className="!p-0 overflow-hidden">
              <button
                onClick={() => toggle(sec.id)}
                className="w-full flex items-center gap-3 px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors cursor-pointer"
              >
                <span className={cn(
                  'w-8 h-8 rounded-lg flex items-center justify-center shrink-0 transition-colors',
                  isOpen
                    ? 'bg-indigo-600 text-white shadow-sm shadow-indigo-600/30'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400',
                )}>
                  {sec.icon}
                </span>
                <span className="flex-1 text-sm font-semibold text-slate-900 dark:text-white">{sec.title}</span>
                {sec.badge && (
                  <span className={cn(
                    'text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0',
                    isOpen
                      ? 'bg-indigo-100 dark:bg-indigo-500/15 text-indigo-700 dark:text-indigo-300'
                      : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400',
                  )}>
                    {sec.badge}
                  </span>
                )}
                <ChevronDown size={15} className={cn(
                  'text-slate-400 shrink-0 transition-transform duration-200',
                  isOpen && 'rotate-180',
                )} />
              </button>
              {isOpen && (
                <div className="px-5 pb-5 pt-1 border-t border-slate-100 dark:border-white/5">
                  {sec.content}
                </div>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
