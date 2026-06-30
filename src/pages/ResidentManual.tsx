import React, { useState } from 'react';
import {
  BookOpen, QrCode, Calendar, Package, Bell, Home, LogIn,
  ChevronDown, CheckCircle2, AlertTriangle, Info, Smartphone,
  Share2, MapPin, Clock, Shield,
} from 'lucide-react';
import { PageHeader, Card } from '../components/ui';
import { cn } from '../lib/utils';

/* ── Types ── */
interface Section {
  id: string;
  icon: React.ReactNode;
  title: string;
  badge?: string;
  content: React.ReactNode;
}

/* ── Sub-components ── */
const Step = ({ n, children }: { n: number; children: React.ReactNode }) => (
  <div className="flex items-start gap-3 py-2 border-b border-slate-100 dark:border-white/5 last:border-0">
    <span className="w-5 h-5 rounded-full bg-blue-600 text-white flex items-center justify-center text-[10px] font-bold shrink-0 mt-0.5">{n}</span>
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
    <AlertTriangle size={15} className="text-amber-500 shrink-0 mt-0.5" />
    <p className="text-xs text-amber-700 dark:text-amber-300 leading-relaxed">{children}</p>
  </div>
);

const Ok = ({ children }: { children: React.ReactNode }) => (
  <div className="flex gap-2.5 bg-emerald-50 dark:bg-emerald-500/10 border border-emerald-200 dark:border-emerald-500/20 rounded-xl p-3 mt-3">
    <CheckCircle2 size={15} className="text-emerald-500 shrink-0 mt-0.5" />
    <p className="text-xs text-emerald-700 dark:text-emerald-300 leading-relaxed">{children}</p>
  </div>
);

/* ── App mockup shell ── */
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

/* ── Pill badge ── */
const Pill = ({ color, children }: { color: 'yellow' | 'blue' | 'green' | 'slate'; children: React.ReactNode }) => {
  const cls: Record<string, string> = {
    yellow: 'bg-yellow-100 text-yellow-800 dark:bg-yellow-500/15 dark:text-yellow-300',
    blue:   'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
    green:  'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
    slate:  'bg-slate-100 text-slate-600 dark:bg-white/5 dark:text-slate-400',
  };
  return <span className={cn('inline-block rounded-full px-2 py-0.5 text-[10px] font-bold', cls[color])}>{children}</span>;
};

/* ════════════════════════════════════
   SECTION CONTENT
   ════════════════════════════════════ */

const SecIngreso = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      El administrador de tu condominio te enviará un correo con tus credenciales de acceso. Con ellas puedes ingresar desde la app o desde el navegador en <strong className="text-slate-900 dark:text-white">porteriavirtual.cl</strong>.
    </p>
    <div className="space-y-1">
      <Step n={1}>Abre la app o visita <strong>porteriavirtual.cl</strong></Step>
      <Step n={2}>Ingresa tu <strong>correo electrónico</strong> y <strong>contraseña</strong></Step>
      <Step n={3}>Pulsa <strong>"Iniciar sesión"</strong></Step>
    </div>
    <Tip>También puedes iniciar sesión con tu cuenta <strong>Google</strong> si el administrador habilitó esta opción.</Tip>
    <Mockup title="Pantalla de acceso">
      <div className="bg-gradient-to-b from-slate-900 to-slate-800 px-6 py-8 flex flex-col items-center gap-4">
        <div className="w-14 h-14 rounded-2xl bg-blue-600/20 border border-blue-500/30 flex items-center justify-center">
          <Shield size={26} className="text-blue-400" />
        </div>
        <div className="text-center">
          <p className="font-bold text-white text-base">Portería Virtual</p>
          <p className="text-xs text-slate-400 mt-0.5">Ingresa con tu cuenta</p>
        </div>
        <div className="w-full space-y-2">
          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5">
            <p className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide mb-1">Correo electrónico</p>
            <p className="text-xs text-slate-300">residente@correo.com</p>
          </div>
          <div className="bg-white/5 border border-white/10 rounded-xl px-3 py-2.5">
            <p className="text-[9px] text-slate-500 font-semibold uppercase tracking-wide mb-1">Contraseña</p>
            <p className="text-xs text-slate-300">••••••••••</p>
          </div>
        </div>
        <div className="w-full bg-blue-600 rounded-xl py-2.5 text-center">
          <p className="text-xs font-bold text-white">Iniciar sesión</p>
        </div>
        <div className="w-full bg-white/5 border border-white/10 rounded-xl py-2.5 text-center">
          <p className="text-xs text-slate-300">🔵 Continuar con Google</p>
        </div>
      </div>
    </Mockup>
  </div>
);

