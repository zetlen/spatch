// colors.js — Color conversions (HSL, RGB) and color picker logic

export function hslToString(h, s, l) {
  return `hsl(${h}, ${s}%, ${l}%)`;
}

// ---- Get fill CSS string for a shape ----

export function getFillStyle(ctx, fill, radius) {
  switch (fill.mode) {
    case 'solid':
      return hslToString(fill.h, fill.s, fill.l);

    case 'radial': {
      const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, radius);
      grad.addColorStop(0, hslToString(fill.h, fill.s, fill.l));
      grad.addColorStop(1, hslToString(fill.h2, fill.s2, fill.l2));
      return grad;
    }

    case 'linear': {
      const angle = ((fill.gradAngle || 0) * Math.PI) / 180;
      const dx = Math.cos(angle) * radius;
      const dy = Math.sin(angle) * radius;
      const grad = ctx.createLinearGradient(-dx, -dy, dx, dy);
      grad.addColorStop(0, hslToString(fill.h, fill.s, fill.l));
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
      return hslToString(fill.h, fill.s, fill.l);
    case 'linear':
      return `linear-gradient(${fill.gradAngle || 0}deg, ${hslToString(fill.h, fill.s, fill.l)}, ${hslToString(fill.h2, fill.s2, fill.l2)})`;
    default:
      return '#ff00ff';
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
