#!/usr/bin/env node
/*
 * dump-config.js — snapshot a Pi agent's configuration into the repo.
 *
 * Reads the live config under ~/.pi/agent (and ~/.agents), copies every
 * human-authored config / skill / extension source into ./dump, redacts
 * secrets, and writes dump/manifest.json describing exactly what was captured.
 *
 * Usage: node scripts/dump-config.js
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');

const REPO = path.resolve(__dirname, '..');
const OUT = path.join(REPO, 'dump');
const AGENT = path.join(os.homedir(), '.pi', 'agent');
const HOME = os.homedir();

const REDACTED = '***REDACTED***';

// Files/extensions worth capturing as text. Everything else is skipped.
const TEXT_EXT = new Set([
  '.md', '.markdown', '.json', '.jsonc', '.json5', '.txt', '.yaml', '.yml',
  '.toml', '.ini', '.cfg', '.conf', '.js', '.mjs', '.cjs', '.ts', '.tsx',
  '.jsx', '.sh', '.bash', '.ps1', '.psm1', '.cmd', '.bat', '.css', '.html',
  '.htm', '.svg', '.xml', '.sql', '.go', '.py', '.rb', '.env.example', '.lock'
]);

const SKIP_DIRS = new Set([
  '.git', 'node_modules', '.cache', 'dist_bin', 'releases', 'staging'
]);
// Vendored repos can carry their own huge product trees; we only want the
// parts that actually shape the agent (skills, extension, commands).
const PRUNE_UNDER_VENDOR = new Set([
  '.github', 'benchmarks', 'browse', 'deploy', 'dist', 'engine', 'evals',
  'integrations', 'packages', 'plugins', 'proxy', 'scripts', 'shared',
  'shrink', 'src', 'supabase', 'tests', 'mem', 'docs', 'commands'
]);

const MAX_FILE_BYTES = 512 * 1024;

const SECRET_KEY_RE = /(^|[-_])(api[-_]?key|apikey|token|secret|password|passwd|passphrase|authorization|auth[-_]?token|access[-_]?token|refresh[-_]?token|client[-_]?secret|private[-_]?key|credential|cookie|session[-_]?id)([-_]|$)/i;
const SECRET_TEXT_PATTERNS = [
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
  /\bghp_[A-Za-z0-9]{20,}\b/g,
  /\bgithub_pat_[A-Za-z0-9_]{30,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g,
  /\bAIza[0-9A-Za-z_-]{35}\b/g,
  /\beyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}\b/g
];

const manifest = {
  generatedAt: new Date().toISOString(),
  host: {
    platform: process.platform,
    node: process.version,
    home: HOME.replace(/\\/g, '/')
  },
  source: AGENT.replace(/\\/g, '/'),
  files: [],
  categories: [],
  stats: {}
};

function ensureDir(p) { fs.mkdirSync(p, { recursive: true }); }

function redactText(text) {
  let out = text;
  for (const re of SECRET_TEXT_PATTERNS) out = out.replace(re, REDACTED);
  return out;
}

function isEnvRef(s) {
  return /^\$\{?[A-Z0-9_]+\}?$/.test(s) || /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(s);
}

// Returns { value, changed } so callers can tell real redaction from reformat.
function redactJsonValue(value, keyHint) {
  if (Array.isArray(value)) {
    let changed = false;
    const out = value.map(v => {
      const r = redactJsonValue(v, keyHint);
      changed = changed || r.changed;
      return r.value;
    });
    return { value: out, changed };
  }
  if (value && typeof value === 'object') {
    let changed = false;
    const out = {};
    for (const [k, v] of Object.entries(value)) {
      if (typeof v === 'string' && SECRET_KEY_RE.test(k) && !isEnvRef(v)) {
        out[k] = REDACTED;
        changed = true;
      } else {
        const r = redactJsonValue(v, k);
        changed = changed || r.changed;
        out[k] = r.value;
      }
    }
    return { value: out, changed };
  }
  if (typeof value === 'string' && SECRET_KEY_RE.test(keyHint || '') && !isEnvRef(value)) {
    return { value: REDACTED, changed: true };
  }
  return { value, changed: false };
}

function processContent(absPath) {
  const ext = path.extname(absPath).toLowerCase();
  let buf;
  try { buf = fs.readFileSync(absPath); } catch { return null; }
  if (buf.includes(0)) return { binary: true, size: buf.length };
  let text = buf.toString('utf8');
  let redacted = false;
  if (ext === '.json' || ext === '.jsonc') {
    try {
      const parsed = JSON.parse(text);
      const r = redactJsonValue(parsed, '');
      if (r.changed) {
        redacted = true;
        text = JSON.stringify(r.value, null, 2);
      }
    } catch {
      const t = redactText(text);
      if (t !== text) { redacted = true; text = t; }
    }
  } else {
    const t = redactText(text);
    if (t !== text) { redacted = true; text = t; }
  }
  return { binary: false, size: buf.length, text, redacted };
}

function extOf(p) { return path.extname(p).toLowerCase(); }

function shouldSkipFile(name) {
  return name.endsWith('.sqlite') || name.endsWith('.sqlite-shm') ||
    name.endsWith('.sqlite-wal') || name.endsWith('.db') ||
    name.endsWith('.db-shm') || name.endsWith('.db-wal');
}

let fileCounter = 0;
function walk(dir, baseRel, category, opts, sourceRoot) {
  let ents;
  try { ents = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of ents) {
    if (e.isSymbolicLink()) continue;
    const abs = path.join(dir, e.name);
    const rel = path.posix.join(baseRel, e.name);
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue;
      if (opts.vendorPrune && PRUNE_UNDER_VENDOR.has(e.name)) continue;
      walk(abs, rel, category, opts, sourceRoot);
      continue;
    }
    if (shouldSkipFile(e.name)) continue;
    if (opts.onlySkills && e.name !== 'SKILL.md' && !/\.(md|json|ya?ml|toml|sh|ps1|cmd|js|mjs|cjs|txt|ts)$/i.test(e.name)) {
      // inside a vendored skill dir, keep supporting text but skip assets
    }
    if (opts.extAllow && !opts.extAllow.has(extOf(e.name))) continue;
    if (opts.nameAllow && !opts.nameAllow.test(e.name)) continue;
    let stat;
    try { stat = fs.statSync(abs); } catch { continue; }
    if (stat.size > (opts.maxBytes || MAX_FILE_BYTES)) continue;
    const content = processContent(abs);
    if (content === null) continue;
    if (content.binary) continue;
    const targetAbs = path.join(OUT, 'files', rel);
    ensureDir(path.dirname(targetAbs));
    fs.writeFileSync(targetAbs, content.text, 'utf8');
    const sha = crypto.createHash('sha256').update(content.text).digest('hex').slice(0, 16);
    const rec = {
      id: 'f' + (++fileCounter).toString().padStart(4, '0'),
      path: rel.replace(/\\/g, '/'),
      category,
      source: path.relative(HOME, abs).replace(/\\/g, '/'),
      size: Buffer.byteLength(content.text, 'utf8'),
      sha256: sha,
      redacted: content.redacted,
      ext: extOf(e.name).replace('.', '')
    };
    if (opts.describe) {
      const d = opts.describe(rec.path);
      if (d) rec.description = d;
    }
    manifest.files.push(rec);
  }
}

function copyFile(abs, rel, category, opts) {
  let stat;
  try { stat = fs.statSync(abs); } catch { return; }
  if (stat.size > (opts.maxBytes || MAX_FILE_BYTES)) return;
  const content = processContent(abs);
  if (!content || content.binary) return;
  const targetAbs = path.join(OUT, 'files', rel);
  ensureDir(path.dirname(targetAbs));
  fs.writeFileSync(targetAbs, content.text, 'utf8');
  const sha = crypto.createHash('sha256').update(content.text).digest('hex').slice(0, 16);
  const rec = {
    id: 'f' + (++fileCounter).toString().padStart(4, '0'),
    path: rel.replace(/\\/g, '/'),
    category,
    source: path.relative(HOME, abs).replace(/\\/g, '/'),
    size: Buffer.byteLength(content.text, 'utf8'),
    sha256: sha,
    redacted: content.redacted,
    ext: extOf(abs).replace('.', '')
  };
  if (opts.describe) {
    const d = opts.describe(rec.path);
    if (d) rec.description = d;
  }
  manifest.files.push(rec);
}

// ---------------------------------------------------------------------------
// Capture definitions — each entry copies a file/dir under dump/files/<to>.
// ---------------------------------------------------------------------------
const SKILL_DESC = {
  'skills/impeccable/SKILL.md': 'Frontend design/UX skill for building and polishing interfaces.',
  'vendor/caveman/skills/': 'Caveman output-compression skills (caveman, caveman-review, cavecrew, ...).',
  'vendor/mattpocock-skills/skills/': 'Engineering + productivity workflow skills (tdd, code-review, research, ...).',
  'external/agents-skills/unity-cli/SKILL.md': 'Unity CLI control skill installed under ~/.agents/skills.',
  'extensions/caveman-native.js': 'Native Pi extension: caveman compression + provider routing + hooks.',
};

const captures = [
  { cat: 'Core Config', to: 'agent/settings.json', from: path.join(AGENT, 'settings.json'), file: true, describe: () => 'Default provider/model, installed packages, skill paths, thinking level.' },
  { cat: 'Core Config', to: 'agent/models.json', from: path.join(AGENT, 'models.json'), file: true, describe: () => 'Custom provider + model definitions (DeepSeek V4).' },
  { cat: 'Core Config', to: 'agent/models-store.json', from: path.join(AGENT, 'models-store.json'), file: true, describe: () => 'Cached model catalog / auth state. Secrets redacted.' },
  { cat: 'Core Config', to: 'agent/mcp.json', from: path.join(AGENT, 'mcp.json'), file: true, describe: () => 'MCP servers (Exa search, Chrome DevTools). API key redacted.' },
  { cat: 'Core Config', to: 'agent/mcp-auth.json', from: path.join(AGENT, 'mcp-auth.json'), file: true, describe: () => 'MCP OAuth/token store. Secrets redacted.' },
  { cat: 'Core Config', to: 'agent/auth.json', from: path.join(AGENT, 'auth.json'), file: true, describe: () => 'Provider auth store. Secrets redacted.' },
  { cat: 'Core Config', to: 'agent/AGENTS.md', from: path.join(AGENT, 'AGENTS.md'), file: true, describe: () => 'Global agent playbook (working rules, delegation, verification).' },
  { cat: 'Core Config', to: 'agent/APPEND_SYSTEM.md', from: path.join(AGENT, 'APPEND_SYSTEM.md'), file: true, describe: () => 'Appended system prompt (caveman default output style).' },
  { cat: 'Core Config', to: 'agent/AGENTS.md.bak', from: path.join(AGENT, 'AGENTS.md.bak-20261006235926'), file: true, describe: () => 'Previous revision of global playbook.' },
  { cat: 'Core Config', to: 'agent/settings.json.bak', from: path.join(AGENT, 'settings.json.bak-20261006232329'), file: true, describe: () => 'Previous revision of settings.json.' },

  { cat: 'Extensions', to: 'agent/extensions', from: path.join(AGENT, 'extensions'), dir: true, describe: (p) => SKILL_DESC[p] || null },

  { cat: 'Skills (local)', to: 'agent/skills', from: path.join(AGENT, 'skills'), dir: true, describe: (p) => SKILL_DESC[p] || null },
  { cat: 'Skills (vendored)', to: 'agent/vendor/caveman/skills', from: path.join(AGENT, 'vendor', 'caveman', 'skills'), dir: true, describe: (p) => p.endsWith('SKILL.md') ? 'Skill: ' + p.split('/skills/')[1].replace('/SKILL.md', '') : null },
  { cat: 'Skills (vendored)', to: 'agent/vendor/mattpocock-skills/skills', from: path.join(AGENT, 'vendor', 'mattpocock-skills', 'skills'), dir: true, describe: (p) => p.endsWith('SKILL.md') ? 'Skill: ' + p.split('/skills/')[1].replace('/SKILL.md', '') : null },
  { cat: 'Skills (external)', to: 'external/agents-skills', from: path.join(HOME, '.agents', 'skills'), dir: true, describe: () => 'Skill under ~/.agents/skills (auto-discovered).' },

  { cat: 'Memory', to: 'agent/memory/USER.md', from: path.join(AGENT, 'pi-hermes-memory', 'USER.md'), file: true, describe: () => 'Durable user profile memory.' },
  { cat: 'Memory', to: 'agent/memory/MEMORY.md', from: path.join(AGENT, 'pi-hermes-memory', 'MEMORY.md'), file: true, describe: () => 'Global durable agent memory.' },
  { cat: 'Memory', to: 'agent/memory/failures.md', from: path.join(AGENT, 'pi-hermes-memory', 'failures.md'), file: true, describe: () => 'Recorded failures, corrections, and tool quirks.' },
  { cat: 'Memory', to: 'agent/projects-memory', from: path.join(AGENT, 'projects-memory'), dir: true, describe: (p) => p.endsWith('MEMORY.md') ? 'Per-project memory: ' + p : null },

  { cat: 'Packages', to: 'agent/npm/package.json', from: path.join(AGENT, 'npm', 'package.json'), file: true, describe: () => 'Installed Pi extensions/packages and versions.' },
  { cat: 'Packages', to: 'agent/npm/package-lock.json', from: path.join(AGENT, 'npm', 'package-lock.json'), file: true, maxBytes: 900 * 1024, describe: () => 'Locked dependency tree.' },
  { cat: 'Packages', to: 'agent/pi-subagents', from: path.join(AGENT, 'pi-subagents'), dir: true },

  { cat: 'Install', to: 'agent/bin', from: path.join(AGENT, 'bin'), dir: true, describe: () => 'Pi launcher entrypoints.' },
  { cat: 'Install', to: 'agent/install/managed-install.json', from: path.join(AGENT, 'install', 'managed-install.json'), file: true, describe: () => 'Managed install layout + entrypoint.' },
  { cat: 'Install', to: 'agent/install/current-version', from: path.join(AGENT, 'install', 'current-version'), file: true, describe: () => 'Active Pi version.' }
];

const PI_PKG = path.join(AGENT, 'install', 'releases', '1.0.4', 'node_modules', '@earendil-works', 'pi-coding-agent');
captures.push({ cat: 'Install', to: 'agent/install/pi-coding-agent/package.json', from: path.join(PI_PKG, 'package.json'), file: true, describe: () => 'Pi coding agent package manifest.' });
captures.push({ cat: 'Pi Docs', to: 'pi/docs', from: path.join(PI_PKG, 'docs'), dir: true, describe: () => 'Official Pi documentation.' });
captures.push({ cat: 'Pi Docs', to: 'pi/README.md', from: path.join(PI_PKG, 'README.md'), file: true, describe: () => 'Pi coding agent README.' });

// package.json + README for each installed extension package
const NODE_MODULES = path.join(AGENT, 'npm', 'node_modules');
try {
  for (const name of fs.readdirSync(NODE_MODULES)) {
    if (name.startsWith('.') || name.startsWith('@')) continue;
    const pkgDir = path.join(NODE_MODULES, name);
    for (const f of ['package.json', 'README.md']) {
      const abs = path.join(pkgDir, f);
      if (fs.existsSync(abs)) {
        captures.push({ cat: 'Packages', to: `agent/npm/packages/${name}/${f}`, from: abs, file: true, describe: () => `Extension package ${name}: ${f}` });
      }
    }
  }
} catch { /* no packages */ }