const SecMenu = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      Después de ingresar verás el <strong className="text-slate-900 dark:text-white">menú lateral</strong> con todas las secciones disponibles para tu perfil de residente.
    </p>
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mb-4">
      {[
        { icon: <Home size={15} />, name: 'Inicio', desc: 'Resumen general de actividad', color: 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300' },
        { icon: <QrCode size={15} />, name: 'Visitas', desc: 'Genera y gestiona pases QR', color: 'bg-purple-100 dark:bg-purple-500/15 text-purple-700 dark:text-purple-300' },
        { icon: <Calendar size={15} />, name: 'Instalaciones', desc: 'Reserva espacios comunes', color: 'bg-emerald-100 dark:bg-emerald-500/15 text-emerald-700 dark:text-emerald-300' },
        { icon: <Package size={15} />, name: 'Encomiendas', desc: 'Sigue tus paquetes en portería', color: 'bg-amber-100 dark:bg-amber-500/15 text-amber-700 dark:text-amber-300' },
        { icon: <Bell size={15} />, name: 'Notificaciones', desc: 'Alertas en tiempo real', color: 'bg-rose-100 dark:bg-rose-500/15 text-rose-700 dark:text-rose-300' },
        { icon: <BookOpen size={15} />, name: 'Manual', desc: 'Esta guía de uso', color: 'bg-slate-100 dark:bg-white/5 text-slate-600 dark:text-slate-300' },
      ].map(m => (
        <div key={m.name} className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02]">
          <span className={cn('w-8 h-8 rounded-lg flex items-center justify-center shrink-0', m.color)}>{m.icon}</span>
          <div>
            <p className="text-sm font-semibold text-slate-900 dark:text-white leading-none mb-0.5">{m.name}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">{m.desc}</p>
          </div>
        </div>
      ))}
    </div>
    <Tip>En móvil, los módulos aparecen en la barra inferior. Pulsa el ícono de menú <strong>(☰)</strong> para ver todas las secciones.</Tip>
  </div>
);

