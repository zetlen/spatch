import { expect, test } from '@playwright/test';
import path from 'path';

async function getDecayRadius(page) {
  return page.evaluate(() => {
    const frame = document.querySelector('#canvas-frame');
    return parseFloat(getComputedStyle(frame).borderTopLeftRadius);
  });
}

test.describe('ADSR corner drag gesture', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript({
      path: path.join(import.meta.dirname, 'helpers/skip-splash.js'),
    });
    await page.goto('/');
    await page.waitForSelector('#sigil-canvas');
  });

  test('drag down-right rounds, up-left unrounds, back down-right re-rounds', async ({ page }) => {
    const canvas = page.locator('#sigil-canvas');
    const box = await canvas.boundingBox();

    // Decay corner is top-left of canvas (0,0 in canvas coords)
    const startX = box.x + 15;
    const startY = box.y + 15;

    const initialRadius = await getDecayRadius(page);

    // 1. Mouse down near decay corner
    await page.mouse.move(startX, startY);
    await page.mouse.down();

    // 2. Drag down-right — should increase rounding
    await page.mouse.move(startX + 60, startY + 60, { steps: 5 });
    await page.waitForTimeout(50);
    const roundedRadius = await getDecayRadius(page);
    expect(roundedRadius).toBeGreaterThan(initialRadius + 1);

    // 3. Drag diagonally up-left past the start — should decrease rounding
    //    This moves the mouse OUTSIDE the canvas element.
    await page.mouse.move(startX - 40, startY - 40, { steps: 5 });
    await page.waitForTimeout(50);
    const unroundedRadius = await getDecayRadius(page);
    expect(unroundedRadius).toBeLessThan(roundedRadius);

    // 4. Drag back down-right, farther than step 2 — should re-round.
    //    Previously this failed because mouseleave reset the interaction.
    await page.mouse.move(startX + 100, startY + 100, { steps: 5 });
    await page.waitForTimeout(50);
    const reRoundedRadius = await getDecayRadius(page);
    expect(reRoundedRadius).toBeGreaterThan(unroundedRadius + 1);
    // Both drags max out the decay value, so re-rounded >= rounded
    expect(reRoundedRadius).toBeGreaterThanOrEqual(roundedRadius);

    // 5. Release
    await page.mouse.up();
  });
});
