// colors.js — Color conversions (HSL, Lab, RGB) and color picker logic

// ---- Lab <-> RGB conversion ----

export function labToRgb(L, a, b) {
  // Lab -> XYZ (D65 illuminant)
  let fy = (L + 16) / 116;
  let fx = a / 500 + fy;
  let fz = fy - b / 200;

  const delta = 6 / 29;
  const cubeOrLinear = (t) => (t > delta ? t * t * t : 3 * delta * delta * (t - 4 / 29));

  const xn = 0.95047,
    yn = 1.0,
    zn = 1.08883;
  let X = xn * cubeOrLinear(fx);
  let Y = yn * cubeOrLinear(fy);
  let Z = zn * cubeOrLinear(fz);

  // XYZ -> linear sRGB
  let rl = 3.2406 * X - 1.5372 * Y - 0.4986 * Z;
  let gl = -0.9689 * X + 1.8758 * Y + 0.0415 * Z;
  let bl = 0.0557 * X - 0.204 * Y + 1.057 * Z;

  // Gamma correction
  const gamma = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055);

  return [
    Math.round(Math.max(0, Math.min(1, gamma(rl))) * 255),
    Math.round(Math.max(0, Math.min(1, gamma(gl))) * 255),
    Math.round(Math.max(0, Math.min(1, gamma(bl))) * 255),
  ];
}

export function hslToString(h, s, l) {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

export function labToString(L, a, b) {
  const [r, g, bb] = labToRgb(L, a, b);
  return `rgb(${r},${g},${bb})`;
}

// ---- Get fill CSS string for a shape ----

export function getFillStyle(ctx, fill, radius) {
  switch (fill.mode) {
    case 'solid':
      return hslToString(fill.h, fill.s, fill.l);

    case 'radial': {
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      grad.addColorStop(0, labToString(fill.labL, fill.labA, fill.labB));
      grad.addColorStop(1, labToString(fill.labL2, fill.labA2, fill.labB2));
      return grad;
    }

    case 'linear': {
      const angle = ((fill.gradAngle || 0) * Math.PI) / 180;
      const dx = Math.cos(angle) * radius;
      const dy = Math.sin(angle) * radius;
      const grad = ctx.createLinearGradient(-dx, -dy, dx, dy);
      grad.addColorStop(0, hslToString(fill.h1, fill.s1, fill.l1));
      grad.addColorStop(1, hslToString(fill.h2, fill.s2, fill.l2));
      return grad;
    }

    default:
      return '#ff00ff';
  }
}

// ---- Get swatch display color for toolbar ----

export function getSwatchColor(fill) {
  switch (fill.mode) {
    case 'solid':
      return hslToString(fill.h, fill.s, fill.l);
    case 'radial':
      return labToString(fill.labL, fill.labA, fill.labB);
    case 'linear':
      return `linear-gradient(${fill.gradAngle || 0}deg, ${hslToString(fill.h1, fill.s1, fill.l1)}, ${hslToString(fill.h2, fill.s2, fill.l2)})`;
    default:
      return '#ff00ff';
  }
}

// ---- Hue ring rendering ----

export function drawHueRing(ctx, cx, cy, outerR, innerR) {
  for (let deg = 0; deg < 360; deg++) {
    const startAngle = ((deg - 1) * Math.PI) / 180;
    const endAngle = ((deg + 1) * Math.PI) / 180;
    ctx.beginPath();
    ctx.arc(cx, cy, outerR, startAngle, endAngle);
    ctx.arc(cx, cy, innerR, endAngle, startAngle, true);
    ctx.closePath();
    ctx.fillStyle = `hsl(${deg}, 100%, 50%)`;
    ctx.fill();
  }
}

// ---- SL square rendering ----

export function drawSLSquare(ctx, x, y, w, h, hue) {
  const imgData = ctx.createImageData(w, h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const s = (px / (w - 1)) * 100;
      const l = (1 - py / (h - 1)) * 100;
      const rgb = hslToRgb(hue, s, l);
      const i = (py * w + px) * 4;
      imgData.data[i] = rgb[0];
      imgData.data[i + 1] = rgb[1];
      imgData.data[i + 2] = rgb[2];
      imgData.data[i + 3] = 255;
    }
  }
  ctx.putImageData(imgData, x, y);
}

function hslToRgb(h, s, l) {
  s /= 100;
  l /= 100;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r, g, b;
  if (h < 60) {
    r = c;
    g = x;
    b = 0;
  } else if (h < 120) {
    r = x;
    g = c;
    b = 0;
  } else if (h < 180) {
    r = 0;
    g = c;
    b = x;
  } else if (h < 240) {
    r = 0;
    g = x;
    b = c;
  } else if (h < 300) {
    r = x;
    g = 0;
    b = c;
  } else {
    r = c;
    g = 0;
    b = x;
  }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

// ---- Lab a*/b* plane rendering ----

export function drawLabPlane(ctx, x, y, w, h, L) {
  const imgData = ctx.createImageData(w, h);
  for (let py = 0; py < h; py++) {
    for (let px = 0; px < w; px++) {
      const a = (px / (w - 1)) * 256 - 128;
      const b = 128 - (py / (h - 1)) * 256;
      const [r, g, bb] = labToRgb(L, a, b);
      const i = (py * w + px) * 4;
      imgData.data[i] = r;
      imgData.data[i + 1] = g;
      imgData.data[i + 2] = bb;
      imgData.data[i + 3] = 255;
    }
  }
  ctx.putImageData(imgData, x, y);
}

// ---- Angle dial rendering ----

export function drawAngleDial(ctx, cx, cy, r, angle) {
  ctx.clearRect(cx - r - 2, cy - r - 2, (r + 2) * 2, (r + 2) * 2);
  // Outer ring
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.strokeStyle = 'rgba(255,255,255,0.2)';
  ctx.lineWidth = 2;
  ctx.stroke();
  // Direction indicator
  const rad = (angle * Math.PI) / 180;
  ctx.beginPath();
  ctx.moveTo(cx, cy);
  ctx.lineTo(cx + Math.cos(rad) * r * 0.8, cy + Math.sin(rad) * r * 0.8);
  ctx.strokeStyle = '#00f0ff';
  ctx.lineWidth = 3;
  ctx.stroke();
  // Center dot
  ctx.beginPath();
  ctx.arc(cx, cy, 3, 0, Math.PI * 2);
  ctx.fillStyle = '#00f0ff';
  ctx.fill();
}
