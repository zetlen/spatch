// shapes.js — Hit testing, selection, drag/resize/rotate

const HANDLE_SIZE = 8;
const ROT_HANDLE_OFFSET = 25;

const MIN_SIZE = 0.025;
const MAX_SIZE = 0.9;

export function clampSize(size) {
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, size));
}

// Hit test against all shapes (back-to-front, return topmost)
export function hitTestShapes(state, mx, my, canvasSize) {
  // Iterate in reverse (front shapes first)
  for (let i = state.shapes.length - 1; i >= 0; i--) {
    const shape = state.shapes[i];
    if (isPointInShape(shape, mx, my, canvasSize)) {
      return shape.id;
    }
  }
  return null;
}

function isPointInShape(shape, mx, my, canvasSize) {
  const cx = shape.x * canvasSize;
  const cy = shape.y * canvasSize;
  const r = (shape.size / 2) * canvasSize;
  const rotRad = (shape.rotation * Math.PI) / 180;

  // Transform mouse point into shape-local coordinates
  const dx = mx - cx;
  const dy = my - cy;
  const cos = Math.cos(-rotRad);
  const sin = Math.sin(-rotRad);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;

  switch (shape.type) {
    case 'circle':
      return lx * lx + ly * ly <= r * r;

    case 'square':
      return Math.abs(lx) <= r && Math.abs(ly) <= r;

    case 'triangle': {
      // Equilateral triangle inscribed in circle of radius r
      const verts = [];
      for (let i = 0; i < 3; i++) {
        const angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
        verts.push([Math.cos(angle) * r, Math.sin(angle) * r]);
      }
      return pointInTriangle(lx, ly, verts[0], verts[1], verts[2]);
    }

    default:
      return false;
  }
}

function pointInTriangle(px, py, v0, v1, v2) {
  // Use barycentric coordinates
  const denom = (v1[0] - v0[0]) * (v2[1] - v0[1]) - (v2[0] - v0[0]) * (v1[1] - v0[1]);
  if (Math.abs(denom) < 0.001) return false;
  const u = ((v2[1] - v0[1]) * (px - v0[0]) + (v0[0] - v2[0]) * (py - v0[1])) / denom;
  const v = ((v0[1] - v1[1]) * (px - v0[0]) + (v1[0] - v0[0]) * (py - v0[1])) / denom;
  return u >= 0 && v >= 0 && u + v <= 1;
}

// Hit test selection handles. Returns handle type or null.
export function hitTestHandles(shape, mx, my, canvasSize) {
  if (!shape) return null;
  const cx = shape.x * canvasSize;
  const cy = shape.y * canvasSize;
  const r = (shape.size / 2) * canvasSize;
  const rotRad = (shape.rotation * Math.PI) / 180;

  // Transform to local coords
  const dx = mx - cx;
  const dy = my - cy;
  const cos = Math.cos(-rotRad);
  const sin = Math.sin(-rotRad);
  const lx = dx * cos - dy * sin;
  const ly = dx * sin + dy * cos;

  // Rotation handle (disabled for circles)
  const rotY = -r - ROT_HANDLE_OFFSET;
  if (shape.type !== 'circle' && Math.abs(lx) < 8 && Math.abs(ly - rotY) < 8) {
    return 'rotate';
  }

  // Resize handles (corners and midpoints)
  const handles = [
    { x: -r, y: -r, type: 'nw' },
    { x: r, y: -r, type: 'ne' },
    { x: r, y: r, type: 'se' },
    { x: -r, y: r, type: 'sw' },
    { x: 0, y: -r, type: 'n' },
    { x: r, y: 0, type: 'e' },
    { x: 0, y: r, type: 's' },
    { x: -r, y: 0, type: 'w' },
  ];

  for (const h of handles) {
    if (Math.abs(lx - h.x) < HANDLE_SIZE && Math.abs(ly - h.y) < HANDLE_SIZE) {
      return h.type;
    }
  }

  return null;
}

// Hit test ADSR corners. Returns corner name if mouse is near a canvas corner.
export function hitTestADSRCorner(envelope, mx, my, canvasSize) {
  const hitRadius = canvasSize * 0.08;
  const corners = [
    { name: 'attack', cx: 0, cy: canvasSize },
    { name: 'decay', cx: 0, cy: 0 },
    { name: 'sustain', cx: canvasSize, cy: 0 },
    { name: 'release', cx: canvasSize, cy: canvasSize },
  ];

  for (const corner of corners) {
    if (Math.hypot(mx - corner.cx, my - corner.cy) < hitRadius) {
      return corner.name;
    }
  }

  return null;
}