const SecDashboard = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      El <strong className="text-slate-900 dark:text-white">Panel de Inicio</strong> es la primera pantalla que ves. Resume en un vistazo tus visitas activas, próximas reservas y encomiendas pendientes.
    </p>
    <Mockup title="Panel de Inicio">
      <div className="p-4">
        <p className="font-bold text-slate-900 dark:text-white text-sm mb-0.5">¡Hola, María! 👋</p>
        <p className="text-[10px] text-slate-400 mb-3">Condominio Los Olivos · Depto 304</p>
        <div className="grid grid-cols-3 gap-2 mb-3">
          {[
            { n: '2', label: 'Mis Visitas', color: 'bg-purple-50 dark:bg-purple-500/10 border-purple-200 dark:border-purple-500/20', nc: 'text-purple-700 dark:text-purple-300', lc: 'text-purple-500 dark:text-purple-400' },
            { n: '1', label: 'Reservas',   color: 'bg-blue-50 dark:bg-blue-500/10 border-blue-200 dark:border-blue-500/20', nc: 'text-blue-700 dark:text-blue-300', lc: 'text-blue-500 dark:text-blue-400' },
            { n: '3', label: 'Encomiendas', color: 'bg-amber-50 dark:bg-amber-500/10 border-amber-200 dark:border-amber-500/20', nc: 'text-amber-700 dark:text-amber-300', lc: 'text-amber-500 dark:text-amber-400' },
          ].map(s => (
            <div key={s.label} className={cn('border rounded-xl p-2.5 text-center', s.color)}>
              <p className={cn('text-xl font-black leading-none', s.nc)}>{s.n}</p>
              <p className={cn('text-[8px] font-semibold mt-1 leading-tight', s.lc)}>{s.label}</p>
            </div>
          ))}
        </div>
        <div className="grid grid-cols-2 gap-2">
          <div className="bg-white dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-xl p-3">
            <p className="text-[9px] font-bold text-purple-600 dark:text-purple-400 mb-2 flex items-center gap-1"><QrCode size={9} /> Visitas activas</p>
            {['Carlos Pérez', 'Ana Martínez'].map((n, i) => (
              <div key={n} className="flex items-center gap-1.5 py-1 border-b border-slate-50 dark:border-white/5 last:border-0">
                <span className="w-5 h-5 rounded-md bg-slate-100 dark:bg-white/5 flex items-center justify-center text-[9px]">👤</span>
                <div className="flex-1 min-w-0">
                  <p className="text-[9px] font-semibold text-slate-800 dark:text-slate-200 truncate">{n}</p>
                </div>
                <Pill color={i === 0 ? 'yellow' : 'blue'}>{i === 0 ? 'Pendiente' : 'En Visita'}</Pill>
              </div>
            ))}
          </div>
          <div className="bg-white dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-xl p-3">
            <p className="text-[9px] font-bold text-blue-600 dark:text-blue-400 mb-2 flex items-center gap-1"><Calendar size={9} /> Próximas reservas</p>
            <p className="text-[9px] font-semibold text-slate-800 dark:text-slate-200">Quincho N°1</p>
            <p className="text-[8px] text-slate-400">Sáb 14 jun · 13:00–16:00</p>
            <Pill color="green">Confirmada</Pill>
            <p className="text-[9px] font-bold text-amber-600 dark:text-amber-400 mt-2 mb-1 flex items-center gap-1"><Package size={9} /> Encomiendas</p>
            <p className="text-[9px] text-slate-500 dark:text-slate-400">3 paquetes en portería</p>
          </div>
        </div>
      </div>
    </Mockup>
  </div>
);

const SecQR = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      El <strong className="text-slate-900 dark:text-white">Pase QR</strong> es un código digital que autoriza la entrada de una persona al condominio. La portería lo escanea para confirmar que es válido — sin llamadas ni esperas.
    </p>
    <div className="space-y-1 mb-3">
      <Step n={1}>Ve a <strong>Visitas</strong> en el menú</Step>
      <Step n={2}>Pulsa el botón azul <strong>"+ Generar Pase"</strong></Step>
      <Step n={3}>Completa el formulario: nombre del visitante (obligatorio), RUT, patente, fecha y horario</Step>
      <Step n={4}>Pulsa <strong>"Crear Pase"</strong> — el QR se genera al instante</Step>
      <Step n={5}>Toca el pase en la lista para ver el QR y compartirlo por WhatsApp</Step>
    </div>
    <Warn>Si ves <em>"Sin permiso para generar pases QR"</em>, solicita al administrador que active este permiso en tu cuenta.</Warn>
    <Mockup title="Formulario — Nuevo Pase QR">
      <div className="bg-black/40 p-4">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4">
          <p className="font-bold text-slate-900 dark:text-white text-sm mb-4 flex items-center gap-2"><QrCode size={15} className="text-blue-600" /> Nuevo Pase QR</p>
          <div className="grid grid-cols-2 gap-3 mb-3">
            {[
              { l: 'Nombre del visitante *', v: 'Carlos Pérez Rojas' },
              { l: 'RUT (opcional)', v: '12.345.678-9' },
              { l: 'Patente (opcional)', v: 'ABCD12' },
              { l: 'Fecha de visita *', v: '14/06/2025' },
              { l: 'Hora de entrada *', v: '15:00' },
              { l: 'Hora de salida *', v: '18:00' },
            ].map(f => (
              <div key={f.l}>
                <p className="text-[8px] font-bold text-slate-400 uppercase tracking-wide mb-1">{f.l}</p>
                <div className="bg-slate-50 dark:bg-white/5 border border-slate-200 dark:border-white/10 rounded-lg px-2.5 py-1.5">
                  <p className="text-xs text-slate-700 dark:text-slate-300">{f.v}</p>
                </div>
              </div>
            ))}
          </div>
          <div className="flex gap-2 justify-end">
            <div className="bg-slate-100 dark:bg-white/5 rounded-xl px-3 py-2"><p className="text-xs text-slate-500">Cancelar</p></div>
            <div className="bg-blue-600 rounded-xl px-4 py-2"><p className="text-xs text-white font-bold">✓ Crear Pase</p></div>
          </div>
        </div>
      </div>
    </Mockup>
  </div>
);

