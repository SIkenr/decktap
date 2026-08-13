const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { PNG } = require('pngjs');

const ROOT = path.resolve(__dirname, '..');
const ASSETS = path.join(ROOT, 'assets');
const SVG_SOURCE = path.join(ASSETS, 'icon.svg');

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, value));
}

function mix(left, right, amount) {
  return left + (right - left) * amount;
}

function mixColor(left, right, amount) {
  return [
    Math.round(mix(left[0], right[0], amount)),
    Math.round(mix(left[1], right[1], amount)),
    Math.round(mix(left[2], right[2], amount)),
    Math.round(mix(left[3] ?? 255, right[3] ?? 255, amount)),
  ];
}

function smoothstep(edge0, edge1, value) {
  const amount = clamp((value - edge0) / (edge1 - edge0));
  return amount * amount * (3 - 2 * amount);
}

function roundedRectAlpha(x, y, left, top, width, height, radius) {
  const px = Math.abs(x - (left + width / 2)) - width / 2 + radius;
  const py = Math.abs(y - (top + height / 2)) - height / 2 + radius;
  const outside = Math.hypot(Math.max(px, 0), Math.max(py, 0));
  const inside = Math.min(Math.max(px, py), 0);
  const distance = outside + inside - radius;
  return clamp(0.5 - distance);
}

function ellipseAlpha(x, y, cx, cy, rx, ry) {
  const nx = (x - cx) / rx;
  const ny = (y - cy) / ry;
  const distance = (Math.hypot(nx, ny) - 1) * Math.min(rx, ry);
  return clamp(0.5 - distance);
}

function rectAlpha(x, y, left, top, width, height) {
  const dx = Math.max(left - x, 0, x - (left + width));
  const dy = Math.max(top - y, 0, y - (top + height));
  const outside = Math.hypot(dx, dy);
  const inside = Math.min(Math.max(left - x, x - (left + width), top - y, y - (top + height)), 0);
  return clamp(0.5 - outside - inside);
}

function blendPixel(png, x, y, color, alpha) {
  if (alpha <= 0) return;
  const index = (y * png.width + x) * 4;
  const sourceAlpha = clamp((color[3] / 255) * alpha);
  const destAlpha = png.data[index + 3] / 255;
  const outAlpha = sourceAlpha + destAlpha * (1 - sourceAlpha);
  if (outAlpha <= 0) return;

  png.data[index] = Math.round((color[0] * sourceAlpha + png.data[index] * destAlpha * (1 - sourceAlpha)) / outAlpha);
  png.data[index + 1] = Math.round((color[1] * sourceAlpha + png.data[index + 1] * destAlpha * (1 - sourceAlpha)) / outAlpha);
  png.data[index + 2] = Math.round((color[2] * sourceAlpha + png.data[index + 2] * destAlpha * (1 - sourceAlpha)) / outAlpha);
  png.data[index + 3] = Math.round(outAlpha * 255);
}

function drawAppIcon(size) {
  const png = new PNG({ width: size, height: size });
  const scale = size / 1024;
  const blueTop = [96, 141, 255, 255];
  const blueBottom = [18, 73, 218, 255];
  const blueMid = [39, 103, 244, 255];

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const ux = (x + 0.5) / scale;
      const uy = (y + 0.5) / scale;
      const shell = roundedRectAlpha(ux, uy, 64, 64, 896, 896, 246);
      if (shell <= 0) continue;

      const linear = clamp((uy - 64 + (ux - 64) * 0.16) / 896);
      let color = mixColor(blueTop, blueBottom, linear);
      color = mixColor(color, blueMid, 0.16);
      blendPixel(png, x, y, color, shell);

      const stem = roundedRectAlpha(ux, uy, 376, 330, 138, 364, 30);
      const outer = ellipseAlpha(ux, uy, 570, 512, 224, 206);
      const inner = ellipseAlpha(ux, uy, 573, 512, 112, 122);
      const rightMask = smoothstep(490, 535, ux);
      const bowl = clamp(outer * rightMask - inner);
      const cutTop = smoothstep(330, 398, uy);
      const cutBottom = 1 - smoothstep(626, 694, uy);
      const letterAlpha = clamp(Math.max(stem, bowl * cutTop * cutBottom));
      blendPixel(png, x, y, [255, 255, 255, 255], letterAlpha);

      const signalOuter = ellipseAlpha(ux, uy, 780, 244, 70, 70);
      const signalInner = ellipseAlpha(ux, uy, 780, 244, 47, 47);
      const signalRing = clamp(signalOuter - signalInner);
      const signalQuarter = signalOuter * smoothstep(780, 791, ux) * (1 - smoothstep(244, 255, uy));
      blendPixel(png, x, y, [255, 255, 255, 210], Math.max(signalRing, signalQuarter));
    }
  }

  return PNG.sync.write(png);
}

