import { test } from '@e2e-dev/web';

// The landing page's product video and the Quickstart's walkthrough: each page points at a
// video, a cover and captions, and the site serves all three.
const PAGES = [
  { path: '/', video: '#demo video', files: ['/landing/product-video.mp4', '/landing/product-video-poster.webp', '/landing/product-video.vtt'] },
  { path: '/docs/quickstart', video: 'main video', files: ['/docs/quickstart/walkthrough.mp4', '/docs/quickstart/walkthrough-poster.webp', '/docs/quickstart/walkthrough.vtt'] },
];

for (const page of PAGES) {
  test(`the video on ${page.path} loads, with its cover and captions`, async ({ app, browser }) => {
    await app.open(page.path);
    const found = await browser.evaluate(async ({ selector, files }: { selector: string; files: string[] }) => {
      const v = document.querySelector(selector);
      const wired = v ? [v.querySelector('source')?.getAttribute('src'), v.getAttribute('poster'), v.querySelector('track')?.getAttribute('src')] : [];
      const served = await Promise.all(files.map(async (f) => { const r = await fetch(f, { method: 'HEAD' }); return `${f} ${r.status} ${r.headers.get('content-type')}`; }));
      return { wired, served };
    }, { selector: page.video, files: page.files });
    if (JSON.stringify(found.wired) !== JSON.stringify([page.files[0], page.files[1], page.files[2]])) throw new Error(`video not wired as expected: ${JSON.stringify(found.wired)}`);
    const bad = found.served.filter((s) => !/ 200 /.test(s));
    if (bad.length) throw new Error(`not served: ${bad.join('; ')}`);
  });
}
