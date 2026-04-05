const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const app = express();
const port = process.env.PORT || 3001;

// Initialize Firebase Admin (requires serviceAccountKey.json or environment variables)
// admin.initializeApp({
//   credential: admin.credential.cert(require('./serviceAccountKey.json'))
// });

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
  const { deviceId, ip } = req.params;
  console.log(`Checking connectivity for device ${deviceId} at IP ${ip}...`);
  
  // Real implementaton would use a ping library or net.connect
  // For now we simulate a response based on typical local network latency
  const isReachable = true; // Replace with real check logic
  
  if (isReachable) {
    res.json({ status: 'online', message: 'Device reachable from gateway' });
  } else {
    res.status(504).json({ status: 'offline', message: 'Connection timed out' });
  }
});

app.listen(port, () => {
  console.log(`Webhook Gateway listening at http://localhost:${port}`);
});
