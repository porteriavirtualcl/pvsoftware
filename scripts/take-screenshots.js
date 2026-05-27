const puppeteer = require('puppeteer');
const fs = require('fs');
const path = require('path');

const URL = 'https://app.porteriavirtual.cl';

const DEVICES = [
  {
    name: 'iphone-69',
    label: 'iPhone 6.9"',
    width: 1320,
    height: 2868,
    deviceScaleFactor: 3,
  },
  {
    name: 'ipad-pro-13',
    label: 'iPad Pro 13"',
    width: 2064,
    height: 2752,
    deviceScaleFactor: 2,
  },
];

const PAGES = [
  { slug: '01-login',     path: '/login',    waitFor: 'input, button, .login' },
  { slug: '02-home',      path: '/',         waitFor: 'body' },
];

async function run() {
  const outDir = path.join(__dirname, '..', 'screenshots');
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await puppeteer.launch({
    headless: 'new',
    args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage'],
  });

  for (const device of DEVICES) {
    console.log(`\n📱 ${device.label} (${device.width}×${device.height})`);

    const page = await browser.newPage();
    await page.setViewport({
      width:  Math.round(device.width  / device.deviceScaleFactor),
      height: Math.round(device.height / device.deviceScaleFactor),
      deviceScaleFactor: device.deviceScaleFactor,
    });

    for (const pg of PAGES) {
      const targetUrl = `${URL}${pg.path}`;
      console.log(`  → ${targetUrl}`);

      try {
        await page.goto(targetUrl, { waitUntil: 'networkidle2', timeout: 30000 });
        await new Promise(r => setTimeout(r, 2000));

        const file = path.join(outDir, `${device.name}_${pg.slug}.png`);
        await page.screenshot({ path: file, fullPage: false });
        console.log(`     ✅ ${path.basename(file)}`);
      } catch (err) {
        console.error(`     ❌ Error: ${err.message}`);
      }
    }

    await page.close();
  }

  await browser.close();
  console.log('\n✅ Screenshots guardados en /screenshots');
}

run().catch(err => { console.error(err); process.exit(1); });
