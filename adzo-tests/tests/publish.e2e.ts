import { test } from '@e2e-dev/web';
import { expect, credentials } from 'e2e';
import { writeFileSync } from 'node:fs';
import { KEY_FILE, accountFor, publishNow, expectLinkOpens, stamp, uploadMedia, showOnCamera } from './lib/publish-helpers';

// Publishing to every connected test account on staging: each test makes one post through the
// REST API (a key the setup creates), waits for the app to show it published, and checks the
// live link. All 8 accounts live in the staging workspace "Adzo Test's workspace".
//   Quick set (every change):  --grep "@quick"    Bluesky, Facebook, Instagram, Threads, LinkedIn
//   Release set (everything):  --grep "@quick|@release"  adds X (costs API credit), TikTok, YouTube
// The app has no way to delete a sent post from the platform, so test posts stay on the test accounts.
// Each test ends on the app's Calendar, the live post and the account's page, for the recording.

// Signs in as the "social" test login and makes an API key for the tests below. Old keys from
// earlier runs are revoked first, so at most one stays active.
test.setup('sign in as the social test login and make a publishing key', { sessions: ['social'] }, async ({ app, screen, session, browser }) => {
  const user = credentials.user('social');
  await app.open('/beta/login');
  await screen.getByLabel('Email').fill(user.username);
  await screen.getByLabel('Password').fill(user.password);
  await screen.getByRole('button', 'Sign in').tap();
  await browser.waitForURL(/\/beta\/accounts/, { timeout: 60_000 });
  await session.save('social');

  await app.open('/beta/api');
  // Revoke leftovers from earlier runs (Revoke, then Confirm, per row).
  for (let i = 0; i < 10; i++) {
    const clicked = await browser.evaluate(async () => {
      const row = [...document.querySelectorAll('div')].find((d) => d.className.includes('border-b') && /e2e-publish/.test(d.textContent ?? '') && [...d.querySelectorAll('button')].some((b) => b.textContent === 'Revoke'));
      const revoke = row && [...row.querySelectorAll('button')].find((b) => b.textContent === 'Revoke');
      if (!revoke) return false;
      (revoke as HTMLButtonElement).click();
      await new Promise((r) => setTimeout(r, 300));
      const confirm = [...row.querySelectorAll('button')].find((b) => b.textContent === 'Confirm');
      (confirm as HTMLButtonElement | undefined)?.click();
      return true;
    });
    if (!clicked) break;
    await new Promise((r) => setTimeout(r, 2500));
  }

  await screen.getByRole('button', 'Create key').tap();
  await screen.getByLabel('Name').fill('e2e-publish');
  await screen.getByRole('button', 'Create').tap();
  // The key is shown once, right after Create.
  let key = '';
  for (let i = 0; i < 20 && !key; i++) {
    key = await browser.evaluate(() => [...document.querySelectorAll('code')].map((c) => c.textContent ?? '').find((t) => t.startsWith('ps_live_')) ?? '');
    if (!key) await new Promise((r) => setTimeout(r, 1500));
  }
  if (!key) throw new Error('The new API key was not shown on the page.');
  writeFileSync(KEY_FILE, key, { mode: 0o600 });
});