const SecVerQR = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      Una vez creado el pase, tócalo en la lista para ver el <strong className="text-slate-900 dark:text-white">código QR completo</strong>. Desde ahí puedes enviárselo a tu visita por WhatsApp.
    </p>
    <div className="grid grid-cols-2 gap-4 items-start">
      <div>
        <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Estados del pase</h4>
        <div className="space-y-1.5">
          {[
            { c: 'yellow', label: 'Pendiente', desc: 'Visita aún no ha llegado' },
            { c: 'blue',   label: 'En Visita', desc: 'Ingresó y está en el condo' },
            { c: 'green',  label: 'Se fue',    desc: 'Salió del condominio' },
            { c: 'slate',  label: 'Expirado',  desc: 'La fecha del pase pasó' },
          ].map(s => (
            <div key={s.label} className="flex items-center gap-2 p-2 rounded-lg border border-slate-100 dark:border-white/5 bg-white dark:bg-white/[0.02]">
              <Pill color={s.c as 'yellow' | 'blue' | 'green' | 'slate'}>{s.label}</Pill>
              <span className="text-xs text-slate-500 dark:text-slate-400">{s.desc}</span>
            </div>
          ))}
        </div>
        <Tip>Al pulsar <strong>"Compartir por WhatsApp"</strong> se envía automáticamente la imagen del QR con el nombre, fecha y horario del visitante.</Tip>
      </div>
      <Mockup title="Detalle del Pase">
        <div className="bg-black/40 p-3">
          <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 text-center">
            <p className="font-bold text-slate-900 dark:text-white text-xs mb-0.5">Pase QR — Carlos Pérez</p>
            <p className="text-[9px] text-slate-400 mb-3">Hoy · 15:00–18:00</p>
            {/* QR simulado */}
            <div className="w-24 h-24 mx-auto mb-3 border-2 border-slate-200 dark:border-white/10 rounded-xl grid p-1.5" style={{ gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px' }}>
              {[1,1,1,1,1,0,1, 1,0,0,0,1,0,1, 1,0,1,0,1,0,1, 1,0,0,1,1,0,1, 1,1,1,0,1,1,1, 0,1,0,1,0,1,0, 1,0,1,0,0,1,1].map((v, i) => (
                <div key={i} className={cn('rounded-[1px]', v ? 'bg-slate-900 dark:bg-white' : 'bg-white dark:bg-slate-900')} />
              ))}
            </div>
            <p className="text-[9px] text-slate-400 mb-2">Muestra este código en portería</p>
            <div className="bg-emerald-500 rounded-xl py-2 flex items-center justify-center gap-1.5">
              <Share2 size={11} className="text-white" />
              <p className="text-[10px] font-bold text-white">Compartir por WhatsApp</p>
            </div>
          </div>
        </div>
      </Mockup>
    </div>

    {/* Cómo compartir por WhatsApp + vista previa del mensaje */}
    <div className="mt-6">
      <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Cómo compartir el QR por WhatsApp</h4>
      <div className="space-y-1.5 mb-5">
        <Step n={1}>Toca el pase en la lista para abrir el <strong>código QR</strong></Step>
        <Step n={2}>Pulsa el botón verde <strong>"Compartir por WhatsApp"</strong></Step>
        <Step n={3}>Elige <strong>WhatsApp</strong> y selecciona el contacto de tu visita</Step>
        <Step n={4}>Se envía la <strong>imagen del QR</strong> junto con un <strong>mensaje con todos los datos</strong> — se completa solo, tú no escribes nada</Step>
      </div>

      <h4 className="text-xs font-bold text-slate-700 dark:text-slate-300 mb-2 uppercase tracking-wide">Así le llega a tu visita</h4>
      <div className="grid grid-cols-2 gap-4 items-start">
        {/* Simulación de chat de WhatsApp */}
        <div className="rounded-2xl overflow-hidden border border-slate-200 dark:border-white/10 shadow-sm">
          <div className="bg-emerald-600 px-3 py-2 flex items-center gap-2">
            <div className="w-6 h-6 rounded-full bg-white/25 flex items-center justify-center text-white text-[10px] font-bold">C</div>
            <p className="text-white text-[11px] font-semibold">Carlos Pérez</p>
          </div>
          <div className="p-3 space-y-2" style={{ background: '#ece5dd' }}>
            {/* Burbuja: imagen del QR */}
            <div className="bg-white rounded-lg rounded-tl-none p-2 max-w-[78%] shadow-sm">
              <div className="w-20 h-20 mx-auto border border-slate-200 rounded-md grid p-1" style={{ gridTemplateColumns: 'repeat(7, 1fr)', gap: '1px' }}>
                {[1,1,1,1,1,0,1, 1,0,0,0,1,0,1, 1,0,1,0,1,0,1, 1,0,0,1,1,0,1, 1,1,1,0,1,1,1, 0,1,0,1,0,1,0, 1,0,1,0,0,1,1].map((v, i) => (
                  <div key={i} className={cn('rounded-[1px]', v ? 'bg-slate-900' : 'bg-white')} />
                ))}
              </div>
              <p className="text-[8px] text-slate-400 text-center mt-1">pase-Carlos.png</p>
            </div>
            {/* Burbuja: mensaje autocompletado */}
            <div className="bg-white rounded-lg rounded-tl-none p-2.5 max-w-[88%] shadow-sm">
              <p className="text-[10px] leading-relaxed text-slate-700 whitespace-pre-line">{
`Hola Carlos! 👋

Has recibido un *Pase de Visita* autorizado para acceder a:
🏢 *Edificio El Vergel*
📍 Av. Las Condes 1234
🗺️ Ver en Google Maps
🏠 Unidad: 502

📅 Fecha de vigencia: 2026-06-30
🕐 Horario: 15:00 – 18:00
🚗 Patente: ABCD-12
👤 Autorizado por: María González

Al llegar a la portería, presenta este mensaje en el *Tótem de Portería Virtual* para registrar tu ingreso.

¡Te esperamos! 🏠`}</p>
              <p className="text-[8px] text-slate-400 text-right mt-1">15:01 ✓✓</p>
            </div>
          </div>
        </div>
        <div>
          <Tip>El mensaje se arma <strong>automáticamente</strong> con los datos del pase: condominio, dirección con link a Google Maps, unidad, fecha, horario, patente (o "acceso peatonal") y quién autoriza la visita.</Tip>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-3">
            Tu visita solo debe <strong className="text-slate-700 dark:text-slate-200">mostrar este mensaje (con el QR) en el tótem de la portería</strong> para registrar su ingreso. No necesita instalar nada.
          </p>
        </div>
      </div>
    </div>
  </div>
);

const SecInstalaciones = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      En <strong className="text-slate-900 dark:text-white">Instalaciones</strong> puedes ver los espacios comunes disponibles (quincho, piscina, sala de eventos, etc.) y hacer reservas directamente desde la app.
    </p>
    <div className="space-y-1 mb-3">
      <Step n={1}>Ve a <strong>Instalaciones</strong> en el menú</Step>
      <Step n={2}>Selecciona el espacio que quieres reservar y pulsa <strong>"Reservar"</strong></Step>
      <Step n={3}>Elige la <strong>fecha</strong> y el <strong>horario</strong> disponible</Step>
      <Step n={4}>Confirma la reserva — recibirás una notificación de confirmación</Step>
      <Step n={5}>Opcionalmente agrega la reserva a <strong>Google Calendar</strong> o descarga el archivo <strong>.ics</strong></Step>
    </div>
    <Ok>Recibirás una notificación automática cuando tu reserva sea confirmada o si hay un cambio.</Ok>
    <Mockup title="Módulo Instalaciones">
      <div className="p-4">
        <p className="font-bold text-slate-900 dark:text-white text-sm mb-3">Instalaciones disponibles</p>
        {[
          { name: 'Quincho N°1', cap: '20 personas', icon: '🍖' },
          { name: 'Piscina',     cap: 'Hasta 10 personas', icon: '🏊' },
          { name: 'Sala de Eventos', cap: '50 personas', icon: '🎉' },
        ].map(f => (
          <div key={f.name} className="flex items-center gap-3 p-3 bg-white dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-xl mb-2">
            <span className="w-10 h-10 rounded-xl bg-blue-50 dark:bg-blue-500/10 flex items-center justify-center text-lg">{f.icon}</span>
            <div className="flex-1">
              <p className="text-xs font-bold text-slate-900 dark:text-white">{f.name}</p>
              <p className="text-[10px] text-slate-400 flex items-center gap-1"><MapPin size={8} /> {f.cap}</p>
            </div>
            <div className="bg-blue-600 rounded-lg px-2.5 py-1.5"><p className="text-[10px] font-bold text-white">Reservar</p></div>
          </div>
        ))}
      </div>
    </Mockup>
  </div>
);

