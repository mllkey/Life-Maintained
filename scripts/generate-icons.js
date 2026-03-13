const sharp = require('sharp');
const path = require('path');

const LOGO = path.join(__dirname, '..', 'assets', 'images', 'brand-logo.png');
const OUT = path.join(__dirname, '..', 'assets', 'images');

async function compositeOnCanvas(logoPath, logoSize, canvasSize, bg) {
  const logoBuffer = await sharp(logoPath)
    .resize(logoSize, logoSize, { fit: 'inside' })
    .toBuffer();

  return sharp({
    create: { width: canvasSize, height: canvasSize, channels: 4, background: bg }
  })
    .composite([{ input: logoBuffer, gravity: 'center' }])
    .png()
    .toBuffer();
}

async function generate() {
  // 1. App icon: logo centered on white 1024x1024
  const iconBuf = await compositeOnCanvas(LOGO, 680, 1024, { r: 255, g: 255, b: 255, alpha: 1 });
  await sharp(iconBuf).flatten({ background: '#FFFFFF' }).png().toFile(path.join(OUT, 'icon.png'));
  const iconMeta = await sharp(path.join(OUT, 'icon.png')).metadata();
  console.log(`✓ icon.png — ${iconMeta.width}x${iconMeta.height}`);

  // 2. Android foreground: logo centered on transparent 512x512
  const fgBuf = await compositeOnCanvas(LOGO, 338, 512, { r: 0, g: 0, b: 0, alpha: 0 });
  await sharp(fgBuf).png().toFile(path.join(OUT, 'android-icon-foreground.png'));
  const fgMeta = await sharp(path.join(OUT, 'android-icon-foreground.png')).metadata();
  console.log(`✓ android-icon-foreground.png — ${fgMeta.width}x${fgMeta.height}`);

  // 3. Android background: solid white 512x512
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 255, g: 255, b: 255, alpha: 1 } }
  }).png().toFile(path.join(OUT, 'android-icon-background.png'));
  console.log('✓ android-icon-background.png — 512x512');

  // 4. Android monochrome: greyscale threshold silhouette on transparent 512x512
  const monoBuffer = await sharp(LOGO)
    .resize(338, 338, { fit: 'inside' })
    .greyscale()
    .threshold(128)
    .png()
    .toBuffer();
  await sharp({
    create: { width: 512, height: 512, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: monoBuffer, gravity: 'center' }])
    .png()
    .toFile(path.join(OUT, 'android-icon-monochrome.png'));
  console.log('✓ android-icon-monochrome.png — 512x512');

  // 5. Favicon: logo centered on white 48x48
  const favBuf = await compositeOnCanvas(LOGO, 32, 48, { r: 255, g: 255, b: 255, alpha: 1 });
  await sharp(favBuf).flatten({ background: '#FFFFFF' }).png().toFile(path.join(OUT, 'favicon.png'));
  const favMeta = await sharp(path.join(OUT, 'favicon.png')).metadata();
  console.log(`✓ favicon.png — ${favMeta.width}x${favMeta.height}`);

  // 6. Splash icon: logo centered on transparent 512x512
  const splashBuf = await compositeOnCanvas(LOGO, 400, 512, { r: 0, g: 0, b: 0, alpha: 0 });
  await sharp(splashBuf).png().toFile(path.join(OUT, 'splash-icon.png'));
  const splashMeta = await sharp(path.join(OUT, 'splash-icon.png')).metadata();
  console.log(`✓ splash-icon.png — ${splashMeta.width}x${splashMeta.height}`);

  console.log('\nAll icons generated successfully');
}

generate().catch(console.error);
