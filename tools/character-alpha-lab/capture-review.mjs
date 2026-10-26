import { chromium } from '../../.scratch/pilot-browser/node_modules/playwright/index.mjs';
import fs from 'node:fs/promises';
const out='docs/art/character-alpha-v1/review';
await fs.mkdir(out,{recursive:true});
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto('http://127.0.0.1:5194/tools/character-alpha-lab/index.html');
  const ready=()=>page.waitForFunction(()=>!document.querySelector('#export-png').disabled);
  await ready();
  for(const body of ['male','female']) {
    await page.selectOption('#body-select',body); await ready();
    for(const mode of ['master','modular']) {
      await page.click('[data-mode="'+mode+'"]'); await ready();
      await page.screenshot({path:out+'/'+body+'-'+mode+'.png'});
      await fs.writeFile(out+'/'+body+'-'+mode+'-canvas.png',Buffer.from(await page.locator('#character').evaluate(c=>c.toDataURL().split(',')[1]),'base64'));
    }
  }
} finally {await browser.close();}
