'use strict';
// Agente de voz (Gemini Live, audio nativo) para llamadas del intercomunicador.
// Entrada: PCM16 8 kHz de la llamada → se sube a 16 kHz. Salida: PCM16 24 kHz → se baja a 8 kHz.
// Las decisiones sensibles (buscar pase, abrir puerta) las toma el SERVIDOR en las funciones: el
// modelo sólo puede pedirlas; nunca recibe listados de personas.
// Latencia: thinkingBudget 0 (1,4 s vs 2,9 s hasta la primera palabra, medido 28-09) y detección de
// fin de turno rápida. La sesión se puede abrir antes de contestar (autoSaludo:false + saludar()).
const { GoogleGenAI, Modality } = require('@google/genai');

function up8to16(pcm) {
  const out = new Int16Array(pcm.length * 2);
  for (let i = 0; i < pcm.length; i++) { const a = pcm[i], b = i + 1 < pcm.length ? pcm[i + 1] : a; out[2 * i] = a; out[2 * i + 1] = (a + b) >> 1; }
  return out;
}
function down24to8(buf) {
  const n = Math.floor(buf.length / 6); const out = new Int16Array(n);
  for (let i = 0; i < n; i++) out[i] = Math.round((buf.readInt16LE(i * 6) + buf.readInt16LE(i * 6 + 2) + buf.readInt16LE(i * 6 + 4)) / 3);
  return out;
}

function instrucciones({ deviceName, condoName }) {
  return [
    `Eres la asistente de voz de Portería Virtual. Atiendes llamadas desde el equipo de acceso "${deviceName}" del condominio ${condoName}.`,
    'Hablas español de Chile, con trato de usted. Suenas como una persona real de portería: cálida, natural y ágil.',
    'Usa frases cortas y expresiones naturales ("Claro", "Perfecto", "Un momento", "Listo"). Habla claro y sin apuro, pero sin silencios largos: la persona está de pie frente al equipo.',
    'Nunca expliques lo que vas a hacer internamente ni menciones "funciones", "sistema de pases" o "base de datos".',
    '',
    'Saludo: "Hola, le habla la asistente de Portería Virtual. ¿En qué le puedo ayudar?"',
    '',
    'Si la persona necesita SALIR:',
    '  - Si no dijo su nombre, pídeselo: "¿Me indica su nombre y apellido, por favor?"',
    '  - Apenas tengas el nombre, di "Un momento, lo reviso" y en ese mismo turno llama a buscar_pase_en_sitio.',
    '  - Si el resultado trae exacta=true: di "Perfecto, <nombre>, le abro la puerta." y llama a abrir_puerta_salida. Luego: "Listo, ya puede salir. Que tenga buen día." y llama a terminar_llamada.',
    '  - Si trae una coincidencia con exacta=false: pregunta solo "¿Usted es <nombre>?". Si confirma, abre como arriba; si no, trátalo como sin resultado.',
    '  - Si NO hay resultado: no pidas que repita. Di de inmediato: "No lo encuentro registrado. Lo comunico ahora mismo con un operador para darle una respuesta rápida; por favor espere en línea." y llama a derivar_a_operador.',
    '',
    'Para CUALQUIER otra consulta (entrar, encomiendas, reclamos, emergencias, etc.): di "Lo comunico ahora mismo con un operador para darle una respuesta rápida; por favor espere en línea." y llama a derivar_a_operador con un resumen breve de lo que necesita.',
    '',
    'Después de derivar_a_operador NO llames a terminar_llamada: el sistema está llamando a un operador. Si la persona habla mientras espera, dile brevemente "Siga en línea, ya lo estoy comunicando".',
    'Si recibes el aviso "(Los operadores no contestaron)", di: "Disculpe, en este momento los operadores no pudieron contestar. Ya quedaron avisados de su llamada; por favor vuelva a llamar en unos minutos. Que tenga buen día." y llama a terminar_llamada.',
    '',
    'Reglas estrictas: abre la puerta una sola vez; nunca abras para ENTRAR; nunca abras sin un resultado de buscar_pase_en_sitio; nunca leas listas de nombres ni des datos de otras personas; no inventes información.',
  ].join('\n');
}

const TOOLS = [{
  functionDeclarations: [
    { name: 'buscar_pase_en_sitio', description: 'Busca por nombre a una visita con pase EN SITIO (ya ingresó) en este condominio. Devuelve como máximo 2 coincidencias con pase_id, nombre y exacta (true si coincide nombre y apellido).',
      parameters: { type: 'OBJECT', properties: { nombre: { type: 'STRING', description: 'Nombre y apellido tal como lo dijo la persona' } }, required: ['nombre'] } },
    { name: 'abrir_puerta_salida', description: 'Abre la puerta de SALIDA de este equipo para la visita del pase indicado. Solo con un pase_id devuelto por buscar_pase_en_sitio.',
      parameters: { type: 'OBJECT', properties: { pase_id: { type: 'STRING' } }, required: ['pase_id'] } },
    { name: 'derivar_a_operador', description: 'Llama de inmediato a un operador para que atienda esta llamada.',
      parameters: { type: 'OBJECT', properties: { motivo: { type: 'STRING', description: 'Resumen breve de lo que necesita la persona' } }, required: ['motivo'] } },
    { name: 'terminar_llamada', description: 'Corta la llamada después de despedirse.', parameters: { type: 'OBJECT', properties: {} } },
  ],
}];

/**
 * opts: { apiKey, model, deviceName, condoName, tools: { buscarPase, abrirPuerta, derivar }, onAudio(Int16Array 8k),
 *         onInterrupt(), onTranscript(quien, texto), onHangup(motivo), log, autoSaludo (def. true) }
 */
