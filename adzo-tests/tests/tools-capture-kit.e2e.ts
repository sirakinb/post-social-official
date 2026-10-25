import { test } from '@e2e-dev/web';
import { credentials } from 'e2e';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';

// Tool, not a check: captures real Post Social screens of the Lantern Studio demo workspace as
// standalone HTML (DOM + inlined CSS, fonts and images) for the product-video kit
// (sirakinb/post-social-videos, kit/app). Runs only when /data/home/videos-work/CAPTURE exists;
// screen names listed in that file limit the run to those screens.
const OUT = '/data/home/videos-work/kit/raw';
const FLAG = '/data/home/videos-work/CAPTURE';

// Runs in the page: returns the page as one self-contained HTML file. Scripts are dropped,
// stylesheets, fonts and images are inlined, and environment-only chrome is hidden.
const SERIALIZE = `async () => {
  const toData = async (url) => {
    try {
      const r = await fetch(url, { credentials: 'include' });
      if (!r.ok) return null;
      const b = await r.blob();
      return await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(b); });
    } catch { return null; }
  };
  let css = '';
  for (const sheet of Array.from(document.styleSheets)) {
    try { css += Array.from(sheet.cssRules).map((r) => r.cssText).join('\\n') + '\\n'; } catch {}
  }
  const urls = new Set();
  css.replace(/url\\((["']?)([^"')]+)\\1\\)/g, (_m, _q, u) => { if (!u.startsWith('data:')) urls.add(u); return _m; });
  for (const u of urls) {
    const abs = new URL(u, location.href).href;
    const data = await toData(abs);
    if (data) css = css.split(u).join(data);
  }
  const clone = document.documentElement.cloneNode(true);
  clone.querySelectorAll('script, noscript, link[rel="preload"], link[rel="stylesheet"], link[rel="modulepreload"], style').forEach((n) => n.remove());
  const live = Array.from(document.querySelectorAll('img'));
  const copies = Array.from(clone.querySelectorAll('img'));
  for (let i = 0; i < copies.length; i++) {
    const src = live[i] && (live[i].currentSrc || live[i].src);
    if (src && !src.startsWith('data:')) { const data = await toData(src); if (data) copies[i].setAttribute('src', data); }
    copies[i].removeAttribute('srcset'); copies[i].removeAttribute('loading');
  }
  clone.querySelectorAll('video').forEach((v) => v.removeAttribute('src'));
  // Form values typed into inputs live on the element, not in the DOM.
  const liveInputs = Array.from(document.querySelectorAll('input, textarea'));
  Array.from(clone.querySelectorAll('input, textarea')).forEach((el, i) => { const v = liveInputs[i] && liveInputs[i].value; if (v) { if (el.tagName === 'TEXTAREA') el.textContent = v; else el.setAttribute('value', v); } });
  const head = clone.querySelector('head');
  const style = document.createElement('style'); style.textContent = css; head.appendChild(style);
  const hide = document.createElement('style');
  hide.textContent = '[aria-label^="Environment"], .crisp-client, #crisp-chatbox, nextjs-portal, [data-nextjs-toast], [data-next-badge-root] { display: none !important; }';
  head.appendChild(hide);
  return '<!doctype html>' + clone.outerHTML;
}`;

const SCREENS: Array<{ name: string; path: string; prepare?: string | string[]; compose?: boolean }> = [
  { name: 'accounts', path: '/beta/accounts' },
  { name: 'api', path: '/beta/api' },
  { name: 'calendar', path: '/beta/calendar' },
  { name: 'calendar-published-card', path: '/beta/calendar', prepare: 'kiln' },
  { name: 'calendar-week', path: '/beta/calendar', prepare: ['week', '›'] },
  { name: 'drafts', path: '/beta/drafts' },
  { name: 'activity', path: '/beta/activity' },
  { name: 'create', path: '/beta/create' },
  { name: 'create-filled', path: '/beta/create', compose: true },
  { name: 'authorize-error', path: '/beta/authorize' },
  { name: 'billing', path: '/beta/billing' },
  { name: 'usage', path: '/beta/usage' },
];