for (const c of captures) {
  const opts = {
    maxBytes: c.maxBytes,
    vendorPrune: c.to.includes('/vendor/'),
    describe: c.describe
  };
  const rel = c.to;
  if (c.file) copyFile(c.from, rel, c.cat, opts);
  else if (c.dir) walk(c.from, rel, c.cat, opts, c.from);
}

// Environment snapshot: names + presence, values only for non-secret keys.
{
  const interesting = Object.keys(process.env)
    .filter(k => /^(PI_|ANTHROPIC|OPENAI|DEEPSEEK|GEMINI|GOOGLE|MOONSHOT|EXA|CAVEMAN|BROWSER|CHROME|NO_PROXY|HTTPS?_PROXY)/i.test(k))
    .sort();
  const lines = ['# Environment snapshot', '', 'Captured from the process that generated this dump.', 'Secret-looking values are redacted.', '', '| Variable | Value |', '| --- | --- |'];
  for (const k of interesting) {
    const v = process.env[k] || '';
    const looksSecret = /(key|token|secret|password|auth)/i.test(k) || SECRET_TEXT_PATTERNS.some(re => { re.lastIndex = 0; return re.test(v); });
    lines.push('| `' + k + '` | ' + (looksSecret ? REDACTED : '`' + v.replace(/\|/g, '\\|') + '`') + ' |');
  }
  const rel = 'agent/environment.md';
  const text = lines.join('\n') + '\n';
  ensureDir(path.join(OUT, 'files', path.dirname(rel)));
  fs.writeFileSync(path.join(OUT, 'files', rel), text);
  manifest.files.push({
    id: 'f' + (++fileCounter).toString().padStart(4, '0'),
    path: rel, category: 'Core Config', source: 'generated',
    size: Buffer.byteLength(text), sha256: 'generated', redacted: true, ext: 'md',
    description: 'Relevant environment variables (secret values redacted).'
  });
}