const SecEncomiendas = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      Cuando llegue un paquete a portería, recibirás una <strong className="text-slate-900 dark:text-white">notificación automática</strong>. En la sección <strong>Encomiendas</strong> puedes ver el historial completo de tus paquetes.
    </p>
    <Mockup title="Módulo Encomiendas">
      <div className="p-4">
        <p className="font-bold text-slate-900 dark:text-white text-sm mb-3">Mis encomiendas</p>
        {[
          { courier: 'Starken',    fecha: 'Hoy, 10:30',   estado: 'Pendiente' as const, color: 'yellow' as const, icon: '📦' },
          { courier: 'Chilexpress', fecha: 'Ayer, 15:00', estado: 'Pendiente' as const, color: 'yellow' as const, icon: '📦' },
          { courier: 'DHL',        fecha: '10 jun',       estado: 'Retirado'  as const, color: 'green'  as const, icon: '✅' },
        ].map(p => (
          <div key={p.courier + p.fecha} className="flex items-center gap-3 p-3 bg-white dark:bg-white/5 border border-slate-100 dark:border-white/10 rounded-xl mb-2">
            <span className="text-lg">{p.icon}</span>
            <div className="flex-1">
              <p className="text-xs font-bold text-slate-900 dark:text-white">{p.courier}</p>
              <p className="text-[10px] text-slate-400 flex items-center gap-1"><Clock size={8} /> {p.fecha}</p>
            </div>
            <Pill color={p.color}>{p.estado}</Pill>
          </div>
        ))}
      </div>
    </Mockup>
    <Tip>La portería registra el paquete cuando llega. Tú recibes la notificación de inmediato — aunque no estés conectado.</Tip>
  </div>
);

