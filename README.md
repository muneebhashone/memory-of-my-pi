# memory-of-my-pi

A point-in-time snapshot of everything that turns a stock [Pi](https://github.com/earendil-works/pi) coding-agent install into **this** agent — plus a browsable HTML artifact for reading it.

Open **`index.html`** in a browser. No server needed; it works straight over `file://`.

## What's here

| Path | Purpose |
| --- | --- |
| `index.html` | Offline navigator: category/folder tree, full-content search, per-file viewer. |
| `site-data.js` | The embedded data `index.html` reads (`window.PI_DUMP`). |
| `dump/manifest.json` | Machine-readable index: every captured file, its source, size, sha256, redaction flag. |
| `dump/files/**` | Redacted mirror of the captured files, laid out by category. |
| `scripts/dump-config.js` | Rebuilds `dump/` from the live config. |
| `scripts/build-site.js` | Rebuilds `index.html` + `site-data.js` from `dump/`. |

## What gets captured

Read from `~/.pi/agent` (and `~/.agents`, for external skills):

- **Core Config** — `settings.json`, `models.json`, `models-store.json`, `mcp.json`, `auth.json`, `AGENTS.md`, `APPEND_SYSTEM.md`, revisions (`.bak`), and an environment snapshot.
- **Extensions** — native extension source loaded into Pi (`caveman-native.js`).
- **Skills** — local (`~/.pi/agent/skills`), vendored (`vendor/caveman`, `vendor/mattpocock-skills`), and external (`~/.agents/skills`).
- **Memory** — durable `USER.md` / `MEMORY.md` / `failures.md` and per-project memory.
- **Packages** — the extensions you installed (`npm/package.json`, lockfile, per-package manifests/READMEs).

**Not captured:** the Pi runtime itself (install tree, upstream docs), session transcripts, SQLite databases, `node_modules` bodies, binaries, images, and files larger than 512 KB.

## Secrets

Everything is passed through a redactor before it lands in `dump/`:

- JSON values whose key looks secret (`apiKey`, `token`, `secret`, `password`, `authorization`, …) become `***REDACTED***`.
- Known token formats (`sk-…`, `ghp_…`, `AIza…`, JWTs, …) are scrubbed from text.
- Environment-variable references like `$DEEPSEEK_API_KEY` are preserved as-is.

Captured files that were actually modified are flagged `redacted` in `manifest.json` and shown with a badge in the UI. Verify before publishing this repo anywhere public.

## Regenerate

```sh
node scripts/dump-config.js         # live config -> dump/
node scripts/build-setup-prompt.js  # dump/       -> setup-prompt.md
node scripts/build-site.js          # dump/       -> index.html + site-data.js
```

Then open `index.html`.

## Replicate the setup on another machine

`setup-prompt.md` is a self-contained prompt generated from this dump. Open the
artifact and press **Copy my setup**, then paste it into a fresh Pi session. It
installs the packages, writes the core config, model and MCP settings, system
prompts, memory, and skills, and re-enables the caveman extension. Secrets are
replaced with `<YOUR_…>` placeholders you fill in.
