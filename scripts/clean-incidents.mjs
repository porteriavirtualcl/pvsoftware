/**
 * One-time script: delete ALL incidents from every condo subcollection.
 * Run once from the project root:
 *   node scripts/clean-incidents.mjs
 *
 * Requires serviceAccountKey.json in the project root.
 */
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createRequire } from 'module';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const serviceAccount = require(path.join(__dirname, '..', 'serviceAccountKey.json'));

initializeApp({ credential: cert(serviceAccount) });
const db = getFirestore();

async function deleteCollection(ref, batchSize = 400) {
  const snap = await ref.limit(batchSize).get();
  if (snap.empty) return 0;
  let batch = db.batch();
  let count = 0;
  snap.docs.forEach(d => { batch.delete(d.ref); count++; });
  await batch.commit();
  return count + await deleteCollection(ref, batchSize);
}

async function main() {
  console.log('Fetching all condos…');
  const condosSnap = await db.collection('condos').get();
  console.log(`Found ${condosSnap.size} condo(s).`);

  let total = 0;
  for (const condoDoc of condosSnap.docs) {
    const incidentsRef = db.collection(`condos/${condoDoc.id}/incidents`);
    const deleted = await deleteCollection(incidentsRef);
    if (deleted > 0) {
      console.log(`  ✓ ${condoDoc.data().name || condoDoc.id}: deleted ${deleted} incident(s)`);
      total += deleted;
    }
  }

  console.log(`\nDone. Total incidents deleted: ${total}`);
  process.exit(0);
}

main().catch(err => { console.error(err); process.exit(1); });