test('tools: capture the video kit screens', async ({ app, screen, browser }) => {
  if (!existsSync(FLAG)) return;
  mkdirSync(OUT, { recursive: true });
  const demo = credentials.user('demo');
  await app.open('/beta/login');
  await screen.getByLabel('Email').fill(demo.username);
  await screen.getByLabel('Password').fill(demo.password);
  await screen.getByRole('button', 'Sign in').tap();
  await browser.waitForURL(/\/beta\/accounts/);

  const only = readFileSync(FLAG, 'utf8').split(/\s+/).filter(Boolean);
  for (const mode of ['dark', 'light']) {
    await browser.evaluate((m: string) => { document.cookie = 'ps-theme=' + m + '; path=/; samesite=lax'; }, mode);
    for (const s of SCREENS) {
      if (only.length && !only.includes(s.name)) continue;
      await app.open(s.path);
      await new Promise((r) => setTimeout(r, 2500));
      await browser.evaluate((m: string) => { const el = document.querySelector('[data-theme]'); if (el) el.setAttribute('data-theme', m); }, mode);
      for (const click of s.prepare ? [s.prepare].flat() : []) {
        await browser.evaluate((text: string) => {
          const el = Array.from(document.querySelectorAll('button, [role="button"], a')).find((n) => (n.textContent || '').trim().toLowerCase() === text || (n.textContent || '').toLowerCase().includes(text));
          (el as HTMLElement | undefined)?.click();
        }, click);
        await new Promise((r) => setTimeout(r, 1500));
      }
      if (s.compose) {
        // A post being written: Instagram and Threads chosen, a caption, the kiln clip (no people
        // in it), and the Instagram preview showing.
        await browser.evaluate(() => {
          const chips = Array.from(document.querySelectorAll('section[aria-label="Editor"] button[aria-pressed]')) as HTMLElement[];
          chips.filter((c) => /@lantern\.studio/.test(c.textContent || '')).forEach((c) => c.click());
        });
        await screen.getByPlaceholder('Write a caption…').fill('Fresh out of the kiln. Our autumn glazes are finally here, in five new colours.');
        await screen.getByRole('button', 'Add media').tap();
        await new Promise((r) => setTimeout(r, 1500));
        await browser.evaluate(() => {
          const pick = Array.from(document.querySelectorAll('[role="dialog"][aria-label="Add media"] button[aria-pressed]')).find((b) => (b.textContent || '').includes('kiln.mp4')) as HTMLElement | undefined;
          pick?.click();
        });
        await screen.getByRole('button', 'Done').tap();
        await new Promise((r) => setTimeout(r, 2500));
        await browser.evaluate(() => { (Array.from(document.querySelectorAll('[role="tablist"][aria-label="Preview"] button')).find((b) => b.textContent === 'Instagram') as HTMLElement | undefined)?.click(); });
        await new Promise((r) => setTimeout(r, 1000));
      }
      let html = await browser.evaluate<string>(SERIALIZE);
      // Signed media links can't be read from the page (no CORS); fetch them here and embed them.
      for (const url of new Set(html.match(/https:\/\/[a-z0-9.]+\.r2\.cloudflarestorage\.com\/[^"'\s)]+/g) ?? [])) {
        const res = await fetch(url.replace(/&amp;/g, '&'));
        if (!res.ok) continue;
        const type = res.headers.get('content-type') ?? 'application/octet-stream';
        html = html.split(url).join(`data:${type};base64,${Buffer.from(await res.arrayBuffer()).toString('base64')}`);
      }
      const scroll = await browser.evaluate(() => ({ w: document.documentElement.scrollWidth, h: document.documentElement.scrollHeight, theme: document.querySelector('[data-theme]')?.getAttribute('data-theme') ?? null }));
      writeFileSync(`${OUT}/${s.name}-${mode}.html`, html);
      writeFileSync(`${OUT}/${s.name}-${mode}.json`, JSON.stringify({ path: s.path, mode, viewport: { width: 1280, height: 800 }, ...scroll }));
    }
  }
});