function drawTrayTemplate() {
  const size = 22;
  const png = new PNG({ width: size, height: size });
  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      const ux = x + 0.5;
      const uy = y + 0.5;
      const stem = roundedRectAlpha(ux, uy, 5, 5, 4, 12, 1.2);
      const outer = ellipseAlpha(ux, uy, 11.2, 11, 6.2, 6);
      const inner = ellipseAlpha(ux, uy, 11.5, 11, 3.1, 3.3);
      const bowl = clamp(outer * smoothstep(7.4, 9, ux) - inner);
      blendPixel(png, x, y, [0, 0, 0, 255], Math.max(stem, bowl));
    }
  }
  return PNG.sync.write(png);
}

function renderSvgIcon(size) {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'decktap-icon-'));
  try {
    const svgPath = path.join(tempDir, `icon-${size}-${process.pid}.svg`);
    fs.copyFileSync(SVG_SOURCE, svgPath);
    execFileSync('/usr/bin/qlmanage', ['-t', '-s', String(size), '-o', tempDir, svgPath], {
      stdio: 'ignore',
    });
    const renderedPath = `${svgPath}.png`;
    return applyAppIconMask(fs.readFileSync(renderedPath), size);
  } catch {
    return null;
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
}

function applyAppIconMask(buffer, size) {
  const png = PNG.sync.read(buffer);
  const scale = size / 1024;
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const ux = (x + 0.5) / scale;
      const uy = (y + 0.5) / scale;
      const shell = roundedRectAlpha(ux, uy, 64, 64, 896, 896, 246);
      const index = (y * png.width + x) * 4;
      if (shell <= 0) {
        png.data[index + 3] = 0;
      } else if (shell < 1) {
        png.data[index + 3] = Math.round(png.data[index + 3] * shell);
      }
    }
  }
  return PNG.sync.write(png);
}

function downsamplePng(buffer, outputSize, factor) {
  if (factor <= 1) return buffer;
  const source = PNG.sync.read(buffer);
  const output = new PNG({ width: outputSize, height: outputSize });
  for (let y = 0; y < outputSize; y += 1) {
    for (let x = 0; x < outputSize; x += 1) {
      let alpha = 0;
      let red = 0;
      let green = 0;
      let blue = 0;
      for (let sampleY = 0; sampleY < factor; sampleY += 1) {
        for (let sampleX = 0; sampleX < factor; sampleX += 1) {
          const sourceIndex = (((y * factor + sampleY) * source.width) + (x * factor + sampleX)) * 4;
          const sampleAlpha = source.data[sourceIndex + 3] / 255;
          alpha += sampleAlpha;
          red += source.data[sourceIndex] * sampleAlpha;
          green += source.data[sourceIndex + 1] * sampleAlpha;
          blue += source.data[sourceIndex + 2] * sampleAlpha;
        }
      }
      const samples = factor * factor;
      const outputAlpha = alpha / samples;
      const outputIndex = (y * output.width + x) * 4;
      if (outputAlpha > 0) {
        output.data[outputIndex] = Math.round(red / alpha);
        output.data[outputIndex + 1] = Math.round(green / alpha);
        output.data[outputIndex + 2] = Math.round(blue / alpha);
      }
      output.data[outputIndex + 3] = Math.round(outputAlpha * 255);
    }
  }
  return PNG.sync.write(output);
}

function renderIcon(size) {
  const factor = size <= 256 ? 4 : size <= 512 ? 2 : 1;
  const renderedSvg = renderSvgIcon(size * factor);
  return downsamplePng(renderedSvg || drawAppIcon(size * factor), size, factor);
}

function writeIcns(entries, outputPath) {
  const chunks = entries.map(([type, data]) => {
    const buffer = Buffer.alloc(8 + data.length);
    buffer.write(type, 0, 'ascii');
    buffer.writeUInt32BE(buffer.length, 4);
    data.copy(buffer, 8);
    return buffer;
  });
  const total = 8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0);
  const header = Buffer.alloc(8);
  header.write('icns', 0, 'ascii');
  header.writeUInt32BE(total, 4);
  fs.writeFileSync(outputPath, Buffer.concat([header, ...chunks], total));
}

function writeIco(images, outputPath) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = 6 + 16 * images.length;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  fs.writeFileSync(outputPath, Buffer.concat([header, ...entries, ...images.map((image) => image.data)]));
}

fs.mkdirSync(ASSETS, { recursive: true });

const png16 = renderIcon(16);
const png32 = renderIcon(32);
const png48 = renderIcon(48);
const png64 = renderIcon(64);
const png128 = renderIcon(128);
const png256 = renderIcon(256);
const png512 = renderIcon(512);
const png1024 = renderIcon(1024);

fs.writeFileSync(path.join(ASSETS, 'icon-source.png'), png1024);
fs.writeFileSync(path.join(ASSETS, 'icon.png'), png1024);
fs.writeFileSync(path.join(ASSETS, 'trayTemplate.png'), drawTrayTemplate());
writeIcns([
  ['icp4', png16],
  ['icp5', png32],
  ['icp6', png64],
  ['ic07', png128],
  ['ic08', png256],
  ['ic09', png512],
  ['ic10', png1024],
], path.join(ASSETS, 'icon.icns'));
writeIco([
  { size: 16, data: png16 },
  { size: 32, data: png32 },
  { size: 48, data: png48 },
  { size: 64, data: png64 },
  { size: 128, data: png128 },
  { size: 256, data: png256 },
], path.join(ASSETS, 'icon.ico'));