async function iniciarAgente(opts) {
  const log = opts.log || (() => {});
  const ai = new GoogleGenAI({ apiKey: opts.apiKey });
  let cerrado = false, sesion = null, colaIn = [], colaLen = 0, colgarTimer = null, saludado = false;
  let txtUsuario = '', txtAgente = '';
  const flushTx = () => {
    if (txtUsuario.trim()) { opts.onTranscript && opts.onTranscript('persona', txtUsuario.trim()); txtUsuario = ''; }
    if (txtAgente.trim()) { opts.onTranscript && opts.onTranscript('asistente', txtAgente.trim()); txtAgente = ''; }
  };
  const cerrar = (motivo) => {
    if (cerrado) return; cerrado = true; clearTimeout(colgarTimer); flushTx();
    try { sesion && sesion.close(); } catch { /* */ }
    opts.onHangup && opts.onHangup(motivo);
  };
  const thinking = process.env.GEMINI_THINKING_BUDGET !== undefined ? Number(process.env.GEMINI_THINKING_BUDGET) : 0;
  sesion = await ai.live.connect({
    model: opts.model,
    config: {
      responseModalities: [Modality.AUDIO],
      speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: opts.voice || 'Kore' } } },
      systemInstruction: instrucciones(opts),
      tools: TOOLS,
      thinkingConfig: { thinkingBudget: thinking },
      // Fin de turno rápido; inicio poco sensible para no reaccionar al ruido de la calle.
      realtimeInputConfig: { automaticActivityDetection: { startOfSpeechSensitivity: 'START_SENSITIVITY_LOW', endOfSpeechSensitivity: 'END_SENSITIVITY_HIGH', prefixPaddingMs: 150, silenceDurationMs: 550 } },
      inputAudioTranscription: {}, outputAudioTranscription: {},
    },
    callbacks: {
      onmessage: async (m) => {
        if (cerrado) return;
        const sc = m.serverContent;
        if (sc) {
          if (sc.interrupted) opts.onInterrupt && opts.onInterrupt();
          for (const p of (sc.modelTurn && sc.modelTurn.parts) || []) {
            if (p.inlineData && p.inlineData.data) opts.onAudio && opts.onAudio(down24to8(Buffer.from(p.inlineData.data, 'base64')));
          }
          if (sc.inputTranscription && sc.inputTranscription.text) txtUsuario += sc.inputTranscription.text;
          if (sc.outputTranscription && sc.outputTranscription.text) { if (txtUsuario.trim()) flushTx(); txtAgente += sc.outputTranscription.text; }
          if (sc.turnComplete) flushTx();
        }
        if (m.toolCall && m.toolCall.functionCalls) {
          const respuestas = [];
          for (const fc of m.toolCall.functionCalls) {
            let result; const t0 = Date.now();
            try {
              if (fc.name === 'buscar_pase_en_sitio') result = await opts.tools.buscarPase(String(fc.args?.nombre || ''));
              else if (fc.name === 'abrir_puerta_salida') result = await opts.tools.abrirPuerta(String(fc.args?.pase_id || ''));
              else if (fc.name === 'derivar_a_operador') result = await opts.tools.derivar(String(fc.args?.motivo || ''));
              else if (fc.name === 'terminar_llamada') { result = { ok: true }; clearTimeout(colgarTimer); colgarTimer = setTimeout(() => cerrar('la asistente terminó la llamada'), 3500); }
              else result = { error: 'función desconocida' };
            } catch (e) { result = { error: e.message }; }
            log(`función ${fc.name}(${JSON.stringify(fc.args || {})}) → ${JSON.stringify(result).slice(0, 200)} [${Date.now() - t0} ms]`);
            respuestas.push({ id: fc.id, name: fc.name, response: { result } });
          }
          try { sesion.sendToolResponse({ functionResponses: respuestas }); } catch { /* */ }
        }
      },
      onerror: (e) => { log('error Gemini ' + (e && e.message)); cerrar('error del asistente'); },
      onclose: (e) => { if (!cerrado) { log('Gemini cerró ' + (e && (e.code + ' ' + (e.reason || '')))); cerrar('asistente desconectado'); } },
    },
  });
  const saludar = () => {
    if (saludado || cerrado) return; saludado = true;
    sesion.sendClientContent({ turns: [{ role: 'user', parts: [{ text: '(Entra una llamada desde el equipo. Saluda.)' }] }], turnComplete: true });
  };
  if (opts.autoSaludo !== false) saludar();
  const maxTimer = setTimeout(() => cerrar('tiempo máximo del asistente'), 5 * 60 * 1000);
  return {
    saludar,
    abierto: () => !cerrado,
    // Audio de la llamada (8 kHz) → Gemini en bloques de ~60 ms a 16 kHz (sólo tras saludar).
    sendAudio8k(pcm) {
      if (cerrado || !saludado) return;
      colaIn.push(pcm); colaLen += pcm.length;
      if (colaLen < 480) return;
      const all = new Int16Array(colaLen); let o = 0; for (const c of colaIn) { all.set(c, o); o += c.length; }
      colaIn = []; colaLen = 0;
      const up = up8to16(all);
      try { sesion.sendRealtimeInput({ audio: { data: Buffer.from(up.buffer, up.byteOffset, up.byteLength).toString('base64'), mimeType: 'audio/pcm;rate=16000' } }); } catch { /* */ }
    },
    // Aviso del sistema a la asistente (p. ej. que el operador no contestó).
    instruir(texto) { if (cerrado) return; try { sesion.sendClientContent({ turns: [{ role: 'user', parts: [{ text: texto }] }], turnComplete: true }); } catch { /* */ } },
    close(motivo) { clearTimeout(maxTimer); cerrar(motivo || 'cerrado'); },
  };
}

module.exports = { iniciarAgente };
