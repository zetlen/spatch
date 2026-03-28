// blend-combinations.test.js — Verify blend mode visual distinctness via real rendering.
//
// Renders overlapping SVG circles with all blend mode combinations and samples
// the overlap pixel. Asserts:
// 1. Same-mode pairs are order-independent (commutative)
// 2. All distinct blend configurations produce distinct colors

import { test, expect } from '@playwright/test';

const MODES = ['screen', 'multiply', 'difference'];
const COLOR_A = 'rgb(200, 80, 60)';
const COLOR_B = 'rgb(60, 120, 200)';
const BG = '#333333';

/**
 * Render two overlapping circles with given blend modes, rasterize via
 * canvas, and return the RGB of the overlap center pixel.
 */
async function sampleOverlap(page, modeA, modeB, colorA = COLOR_A, colorB = COLOR_B) {
  return page.evaluate(
    ({ modeA, modeB, colorA, colorB, bg }) => {
      const svgNS = 'http://www.w3.org/2000/svg';
      const S = 200;
      const svg = document.createElementNS(svgNS, 'svg');
      svg.setAttribute('xmlns', svgNS);
      svg.setAttribute('width', String(S));
      svg.setAttribute('height', String(S));

      // Background rect inside SVG (so it serializes)
      const bgRect = document.createElementNS(svgNS, 'rect');
      bgRect.setAttribute('width', String(S));
      bgRect.setAttribute('height', String(S));
      bgRect.setAttribute('fill', bg);
      svg.appendChild(bgRect);

      // Voice A (bottom)
      const gA = document.createElementNS(svgNS, 'g');
      gA.setAttribute('style', `mix-blend-mode: ${modeA}`);
      const cA = document.createElementNS(svgNS, 'circle');
      cA.setAttribute('cx', '80');
      cA.setAttribute('cy', '100');
      cA.setAttribute('r', '60');
      cA.setAttribute('fill', colorA);
      gA.appendChild(cA);
      svg.appendChild(gA);

      // Voice B (top)
      const gB = document.createElementNS(svgNS, 'g');
      gB.setAttribute('style', `mix-blend-mode: ${modeB}`);
      const cB = document.createElementNS(svgNS, 'circle');
      cB.setAttribute('cx', '120');
      cB.setAttribute('cy', '100');
      cB.setAttribute('r', '60');
      cB.setAttribute('fill', colorB);
      gB.appendChild(cB);
      svg.appendChild(gB);

      document.body.appendChild(svg);

      const canvas = document.createElement('canvas');
      canvas.width = S;
      canvas.height = S;
      const ctx = canvas.getContext('2d');
      return new Promise((resolve) => {
        const data = new XMLSerializer().serializeToString(svg);
        const img = new Image();
        img.onload = () => {
          ctx.drawImage(img, 0, 0);
          const px = ctx.getImageData(100, 100, 1, 1).data;
          svg.remove();
          resolve({ r: px[0], g: px[1], b: px[2] });
        };
        img.src = 'data:image/svg+xml,' + encodeURIComponent(data);
      });
    },
    { modeA, modeB, colorA, colorB, bg: BG },
  );
}

test.describe('blend mode combinations', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('about:blank');
  });

  test('same-mode pairs are commutative (swapping DOM order produces same color)', async ({
    page,
  }) => {
    for (const mode of MODES) {
      const ab = await sampleOverlap(page, mode, mode, COLOR_A, COLOR_B);
      const ba = await sampleOverlap(page, mode, mode, COLOR_B, COLOR_A);
      expect(
        Math.abs(ab.r - ba.r) + Math.abs(ab.g - ba.g) + Math.abs(ab.b - ba.b),
      ).toBeLessThanOrEqual(3);
    }
  });

  test('cross-mode pairs are commutative (swapping DOM order produces same color)', async ({
    page,
  }) => {
    for (let i = 0; i < MODES.length; i++) {
      for (let j = i + 1; j < MODES.length; j++) {
        const ab = await sampleOverlap(page, MODES[i], MODES[j]);
        const ba = await sampleOverlap(page, MODES[j], MODES[i]);
        const dist = Math.abs(ab.r - ba.r) + Math.abs(ab.g - ba.g) + Math.abs(ab.b - ba.b);
        if (dist > 3) {
          // If this fails, cross-mode pairs are NOT commutative — bijection issue
          console.log(
            `NOT commutative: ${MODES[i]}+${MODES[j]} → rgb(${ab.r},${ab.g},${ab.b}) vs ${MODES[j]}+${MODES[i]} → rgb(${ba.r},${ba.g},${ba.b}), dist=${dist}`,
          );
        }
        expect(dist).toBeLessThanOrEqual(3);
      }
    }
  });

  test('all 6 blend pair configurations produce distinct overlap colors', async ({ page }) => {
    const pairs = [];
    for (let i = 0; i < MODES.length; i++) {
      for (let j = i; j < MODES.length; j++) {
        pairs.push([MODES[i], MODES[j]]);
      }
    }

    const results = [];
    for (const [a, b] of pairs) {
      const color = await sampleOverlap(page, a, b);
      results.push({ pair: `${a}+${b}`, color });
    }

    // Log all colors for debugging
    for (const { pair, color } of results) {
      console.log(`${pair}: rgb(${color.r}, ${color.g}, ${color.b})`);
    }

    // Every pair must produce a distinct RGB (manhattan distance > 5)
    for (let i = 0; i < results.length; i++) {
      for (let j = i + 1; j < results.length; j++) {
        const a = results[i].color;
        const b = results[j].color;
        const dist = Math.abs(a.r - b.r) + Math.abs(a.g - b.g) + Math.abs(a.b - b.b);
        if (dist <= 5) {
          console.log(`INDISTINCT: ${results[i].pair} vs ${results[j].pair}, dist=${dist}`);
        }
        expect(dist).toBeGreaterThan(5);
      }
    }
  });
});
