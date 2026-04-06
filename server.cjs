const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const DigestFetch = require('digest-fetch').default;
const app = express();
const port = process.env.PORT || 3001;

// Initialize Firebase Admin (Requires serviceAccountKey.json in the root)
try {
  const serviceAccount = require('./serviceAccountKey.json');
  admin.initializeApp({
    credential: admin.credential.cert(serviceAccount)
  });
  console.log('✅ Firebase Admin Initialized - Cloud Bridge Active');

  // REAL-TIME COMMAND LISTENER
  // This allows the server to receive "Open" commands from the App without VPN/Direct Port Forwarding
  admin.firestore().collectionGroup('commands')
    .where('status', '==', 'pending')
    .onSnapshot(snapshot => {
      snapshot.docChanges().forEach(async (change) => {
        if (change.type === 'added') {
          const commandData = change.doc.data();
          const commandId = change.doc.id;
          const { deviceId, ip, command } = commandData;

          if ((command === 'open' || commandData.cmd === 'AccessControl.Open' || commandData.cmd === 'LPR.Open') && ip) {
            console.log(`[CLOUD COMMAND] Received OPEN request for ${ip} (Command ID: ${commandId})`);

            try {
              const profile = commandData.hardwareProfile || 'itc';
              const channel = commandData.relayChannel || 0;
              const user = commandData.username || 'admin';
              const pass = commandData.password || '23242324fire';

              console.log(`🚀 [COMMAND] Sending to ${ip} (Profile: ${profile}, Channel: ${channel})...`);
              const cmdClient = new DigestFetch(user, pass);
              if (profile === 'asi') {
                try {
                  const res = await cmdClient.fetch(`http://${ip}/cgi-bin/accessControl.cgi?action=openDoor&channel=1`, { timeout: 5000 });
                  const body = await res.text();
                  console.log(`🚪 [ASI-OPEN] Status: ${res.status} | Body: ${body.trim()}`);

                  // AGGRESSIVE FALLBACK: Trigger AlarmOut just in case the installer wired the lock to the Alarm relay instead of the Door relay
                  console.log(`⚡ [ASI-FALLBACK] Sending manual pulse on AlarmOut[${channel}] just in case...`);
                  await cmdClient.fetch(`http://${ip}/cgi-bin/configManager.cgi?action=setConfig&AlarmOut[${channel}].Mode=1`, { timeout: 5000 }).catch(() => { });
                  setTimeout(async () => {
                    await cmdClient.fetch(`http://${ip}/cgi-bin/configManager.cgi?action=setConfig&AlarmOut[${channel}].Mode=0`, { timeout: 5000 }).catch(() => { });
                  }, 1500);

                } catch (e) {
                  console.warn(`[ASI-FAIL] Open door logic failed: ${e.message}`);
                }
              } else {
                try {
                  const res1 = await cmdClient.fetch(`http://${ip}/cgi-bin/configManager.cgi?action=setConfig&AlarmOut[${channel}].Mode=1`, { timeout: 5000 });
                  console.log(`⚡ [RELAY-ON] Status: ${res1.status}`);

                  setTimeout(async () => {
                    try {
                      const res2 = await cmdClient.fetch(`http://${ip}/cgi-bin/configManager.cgi?action=setConfig&AlarmOut[${channel}].Mode=0`, { timeout: 5000 });
                      console.log(`⚡ [RELAY-OFF] Status: ${res2.status}`);
                    } catch (e) { }
                  }, 1500);
                } catch (e) {
                  console.error(`[RELAY-FAIL] Failed to manual pulse: ${e.message}`);
                }
              }

              // Mark command as executed
              await change.doc.ref.update({
                status: 'executed',
                executedAt: admin.firestore.Timestamp.now()
              });
              console.log(`[SUCCESS] Command marked as executed.`);
            } catch (err) {
              console.error(`[ERROR] Failed to execute hardware command:`, err.message);
              await change.doc.ref.update({ status: 'failed', error: err.message });
            }
          } else if (command === 'sync_credential' && ip) {
            console.log(`[CLOUD COMMAND] Received SYNC_CREDENTIAL request for ${ip} (Command ID: ${commandId})`);
            try {
              const user = commandData.username || 'admin';
              const pass = commandData.password || '23242324fire';
              const cmdClient = new DigestFetch(user, pass);

              if (commandData.credentialType === 'card' && commandData.hardwareProfile === 'asi') {
                if (commandData.action === 'delete') {
                  console.log(`📡 [SYNC] Deleting Card ${commandData.cardNumber} from ASI...`);
                  const url = `http://${ip}/cgi-bin/recordUpdater.cgi?action=remove&name=AccessControlCard&CardNo=${commandData.cardNumber}`;
                  const res = await cmdClient.fetch(url, { timeout: 10000 });
                  const body = await res.text();
                  console.log(`📡 [SYNC-CARD-DEL] Status: ${res.status} | Body: ${body.trim()}`);
                } else {
                  // Función para formatear fechas ISO a 'YYYY-MM-DD HH:mm:ss' (Formato Dahua)
                  const formatDate = (iso) => {
                    if (!iso) return null;
                    try {
                      const d = new Date(iso);
                      return d.toISOString().replace('T', ' ').substring(0, 19);
                    } catch (e) { return null; }
                  };

                  console.log(`📡 [SYNC] Adding Card ${commandData.cardNumber} to ASI...`);
                  const start = encodeURIComponent(formatDate(commandData.validFrom) || '2020-01-01 00:00:00');
                  const end = encodeURIComponent(formatDate(commandData.validTo) || '2030-01-01 00:00:00');
                  
                  // IMPORTANTE: El UserID (177...) y el CardNo (Base64) son datos distintos en el modo compatible de Dahua
                  // Añadimos permisos maestros: DoorRight=255, TimeGroupNo=1 y HolidayEnable=1
                  // Usamos UserType=2 (Invitado) y MaxTimes=0 (Infinito mientras dure el rango de tiempo)
                  const userId = encodeURIComponent(commandData.externalUserId || commandData.cardNumber);
                  const url = `http://${ip}/cgi-bin/recordUpdater.cgi?action=insert&name=AccessControlCard&CardNo=${encodeURIComponent(commandData.cardNumber)}&CardName=${encodeURIComponent(commandData.visitorName)}&UserID=${userId}&CardStatus=0&CardType=2&UserType=2&TimeGroupNo=1&HolidayEnable=1&MaxTimes=0&DoorRight=255&ValidDateStart=${start}&ValidDateEnd=${end}`;
                  
                  let res = await cmdClient.fetch(url, { timeout: 10000 });
                  const body = await res.text();
                  console.log(`📡 [SYNC-CARD] Status: ${res.status} | Body: ${body.trim()}`);
                }
              } else if (commandData.credentialType === 'plate' && commandData.hardwareProfile === 'itc') {
                 if (commandData.action === 'delete') {
                    console.log(`📡 [SYNC] Deleting Plate ${commandData.plate} from LPR (all tables)...`);
                    const tableNames = ['TrafficWhiteList', 'TrafficRedList', 'TrafficList'];
                    for (const tableName of tableNames) {
                        try {
                            const url = `http://${ip}/cgi-bin/recordUpdater.cgi?action=remove&name=${tableName}&PlateNumber=${commandData.plate}`;
                            const res = await cmdClient.fetch(url, { timeout: 5000 });
                            const body = await res.text();
                            console.log(`📡 [SYNC-LPR-DEL] Table: ${tableName} | Status: ${res.status} | Body: ${body.trim()}`);
                        } catch (e) {
                            console.error(`[SYNC-LPR-DEL-ERR] ${tableName}: ${e.message}`);
                        }
                    }
                 } else {
                  console.log(`📡 [SYNC] Adding Plate ${commandData.plate} to LPR...`);
                  const start = encodeURIComponent(commandData.validFrom || '2020-01-01 00:00:00');
                  const end = encodeURIComponent(commandData.validTo || '2030-01-01 00:00:00');

                  const tableNames = ['TrafficWhiteList', 'TrafficRedList', 'TrafficList'];
                  let body = 'No table accepted';
                  let finalStatus = 400;

                  for (const tableName of tableNames) {
                    const url = `http://${ip}/cgi-bin/recordUpdater.cgi?action=insert&name=${tableName}&PlateNumber=${commandData.plate}&MasterOfCar=${encodeURIComponent(commandData.visitorName)}&BeginTime=${start}&CancelTime=${end}`;
                    try {
                        const res = await cmdClient.fetch(url, { timeout: 10000 });
                        if (res.status === 200) {
                            finalStatus = 200;
                            body = await res.text();
                            console.log(`📡 [SYNC-LPR] Success with table: ${tableName} | Body: ${body.trim()}`);
                            // We don't break, some cameras might need it in multiple lists or we want to try all to be sure it appears
                        }
                    } catch (e) {
                        console.error(`[SYNC-LPR-ERR] Table ${tableName} failed: ${e.message}`);
                    }
                  }
                  console.log(`📡 [SYNC-LPR-DONE] Final Result Status: ${finalStatus}`);
                }
              }

              await change.doc.ref.update({ status: 'executed', executedAt: admin.firestore.Timestamp.now() });
              console.log(`[SUCCESS] Sync Command executed.`);
            } catch (err) {
              console.error(`[ERROR] Failed to sync credential:`, err.message);
              await change.doc.ref.update({ status: 'failed', error: err.message });
            }
          }
        }
      });
    }, err => {
      console.error('Firestore listener error:', err);
    });

} catch (error) {
  console.log('⚠️ WARNING: serviceAccountKey.json not found. Cloud Bridge (No-VPN) mode is disabled.');
  console.log('   To enable, place your Firebase Service Account JSON file in the root directory.');
}

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Webhook for Dahua LPR and Facial Terminals
app.post('/webhooks/dahua/:deviceId', async (req, res) => {
  const { deviceId } = req.params;
  const eventData = req.body;

  console.log(`Received event from device ${deviceId}:`, eventData);

  try {
    // 1. Identify the event type (LPR, Face, QR) based on Dahua JSON structure
    let eventType = 'UNKNOWN';
    let value = '';
    let confidence = 0;

    if (eventData.PlateNumber) {
      eventType = 'LPR';
      value = eventData.PlateNumber;
      confidence = eventData.Confidence || 95;
    } else if (eventData.FaceName || eventData.FaceID) {
      eventType = 'FACE';
      value = eventData.FaceName || eventData.FaceID;
      confidence = eventData.Score || 98;
    }

    // 2. Mock: Authorization Logic
    // In a real scenario, we would check if 'value' exists in 'residents' or authorized 'visitors'.
    console.log(`Verificando autorización para ${eventType}: ${value}...`);

    // Simulate finding a match
    const isAuthorized = true;

    if (isAuthorized) {
      if (eventType === 'LPR') {
        console.log(`[ACCESS] Patente ${value} AUTORIZADA. Enviando comando de APERTURA DE BARRERA...`);
      } else if (eventType === 'FACE') {
        console.log(`[ACCESS] Rostro ${value} RECONOCIDO. Enviando comando de DESBLOQUEO DE PUERTA al ASI...`);
      }
      // Proceso de apertura real: axios.get(`http://${device.ip}/cgi-bin/accessControl.cgi?action=openDoor&channel=1`)
    }

    // 3. Save to Firestore (access_events)
    // This allows the Frontend to show the event in the Real-time Monitor
    /*
    await admin.firestore().collectionGroup('access_events').add({
      deviceId,
      type: eventType,
      value: value,
      confidence: confidence,
      timestamp: admin.firestore.Timestamp.now(),
      raw: eventData
    });
    */

    res.status(200).send('Event processed and access granted');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Internal Server Error');
  }
});

