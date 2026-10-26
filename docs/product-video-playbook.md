# Product video playbook for Post Social

You are producing product videos for **Post Social**, a social media scheduler that
posts to eight platforms from one place, by hand or through your AI agent (Claude,
ChatGPT or any agent). The videos are a landing-page hero (~55s), short launch films
(25–40s) and feature walkthroughs (45–110s) for the app and the docs. They are made
entirely with code: there's no screen recording and no video editor. Quality matters
far more than cost.

The product's source code is at `/Users/sirakinb/Documents/Thought-Social` (GitHub
`sirakinb/post-social-official`). The docs are part of the same app: the pages under
`src/app/docs/` (served at postsocial.xyz/docs). The reviewer is **Aki** (owner). He
gives taste feedback, and you turn that feedback into written rules.

Before starting, read `AGENTS.md`, `docs/claude-handoff.md` and `docs/environments.md`
in the product repo. Their rules (approvals, secrets, dev vs prod) apply here too.

## 1. Core idea

Every video is an **HTML/CSS/JS page whose every frame is a pure function of time `t`**.
Headless Chrome screenshots each frame, and ffmpeg encodes them. This gives you:

- Exact, repeatable renders: a copy change means a cheap re-render, not a re-edit.
- Parallel rendering, because nothing carries over from one frame to the next.
- Real product UI, because the "footage" is real DOM captured from the running app.

Don't use Remotion or any other video framework; a ~200-line engine is enough. Don't
screen-record: recordings can't be re-timed, re-worded or kept pixel-perfect.

## 2. Set up a private video repo

Create a **private** repo, `sirakinb/post-social-videos`, separate from the product repo.
Ask Aki before creating it or pushing to it. Its layout:

```
AGENTS.md        # read-first notes for every agent: pipeline, taste rules, mistakes made
README.md        # catalog: every video, its branch, length, status, where it's used
BRIEF.md         # product truths, fictional cast, kit API, end-card and taste rules
EXPLAINER.md     # brief for the walkthrough format
LAUNCH.md        # brief for launch films
HOSTING.md       # hosting IDs for every published video
engine.js        # renderAt(t), addScene, spring/easing helpers, word-by-word captions
render.mjs       # parallel Playwright frame renderer → ffmpeg
mix.sh           # voice + music mix with ducking and loudness normalisation
judge.mjs        # audio judge (picks the best voiceover take)
vjudge.mjs       # video judge (reviews a whole render)
sheet.sh         # contact sheet from sampled frames
kit/app/         # REAL Post Social screens captured as DOM snapshots (see §3)
kit/explainer.js # overlays: step captions, callouts, highlights, camera, cursor, typing, toasts,
                 # and mock-ups of other apps' UI (Claude and ChatGPT chats, platform post views)
kit/endcard.js   # shared end card
music/           # shared music bed(s)
tools/           # upload scripts (hosting), helpers
```

**One branch and one git worktree per video**
(`git worktree add -b explainer-foo ../videos-explainer-foo main`). `main` holds only
shared things: the kit, the briefs and the tools. Merge `main` into a video branch to
pick up kit fixes. Put kit fixes found while making a video in a separate commit so they
can be cherry-picked to `main`.

Commit each video's web encode, poster, `.vtt` captions and a `VARIANT.md`. That file
holds the script, the timings, chapter markers, the claim checks, and any docs-vs-UI
differences found. Git-ignore masters and intermediate files.

Keep `AGENTS.md` alive. Every time Aki gives feedback, or an agent makes a mistake, add
a one-line rule there. This file is what makes the tenth video good on the first try.

## 3. Capture the real UI kit

1. **Use the existing demo workspace.** `scripts/seed-demo-workspace.ts` in the product
   repo builds one on **dev** (never prod): "Lantern Studio", a small pottery studio run
   by **Maya Okafor**, with five fake connected accounts, Claude and ChatGPT connected,
   and posts in every state (published, scheduled, partly failed). Publishing is paused,
   so nothing reaches a real platform. The sign-in goes to a file, never to chat.
   This is the fictional cast. Add to it in that script if a video needs more.
2. Run the app locally (`npm run dev`, port 3333, pointed at dev) and sign in as the demo
   account. Write a Playwright capture script that visits each screen and state the videos
   need (Create, Calendar, Drafts, Accounts, Activity, Analytics, Media, API keys,
   Billing, Usage, Settings, and the connect pages). It saves the **rendered DOM plus
   inlined CSS** as a standalone HTML snapshot, plus a PNG for reference. Capture both
   dark mode (the default) and light mode.
3. Missing states can be **derived** from the nearest snapshot by editing the DOM to
   match the real component's source (text, classes), never invented.