const SecNotificaciones = () => (
  <div>
    <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">
      Las <strong className="text-slate-900 dark:text-white">notificaciones push</strong> te avisan en tiempo real de lo que pasa en el condominio: visitas que ingresan o salen, encomiendas recibidas y confirmaciones de reservas.
    </p>
    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
      {[
        { icon: <QrCode size={16} />, title: 'Visitas', desc: 'Cuando tu visita ingresa o sale del condominio', color: 'bg-purple-50 dark:bg-purple-500/10 text-purple-600 dark:text-purple-400' },
        { icon: <Package size={16} />, title: 'Encomiendas', desc: 'Cuando llega un paquete a portería para ti', color: 'bg-amber-50 dark:bg-amber-500/10 text-amber-600 dark:text-amber-400' },
        { icon: <Calendar size={16} />, title: 'Reservas', desc: 'Confirmaciones y recordatorios de tus reservas', color: 'bg-emerald-50 dark:bg-emerald-500/10 text-emerald-600 dark:text-emerald-400' },
      ].map(n => (
        <div key={n.title} className="flex flex-col items-center text-center p-4 rounded-xl border border-slate-200 dark:border-white/10 bg-white dark:bg-white/[0.02]">
          <span className={cn('w-10 h-10 rounded-xl flex items-center justify-center mb-2', n.color)}>{n.icon}</span>
          <p className="text-sm font-bold text-slate-900 dark:text-white mb-1">{n.title}</p>
          <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">{n.desc}</p>
        </div>
      ))}
    </div>
    <Warn>Asegúrate de que la app tenga <strong>permisos de notificación</strong> activados en tu teléfono para recibirlas en tiempo real.</Warn>
    <Tip>Puedes ver el historial completo de notificaciones tocando el ícono de campana 🔔 en la parte superior de la app.</Tip>
  </div>
);

