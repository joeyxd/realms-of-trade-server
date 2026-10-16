// Root-only serial acceptance for the live M panel and its expanded map projection.
async page => {
  const cases = [], out = 'C:/DEV/real of trade/realms-of-trade-server/docs/art/map-revamp';
  for (const device of ['desktop', 'mobile']) {
    const mobile = device === 'mobile', viewport = mobile ? { width: 844, height: 390 } : { width: 1280, height: 720 };
    const context = await page.context().browser().newContext({ viewport, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: 1 });
    const p = await context.newPage(), errors = [];
    p.on('pageerror', e => errors.push(e.message));
    try {
      await p.goto('http://127.0.0.1:5192/?solo&debug&tod=day&q=' + (mobile ? 'medium' : 'high'));
      await p.waitForFunction(() => window.__mn && !document.querySelector('#btn-play').disabled, null, { timeout: 60000 });
      await p.locator('#btn-play').click({ force: true });
      await p.waitForFunction(() => __mn.client.resources?.bench && __mn.st.mode === 'playing' && __mn.input.enabled);
      await p.evaluate(() => document.querySelector('#game')?.focus());
      await p.keyboard.press('m');
      await p.locator('#mapview').waitFor({ state: 'visible' });
      await p.waitForTimeout(400);
      const state = await p.evaluate(() => {
        const m = __mn, panel = m.panels.mapView;
        m.transport.send({ t: 'cmd', type: 'pause', on: true }); m.loop.running = false;
        panel.update(m.ps, [], null, 0);
        const labels = [...document.querySelectorAll('.mapv-labels span')].map(e => ({ name: e.textContent, x: parseFloat(e.style.left), y: parseFloat(e.style.top) }));
        const pins = [...m.map.npcs, ...m.map.racks, m.map.landmarks.arena, m.map.landmarks.volcano, m.map.cala].map(p => panel.px(p.x, p.z, 100));
        const gl = m.world.renderer.getContext();
        return { open: panel.isOpen, span: panel.span, size: m.map.size, labels, pins, glError: gl.getError(), gameErrors: m.errors, assetErrors: m.assets.errors };
      });
      if (!state.open || state.span !== 255 || state.size !== 560 || state.glError !== 0 || Object.keys(state.gameErrors).length || state.assetErrors.length || errors.length
        || state.pins.some(p => p.some(n => n < 0 || n > 100)) || state.labels.some(p => p.x < 0 || p.x > 100 || p.y < 0 || p.y > 100)) throw Error('Expanded map panel failed on ' + device);
      await p.screenshot({ path: out + '/' + device + '-map-panel-after-v1.png' });
      await p.keyboard.press('Escape');
      if (await p.locator('#mapview').isVisible()) throw Error('Map panel did not close on ' + device);
      cases.push({ device, viewport, state, closePassed: true, errors });
    } finally { await context.close(); }
  }
  return { family: 'map-revamp-v1', cases };
}
