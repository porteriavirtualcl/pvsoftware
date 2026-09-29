# Auditoría de seguridad y operación — 23-09-2026

Alcance: `server.cjs`, `lib/*`, `firestore.rules`, cliente `src/**`, VPS Hostinger (nginx, pm2, ufw, ssh), estado funcional de los módulos en producción. Solo lectura; no se modificó nada en producción durante la auditoría.

## Estado funcional (verificado en producción)

| Módulo / job | Estado | Evidencia |
|---|---|---|
| Servidor (pm2) | OK | online, 123 MB, 0 reinicios inestables, arranque automático habilitado |
| Sesión DSS y poller de pases | OK | `sessionActive`, último ciclo hace segundos, sin error |
| Pases QR → DSS (7 días) | OK | 648 pases, 0 sin sincronizar, 0 finalizados con credencial activa |
| Barrido de credenciales (6 h) | OK | ejecutándose |
| Encomiendas | OK | 0 pendientes con más de 7 días |
| WhatsApp Cloud (Prueba) | OK | chat, plantillas y llamadas probados; el campo `status` del doc no aplica a cloud |
| WhatsApp legado (whatsapp-web.js) | Sin uso | no queda ningún número `web`; quedan carpetas `wa_sessions/` y 19 MB de caché |
| Iluminación y Energía (Shelly) | OK | poll hace 1 min, 6 encendidos, 0 alertas, 0 offline; 4 errores 429 históricos |
| Centro de eventos | Funciona, pero saturado | 4.159 alarmas altas en 24 h; 524 pendientes (ver O1) |
| Push DSS (Fase 3) | Bloqueado en el DSS | suscripción aceptada, 0 callbacks; falta agregar usuario `api` a los esquemas |
| Certificado TLS | OK | vence 27-10-2026, certbot en cron |
| Disco / memoria | OK | 55 % disco, 2,9 GB libres |

## Hallazgos de seguridad

### Críticos

**S1. Proxy del DSS público y token de servicio entregado a cualquier usuario.**
`server.cjs:167` (`app.all('/dahua/*')`) no exige sesión y reenvía cualquier petición al DSS. `POST /api/dahua/login` (`server.cjs:277`) devuelve el token de la cuenta de servicio del DSS a cualquier usuario autenticado, residente incluido. Con ambos, un residente puede abrir puertas, borrar personas o consultar cualquier condominio; sin sesión, el DSS queda expuesto a internet a 200 req/min.
El cliente usa el proxy en Visitors, Residents, AccessRecords, AccessReports, Condos y useVisitorExitPoller, solo con `X-Subject-Token`.
Fix: (1) `DahuaService.request` envía también el ID token de Firebase; (2) `/dahua/*` exige `requireAuth`; (3) allowlist de rutas DSS por rol (residentes: solo visitante crear/consultar/borrar de su propio pase; staff: lo que usan hoy); (4) mover `visitor/delete` y `visitor/terminate` a validar dueño o condominio como ya hace `/api/visitors/finalize`.

**S2. Inyección de comandos y borrado recursivo con el id de número WhatsApp.**
`killWaSessionChrome` (`server.cjs:3552`) ejecuta `` execSync(`pkill -9 -f "[s]ession-${numberId}"`) `` con `req.params.id` sin validar desde `DELETE /api/wa/numbers/:id` y `force-reset` (`rmSync` con el id en la ruta). Cualquier operador o técnico autenticado puede ejecutar comandos como el usuario de Node.
Fix: validar `/^[A-Za-z0-9_-]{1,64}$/`, usar `execFileSync('pkill', [...])`, restringir borrar/reset a super_admin. Alternativa mejor: retirar whatsapp-web.js completo (ya no hay números legado), lo que además elimina Puppeteer/Chrome y la mayoría de vulnerabilidades del `npm audit`.

