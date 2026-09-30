# QR directo al controlador (sin visitante en el DSS) — estado al 29-09-2026

Objetivo: que el pase QR de una visita no dependa de la sincronización del DSS (~3 min) ni de crear el
visitante allí. El servidor pide al DSS solo el pasaporte (`passport/generate` → `qrcode` +
`passportCardNo`) y carga `passportCardNo` como tarjeta en cada controlador del condominio por la VPN
(API CGI Dahua con digest, `lib/dahuaDevice.cjs`). Al salir/expirar, se borra la tarjeta.

## Qué está implementado (rama `staging-vts`)

- `lib/dahuaDevice.cjs`: `cargarCredencialQR`, `borrarCredencialUsuario`, `recNosDeUsuario`,
  `offsetEquipoMs`/`fmtLocalEquipo` (la vigencia se escribe en la hora local del lector; algunos equipos
  están en zona Buenos Aires sin horario de verano).
- `server.cjs`: `QR_DIRECT_CONDOS` (env JSON `{condoId:[{ip,name}]}`, opt-in por condominio),
  `POST /api/dahua/visitor/create-direct`, revocación en `finalizarPaseDss` cuando `v.qrDirect`.
- Registro de controladores por condominio: 14 condominios, ~70 equipos (archivo fuera del repo).
- Apertura remota por VPN (`accessControl.cgi?action=openDoor`) probada OK en el equipo de prueba.

## Qué se comprobó y qué NO (equipo de prueba MB_Prueba, ASI6213S-PW)

| Prueba | Resultado |
|---|---|
| Cargar/borrar tarjeta por CGI, vigencia en hora del equipo | OK |
| Tarjeta con el número que el equipo decodificó de un QR real de la app | **Abre** (28-09) |
| Tarjeta con `passportCardNo` de un pasaporte suelto (sin visitante) | **No abre**: el lector suena, no muestra mensaje y no deja registro (29-09, 4 intentos, QR recién generado, equipo reiniciado) |
| `passportCardNo` == número decodificado por el equipo | Verificado solo para un pase ("Prueba 1"); un segundo QR leído no coincide con ningún pase guardado |

Hallazgos de configuración (leídos por CGI, solo lectura):

- **`QRCode.ValidTime = 10` minutos en todos los controladores** (prueba y producción): un QR se acepta
  solo dentro de los 10 minutos posteriores a su generación. Los pases de la app funcionan horas después
  porque el DSS los carga como *visitante*, no como tarjeta suelta. Cualquier variante "directa" debe
  generar el pasaporte al momento de mostrarlo o cambiar ese parámetro en el equipo.
- `AccessControl[0].Method = 32` es el valor normal en producción; no influye.
- El contenido del QR de la app es exactamente el `qrcode` del pasaporte (12 caracteres base64).

## Conclusión provisional

La opción híbrida **no está confirmada**. Lo que sí está demostrado es que el equipo abre con una tarjeta
cuyo número coincide con lo que decodifica del QR; falta demostrar que un pasaporte generado sin visitante
produce un QR que el equipo procese. Próximas pruebas (en el equipo de prueba):

1. Mostrar un QR de texto plano: si no queda registro, el lector no está procesando QR (hasta el 28-09 sí
   registraba los rechazos con `ErrorCode=16`).
2. Mostrar el QR de un pase real desde la app: si ese sí deja mensaje/registro y el pasaporte suelto no, el
   pasaporte necesita el visitante en el DSS. Alternativa entonces: crear el visitante en el DSS como hoy y
   *además* cargar la tarjeta directo, para abrir sin esperar la sincronización.
3. Si el lector procesa el pasaporte suelto: subir `QRCode.ValidTime` o generar el pasaporte al mostrar.

## Red

La VPN del VPS (WireGuard a la consola GTD Magic) llega a los 14 condominios. La consola de Maipo Bodegas
tiene la WAN2 (fibra) desconectada y opera solo por Starlink (CGNAT); las VLAN 5 y 10 de ese sitio se
pierden por ratos desde el hub (la VLAN 13 no). Sitios por Starlink necesitan timeouts ≥ 5 s.
