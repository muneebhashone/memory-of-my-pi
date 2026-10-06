#!/usr/bin/env node
/*
 * build-site.js — generate the browsable HTML artifact over the dump.
 *
 * Reads dump/manifest.json plus dump/files/**, writes:
 *   site-data.js  (window.PI_DUMP = { ...files with text... })
 *   index.html    (offline tree + viewer)
 *
 * Usage: node scripts/build-site.js
 */
'use strict';

const fs = require('fs');
const path = require('path');

const REPO = path.resolve(__dirname, '..');
const DUMP = path.join(REPO, 'dump');
const manifest = JSON.parse(fs.readFileSync(path.join(DUMP, 'manifest.json'), 'utf8'));

const files = manifest.files.map(f => {
  let text = '';
  try { text = fs.readFileSync(path.join(DUMP, 'files', f.path), 'utf8'); } catch { text = ''; }
  return { ...f, text };
});

const data = {
  generatedAt: manifest.generatedAt,
  host: manifest.host,
  source: manifest.source,
  stats: manifest.stats,
  categories: manifest.categories,
  files
};

const payload = JSON.stringify(data)
  .replace(/</g, '\\u003c')
  .replace(/\u2028/g, '\\u2028')
  .replace(/\u2029/g, '\\u2029');
fs.writeFileSync(path.join(REPO, 'site-data.js'), 'window.PI_DUMP=' + payload + ';\n', 'utf8');

const HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Memory of my Pi</title>
<style>
  :root {
    --paper: #ffffff;
    --ink: #16181d;
    --muted: #6d7480;
    --faint: #9aa1ab;
    --line: #e8eaee;
    --soft: #f5f6f8;
    --accent: #bd4522;
    --accent-soft: #fbeee9;
    --accent-on-dark: #e98f6c;
    --coal: #121317;
    --coal-2: #1a1c21;
    --coal-ink: #e7e4de;
    --coal-muted: #8f8d88;
    --serif: "Iowan Old Style", "Palatino Linotype", Palatino, "Book Antiqua", Georgia, serif;
    --sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    --mono: ui-monospace, "SF Mono", "Cascadia Code", Menlo, Consolas, monospace;
  }
  * { box-sizing: border-box; }
  html, body { margin: 0; height: 100%; }
  body { background: var(--paper); color: var(--ink); font-family: var(--sans); font-size: 14px; -webkit-font-smoothing: antialiased; }
  #app { display: grid; grid-template-columns: 344px 1fr; height: 100vh; }

  aside { background: var(--coal); color: var(--coal-ink); display: flex; flex-direction: column; min-height: 0; overflow: hidden; }
  .brand { padding: 26px 26px 20px; border-bottom: 1px solid #ffffff12; }
  .brand h1 { margin: 0; font-family: var(--serif); font-weight: 500; font-size: 27px; letter-spacing: .01em; line-height: 1.12; }
  .brand h1 em { font-style: normal; color: var(--accent-on-dark); }
  .brand .meta { margin-top: 12px; color: var(--coal-muted); font-size: 11.5px; line-height: 1.7; }
  .brand .meta b { color: var(--coal-ink); font-weight: 600; }

  .search { padding: 16px 26px; border-bottom: 1px solid #ffffff10; }
  .search input { width: 100%; background: transparent; border: 0; border-bottom: 1px solid #ffffff22; color: var(--coal-ink); padding: 7px 0; font-size: 13px; font-family: var(--sans); }
  .search input::placeholder { color: #a8a59f; }
  .search input:focus { outline: none; border-color: var(--accent); }

  .filters { display: flex; flex-wrap: wrap; gap: 14px; padding: 14px 26px 10px; }
  .chip { font-size: 11.5px; letter-spacing: .02em; color: var(--coal-muted); cursor: pointer; padding-bottom: 2px; border-bottom: 1.5px solid transparent; user-select: none; transition: color .15s, border-color .15s; }
  .chip:hover { color: var(--coal-ink); }
  .chip.on { color: #fff; border-color: var(--accent-on-dark); }
  .chip .n { color: #9a9791; margin-left: 5px; font-variant-numeric: tabular-nums; }

  .tree { overflow: auto; flex: 1; padding: 8px 14px 48px; }
  .tree::-webkit-scrollbar { width: 8px; }
  .tree::-webkit-scrollbar-thumb { background: #ffffff1a; border-radius: 4px; }
  .cat { margin: 18px 0 6px; padding: 0 12px; font-size: 10.5px; letter-spacing: .16em; text-transform: uppercase; color: #7a7873; }
  .cat:first-child { margin-top: 6px; }
  .node { display: flex; align-items: baseline; gap: 8px; padding: 4px 12px 4px 0; border-radius: 5px; cursor: pointer; white-space: nowrap; }
  .node:hover { background: #ffffff0d; }
  .node .nm { overflow: hidden; text-overflow: ellipsis; }
  .node.dir { color: var(--coal-muted); font-size: 12px; }
  .node.file { color: #cfccc6; font-size: 12.5px; }
  .node.active { background: var(--accent); color: #fff; }
  .node.active .count, .node.active .dot { color: #ffd9cd; }
  .count { margin-left: auto; color: #6f6d69; font-size: 10.5px; font-variant-numeric: tabular-nums; }
  .dot { color: var(--accent-on-dark); font-size: 9px; }

  main { display: flex; flex-direction: column; min-width: 0; min-height: 0; }
  .filehead { padding: 26px 44px 20px; border-bottom: 1px solid var(--line); }
  .filehead .label { font-size: 10.5px; letter-spacing: .16em; text-transform: uppercase; color: var(--accent); margin-bottom: 10px; }
  .filehead .p { font-family: var(--mono); font-size: 16px; color: var(--ink); word-break: break-all; letter-spacing: -.01em; }
  .filehead .desc { color: var(--muted); font-size: 13px; margin-top: 8px; max-width: 70ch; line-height: 1.55; }
  .filehead .info { color: var(--faint); font-size: 11.5px; margin-top: 12px; display: flex; flex-wrap: wrap; gap: 6px 14px; }
  .filehead .info span { display: inline-flex; gap: 5px; }
  .filehead .info code { color: var(--muted); font-family: var(--mono); font-size: 11px; }
  .flag { color: var(--accent); font-weight: 600; }
  .flag::before { content: "● "; font-size: 8px; vertical-align: 1px; }

  .content { overflow: auto; flex: 1; background: var(--paper); }
  .content::-webkit-scrollbar { width: 11px; height: 11px; }
  .content::-webkit-scrollbar-thumb { background: #c9ccd2; border-radius: 6px; border: 3px solid var(--paper); }
  .code { display: flex; align-items: flex-start; min-height: 100%; font-family: var(--mono); font-size: 12.5px; line-height: 1.62; }
  .gutter { position: sticky; left: 0; flex: 0 0 auto; padding: 20px 14px 40px 44px; text-align: right; color: #c2c6cd; background: var(--paper); user-select: none; font-variant-numeric: tabular-nums; border-right: 1px solid var(--line); white-space: pre; line-height: inherit; }
  .codebody { flex: 1; padding: 20px 44px 40px; white-space: pre; overflow-x: auto; }
  .fade { animation: fade .22s ease; }
  @keyframes fade { from { opacity: 0; transform: translateY(3px); } to { opacity: 1; transform: none; } }

  .welcome { padding: 54px 44px 60px; max-width: 900px; }

  .welcome h2 { font-family: var(--serif); font-weight: 500; font-size: 40px; line-height: 1.1; margin: 14px 0 18px; letter-spacing: -.01em; max-width: 27ch; }
  .welcome .lede { font-size: 16px; line-height: 1.7; color: var(--muted); max-width: 62ch; }
  .welcome .lede b { color: var(--ink); font-weight: 600; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(230px, 1fr)); gap: 12px; margin: 40px 0 34px; }
  .card { background: var(--paper); border: 1px solid var(--line); border-radius: 3px; padding: 20px 20px 22px; transition: border-color .15s, transform .15s; }
  .card:hover { border-color: #d7dade; transform: translateY(-1px); }
  .card h3 { margin: 0 0 8px; font-size: 13px; font-weight: 600; letter-spacing: .01em; display: flex; align-items: baseline; justify-content: space-between; }
  .card h3 .num { color: var(--accent); font-family: var(--serif); font-size: 15px; font-variant-numeric: tabular-nums; }
  .card p { margin: 0; color: var(--muted); font-size: 12.5px; line-height: 1.6; }
  .hint { color: var(--faint); font-size: 12px; line-height: 1.8; }
  .hint kbd { font-family: var(--mono); font-size: 11px; background: var(--soft); border: 1px solid var(--line); border-radius: 4px; padding: 1px 6px; color: var(--muted); }
  .hint code { font-family: var(--mono); font-size: 11.5px; color: var(--ink); background: var(--soft); padding: 1px 5px; border-radius: 4px; }
  mark { background: var(--accent-soft); color: inherit; border-radius: 2px; padding: 0 1px; }
  a { color: var(--accent); }
  @media (max-width: 860px) {
    #app { grid-template-columns: 1fr; }
    aside { display: none; }
  }
</style>
</head>
<body>
<div id="app">
  <aside>
    <div class="brand">
      <h1>Memory of <em>my Pi</em></h1>
      <div class="meta" id="meta"></div>
    </div>
    <div class="search"><input id="q" type="search" placeholder="Filter by path, note, or content" autocomplete="off"></div>
    <div class="filters" id="filters"></div>
    <div class="tree" id="tree"></div>
  </aside>
  <main>
    <div class="filehead" id="head"></div>
    <div class="content" id="content"></div>
  </main>
</div>
<script src="site-data.js"></script>
<script>
(function () {
  var D = window.PI_DUMP;
  if (!D) { document.body.innerHTML = '<p style="padding:40px;font-family:sans-serif">site-data.js missing — run <code>node scripts/build-site.js</code></p>'; return; }

  document.getElementById('meta').innerHTML =
    '<b>' + D.files.length + '</b> files\\u2009·\\u2009' + fmtBytes(D.stats.totalBytes) + '<br>' +
    'captured ' + new Date(D.generatedAt).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) +
    ' from <b>' + D.source.replace(/^.*[\\\\/]/, '~/') + '</b>';

  var state = { q: '', cats: new Set(), active: null };
  var byPath = {};
  D.files.forEach(function (f) { byPath[f.path] = f; });

  var CATERS = {
    'Core Config':      'Provider, models, MCP servers, system prompt, global playbook.',
    'Extensions':       'Native code loaded into the runtime.',
    'Skills (local)':   'Skill procedures authored in this agent.',
    'Skills (vendored)':'Skills bundled by installed packages.',
    'Skills (external)':'Skills auto-discovered from ~/.agents.',
    'Memory':           'Durable user, agent, and per-project memory.',
    'Packages':         'Installed Pi extensions and their manifests.'
  };

  var filtersEl = document.getElementById('filters');
  var chips = [{ name: '__all', label: 'All', n: D.files.length }].concat(D.categories.map(function (c) { return { name: c.name, label: c.name, n: c.files }; }));
  chips.forEach(function (c) {
    var el = document.createElement('span');
    el.className = 'chip' + (c.name === '__all' ? ' on' : '');
    el.innerHTML = esc(c.label) + '<span class="n">' + c.n + '</span>';
    el.dataset.c = c.name;
    el.onclick = function () {
      if (c.name === '__all') state.cats.clear();
      else state.cats.has(c.name) ? state.cats.delete(c.name) : state.cats.add(c.name);
      syncChips();
      renderTree();
    };
    filtersEl.appendChild(el);
  });
  function syncChips() {
    Array.prototype.forEach.call(filtersEl.children, function (x) {
      x.classList.toggle('on', x.dataset.c === '__all' ? state.cats.size === 0 : state.cats.has(x.dataset.c));
    });
  }

  function visible(f) {
    if (state.cats.size && !state.cats.has(f.category)) return false;
    if (!state.q) return true;
    var q = state.q.toLowerCase();
    return (f.path + ' ' + (f.description || '') + ' ' + (f.text || '')).toLowerCase().indexOf(q) >= 0;
  }

  function buildTree(files) {
    var root = { dirs: {}, files: [] };
    files.forEach(function (f) {
      var parts = f.path.split('/'), node = root;
      for (var i = 0; i < parts.length - 1; i++) node = node.dirs[parts[i]] || (node.dirs[parts[i]] = { dirs: {}, files: [] });
      node.files.push(f);
    });
    return root;
  }

  function renderTree() {
    var tree = document.getElementById('tree');
    tree.innerHTML = '';
    D.categories.forEach(function (cat) {
      var files = D.files.filter(function (f) { return f.category === cat.name && visible(f); });
      if (!files.length) return;
      var h = document.createElement('div');
      h.className = 'cat';
      h.textContent = cat.name + ' · ' + files.length;
      tree.appendChild(h);
      renderNode(buildTree(files), tree, 0);
    });
    if (!tree.children.length) tree.innerHTML = '<div class="cat">No matches</div>';
  }

  function renderNode(node, parent, depth) {
    Object.keys(node.dirs).sort().forEach(function (d) {
      var el = document.createElement('div');
      el.className = 'node dir';
      el.style.paddingLeft = (12 + depth * 12) + 'px';
      el.innerHTML = '<span class="nm">' + esc(d) + '</span>';
      var kids = document.createElement('div');
      el.onclick = function (e) { e.stopPropagation(); kids.style.display = kids.style.display === 'none' ? '' : 'none'; };
      parent.appendChild(el); parent.appendChild(kids);
      renderNode(node.dirs[d], kids, depth + 1);
    });
    node.files.sort(function (a, b) { return a.path.localeCompare(b.path); }).forEach(function (f) {
      var el = document.createElement('div');
      el.className = 'node file' + (state.active === f.path ? ' active' : '');
      el.style.paddingLeft = (12 + depth * 12) + 'px';
      el.innerHTML = '<span class="nm" title="' + escAttr(f.path) + '">' + esc(f.path.split('/').pop()) + '</span>' +
        (f.redacted ? '<span class="dot" title="secrets redacted">●</span>' : '') +
        '<span class="count">' + fmtBytes(f.size) + '</span>';
      el.onclick = function () { show(f.path); };
      parent.appendChild(el);
    });
  }

  function lineNumbers(n) {
    var out = '';
    for (var i = 1; i <= n; i++) out += i + '\\n';
    return out;
  }

  function show(p) {
    var f = byPath[p];
    if (!f) return;
    state.active = p;
    if (location.hash.slice(1) !== p) history.replaceState(null, '', '#' + p);
    var head = document.getElementById('head');
    head.style.display = '';
    head.innerHTML =
      '<div class="label">' + esc(f.category) + '</div>' +
      '<div class="p">' + esc(f.path) + '</div>' +
      (f.description ? '<div class="desc">' + esc(f.description) + '</div>' : '') +
      '<div class="info">' +
        '<span>source <code>' + esc(f.source) + '</code></span>' +
        '<span>' + fmtBytes(f.size) + '</span>' +
        '<span>sha256 <code>' + f.sha256 + '</code></span>' +
        (f.redacted ? '<span class="flag">secrets redacted</span>' : '') +
      '</div>';
    var content = document.getElementById('content');
    content.innerHTML = '';
    var text = f.text || '';
    var lines = text.length ? text.split('\\n').length : 1;
    var wrap = document.createElement('div');
    wrap.className = 'code fade';
    var g = document.createElement('div');
    g.className = 'gutter';
    g.textContent = lineNumbers(lines);
    var b = document.createElement('div');
    b.className = 'codebody';
    b.textContent = text || '(empty)';
    wrap.appendChild(g); wrap.appendChild(b);
    content.appendChild(wrap);
    content.scrollTop = 0; content.scrollLeft = 0;
    renderTree();
  }

  function welcome() {
    var head = document.getElementById('head');
    head.style.display = 'none';
    var content = document.getElementById('content');
    content.innerHTML = '';
    var d = document.createElement('div');
    d.className = 'welcome fade';
    var cards = D.categories.map(function (c) {
      return '<div class="card"><h3>' + esc(c.name) + '<span class="num">' + c.files + '</span></h3><p>' + esc(CATERS[c.name] || '') + '</p></div>';
    }).join('');
    d.innerHTML =
      '<h2>Everything that turns a plain Pi install into this one.</h2>' +
      '<p class="lede">Every file that shapes behaviour is mirrored here, redacted where it carried secrets. Browse the tree, or search across paths, notes, and full file contents. <b>' + D.files.length + ' files, ' + fmtBytes(D.stats.totalBytes) + '.</b></p>' +
      '<div class="grid">' + cards + '</div>' +
      '<p class="hint">Press <kbd>/</kbd> to search. Click a category above the tree to narrow it. Every file has a stable link — the URL hash is the path.<br>' +
      'Regenerate with <code>node scripts/dump-config.js &amp;&amp; node scripts/build-site.js</code>.</p>';
    content.appendChild(d);
  }

  function fmtBytes(n) { return n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(1) + ' KB' : (n / 1048576).toFixed(2) + ' MB'; }
  function esc(s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function escAttr(s) { return esc(s); }

  var q = document.getElementById('q');
  q.addEventListener('input', function () { state.q = q.value.trim(); renderTree(); });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && document.activeElement !== q) { e.preventDefault(); q.focus(); }
    if (e.key === 'Escape' && document.activeElement === q) { q.value = ''; state.q = ''; renderTree(); q.blur(); }
  });
  window.addEventListener('hashchange', function () {
    var h = decodeURIComponent(location.hash.replace(/^#/, ''));
    if (h && byPath[h]) show(h); else if (!h) welcome();
  });

  renderTree();
  var initial = decodeURIComponent(location.hash.replace(/^#/, ''));
  if (initial && byPath[initial]) show(initial); else welcome();
})();
</script>
</body>
</html>
`;

fs.writeFileSync(path.join(REPO, 'index.html'), HTML, 'utf8');
console.log('Wrote index.html (' + HTML.length + ' bytes) and site-data.js');
