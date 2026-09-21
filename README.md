# RunToDawn

Apple Health running analytics that runs entirely in your browser. Drop in
your Health export and it finds your real best efforts (not just average
pace), predicts 5K/10K/half/marathon times, builds a periodised training
plan, and shows a GPS route heatmap — all from data that never leaves your
device.

No build step, no backend, no bundler. It's plain HTML/CSS/JS split into
small files that share the page's global scope, the way the web worked
before module bundlers — open `index.html` (via a local server, see below)
and it runs.

## Running it

Requires **Node 24+** for the test suite and the GitHub Pages workflow
(the app itself is just static HTML/CSS/JS and runs in any modern browser
regardless of Node version — this only matters for local tooling and CI).

Browsers block a few things (IndexedDB, `fetch` for fonts) on the bare
`file://` origin, so serve the folder instead of double-clicking `index.html`:

```bash
npm install       # only needed for the test suite (jsdom, jszip)
npm run dev        # serves the project at http://localhost:8080
```

`npm run dev` runs `npx serve`, so the very first run will download that
package. Any static file server works equally well — `python3 -m http.server
8080`, VS Code's Live Server, etc.

## Project layout

```
.github/
  workflows/
    deploy.yml         test → build → deploy to GitHub Pages, on push to main
index.html          dev entry point — loads src/style.css and src/js/* directly
src/
  body.html          the <body> markup (nav rail, view containers)
  style.css           the whole design system: tokens, layout, components
  js/
    00-util.js         App state, unit conversion, date helpers, IndexedDB, tiny markdown renderer
    10-parse.js         streaming Apple Health XML/zip parser, GPX route reader, best-effort extraction
    20-metrics.js        VDOT model, Daniels training paces, fitness/fatigue/form (CTL/ATL/TSB)
    25-classify.js        per-run classification (easy/long/threshold/intervals/progression/race)
    30-charts.js          Chart.js wrappers: volume, load, pace scatter, effort curve
    35-routes.js           GPS route heatmap: canvas renderer, pan/zoom
    40-coach.js             training-plan generator: periodisation, long-run progression, session menu
    50-views.js              Overview / Volume / Performance view rendering
    55-coachview.js           Coach tab rendering (plan form, week-by-week plan)
    60-insights.js            training signals, glossary, LLM prompt + provider calls
    90-boot.js                 nav, import flow, app boot, IndexedDB restore
build.sh              concatenates src/ into one self-contained dist/runtodawn.html
test/                 see below
```

Every file in `src/js/` is loaded as a plain `<script>` tag, in the order
listed in `index.html` (and in `build.sh`) — same as if it were one big file
cut into readable pieces. There's no module system to fight with; a function
defined in `10-parse.js` is just a global that `20-metrics.js` calls
directly.

## Building the single-file version

```bash
npm run build          # -> dist/runtodawn.html
# or
bash build.sh path/to/output.html
```

This inlines `style.css`, `body.html`, and every `src/js/*.js` file into one
HTML document (Chart.js and the Google Fonts stylesheet still load from a
CDN). That's the shape you want for pasting into a Claude Artifact, dropping
onto static hosting, or handing to someone as a single file.

## Tests

```bash
npm test              # everything below, in sequence — this is what CI runs
npm run test:model     # VDOT / race-time / training-pace accuracy against Daniels' published tables
npm run test:classify   # confusion matrix: does the run classifier recognise intervals, tempo, etc.?
npm run test:dom         # renders every view in jsdom and checks for undefined/NaN leaking into markup
npm run test:routes       # end-to-end zip + GPX parsing with a synthetically generated export.zip
```

`test/gen.js` writes a synthetic Apple Health export to your OS temp
directory (`os.tmpdir()`) with realistically-shaped sessions — actual
interval reps with jog recoveries, tempo blocks, progression runs, a real
half-marathon — plus ground truth labels, so `test:classify` can score the
classifier against a real answer key rather than eyeballing it.

### Optional: pixel-level route heatmap test

```bash
npm install canvas    # native binary, not installed by default — see below
npm run test:pixels
```

This renders the actual route-heatmap drawing code against a real Cairo 2D
canvas (`node-canvas`) and inspects the resulting pixels, rather than a
mocked `getContext()` that would hide rendering bugs. It's how a real bug
was caught: per-stroke opacity used to shrink as route count grew, so a
realistic multi-year history (100+ routes) rendered at 5–12% opacity —
technically non-zero, indistinguishable from blank to the eye. `canvas`
needs a native build and isn't always installable without system libraries
(Cairo, Pango, etc.), which is why it's an `optionalDependency` kept out of
`npm test` / CI — a failed install there shouldn't be able to block a
deploy.

## How it stores data

Health data is parsed and kept in the browser's IndexedDB (`runtodawn` /
store `blobs`) and never sent anywhere. The optional LLM insights feature can
call Anthropic, OpenAI or Gemini directly from the browser using a key you
paste in yourself (stored in `localStorage`, sent only to that provider's
API) — or, if you publish this as a Claude Artifact, use Claude's own
built-in `sample` runtime capability with no key at all.

## Deploying to GitHub Pages

A workflow at `.github/workflows/deploy.yml` builds, tests, and deploys this
on every push to `main` (or on demand from the Actions tab). To turn it on:

1. Push this project to a GitHub repo.
2. **Settings → Pages → Source → GitHub Actions.**
3. Push to `main`, or run the workflow manually from the **Actions** tab.

It runs `npm test` as a real gate — a broken classifier or a broken VDOT
model fails the build before anything goes live — then publishes:

- `/` — the dev entry point (`index.html` + `src/`), served over `https://`
  so IndexedDB and the Google Fonts stylesheet work properly (unlike opening
  `index.html` straight from disk).
- `/dist/runtodawn.html` — the same app as one self-contained file, in case
  you want a single URL to hand someone or embed elsewhere.

Your site will be at `https://<username>.github.io/<repo>/`. If your default
branch isn't `main`, change the `branches:` line in the workflow to match.

## A note if you publish this as a Claude Artifact

A page published as a Claude Artifact runs under a content-security policy
that blocks requests to arbitrary APIs, so the bring-your-own-key fields for
Anthropic/OpenAI/Gemini won't be reachable there — that's a platform
restriction, not a bug. Self-hosted (this project, as-is, on any static host)
they work normally. The app also offers "Claude, built into this page" (no
key needed) and a "copy the prompt" fallback either way.