// pi version/package details captured as a synthetic file
const piPkgPath = path.join(PI_PKG, 'package.json');
if (fs.existsSync(piPkgPath)) {
  const p = JSON.parse(fs.readFileSync(piPkgPath, 'utf8'));
  const rel = 'pi/versions.json';
  const text = JSON.stringify({ piVersion: p.version, packageName: p.name, capturedAt: manifest.generatedAt }, null, 2);
  ensureDir(path.join(OUT, 'files', path.dirname(rel)));
  fs.writeFileSync(path.join(OUT, 'files', rel), text);
  manifest.files.push({
    id: 'f' + (++fileCounter).toString().padStart(4, '0'),
    path: rel, category: 'Pi Docs',
    source: 'generated', size: Buffer.byteLength(text), sha256: 'generated',
    redacted: false, ext: 'json', description: 'Detected Pi version.'
  });
}

// Summarise
const cats = {};
for (const f of manifest.files) {
  cats[f.category] = cats[f.category] || { files: 0, bytes: 0 };
  cats[f.category].files++;
  cats[f.category].bytes += f.size;
}
manifest.categories = Object.entries(cats).map(([name, v]) => ({ name, ...v }))
  .sort((a, b) => a.name.localeCompare(b.name));
manifest.stats = {
  totalFiles: manifest.files.length,
  totalBytes: manifest.files.reduce((s, f) => s + f.size, 0),
  redactedFiles: manifest.files.filter(f => f.redacted).length
};

// Stable ordering
manifest.files.sort((a, b) => a.path.localeCompare(b.path));

ensureDir(OUT);
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));

// Embed text content for the offline site
const data = { generatedAt: manifest.generatedAt, host: manifest.host, source: manifest.source, categories: manifest.categories, files: manifest.files };
for (const f of data.files) {
  const abs = path.join(OUT, 'files', f.path);
  try { f.text = fs.readFileSync(abs, 'utf8'); } catch { f.text = ''; }
}
const payload = JSON.stringify(data).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
fs.writeFileSync(path.join(REPO, 'site-data.js'), 'window.PI_DUMP=' + payload + ';\n', 'utf8');

console.log(JSON.stringify({
  files: manifest.stats.totalFiles,
  bytes: manifest.stats.totalBytes,
  redacted: manifest.stats.redactedFiles,
  categories: manifest.categories.map(c => `${c.name}: ${c.files} files`)
}, null, 2));
