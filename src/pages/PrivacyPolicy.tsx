import React from 'react';
import { Link } from 'react-router-dom';
import { Shield, ArrowLeft } from 'lucide-react';

const LAST_UPDATE = '20 de abril de 2026';
const COMPANY     = 'Portería Virtual SpA';
const RUT_COMPANY = '77.347.665-9';
const EMAIL       = 'contacto@porteriavirtual.cl';
const ADDRESS     = 'Balmaceda 6171, Isla de Maipo, Región Metropolitana, Chile';
const APP_NAME    = 'Portería Virtual';

const Section = ({ title, children }: { title: string; children: React.ReactNode }) => (
  <section className="mb-8">
    <h2 className="text-lg font-bold text-slate-900 dark:text-white mb-3 pb-2 border-b border-slate-200 dark:border-white/10">
      {title}
    </h2>
    <div className="space-y-3 text-slate-600 dark:text-slate-300 text-sm leading-relaxed">
      {children}
    </div>
  </section>
);

const PrivacyPolicy = () => (
  <div className="min-h-screen bg-slate-50 dark:bg-slate-950 py-10 px-4">
    <div className="max-w-3xl mx-auto">

      {/* Header */}
      <div className="flex items-center gap-3 mb-8">
        <Link
          to="/login"
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white transition-colors"
        >
          <ArrowLeft size={15} /> Volver
        </Link>
      </div>

      <div className="flex items-center gap-3 mb-2">
        <div className="w-10 h-10 rounded-xl bg-blue-600/10 text-blue-600 flex items-center justify-center">
          <Shield size={20} />
        </div>
        <div>
          <h1 className="text-2xl font-black text-slate-900 dark:text-white">Política de Privacidad</h1>
          <p className="text-xs text-slate-500 dark:text-slate-400">{APP_NAME} · Última actualización: {LAST_UPDATE}</p>
        </div>
      </div>

      <div className="mt-8 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-white/10 p-6 sm:p-8 space-y-0">

        <Section title="1. Identidad del Responsable del Tratamiento">
          <p>
            El responsable del tratamiento de sus datos personales es <strong>{COMPANY}</strong>,
            RUT {RUT_COMPANY}, con domicilio en {ADDRESS}.
          </p>
          <p>
            Para consultas o ejercicio de derechos, puede contactarnos en:{' '}
            <a href={`mailto:${EMAIL}`} className="text-blue-600 dark:text-blue-400 underline">{EMAIL}</a>
          </p>
        </Section>

        <Section title="2. Marco Normativo Aplicable">
          <p>
            La presente política se rige por la legislación chilena vigente, en particular:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Ley N° 19.628</strong> sobre Protección de la Vida Privada y sus modificaciones.</li>
            <li><strong>Ley N° 21.719</strong> (nueva Ley de Protección de Datos Personales), en lo que se encuentre vigente.</li>
            <li>Ley N° 19.223 sobre Delitos Informáticos.</li>
            <li>Normativa sectorial aplicable a la administración de condominios (Ley N° 21.442).</li>
          </ul>
        </Section>

        <Section title="3. Datos Personales que Recopilamos">
          <p>En el uso de <strong>{APP_NAME}</strong> podemos recopilar las siguientes categorías de datos:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Datos de identificación:</strong> nombre completo, RUT, fotografía.</li>
            <li><strong>Datos de contacto:</strong> correo electrónico, número de teléfono.</li>
            <li><strong>Datos de acceso al condominio:</strong> patente vehicular, código QR de acceso, historial de ingresos y egresos.</li>
            <li><strong>Datos de la unidad:</strong> número de departamento o casa dentro del condominio.</li>
            <li><strong>Datos de incidencias:</strong> descripción de eventos, fotografías de evidencia, observaciones de cierre.</li>
            <li><strong>Datos de uso de instalaciones:</strong> reservas de espacios comunes y gastos asociados.</li>
            <li><strong>Datos de encomiendas:</strong> registro de paquetes recibidos.</li>
            <li><strong>Datos técnicos:</strong> dirección IP, identificadores de dispositivo, registros de actividad en la plataforma.</li>
          </ul>
        </Section>

        <Section title="4. Finalidad del Tratamiento">
          <p>Sus datos son tratados exclusivamente para las siguientes finalidades:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Control de acceso físico al condominio mediante sistema biométrico y QR.</li>
            <li>Gestión de residentes, visitas, operadores y personal técnico.</li>
            <li>Registro y seguimiento de incidencias de seguridad y mantención.</li>
            <li>Administración de reservas de áreas comunes y registro de gastos.</li>
            <li>Emisión de reportes e informes para la administración del condominio.</li>
            <li>Comunicaciones operativas relacionadas con el condominio.</li>
            <li>Cumplimiento de obligaciones legales y contractuales.</li>
          </ul>
        </Section>

        <Section title="5. Base Legal del Tratamiento">
          <p>El tratamiento de sus datos personales se sustenta en:</p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Consentimiento del titular</strong> (Art. 4 Ley 19.628), otorgado al momento del registro o al aceptar esta política.</li>
            <li><strong>Ejecución de un contrato</strong> de administración de condominio del que el titular es parte.</li>
            <li><strong>Cumplimiento de obligaciones legales</strong> aplicables al administrador del condominio.</li>
            <li><strong>Interés legítimo</strong> en la seguridad de las personas y bienes del condominio.</li>
          </ul>
        </Section>

        <Section title="6. Transferencia y Encargados de Tratamiento">
          <p>
            Sus datos pueden ser tratados por los siguientes prestadores de servicios en calidad de encargados:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <strong>Google LLC (Firebase / Google Cloud)</strong> — almacenamiento en la nube, autenticación y base de datos.
              Operado bajo las condiciones de tratamiento de Google y sujeto a cláusulas contractuales estándar.
            </li>
            <li>
              <strong>Dahua Technology</strong> — sistema de control de acceso físico (DSS), biometría y cámaras IP.
            </li>
          </ul>
          <p>
            No se venden, arriendan ni ceden datos personales a terceros con fines comerciales.
            Los datos no se transfieren al extranjero salvo por los servicios de infraestructura
            descritos, los cuales cuentan con garantías adecuadas conforme a la legislación vigente.
          </p>
        </Section>

        <Section title="7. Plazo de Conservación">
          <p>
            Los datos personales se conservan durante el tiempo en que la persona mantenga una relación
            activa con el condominio, y hasta por <strong>5 años</strong> adicionales desde la terminación
            de dicha relación, salvo que la ley exija un plazo mayor o que el titular solicite su eliminación
            anticipada conforme al artículo 8° de la Ley N° 19.628.
          </p>
          <p>
            Los registros de acceso físico (bitácoras de ingreso/egreso) pueden conservarse por hasta
            <strong> 2 años</strong> para fines de seguridad y auditoría.
          </p>
        </Section>

        <Section title="8. Derechos del Titular">
          <p>
            De conformidad con la Ley N° 19.628 y la Ley N° 21.719, usted tiene derecho a:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li><strong>Acceso:</strong> conocer qué datos personales suyos tratamos.</li>
            <li><strong>Rectificación:</strong> corregir datos inexactos o desactualizados.</li>
            <li><strong>Cancelación / Supresión:</strong> solicitar la eliminación de sus datos cuando ya no sean necesarios.</li>
            <li><strong>Oposición:</strong> oponerse al tratamiento de sus datos en determinadas circunstancias.</li>
            <li><strong>Portabilidad:</strong> recibir sus datos en formato estructurado y legible (conforme Ley 21.719).</li>
            <li><strong>Revocación del consentimiento:</strong> revocar su consentimiento en cualquier momento, sin efecto retroactivo.</li>
          </ul>
          <p>
            Para ejercer cualquiera de estos derechos, diríjase a{' '}
            <a href={`mailto:${EMAIL}`} className="text-blue-600 dark:text-blue-400 underline">{EMAIL}</a>{' '}
            indicando su nombre, RUT y el derecho que desea ejercer. Responderemos dentro de los plazos legales.
          </p>
        </Section>

        <Section title="9. Seguridad de los Datos">
          <p>
            Implementamos medidas técnicas y organizativas apropiadas para proteger sus datos personales contra
            acceso no autorizado, pérdida, alteración o divulgación indebida, incluyendo:
          </p>
          <ul className="list-disc pl-5 space-y-1">
            <li>Cifrado de datos en tránsito (TLS/HTTPS) y en reposo.</li>
            <li>Autenticación mediante Firebase Authentication con contraseñas seguras.</li>
            <li>Control de acceso basado en roles (RBAC) para el personal de administración.</li>
            <li>Reglas de seguridad de Firestore con validación por perfil de usuario.</li>
            <li>Registros de auditoría de actividad en la plataforma.</li>
          </ul>
        </Section>

        <Section title="10. Uso de Imágenes y Fotografías">
          <p>
            Las fotografías de evidencia capturadas en el módulo de incidencias son de uso exclusivo
            interno del condominio para fines de documentación y seguridad. No se publican ni comparten
            con terceros ajenos a la administración del condominio sin el consentimiento explícito del
            titular o mandato judicial.
          </p>
        </Section>

        <Section title="11. Menores de Edad">
          <p>
            {APP_NAME} no está dirigido a menores de 14 años. No recopilamos datos de menores de
            forma intencionada. Si usted tiene conocimiento de que un menor ha proporcionado datos
            personales, contáctenos para proceder a su eliminación.
          </p>
        </Section>

        <Section title="12. Cookies y Tecnologías de Seguimiento">
          <p>
            La plataforma utiliza almacenamiento local del navegador (<em>localStorage / sessionStorage</em>)
            para mantener la sesión activa y preferencias de uso. No utilizamos cookies de seguimiento
            publicitario ni compartimos datos de navegación con redes de publicidad.
          </p>
        </Section>

        <Section title="13. Modificaciones a esta Política">
          <p>
            Nos reservamos el derecho de actualizar esta política cuando sea necesario. Las modificaciones
            serán comunicadas mediante aviso en la plataforma o por correo electrónico con al menos
            <strong> 15 días de anticipación</strong>. El uso continuado de la plataforma tras la
            notificación constituye aceptación de los cambios.
          </p>
        </Section>

        <Section title="14. Autoridad de Control">
          <p>
            Si considera que el tratamiento de sus datos infringe la legislación vigente, puede presentar
            un reclamo ante el <strong>Consejo para la Transparencia</strong> (www.cplt.cl) o ante la
            autoridad competente en materia de protección de datos personales en Chile.
          </p>
        </Section>

        <div className="pt-4 border-t border-slate-200 dark:border-white/10 text-xs text-slate-400 dark:text-slate-500 text-center">
          {APP_NAME} · {COMPANY} · {ADDRESS}<br />
          {EMAIL} · Versión vigente desde {LAST_UPDATE}
        </div>
      </div>
    </div>
  </div>
);

export default PrivacyPolicy;
