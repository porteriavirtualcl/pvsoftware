// Generates app icons for PWA (Android + iOS) using sharp
// Source: public/logo-square.jpg  (headset + "portería virtual" square version)
import sharp from 'sharp';
import { mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
mkdirSync(publicDir, { recursive: true });

const src = path.join(publicDir, 'logo-square.jpg');

const sizes = [
  { file: 'icon-192.png',        size: 192 },
  { file: 'icon-512.png',        size: 512 },
  { file: 'apple-touch-icon.png',size: 180 },
  { file: 'favicon-32.png',      size: 32  },
];

for (const { file, size } of sizes) {
  const out = path.join(publicDir, file);
  await sharp(src)
    .resize(size, size, { fit: 'contain', background: { r: 255, g: 255, b: 255, alpha: 1 } })
    .png()
    .toFile(out);
  console.log(`✓ ${file} (${size}x${size})`);
}

console.log('\nAll icons generated in public/');
