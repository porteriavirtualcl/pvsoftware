// Piezas WebRTC compartidas por las llamadas de la app (kiosco → residente y
// llamadas por WhatsApp del operador). Señalización sin trickle ICE: se espera a
// que termine el gathering y se manda la SDP completa con sus candidatos, que es
// lo que exige Meta (Calling API) y lo que simplifica la señalización por Firestore.

// STUN sirve en la misma red; TURN es necesario detrás de NAT simétricos (celular,
// oficinas). El TURN es el del VPS de Portería Virtual.
export const ICE_SERVERS: RTCConfiguration = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'turn:2.24.85.59:3478', username: 'porteria', credential: 'PvTurn2026Kx9r' },
    { urls: 'turn:2.24.85.59:3478?transport=tcp', username: 'porteria', credential: 'PvTurn2026Kx9r' },
  ],
};

/** Resuelve cuando el gathering ICE terminó (o tras `timeoutMs`, por si se demora). */
export function waitIceComplete(pc: RTCPeerConnection, timeoutMs = 3000): Promise<void> {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === 'complete') return resolve();
    const done = () => { pc.removeEventListener('icegatheringstatechange', check); resolve(); };
    const check = () => { if (pc.iceGatheringState === 'complete') done(); };
    pc.addEventListener('icegatheringstatechange', check);
    setTimeout(done, timeoutMs);
  });
}

/** true si este navegador/WebView puede hacer llamadas de audio. */
export function webrtcDisponible(): boolean {
  return typeof window !== 'undefined'
    && typeof window.RTCPeerConnection === 'function'
    && !!navigator.mediaDevices
    && typeof navigator.mediaDevices.getUserMedia === 'function';
}

/** Pide el micrófono con parámetros pensados para voz (sin video). */
export function pedirMicrofono(): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
    video: false,
  });
}

/** true si la SDP remota es de un agente ICE-lite (Meta lo es: sólo responde checks). */
export const esIceLite = (sdp: string) => /^a=ice-lite\s*$/m.test(sdp);

/**
 * SDP tal como la espera Meta. Su propia oferta de ejemplo no trae candidatos
 * (c=IN IP4 0.0.0.0, puerto 9): como su lado es ICE-lite, aprende nuestra
 * dirección con los checks que hacemos nosotros. Los candidatos del navegador
 * (mDNS ".local", TURN, IPv6) sólo estorban a su validador, así que se quitan.
 */
export function sdpParaMeta(sdp: string): string {
  return sdp
    .split(/\r?\n/)
    .filter(l => !/^a=candidate:/.test(l) && !/^a=end-of-candidates/.test(l))
    .filter(l => l.length > 0)
    .join('\r\n') + '\r\n';
}

/** "m:ss" para el cronómetro de la llamada. */
export function fmtSegundos(total: number): string {
  const s = Math.max(0, Math.floor(total));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}