**S3. Auto-escalación de rol desde Firestore.**
`firestore.rules:47-53, 88-97`: el dueño de `users/{uid}` puede ponerse `role: 'operator'` o `'technician'` y cambiar `condoId`, `condoIds`, `condoScope: 'multiple'`, `canGenerateQR`. Con eso pasa los `requireRole` del servidor, lee `kiosks` (credencial SIP), `dssAlarms`, conversaciones WhatsApp, y escribe incidentes, encomiendas y equipos de cualquier condominio. Además `condo_admin` puede escribir cualquier `users/{uid}` sin límite (incluido `role: 'super_admin'`).
Fix: rama del dueño con `affectedKeys().hasOnly([...campos de perfil/presencia/fcm/consentimiento])`; `create` solo con rol residente; rama `condo_admin` acotada a su condominio y a roles residente/operador.

### Altos

**S4. Lectura de PII entre condominios.** `users` legible por cualquier autenticado (`rules:84`); `condos/*/visitors` legible y editable por cualquier miembro del condominio (`rules:108`); `parcels`, `accessEvents`, `accessDaily` legibles por todo residente del condominio. Fix: `users` solo propio o staff con `hasCondoAccess`; visitantes por `userId` para residentes; accesos solo staff.

**S5. `/api/reports/raw-data` sin filtro por condominio** (`server.cjs:697`): un condo_admin ve accesos de todos los condominios; caché compartida por rango de fechas. Fix: filtrar por canales del condominio y clave de caché por alcance.

**S6. Callback DSS: 30 MB parseados antes de validar firma** (`server.cjs:84, 5757`), comparación no constante. Fix: allowlist de IP del DSS en nginx para esa ruta, `timingSafeEqual`, o validar firma en header antes del body-parser.

**S7. `/api/admin/*` autenticados con la contraseña del DSS como API key** (`server.cjs:3189-3236`) y `x-api-key` PVCRM comparados con `!==`. Fix: `ADMIN_API_KEY` propio, `timingSafeEqual`, `authLimiter`.

**S8. Gestión de números WhatsApp abierta a todo el staff** (`/api/wa/numbers` crear, borrar, conectar, instalar Chrome, listar todas las conversaciones). Fix: CRUD solo super_admin; conversaciones filtradas por número asignado.

**S9. Archivo `.claude/settings.local.json` trackeado en git** con una contraseña SSH en texto plano en la copia de trabajo (host de hosting compartido 93.127.205.148, no el VPS). Nunca llegó a un commit ni al remoto (verificado en todo el historial). Fix: `git rm --cached`, agregar a `.gitignore` efectivo y rotar esa contraseña igualmente.

**S10. SSH del VPS con `PermitRootLogin yes` y `PasswordAuthentication yes` efectivos, `fail2ban` inactivo, puerto 22 abierto a todo internet.** Fix: `PasswordAuthentication no` (la llave `pv_deploy` ya funciona; confirmar antes que no haya otro acceso por clave), `PermitRootLogin prohibit-password`, activar fail2ban. Puerto 9000 abierto en ufw sin servicio detrás: cerrar.

**S11. Firestore sin respaldos ni PITR.** `pointInTimeRecoveryEnablement: DISABLED`, `deleteProtection: DISABLED`; la cuenta de servicio no puede listar `backupSchedules`, así que no se pudo confirmar ninguno. No hay respaldo de `.env` fuera del VPS. Fix: habilitar PITR (7 días) y un `backupSchedule` diario con retención 14 días; `deleteProtection` ENABLED; copia cifrada del `.env` fuera del servidor. Respaldos del VPS en Hostinger: no verificable desde la cuenta conectada al MCP.

### Medios