const SecFAQ = () => {
  const faqs = [
    { q: '¿Qué hago si olvidé mi contraseña?', a: 'En la pantalla de login, toca "¿Olvidaste tu contraseña?" y sigue los pasos. Recibirás un correo para restablecerla.' },
    { q: '¿Puedo generar un QR para varias fechas?', a: 'Sí. Crea un pase por cada visita que quieras autorizar. Cada pase tiene su propia fecha y horario.' },
    { q: '¿El QR tiene vencimiento?', a: 'Sí. Los pases QR expiran automáticamente cuando pasa la hora de salida que configuraste.' },
    { q: '¿Puedo cancelar una reserva?', a: 'Sí. Ve a Instalaciones, busca tu reserva y usa la opción de cancelar. Consulta el reglamento de tu condominio para los plazos de cancelación.' },
    { q: '¿Cómo actualizo mis datos de perfil?', a: 'Toca tu nombre o avatar en la esquina inferior del menú. Desde el perfil puedes cambiar tu contraseña y ver los datos de tu unidad.' },
    { q: '¿La app funciona sin internet?', a: 'Necesitas conexión para ver datos en tiempo real. Sin embargo, el código QR de un pase ya generado puede guardarse como imagen y mostrarse sin conexión.' },
  ];
  const [open, setOpen] = useState<number | null>(null);
  return (
    <div>
      <p className="text-sm text-slate-600 dark:text-slate-300 mb-4">Respuestas a las preguntas más frecuentes de los residentes.</p>
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
      <div className="mt-6 p-4 rounded-2xl bg-gradient-to-br from-blue-600 to-indigo-700 text-white flex items-center gap-4">
        <div className="w-12 h-12 rounded-xl bg-white/10 flex items-center justify-center shrink-0">
          <Smartphone size={22} className="text-blue-200" />
        </div>
        <div>
          <p className="font-bold text-sm mb-0.5">¿Necesitas más ayuda?</p>
          <p className="text-xs text-blue-200 leading-relaxed">
            Contacta a la <strong className="text-white">administración de tu condominio</strong> para problemas de acceso, o escribe a <strong className="text-white">porteriavirtual.cl</strong> para soporte técnico.
          </p>
        </div>
      </div>
    </div>
  );
};

/* ════════════════════════════════════
   MAIN PAGE
   ════════════════════════════════════ */