4. **Audit every snapshot for leaks** before committing:
   - Real people: Aki, Emmanuel, any real handle such as @Defi__Papi, real emails.
   - The amber dev environment badge and dev hostnames (`syydd6ck-zqc…`). Hide the badge
     in captures; no InsForge address should appear on screen.
   - API keys (even `ps_test_` ones), sign-in links, workspace and user ids.
   - The capture machine's **timezone and locale**: Aki's Mac is in Philadelphia. Set a
     fixed timezone and locale in Playwright.
5. Document the states, selectors and how to recapture in `kit/app/README.md`.

## 4. Write the script (accuracy first)

- Read the docs page and **the app source** for the feature. Every label, button and step
  on screen must match the product. Where the docs and the UI disagree, the UI wins; log
  the difference in `VARIANT.md`. Docs fixes go back to the product repo as a normal PR
  (feature branch, checks, Aki's OK).
- Check claims in code, not just in the docs. For example, do stats for this platform
  actually come from the official API in prod, or from public numbers?
- Keep a list of **product truths** in `BRIEF.md`. Start with these:
  - Eight platforms: TikTok, Instagram, Facebook Pages, Threads, YouTube, LinkedIn,
    Bluesky, X. Show them all or say "eight platforms"; don't add Pinterest or others.
  - Works with Claude, ChatGPT or any AI agent (MCP server, REST API and CLI), and with
    the in-app composer.
  - Pricing line, word for word: "Your first 2 accounts are free. After that it's usage
    based: you pay per account." **Never** say "pay by the day" or mention proration.
    X posts cost extra; never say "X charges us".
  - LinkedIn is personal profiles only (no Company Pages). Sign-up is email only.
  - Stats today come from public numbers; official platform stats are not live yet.
    Show only the metrics a platform reports, never invented numbers or "—" gaps.
  - The "Beta" label is still on, on purpose.
- Writing rules: plain words. Say "AI agent", "your agent", or name the app; never bare
  "AI". No invented testimonials, user counts or "featured on" badges.
- A walkthrough has a 1–2s product payoff up front, then numbered steps (one caption
  each), one result shot, and a minimal end card.
- **Intro messaging** (hero and launch) must say what Post Social *is* in the first line.
  The landing page's current line is "Social media management for AI-native creators and
  operators." Write several candidate openers and let Aki pick; record his pick in
  `BRIEF.md`.

## 5. Build the timeline

- `engine.js`: scenes are DOM subtrees shown and hidden with `display:none` (not
  `visibility`, because visible children leak through a hidden parent). All motion is
  computed from `t` with springs and easing.
- **Render purity is mandatory**: no `Date.now()`, no randomness without a seed, no state
  carried between frames. Workers start mid-timeline.
- Camera moves are CSS transforms on the snapshot, and so are cursor paths, typing and
  highlights.
- Preview live with `npx serve .`, using `?t=17` to start at 17s.

### Taste rules (start with these; add Aki's)

- **Look:** match Post Social's own look: dark mode by default (deep purple, cream text,
  warm peach accent), light mode where it helps. Aki's UI taste is "organized,
  structured, militant, simple, minimalistic". No rows of wrapping pill chips.
- **Openers:** product-native. No glossy fake app icons with red badges, no captions over
  blurred clutter. Reach the product payoff within ~2s.
- **Borrow, don't copy:** take ideas from other companies' videos (Zernio, Buffer, etc.)
  for function and pacing only, never their layout or wording.
- **No recaps:** never repeat earlier points in words or as a montage at the end.
- **End cards:** neat and centred, with the Post Social logo lockup, one line and a quiet
  `postsocial.xyz`. Landing cuts can carry one call to action plus small platform marks.
  Never "·"-joined copy, and never a button stuffed with text.
- **Legibility:** body text ≥ 20px at 1080p, no wide shot of unreadable UI for more than
  ~1s, no words sliced at frame edges, and captions fully settled ≥ 0.4s before the click
  they describe.
- **Transitions:** no long crossfades between two busy UIs (the double exposure looks
  muddy). Use a cut, a camera push or a short blur-through.

## 6. Audio

- **Voiceover:** a strong text-to-speech model with style instructions (for example
  Gemini Flash TTS through OpenRouter). Pick one voice per format. Generate **2–3 takes
  per line** and pick the best with an audio-capable model (`judge.mjs`): it scores
  pacing, mispronunciations, odd stresses and clipped endings. Check how it says
  "Post Social", "Bluesky" and "Threads".
- **Music:** generate one shared bed per format (for example Lyria). Models ignore the
  requested length, so detect the beat grid (librosa) and cut or loop at phrase
  boundaries.