// Calculate new size from a resize handle drag
export function calcResize(shape, handleType, localDx, localDy, canvasSize) {
  const r = (shape.size / 2) * canvasSize;
  let newR = r;

  switch (handleType) {
    case 'nw':
    case 'se':
      newR = r + ((handleType === 'se' ? 1 : -1) * (localDx + localDy)) / 2;
      break;
    case 'ne':
    case 'sw':
      newR = r + ((handleType === 'ne' ? 1 : -1) * (localDx - localDy)) / 2;
      break;
    case 'n':
    case 's':
      newR = r + (handleType === 's' ? 1 : -1) * localDy;
      break;
    case 'e':
    case 'w':
      newR = r + (handleType === 'e' ? 1 : -1) * localDx;
      break;
  }

  return clampSize((newR * 2) / canvasSize);
}

// Calculate rotation from mouse position relative to shape center
export function calcRotation(shape, mx, my, canvasSize) {
  const cx = shape.x * canvasSize;
  const cy = shape.y * canvasSize;
  const angle = Math.atan2(my - cy, mx - cx);
  // Convert to degrees, offset so "up" = 0
  let deg = (angle * 180) / Math.PI + 90;
  if (deg < 0) deg += 360;
  return deg % 360;
}

// ---- Decoration hit testing ----

const DECO_HANDLE_SIZE = 8;
const CURLICUE_EXTENT = 22; // approx max spiral radius in pixels at scale=1
const TEXT_APPROX_CHAR_W = 14; // approximate character width for hit testing

// Compute bounding box for a decoration in pixel coordinates
export function getDecoBounds(deco, canvasSize) {
  const scale = deco.scale || 1;
  if (deco.type === 'squiggle' && deco.points.length >= 2) {
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const [px, py] of deco.points) {
      minX = Math.min(minX, px * canvasSize);
      minY = Math.min(minY, py * canvasSize);
      maxX = Math.max(maxX, px * canvasSize);
      maxY = Math.max(maxY, py * canvasSize);
    }
    const pad = (deco.strokeWidth || 3) + 4;
    return { x: minX - pad, y: minY - pad, w: maxX - minX + pad * 2, h: maxY - minY + pad * 2 };
  }
  if (deco.type === 'curlicue') {
    const cx = deco.x * canvasSize;
    const cy = deco.y * canvasSize;
    const extent = CURLICUE_EXTENT * scale + 6;
    return { x: cx - extent, y: cy - extent, w: extent * 2, h: extent * 2 };
  }
  if (deco.type === 'text' && deco.text) {
    const cx = deco.x * canvasSize;
    const cy = deco.y * canvasSize;
    const fontSize = (deco.fontSize || 24) * scale;
    const tw = deco.text.length * TEXT_APPROX_CHAR_W * scale;
    const th = fontSize * 1.2;
    return { x: cx - tw / 2, y: cy - th / 2, w: tw, h: th };
  }
  return null;
}

// Hit test decorations (back-to-front, return topmost)
export function hitTestDecorations(state, mx, my, canvasSize) {
  for (let i = state.decorations.length - 1; i >= 0; i--) {
    const deco = state.decorations[i];
    const bounds = getDecoBounds(deco, canvasSize);
    if (
      bounds &&
      mx >= bounds.x &&
      mx <= bounds.x + bounds.w &&
      my >= bounds.y &&
      my <= bounds.y + bounds.h
    ) {
      return deco.id;
    }
  }
  return null;
}

// Hit test decoration resize handles (corner handles only)
export function hitTestDecoHandles(deco, mx, my, canvasSize) {
  const bounds = getDecoBounds(deco, canvasSize);
  if (!bounds) return null;

  const corners = [
    { x: bounds.x, y: bounds.y, type: 'nw' },
    { x: bounds.x + bounds.w, y: bounds.y, type: 'ne' },
    { x: bounds.x + bounds.w, y: bounds.y + bounds.h, type: 'se' },
    { x: bounds.x, y: bounds.y + bounds.h, type: 'sw' },
  ];

  for (const c of corners) {
    if (Math.abs(mx - c.x) < DECO_HANDLE_SIZE && Math.abs(my - c.y) < DECO_HANDLE_SIZE) {
      return c.type;
    }
  }
  return null;
}

// Move a decoration by a normalized delta
export function moveDeco(deco, dnx, dny) {
  if (deco.type === 'squiggle') {
    for (const pt of deco.points) {
      pt[0] = Math.max(0, Math.min(1, pt[0] + dnx));
      pt[1] = Math.max(0, Math.min(1, pt[1] + dny));
    }
  } else {
    deco.x = Math.max(0, Math.min(1, deco.x + dnx));
    deco.y = Math.max(0, Math.min(1, deco.y + dny));
  }
}
