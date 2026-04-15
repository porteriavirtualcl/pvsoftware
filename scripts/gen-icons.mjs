// Generates app icons for PWA (Android + iOS) using sharp
import sharp from 'sharp';
import { readFileSync, mkdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(__dirname, '..', 'public');
mkdirSync(publicDir, { recursive: true });

// SVG source — blue rounded square with shield icon
const svgSrc = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <rect width="512" height="512" rx="100" fill="#2563eb"/>
  <g transform="translate(256,256)">
    <!-- shield outline -->
    <path d="M0-170 L120-100 L120 40 Q120 160 0 200 Q-120 160 -120 40 L-120-100 Z"
      fill="none" stroke="white" stroke-width="22" stroke-linejoin="round"/>
    <!-- check mark inside shield -->
    <polyline points="-48,20 -10,60 60,-30"
      fill="none" stroke="white" stroke-width="24" stroke-linecap="round" stroke-linejoin="round"/>
  </g>
</svg>`;

const svgBuf = Buffer.from(svgSrc);

const sizes = [
  { file: 'icon-192.png', size: 192 },
  { file: 'icon-512.png', size: 512 },
  { file: 'apple-touch-icon.png', size: 180 },
  { file: 'favicon-32.png', size: 32 },
];

for (const { file, size } of sizes) {
  const out = path.join(publicDir, file);
  await sharp(svgBuf)
    .resize(size, size)
    .png()
    .toFile(out);
  console.log(`✓ ${file} (${size}x${size})`);
}

console.log('\nAll icons generated in public/');