const cors = require('cors');
app.use(cors());

// Open Barrier/Door Remote Control Endpoint
app.get('/open-barrier/:ip', async (req, res) => {
  const { ip } = req.params;
  console.log(`[ACTION] Requesting REMOTE OPEN for device at IP ${ip}...`);

  try {
    // Dahua CGI Command Examples:
    // LPR/Camera: /cgi-bin/configManager.cgi?action=setConfig&AlarmOut[0].Mode=2 (Pulse)
    // ASI (Face): /cgi-bin/accessControl.cgi?action=openDoor&channel=1

    // For now we simulate the HTTP call success
    console.log(`Sending CGI command to http://${ip}/cgi-bin/configManager.cgi...`);

    // In a real scenario with Digest Auth:
    // await axios.get(`http://${ip}/cgi-bin/configManager.cgi?action=setConfig&AlarmOut[0].Mode=2`, { auth: { username, password } });

    res.json({ status: 'success', message: 'Open command sent to ' + ip });
  } catch (error) {
    console.error('Error sending open command:', error);
    res.status(502).json({ status: 'error', message: 'Failed to reach hardware at ' + ip });
  }
});

// Test Connectivity Diagnostic Endpoint
app.get('/test/:deviceId/:ip', async (req, res) => {
  const { ip } = req.params;
  const { user = 'admin', pass = '23242324fire' } = req.query;
  console.log(`🔍 [TEST] Pinging IP: ${ip}...`);

  try {
    const client = new DigestFetch(user, pass);
    const response = await client.fetch(`http://${ip}/cgi-bin/configManager.cgi?action=getConfig&name=General`, { timeout: 3500 });
    if (response.status === 200 || response.status === 401) {
      return res.json({ status: 'online', message: 'Device responded to HTTP request' });
    }
    res.status(500).json({ status: 'offline', error: `HTTP Status: ${response.status}` });
  } catch (err) {
    res.status(500).json({ status: 'offline', error: err.message });
  }
});

app.get('/open-local/:ip', async (req, res) => {
  const { ip } = req.params;
  const { profile = 'itc', channel = 0, user = 'admin', pass = '23242324fire' } = req.query;
  console.log(`🚪 [LOCAL-OPEN] Command for ${ip} (Profile: ${profile}, Channel: ${channel})`);

  try {
    const client = new DigestFetch(user, pass);
    if (profile === 'asi') {
      await client.fetch(`http://${ip}/cgi-bin/accessControl.cgi?action=openDoor&channel=1`, { timeout: 5000 });
    } else {
      await client.fetch(`http://${ip}/cgi-bin/configManager.cgi?action=setConfig&AlarmOut[${channel}].Mode=1`, { timeout: 3000 });
      setTimeout(() => client.fetch(`http://${ip}/cgi-bin/configManager.cgi?action=setConfig&AlarmOut[${channel}].Mode=0`, { timeout: 3000 }).catch(e => { }), 1500);
    }
    res.json({ success: true, message: 'Local command sent' });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.listen(port, () => {
  console.log(`Webhook Gateway listening at http://localhost:${port}`);
});