const SECTIONS: Section[] = [
  { id: 'ingreso',       icon: <LogIn size={16} />,      title: '¿Cómo ingresar?',                  badge: '1', content: <SecIngreso /> },
  { id: 'menu',          icon: <Home size={16} />,        title: 'Estructura de la app',              badge: '2', content: <SecMenu /> },
  { id: 'dashboard',     icon: <Home size={16} />,        title: 'Panel de Inicio',                  badge: '3', content: <SecDashboard /> },
  { id: 'qr',            icon: <QrCode size={16} />,      title: 'Generar Pase QR para visitas',     badge: '4', content: <SecQR /> },
  { id: 'ver-qr',        icon: <Share2 size={16} />,      title: 'Ver y compartir el código QR',     badge: '5', content: <SecVerQR /> },
  { id: 'instalaciones', icon: <Calendar size={16} />,    title: 'Reservar una instalación',         badge: '6', content: <SecInstalaciones /> },
  { id: 'encomiendas',   icon: <Package size={16} />,     title: 'Mis encomiendas',                  badge: '7', content: <SecEncomiendas /> },
  { id: 'notificaciones',icon: <Bell size={16} />,        title: 'Notificaciones',                   badge: '8', content: <SecNotificaciones /> },
  { id: 'faq',           icon: <CheckCircle2 size={16} />,title: 'Preguntas frecuentes',             badge: '?', content: <SecFAQ /> },
];

export default function ResidentManual() {
  const [openSection, setOpenSection] = useState<string | null>('ingreso');

  const toggle = (id: string) => setOpenSection(prev => prev === id ? null : id);

  return (
    <div className="space-y-6 max-w-3xl mx-auto">
      <PageHeader
        eyebrow="Ayuda"
        title="Manual del Residente"
        description="Guía rápida para sacar el máximo provecho de Portería Virtual."
        icon={BookOpen}
      />

      {/* Quick intro card */}
      <Card className="!p-0 overflow-hidden">
        <div className="bg-gradient-to-r from-blue-600 to-indigo-700 px-6 py-5 flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-white/15 flex items-center justify-center shrink-0">
            <Smartphone size={22} className="text-white" />
          </div>
          <div>
            <p className="font-bold text-white text-base leading-snug">Bienvenido/a a Portería Virtual</p>
            <p className="text-sm text-blue-200 mt-0.5">
              Autoriza visitas, reserva espacios y recibe notificaciones — todo desde tu teléfono.
            </p>
          </div>
        </div>
        <div className="px-6 py-4 grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            { icon: <QrCode size={14} className="text-purple-600 dark:text-purple-400" />, text: 'Pases QR para visitas' },
            { icon: <Calendar size={14} className="text-emerald-600 dark:text-emerald-400" />, text: 'Reservas de instalaciones' },
            { icon: <Package size={14} className="text-amber-600 dark:text-amber-400" />, text: 'Seguimiento encomiendas' },
            { icon: <Bell size={14} className="text-rose-600 dark:text-rose-400" />, text: 'Notificaciones en tiempo real' },
          ].map(f => (
            <div key={f.text} className="flex items-center gap-2">
              <span className="w-6 h-6 rounded-lg bg-slate-100 dark:bg-white/5 flex items-center justify-center shrink-0">{f.icon}</span>
              <span className="text-[11px] font-medium text-slate-600 dark:text-slate-300 leading-tight">{f.text}</span>
            </div>
          ))}
        </div>
      </Card>

      {/* Accordion sections */}
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
                    ? 'bg-blue-600 text-white shadow-sm shadow-blue-600/30'
                    : 'bg-slate-100 dark:bg-white/5 text-slate-500 dark:text-slate-400',
                )}>
                  {sec.icon}
                </span>
                <span className="flex-1 text-sm font-semibold text-slate-900 dark:text-white">{sec.title}</span>
                {sec.badge && (
                  <span className={cn(
                    'text-[10px] font-bold px-2 py-0.5 rounded-full shrink-0',
                    isOpen
                      ? 'bg-blue-100 dark:bg-blue-500/15 text-blue-700 dark:text-blue-300'
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
