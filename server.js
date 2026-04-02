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

    // 2. Save to Firestore (access_events)
    // await admin.firestore().collectionGroup('access_events').add({
    //   deviceId,
    //   type: eventType,
    //   value: value,
    //   confidence: confidence,
    //   timestamp: admin.firestore.Timestamp.now(),
    //   raw: eventData
    // });

    res.status(200).send('Event processed');
  } catch (error) {
    console.error('Error processing webhook:', error);
    res.status(500).send('Internal Server Error');
  }
});

app.listen(port, () => {
  console.log(`Webhook Gateway listening at http://localhost:${port}`);
});
