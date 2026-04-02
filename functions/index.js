const functions = require('firebase-functions');
const admin = require('firebase-admin');

// Initialize Firebase Admin
admin.initializeApp();
const db = admin.firestore();

/**
 * Webhook for Dahua LPR (License Plate Recognition) and Facial Terminals
 * URL format: https://[REGION]-[PROJECT_ID].cloudfunctions.net/dahuaWebhook?deviceId=[DEVICE_ID]
 */
exports.dahuaWebhook = functions.https.onRequest(async (req, res) => {
  // 1. Validate Method (Dahua sends POST)
  if (req.method !== 'POST') {
    return res.status(405).send('Solo se permiten peticiones POST');
  }

  const deviceId = req.query.deviceId || 'unknown';
  const eventData = req.body;

  console.log(`Detección vinculada a dispositivo ${deviceId}:`, JSON.stringify(eventData));

  try {
    let eventType = 'UNKNOWN';
    let value = 'Desconocido';
    let confidence = 0;
    let details = {};

    // 2. Identify Event Type
    // Dahua Traffic/ANPR event
    if (eventData.PlateNumber || (eventData.TrafficEvent && eventData.TrafficEvent.PlateNumber)) {
      eventType = 'LPR';
      value = eventData.PlateNumber || eventData.TrafficEvent.PlateNumber;
      confidence = eventData.Confidence || eventData.TrafficEvent?.Confidence || 95;
      details = { plate: value, vehicleColor: eventData.VehicleColor || eventData.TrafficEvent?.VehicleColor };
    } 
    // Dahua Face Recognition event
    else if (eventData.FaceName || (eventData.AccessControl && eventData.AccessControl.FaceName)) {
      eventType = 'FACE';
      value = eventData.FaceName || eventData.FaceID || 'Rostro Detectado';
      confidence = eventData.Score || 98;
      details = { personName: value };
    }
    // QR Code / Access Control
    else if (eventData.CardNumber || eventData.QRCode) {
      eventType = 'QR';
      value = eventData.QRCode || eventData.CardNumber;
      details = { code: value };
    }

    // 3. Find Device and Condo Info
    // We look up the device globally (using collectionGroup if needed, or by knowing it's under a condo)
    const devicesSnapshot = await db.collectionGroup('devices').get();
    const deviceDoc = devicesSnapshot.docs.find(d => d.id === deviceId);
    
    let condoId = deviceDoc?.data()?.condoId || 'global';
    let condoName = deviceDoc?.data()?.condoName || 'Condominio';
    let deviceName = deviceDoc?.data()?.name || 'Cámara Dahua';

    // 4. Match with Resident (for LPR)
    let residentId = null;
    let residentName = null;

    if (eventType === 'LPR') {
      const residentsSnapshot = await db.collection('users')
        .where('role', 'in', ['resident', 'usuario'])
        .where('plates', 'array-contains', value.toUpperCase())
        .get();
      
      if (!residentsSnapshot.empty) {
        const resident = residentsSnapshot.docs[0].data();
        residentId = residentsSnapshot.docs[0].id;
        residentName = resident.name;
        console.log(`Matching resident found: ${residentName}`);
      }
    }

    // 5. Store Event in Firestore
    const eventRef = await db.collection('access_events').add({
      type: eventType,
      value: value,
      confidence: confidence,
      deviceId: deviceId,
      deviceName: deviceName,
      condoId: condoId,
      condoName: condoName,
      residentId: residentId,
      residentName: residentName,
      details: details,
      raw: eventData, // Keep raw data for debugging
      timestamp: admin.firestore.Timestamp.now()
    });

    console.log(`Evento registrado con éxito: ${eventRef.id}`);

    res.status(200).json({ 
      success: true, 
      eventId: eventRef.id,
      matchFound: !!residentId 
    });

  } catch (error) {
    console.error('Error procesando Webhook Dahua:', error);
    res.status(500).send('Error interno');
  }
});
