# memory-of-my-pi

A point-in-time snapshot of everything that turns a stock [Pi](https://github.com/earendil-works/pi) coding-agent install into **this** agent — plus a browsable HTML artifact for reading it.

Open **`index.html`** in a browser. No server, no build step: it works straight over `file://`.

## What's inside

| Path | Purpose |
| --- | --- |
| `index.html` | Offline navigator: category/folder tree, full-content search, per-file viewer. |
| `site-data.js` | The embedded data `index.html` reads (`window.PI_DUMP`). |
| `dump/manifest.json` | Machine-readable index: every captured file, its source, size, sha256, redaction flag. |
| `dump/files/**` | Redacted mirror of the captured files, laid out by category. |
| `scripts/dump-config.js` | Rebuilds `dump/` from the live config. |
| `scripts/build-setup-prompt.js` | Rebuilds `setup-prompt.md` from `dump/`. |
| `scripts/build-site.js` | Rebuilds `index.html` + `site-data.js` from `dump/`. |
| `setup-prompt.md` | Self-contained prompt that recreates this setup in a fresh Pi session. |

## Capture scope

Read from `~/.pi/agent` (and `~/.agents`, for external skills):

- **Core Config** — `settings.json`, `models.json`, `models-store.json`, `mcp.json`, `auth.json`, `AGENTS.md`, `APPEND_SYSTEM.md`, revisions (`.bak`), and an environment snapshot.
- **Extensions** — native extension source loaded into Pi (`caveman-native.js`).
- **Skills** — local (`~/.pi/agent/skills`), vendored (`vendor/caveman`, `vendor/mattpocock-skills`), and external (`~/.agents/skills`).
- **Memory** — durable `USER.md` / `MEMORY.md` / `failures.md` and per-project memory.
- **Packages** — the extensions you installed (`npm/package.json`, lockfile, per-package manifests/READMEs).

**Not captured:** the Pi runtime itself (install tree, upstream docs), session transcripts, SQLite databases, `node_modules` bodies, binaries, images, and files larger than 512 KB.

## Redaction

Secrets never make it into the dump:

- JSON values whose key looks secret (`apiKey`, `token`, `secret`, `password`, `authorization`, …) become `***REDACTED***`.
- Known token formats (`sk-…`, `ghp_…`, `AIza…`, JWTs, …) are scrubbed from text.
- Environment-variable references like `$DEEPSEEK_API_KEY` are preserved as-is.

Personal information is removed before a snapshot is published:

- The OS account name, in paths and prose, becomes `<user>`.
- The home directory (`C:\Users\<user>`, `/home/<user>`, `/c/Users/<user>`) becomes `~`.
- Email addresses become `<email>`; documentation placeholders such as `user@example.com` are kept.
- The commit/GitHub handle becomes `<github-handle>`.

The manifest records which files were redacted. To keep this guarantee, submit
changes by editing the scripts, not the generated `dump/` files.

## Browse the artifact

```sh
# macOS / Linux
open index.html

# Windows
start index.html
```

Then use the tree and search box to read any captured file with its original path and size.

## Regenerate

From the repository root, with the live Pi config in place:

```sh
node scripts/dump-config.js         # live config -> dump/
node scripts/build-setup-prompt.js  # dump/       -> setup-prompt.md
node scripts/build-site.js          # dump/       -> index.html + site-data.js
```

Commit the result to take a new snapshot. `index.html` and `site-data.js` are generated — edit the scripts, not the generated files.

## Restore into a fresh Pi

`setup-prompt.md` is a self-contained prompt generated from this dump. Open the artifact, press **Copy my setup**, then paste it into a fresh Pi session. It installs the packages and writes the core config, model and MCP settings, system prompts, memory, and skills. Secrets are replaced with `<YOUR_…>` placeholders you fill in.

## Requirements

- [Node.js](https://nodejs.org/) 18+ (tested on v24) for the three scripts.
- A browser for `index.html`.
- No npm dependencies.

## License

[MIT](LICENSE)
