import { chromium } from '/home/claude/.npm-global/lib/node_modules/playwright/index.mjs';
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 420, height: 760 } });
p.on('console', m => console.log('[console]', m.type(), m.text().slice(0,200)));
p.on('pageerror', e => console.log('[pageerror]', e.message.slice(0,300)));
await p.goto('http://localhost:8765/demo.html?surface=sidepanel'); await p.waitForTimeout(2000);
await p.screenshot({ path: '/tmp/claude-0/spike/boot.png' });
const btn = p.locator('#fetchSummary'); console.log('btn', await btn.count());
if (await btn.count()) { await btn.click({timeout:5000}); await p.waitForTimeout(3500); await p.screenshot({ path: '/tmp/claude-0/spike/after.png' }); }
console.log((await p.locator('body').innerText()).slice(0,600));
await b.close();
