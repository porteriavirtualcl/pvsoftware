const express = require('express');
const bodyParser = require('body-parser');
const admin = require('firebase-admin');
const cors = require('cors');

const app = express();
const port = process.env.PORT || 3002;

// Initialize Firebase Admin for Portería Virtual
try {
  const projectId = 'porteriavitual-7d04e'; 
  const serviceAccount = require('./serviceAccountKey.json');
  admin.initializeApp({ 
    credential: admin.credential.cert(serviceAccount),
    projectId: projectId 
  });
  console.log(`✅ Firebase Admin Initialized for [${projectId}]`);
} catch (error) {
  console.log('⚠️ WARNING: serviceAccountKey.json or connectivity issue.');
}

app.use(cors());
app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

// Health Check
app.get('/', (req, res) => {
  res.status(200).send('Portería Virtual Gateway: OK');
});

app.listen(port, () => {
  console.log(`🚀 Gateway Server running on port ${port}`);
});