- **S12.** `npm audit --omit=dev`: 2 críticas (protobufjs vía firebase-admin, websocket-driver) y 20 altas (axios SSRF/auth bypass, grpc-js, ws, form-data, etc.). La mayoría con fix sin cambio mayor. `xlsx` sin fix (usar la versión del CDN de SheetJS). Puppeteer/whatsapp-web.js desaparecen con S2.
- **S13.** Sin `process.on('unhandledRejection')`: un rechazo no capturado reinicia el proceso (pm2 lo levanta, pero se pierden llamadas WhatsApp en curso). `pollVisitorStatuses` y `syncPendingVisitors` sin guardia de solape (los demás jobs sí la tienen).
- **S14.** `rejectUnauthorized: false` en todas las conexiones al DSS (`server.cjs:189, 259, 5828`). Fix: fijar el certificado del DSS vía `ca:`.
- **S15.** 72 respuestas `500` devuelven `err.message` y varias devuelven cuerpos crudos del DSS. Fix: mensaje genérico, detalle en log.
- **S16.** `/api/incidents/breach-notify` sin rol (spam a super_admin). `rights-requests/:id/resolve` sin verificar condominio del doc. `notifications` y `calls` creables por cualquier autenticado (llamadas de portería falsas). `kiosks/*/commands` creable por cualquier staff (abre lockers de otros condominios).
- **S17.** Reglas Firestore sin scoping por condominio en escrituras de staff (`incidents`, `equipment`, `facilities`, `expenses`, `multas`, delete de `reservations`).
- **S18.** CSP desactivada; COOP relajado. Aceptable mientras no haya XSS, sin segunda barrera.
- **S19.** Rol `administrador` (1 usuario) coexiste con `condo_admin` en varios `requireRole`; conviene unificar.

### Bajos

- `/api/dahua/config` público expone el usuario del DSS. `/dahua-test` sin `ProtectedRoute`. `lighting/ack`, `events/picture` sin scoping por condominio. `isMasterAdminEmail()` sin uso en reglas. Archivos internos en `public/` local (manual DSS, plist, Postman) están gitignored y NO se sirven en producción (verificado con curl), pero conviene sacarlos de `public/`.

## Hallazgos operativos

**O1. Centro de eventos saturado por "Movimiento inteligente (persona)".** De 4.159 altas en 24 h, 2.788 son SMD de los NVR (Holanda 1.214, Quillay 579, Torcaza 476, Cántaros 250, Estancia 226) y 970 son "Evento de alarma (controlador)" de Quillay (EQ_Entrada_Vehiculo, EQ_Salida_*, EQ_VTO_Ascensor, EQ_Lector Patentes). Solo 22 son intrusiones reales. Con esto el módulo en rojo permanente pierde sentido. Fix: en el DSS bajar la prioridad del esquema SMD a media/baja (y revisar los controladores de Quillay con el técnico); en la app, tratar `19010` (SMD) y `16` (controlador) como registro aunque vengan en grado 1, hasta que el DSS se corrija.

**O2. Push DSS sin callbacks.** Agregar usuario `api` como usuario vinculado en los esquemas de alarma del DSS (ver memoria del módulo). Si tras eso sigue en 0, revisar salida HTTPS del servidor DSS.

**O3. Ventana de caída del DSS 21-09 23:00 a 22-09 00:00.** 92 errores de login (timeout, reset, 502/504 del nginx del DSS) y pases que no se pudieron crear en 6 condominios en esa hora; se recuperaron por el reintento. Conviene una alerta cuando el poller lleve más de 10 minutos sin sesión (hoy solo queda en log).

**O4. `[Household] DSS merge` con timeout de 8 s (88 veces).** La ficha "Mi unidad" omite integrantes DSS cuando el DSS está lento. Fix: caché de 10 minutos por unidad y refresco en segundo plano.

**O5. Reglas faltantes que rompen funciones.** `condos/*/gasto_items`, `alicuotas_agua`, `fondo_reserva` y `waEvaluations` no tienen regla (las reglas nombran `gasto`, `alicuotas`, `fondo`): esas pantallas del módulo Gastos Comunes y Atención al Cliente fallan al leer/escribir con permiso denegado. Además la UI ofrece "Nuevo residente" a operadores/técnicos, pero la regla lo niega.

**O6. Higiene del servidor.** pm2 sin `pm2-logrotate` (logs crecen sin límite), 48 paquetes del sistema por actualizar (39 días sin reinicio, kernel pendiente), `cupsd` escuchando en 0.0.0.0:631 (bloqueado por ufw, pero innecesario), archivos sueltos en `/var/www/pvsoftware` (`server.cjs.bak.*`, `dist.bak/`, `mq_capture.jsonl`, `mq_capturer.cjs`, `.wwebjs_cache`, `wa_sessions/`), `firestore.indexes.json` desalineado con los índices creados a mano en consola (no hacer `deploy --only firestore:indexes` sin sincronizar antes).

**O7. FCM.** 1 error "Quota exceeded" aislado; sin impacto visible. Tokens FCM se guardan en `users` (no en subcolección).

