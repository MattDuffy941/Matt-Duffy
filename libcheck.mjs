import { chromium } from 'playwright';
const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const page = await browser.newPage({ viewport: { width: 1100, height: 950 } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const scratch = '/tmp/claude-0/-home-user-Matt-Duffy/1ceb27e2-2e23-596f-a482-3e6d865f88c5/scratchpad';

// Save flow: titled groove -> Save -> appears in My Grooves
await page.goto('http://127.0.0.1:4190/?TimeSig=4/4&Div=16&Title=Lesson%20Beat&Tempo=90&Measures=1&H=|x-x-x-x-x-x-x-x-|&S=|----O-------O---|&K=|o-------o-o-----|', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.locator('.saved-grooves summary').click();
console.log('saved list shows Lesson Beat:', await page.locator('.saved-load', { hasText: 'Lesson Beat' }).count());

// Persistence: navigate to blank app, reload, library still there, load restores groove
await page.goto('http://127.0.0.1:4190/', { waitUntil: 'networkidle' });
await page.locator('.saved-grooves summary').click();
await page.locator('.saved-load', { hasText: 'Lesson Beat' }).click();
await page.waitForTimeout(200);
const url = decodeURIComponent(page.url());
console.log('loading from library restores groove:', url.includes('Title=Lesson%20Beat') || url.includes('Title=Lesson Beat'));
console.log('tempo restored:', url.includes('Tempo=90'));

// Untitled save uses prompt
page.on('dialog', (d) => d.accept('Prompted Name'));
await page.goto('http://127.0.0.1:4190/?TimeSig=4/4&Div=16&Tempo=80&Measures=1&H=|x---------------|&S=|----------------|&K=|----------------|', { waitUntil: 'networkidle' });
await page.getByRole('button', { name: 'Save', exact: true }).click();
await page.waitForTimeout(200);
console.log('prompted name saved + title set:', decodeURIComponent(page.url()).includes('Title=Prompted'));

// Embed snippet copy
await page.getByRole('button', { name: 'Embed code' }).click();
const clip = await page.evaluate(() => navigator.clipboard.readText());
console.log('embed snippet is iframe with Embed=1:', clip.startsWith('<iframe') && clip.includes('Embed=1'));

// Embed view renders compact player
await page.goto('http://127.0.0.1:4190/?TimeSig=4/4&Div=16&Title=Lesson%20Beat&Tempo=90&Measures=1&H=|x-x-x-x-x-x-x-x-|&S=|----O-------O---|&K=|o-------o-o-----|&Embed=1', { waitUntil: 'networkidle' });
console.log('embed hides editor:', (await page.locator('.grid-editor').count()) === 0, '| has notation:', (await page.locator('.notation svg').count()) === 1);
console.log('embed bar text:', (await page.locator('.embed-title').textContent()).trim());
await page.locator('.embed .play').click();
await page.waitForTimeout(400);
console.log('embed playback starts:', (await page.locator('.embed .play').textContent()).trim() === '■');
await page.screenshot({ path: scratch + '/embed.png', clip: { x: 0, y: 0, width: 1100, height: 320 } });
console.log(errors.length ? 'ERRORS:\n' + errors.join('\n') : 'no page errors');
await browser.close();