- **Mix (`mix.sh`):** duck the music under the voice with a sidechain, then do two
  loudnorm passes to −14 LUFS and −1.2 dBTP.
- Agents can't listen. Flag music endings and loop points for Aki to ear-check.
- Keys (OpenRouter, hosting) come from environment variables. Aki adds them himself;
  never write them into files, memory or chat.

## 7. Render

- `render.mjs` splits frames across N Playwright workers. Each one loads the page, sets
  `t` and screenshots. ffmpeg then encodes a high-quality master (CRF ~12) and a web copy
  (CRF ~20).
- Add a screenshot timeout and retry (e.g. 120s, 5 tries); long renders hit flaky frames.
- Support env vars to render a sub-range or a single segment, so fixes don't need a full
  render.
- **On Aki's Mac (shared by several agents):** cap workers (e.g. 3 per agent) and only
  stop your own processes by PID. Never `pkill -f render.mjs`: it kills other agents'
  jobs. Run long renders in the background.

## 8. Review before showing anyone

- Sample frames into 2×2 contact sheets and **look at them yourself**, zooming in on
  captions, edges and data. This is the main review.
- Use a video-capable model (`vjudge.mjs`) for whole-video checks like timing and caption
  order, but **treat its output as hints**. Video and audio judges hallucinate problems,
  so verify every claim against frames.
- Check: claims match the code and the product truths, the fictional cast only, no leaks,
  the legibility rules, the end card.
- Show Aki the finished mp4s (open the folder for him) along with the `VARIANT.md`
  difference list.

## 9. Work in parallel with subagents

- Once the kit and briefs exist, give **one subagent per video**. Each gets its own
  worktree and branch, the brief, the relevant docs page, and the instruction to read
  `AGENTS.md` first.
- Each subagent writes the script, builds, renders, reviews and reports back with the mp4
  path and the differences found.
- The coordinator merges kit fixes into `main`, uploads, and puts the videos into the
  app and docs.

## 10. Publish

Nothing gets published, uploaded or pushed without Aki's OK.

- **Hosting:** today the landing video is a plain mp4 in `public/landing/` of the product
  repo. For more videos, a host like Mux is better (clean player, no recommendations,
  auto-subtitles); that needs an account, which is Aki's call. The upload script sets a
  public playback policy and English captions, and records each ID in `HOSTING.md`.
- **In the app:** a video button or dismissible card on the feature's page. **Lazy-load
  the player** (`next/dynamic`, `ssr:false`) so it only loads when opened and adds nothing
  to the page bundle.
- **Docs:** a lazy-loaded player (`loading="lazy"`) at 16:9 on the matching
  `src/app/docs/` page.
- **Landing hero:** the current hero is Aki's own walkthrough video; replacing it is his
  decision. Track `video_clicked`, `video_started`, `video_progress`, `video_completed`
  and `video_closed` in PostHog (project "Post Social") with a `video_id`. Don't A/B test
  the hero video: only the ~10% who click can be affected, so tests on overall sign-ups
  are underpowered. Ship the better cut and compare cuts on watch-through and
  viewer → sign-up by `video_id`.
- Changes to the product repo follow its shipping process: feature branch, tests,
  `typecheck`/`lint`/`test`/`build`, a changelog entry for anything customers see, and
  Aki's OK to merge and deploy.
- **YouTube:** the API locks uploads from unaudited projects to private, so upload in
  YouTube Studio and schedule one video every ~2 days. If an agent drives Studio, set
  text with `execCommand('insertText')`, type dates with real keystrokes, and **read every
  value back before clicking Schedule**.

## 11. Mistakes made on the project this playbook came from (don't repeat them)

- Invented UI in v1; the reviewer's first note was "show real UI". → Real DOM snapshots
  only.
- Claims the product doesn't make. → Check in code.
- Taglines the company doesn't use. → Offer options and let Aki pick, then record the
  pick.
- A real timezone leaked in a snapshot and was committed to history. → Audit before
  committing.
- Agents killed each other's renders with `pkill`. → Stop processes only by your own PID.
- A judge model "found" skips and glitches that weren't there. → Verify against frames.
- Removing a shared component broke production. → Search the whole codebase before
  removing anything shared.
- A free hosting plan capped the number of videos, and the upload script swallowed the
  error. → Scripts must surface API errors.

## Deliverables per video

- [ ] `out/<slug>-web.mp4`, poster, `.vtt`, and chapter markers
- [ ] `VARIANT.md`: script, timings, claim checks, docs/UI differences
- [ ] An entry in the `README.md` catalog, and its hosting ID in `HOSTING.md`
- [ ] Any new rules learned are added to `AGENTS.md`