## Plan de implementación

Cada fase se despliega por separado y se verifica end-to-end antes de la siguiente. Todo lo de Firestore se prueba primero con el emulador de reglas (`firebase emulators:exec --only firestore`) contra los flujos de residente, operador, condo_admin y super_admin.

### Fase 1 — cerrar lo explotable hoy (1 a 2 días)

1. **S3** Reglas de `users`: campos permitidos al dueño, `create` solo residente, `condo_admin` acotado. Desplegar reglas y validar login, migración de cuenta por email, presencia, FCM y consentimiento.
2. **S1** Proxy DSS: ID token obligatorio en `/dahua/*`, allowlist por rol, `visitor/delete` y `terminate` con verificación de dueño/condominio. Desplegar cliente y servidor juntos (la app nativa antigua seguirá funcionando si se acepta transitoriamente `X-Subject-Token` sin ID token durante 2 semanas con log de aviso; decidir).
3. **S2** Retirar whatsapp-web.js y Puppeteer del servidor, borrar `wa_sessions/` y `.wwebjs_cache`, y eliminar las rutas legado (`connect`, `disconnect`, `force-reset`, `install-chrome`, `sync-contacts`). Si se prefiere conservar, aplicar la validación de id y `execFileSync`.
4. **S9** `git rm --cached .claude/settings.local.json`, rotar la contraseña del hosting compartido.
5. **S10** Endurecer SSH (previa confirmación de acceso por llave desde un segundo terminal), activar fail2ban, cerrar puerto 9000.
6. **S11** PITR + backupSchedule diario + deleteProtection en Firestore; copia cifrada del `.env` fuera del VPS.

### Fase 2 — alcance por condominio y PII (2 a 3 días)

7. **S4, S17, S16 (reglas)** Acotar lecturas de `users`, `visitors`, `parcels`, `accessEvents`; scoping de escrituras de staff; `calls`/`notifications` solo servidor o staff; `kiosks/*/commands` por condominio del kiosco.
8. **S5, S7, S8, S16 (servidor)** raw-data por condominio, `ADMIN_API_KEY` con `timingSafeEqual`, CRUD de números WhatsApp solo super_admin, conversaciones por número asignado, `breach-notify` y `rights-requests` con rol y condominio.
9. **S6** Allowlist de IP del DSS para `/api/dss/alarm-callback` en nginx + `timingSafeEqual`.
10. **O5** Renombrar en reglas `gasto`→`gasto_items`, `alicuotas`→`alicuotas_agua`, `fondo`→`fondo_reserva`, agregar `waEvaluations`; alinear gating de "Nuevo residente" en la UI.

### Fase 3 — operación y robustez (1 a 2 días)

11. **O1** Degradar SMD y eventos de controlador a registro en la app; ajustar esquemas en el DSS con el técnico; **O2** usuario `api` en los esquemas.
12. **S13, O3** `process.on('unhandledRejection')` con log, guardia de solape en los dos pollers, alerta (WhatsApp al técnico o email) cuando el DSS lleve más de 10 min sin sesión o el poller de Shelly falle 5 veces seguidas.
13. **O4** Caché de integrantes DSS en "Mi unidad".
14. **S12** `npm audit fix` sin cambios mayores, build, prueba de humo (login, pases, WhatsApp, Shelly, eventos) y deploy; `xlsx` desde CDN.
15. **O6** `pm2 install pm2-logrotate`, `apt upgrade` + reinicio en ventana nocturna (avisar: 2 a 3 min sin servicio), deshabilitar cups, limpiar archivos sueltos, exportar índices reales de Firestore a `firestore.indexes.json`.

### Fase 4 — endurecimiento (opcional)

16. **S14** Certificado del DSS fijado vía `ca:`. **S15** Errores genéricos al cliente. **S18** CSP en modo report-only y luego enforce. **S19** Unificar `administrador` en `condo_admin`. Rotación pendiente de `DAHUA_PASS` (historial git antiguo) y de la cuenta de servicio si no se hizo.

## Qué NO se tocó

Nada. La auditoría fue de solo lectura: consultas a Firestore, lectura de logs y configuración del VPS, y `curl` a producción.
