#!/usr/bin/env node
/*
 * build-setup-prompt.js — generate setup-prompt.md from the dump.
 *
 * The prompt is self-contained: it tells another Pi agent exactly how to
 * rebuild this setup (packages, core config, memory, skills, extension).
 *
 * Usage: node scripts/build-setup-prompt.js   (after scripts/dump-config.js)
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DUMP = path.join(REPO, 'dump');
const manifest = JSON.parse(fs.readFileSync(path.join(DUMP, 'manifest.json'), 'utf8'));

function text(p) {
  try { return fs.readFileSync(path.join(DUMP, 'files', p), 'utf8').trimEnd(); }
  catch { return ''; }
}
function fence(lang, body) { return '```' + lang + '\n' + body + '\n```'; }
function scrub(s) {
  return s
    .replace(/"x-api-key"\s*:\s*"[^"]*"/g, '"x-api-key": "<YOUR_EXA_API_KEY>"')
    .replace(/\*+REDACTED\*+/g, '<YOUR_SECRET>');
}

const settings = text('agent/settings.json');
const models = text('agent/models.json');
const mcp = scrub(text('agent/mcp.json'));
const append = text('agent/APPEND_SYSTEM.md');
const agents = text('agent/AGENTS.md');

let parsed = {};
try { parsed = JSON.parse(settings); } catch {}
const packages = Array.isArray(parsed.packages) ? parsed.packages : [];
const provider = parsed.defaultProvider || '';
const model = parsed.defaultModel || '';
const thinking = parsed.defaultThinkingLevel || '';

const memoryPaths = manifest.files
  .filter(f => f.category === 'Memory' && f.path.endsWith('.md'))
  .map(f => f.path)
  .sort();

const memoryBlocks = memoryPaths.map(p => {
  const rel = p.replace(/^agent\//, '');
  return '### `~/.pi/agent/' + rel + '`\n\n' + fence('md', text(p));
}).join('\n\n');

const installCmds = packages.map(p => 'pi install ' + p).join('\n');

const vendored = [...new Set(manifest.files
  .filter(f => f.category === 'Skills (vendored)')
  .map(f => f.path.split('/').slice(0, 4).join('/')))];
const localSkills = [...new Set(manifest.files
  .filter(f => f.category === 'Skills (local)')
  .map(f => f.path.split('/').slice(0, 3).join('/')))];
const externalSkills = [...new Set(manifest.files
  .filter(f => f.category === 'Skills (external)')
  .map(f => f.path.split('/').slice(0, 3).join('/')))];

const skillList = (cat) => manifest.files
  .filter(f => f.category === cat && /\/SKILL\.md$/.test(f.path))
  .map(f => f.path.replace(/^agent\/vendor\//, '').replace(/\/SKILL\.md$/, ''))
  .sort();

const PROMPT = `# Replicate this Pi setup

You are a Pi coding agent. Your job is to configure **this** machine so it
matches another user's Pi installation — same packages, provider/model,
system prompts, memory, skills, MCP servers, and extension.

Work through the phases in order. After each phase, confirm what changed.
Stop and ask before anything that needs a credential or touches files outside
\`~/.pi/agent\` and \`~/.agents\`.

Target layout:
- \`~/.pi/agent/\` — config, memory, skills, vendored skill repos.
- \`~/.agents/skills/\` — externally discovered skills.

At the end, run the verification checklist in Phase 6.

---

## Phase 1 — Install Pi packages

These are the extensions this setup depends on. Run:

\`\`\`bash
${installCmds}
\`\`\`

Then confirm they appear in \`~/.pi/agent/settings.json\` under \`packages\`:

${fence('json', JSON.stringify(packages, null, 2))}

---

## Phase 2 — Core config

Write each file under \`~/.pi/agent/\`. Back up any file you overwrite.

### \`~/.pi/agent/settings.json\`

Default provider and model: **${provider} / ${model}**, thinking level **${thinking}**.

${fence('json', settings)}

### \`~/.pi/agent/models.json\`

${fence('json', models)}

### \`~/.pi/agent/mcp.json\`

Replace \`<YOUR_EXA_API_KEY>\` with the real key, or delete the \`exa\` server if
you do not have one.

${fence('json', mcp)}

### \`~/.pi/agent/APPEND_SYSTEM.md\`

${fence('md', append)}

### \`~/.pi/agent/AGENTS.md\`

${fence('md', agents)}

---

## Phase 3 — Memory

Create these files with the exact contents. They carry durable user facts,
global notes, and known failure modes that shape behaviour.

${memoryBlocks}

---

## Phase 4 — Skills

Three sources feed this setup.

### 4a. Vendored skills (installed by packages)

These live under \`~/.pi/agent/vendor/\` and were installed with the packages
above or cloned directly:

${vendored.map(v => '- `' + v + '` (' + manifest.files.filter(f => f.path.startsWith(v + '/')).length + ' files)').join('\n')}

If \`~/.pi/agent/vendor/caveman/skills\` is missing, run the caveman install
(Phase 5). For \`~/.pi/agent/vendor/mattpocock-skills\`, clone
\`https://github.com/mattpocock/skills\` into that path. Reinstalling the
packages in Phase 1 should restore most of these.

Vendored skill inventory (${skillList('Skills (vendored)').length}):

${skillList('Skills (vendored)').slice(0, 200).map(s => '- ' + s).join('\n')}

### 4b. External skills (\`~/.agents/skills\`)

${externalSkills.map(s => '- `' + s.replace(/^external\//, '').replace(/^agents-skills\//, '') + '`').join('\n')}

Install with the skills CLI (\`npx skills add <name>\`), or copy the directory
from the artifact.

### 4c. Local skills (\`~/.pi/agent/skills\`)

${localSkills.map(s => '- `' + s + '`').join('\n')}

Copy these from the artifact at \`dump/files/<path>\`. They are authored locally
and have no upstream install command.

---

## Phase 5 — Extension: caveman

This setup compresses model output with the caveman extension
(\`~/.pi/agent/extensions/caveman-native.js\`), which routes through the
\`@caveman-ai/cli\` global. Reinstall it with:

\`\`\`bash
npm i -g @caveman-ai/cli
caveman enable pi
\`\`\`

That regenerates the extension and sets \`CAVEMAN_PI_HOOK_CMD\`. Do **not**
register the caveman MCP server while the native extension is active — they
would double-register.

---

## Phase 6 — Verify

- [ ] \`settings.json\` lists all ${packages.length} packages and the skills paths.
- [ ] Default provider/model is \`${provider} / ${model}\`, thinking \`${thinking}\`.
- [ ] \`mcp.json\` has working MCP servers (keys resolved).
- [ ] \`APPEND_SYSTEM.md\` and \`AGENTS.md\` are in place.
- [ ] Memory files exist under \`~/.pi/agent/memory/\` and project memory loads.
- [ ] Vendored, external, and local skills are discoverable.
- [ ] The caveman extension loads without error.
- [ ] Start Pi and confirm it boots with no config warnings.

---

## Byte-exact option

For a literal copy instead of a rebuild, copy the artifact's \`dump/files/**\`
onto the matching paths under \`~/.pi/agent\` and \`~/.agents\`, then replace the
redacted secrets (\`<YOUR_EXA_API_KEY>\`, \`<YOUR_SECRET>\`) with real values.
The artifact is the authoritative snapshot this prompt was generated from.
`;

fs.writeFileSync(path.join(REPO, 'setup-prompt.md'), PROMPT, 'utf8');
console.log('Wrote setup-prompt.md (' + PROMPT.length + ' bytes)');