// Bluesky takes text posts and its public API lets us read the post back. @quick
test('@quick a post publishes to Bluesky and its live link works', { session: 'social', timeout: 300_000, tags: ['quick', 'publish'] }, async (t) => {
  await accountFor('bluesky');
  const caption = `Post Social e2e check ${stamp()}`;
  const { liveUrl } = await publishNow('bluesky', { caption, options: { media_type: 'text' } });
  expect(liveUrl).toMatch(/^https:\/\/bsky\.app\/profile\/adzotest\.bsky\.social\/post\//);
  await expectLinkOpens(liveUrl);
  // Read the post back from Bluesky itself. Its post lookup needs the account's DID (not the
  // handle), and a new post can take a few seconds to show up there.
  const rkey = liveUrl.split('/').pop();
  const resolved: any = await (await fetch('https://public.api.bsky.app/xrpc/com.atproto.identity.resolveHandle?handle=adzotest.bsky.social')).json();
  const uri = `at://${resolved.did}/app.bsky.feed.post/${rkey}`;
  let posted: string | undefined;
  for (let i = 0; i < 10 && posted === undefined; i++) {
    if (i) await new Promise((r) => setTimeout(r, 3000));
    const body: any = await (await fetch('https://public.api.bsky.app/xrpc/app.bsky.feed.getPosts?uris=' + encodeURIComponent(uri))).json();
    posted = body.posts?.[0]?.record?.text;
  }
  expect(posted).toBe(caption);
  await showOnCamera(t, { platform: 'bluesky', caption, liveUrl: liveUrl });
});

// A text post to the Facebook test Page. @quick
test('@quick a post publishes to Facebook and its live link works', { session: 'social', timeout: 300_000, tags: ['quick', 'publish'] }, async (t) => {
  await accountFor('facebook');
  const caption = `Post Social e2e check ${stamp()}`;
  const { liveUrl } = await publishNow('facebook', { caption, options: { media_type: 'text' } });
  expect(liveUrl).toMatch(/^https:\/\/(www\.)?facebook\.com\//);
  await expectLinkOpens(liveUrl);
  await showOnCamera(t, { platform: 'facebook', caption, liveUrl: liveUrl });
});

// A photo post to @adzotest (Instagram needs media). @quick
test('@quick a photo publishes to Instagram and its live link works', { session: 'social', timeout: 420_000, tags: ['quick', 'publish'] }, async (t) => {
  await accountFor('instagram');
  const caption = `Post Social e2e check ${stamp()}`;
  const mediaId = await uploadMedia('test-image.jpg', 'image/jpeg');
  const { liveUrl } = await publishNow('instagram', { caption, mediaIds: [mediaId], options: { media_type: 'image' }, timeoutMs: 360_000 });
  expect(liveUrl).toMatch(/^https:\/\/(www\.)?instagram\.com\//);
  await expectLinkOpens(liveUrl);
  await showOnCamera(t, { platform: 'instagram', caption, liveUrl: liveUrl });
});

// A text post to the Threads test account. @quick
test('@quick a post publishes to Threads and its live link works', { session: 'social', timeout: 300_000, tags: ['quick', 'publish'] }, async (t) => {
  await accountFor('threads');
  const caption = `Post Social e2e check ${stamp()}`;
  const { liveUrl } = await publishNow('threads', { caption, options: { media_type: 'text' } });
  expect(liveUrl).toMatch(/^https:\/\/(www\.)?threads\.(net|com)\//);
  await expectLinkOpens(liveUrl);
  await showOnCamera(t, { platform: 'threads', caption, liveUrl: liveUrl });
});

// A text post to the LinkedIn dummy profile. @quick
test('@quick a post publishes to LinkedIn and its live link works', { session: 'social', timeout: 300_000, tags: ['quick', 'publish'] }, async (t) => {
  await accountFor('linkedin');
  const caption = `Post Social e2e check ${stamp()}`;
  const { liveUrl } = await publishNow('linkedin', { caption, options: { media_type: 'text' } });
  expect(liveUrl).toMatch(/^https:\/\/(www\.)?linkedin\.com\//);
  await expectLinkOpens(liveUrl);
  await showOnCamera(t, { platform: 'linkedin', caption, liveUrl: liveUrl });
});

// A text post to @adzotest. Costs X API credit (about 1.5 cents), so release set only; no link in the text so it stays at the lowest price. @release
test('@release a post publishes to X and its live link works', { session: 'social', timeout: 300_000, tags: ['release', 'publish'] }, async (t) => {
  await accountFor('x');
  const caption = `Post Social e2e check ${stamp()}`;
  const { liveUrl } = await publishNow('x', { caption, options: { media_type: 'text' } });
  expect(liveUrl).toMatch(/^https:\/\/(x|twitter)\.com\/adzotest\/status\//);
  await expectLinkOpens(liveUrl);
  await showOnCamera(t, { platform: 'x', caption, liveUrl: liveUrl });
});

// A photo post to the TikTok sandbox account. Sandbox posts can only be private (SELF_ONLY), so
// this checks TikTok accepted and finished the post, not that anyone can see it. @release
test('@release a photo is accepted by TikTok as a private post', { session: 'social', timeout: 600_000, tags: ['release', 'publish'] }, async (t) => {
  await accountFor('tiktok');
  const caption = `Post Social e2e check ${stamp()}`;
  const mediaId = await uploadMedia('test-image.jpg', 'image/jpeg');
  const { postId, destination } = await publishNow('tiktok', {
    caption,
    mediaIds: [mediaId],
    options: { delivery_mode: 'direct', privacy_level: 'SELF_ONLY', media_type: 'photo', title: 'Post Social e2e check' },
    timeoutMs: 540_000,
    requireLink: false,
  });
  expect(postId).toBeTruthy();
  expect(destination.status).toBe('published');
  await showOnCamera(t, { platform: 'tiktok', caption, liveUrl: undefined });
});

// A 4-second vertical video uploaded to the "adzo test" channel as a private Short.
// YouTube has a daily upload limit, so release set only. @release
test('@release a video uploads to YouTube as a private Short', { session: 'social', timeout: 720_000, tags: ['release', 'publish'] }, async (t) => {
  await accountFor('youtube');
  const caption = `Post Social e2e check ${stamp()}`;
  const mediaId = await uploadMedia('test-short.mp4', 'video/mp4');
  const { liveUrl } = await publishNow('youtube', {
    caption,
    mediaIds: [mediaId],
    options: { title: 'Post Social e2e check', privacy_status: 'private' },
    timeoutMs: 660_000,
  });
  expect(liveUrl).toMatch(/^https:\/\/(www\.)?(youtube\.com|youtu\.be)\//);
  // A private video's page still opens (YouTube shows "private video"), it is just not public.
  await expectLinkOpens(liveUrl);
  await showOnCamera(t, { platform: 'youtube', caption, liveUrl: liveUrl });
});
