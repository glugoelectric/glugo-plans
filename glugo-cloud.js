/* GLugo Cloud — lets a GLugo app that was built inside Claude run on GitHub Pages.
   It answers the app's claude.use('db' | 'user' | 'assets' | 'downloads') calls with
   Gustavo's own Google Apps Script ("GLugo Apps"), which keeps the data in his Google Drive.
   Load it before the app's own scripts:  <script src="glugo-cloud.js" data-app="plans"></script>  */
(function () {
  'use strict';
  const APP = (document.currentScript && document.currentScript.dataset.app) || 'plans';
  const CONN_KEY = 'glugoapps.conn';
  const ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  };
  let CONN = ls.get(CONN_KEY, null);

  function parseConn(code, key) {
    code = String(code || '').trim(); key = String(key || '').trim();
    try { code = decodeURIComponent(code); } catch (e) {}
    const ci = code.indexOf('#connect='); if (ci >= 0) code = code.slice(ci + 9);
    code = code.replace(/[\uFF5C\u2223\u00A6\u2502\u01C0\u05C0\u2016]/g, '|');
    code = code.replace(/(\/exec)\s+(\S+)\s*$/, '$1|$2');
    code = code.replace(/\s+/g, '');
    if (!code.includes('|')) { const m = code.match(/^(.*\/exec)([A-Za-z0-9_-]{8,})$/); if (m) code = m[1] + '|' + m[2]; }
    if (code.includes('|')) { const i = code.lastIndexOf('|'); key = code.slice(i + 1).trim(); code = code.slice(0, i).trim(); }
    if (!/^https:\/\/script\.google(usercontent)?\.com\//.test(code) || !/\/exec$/.test(code) || !key) return null;
    return { url: code, key };
  }

  async function call(a, extra, conn) {
    conn = conn || CONN;
    if (!conn) { const e = new Error('not connected'); e.code = 'unavailable'; throw e; }
    let r;
    try { r = await fetch(conn.url, { method: 'POST', body: JSON.stringify(Object.assign({ k: conn.key, a, app: APP }, extra || {})) }); }
    catch (e) { const er = new Error('offline'); er.code = 'unavailable'; throw er; }
    if (!r.ok) { const er = new Error('HTTP ' + r.status); er.code = 'unavailable'; throw er; }
    const j = await r.json();
    if (!j.ok) { const er = new Error(j.error || 'error'); er.code = /key/.test(j.error || '') ? 'permission-denied' : 'internal'; throw er; }
    return j;
  }
  const GA = { call, app: APP, connected: () => !!CONN };
  window.GLugoCloud = GA;

  /* ---------- files (photos, signatures) ---------- */
  let idbP = null;
  function idb() {
    if (!idbP) idbP = new Promise(res => { try { const r = indexedDB.open('glugo-files', 1); r.onupgradeneeded = () => r.result.createObjectStore('f'); r.onsuccess = () => res(r.result); r.onerror = () => res(null); } catch (e) { res(null); } });
    return idbP;
  }
  async function idbGet(id) { const d = await idb(); if (!d) return null; return new Promise(res => { try { const q = d.transaction('f').objectStore('f').get(id); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } }); }
  async function idbPut(id, b) { const d = await idb(); if (!d) return; try { d.transaction('f', 'readwrite').objectStore('f').put(b, id); } catch (e) {} }
  const mem = {};
  function b64ToBlob(b64, mime) { const s = atob(b64), u = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i); return new Blob([u], { type: mime || 'application/octet-stream' }); }
  function blobToB64(b) { return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(',')[1] || ''); r.onerror = () => rej(r.error); r.readAsDataURL(b); }); }
  function fileBlob(id) {
    if (!mem[id]) mem[id] = (async () => { const c = await idbGet(id); if (c) return c; const j = await call('file', { id }); const b = b64ToBlob(j.b64, j.mime); idbPut(id, b); return b; })()
      .catch(e => { delete mem[id]; throw e; });
    return mem[id];
  }
  const assets = {
    async upload(blob, opts) {
      const b = blob instanceof Blob ? blob : new Blob([blob], { type: (opts && opts.type) || 'application/octet-stream' });
      const j = await call('upload', { name: 'file', mime: b.type || (opts && opts.type) || 'application/octet-stream', b64: await blobToB64(b) });
      mem[j.id] = Promise.resolve(b); idbPut(j.id, b);
      return { id: j.id, url: '/_blob/' + j.id };
    },
    async delete(id) { await call('trash', { id }); }
  };
  /* the app reads stored pictures with fetch('/_blob/<id>') — answer those from Drive */
  const realFetch = window.fetch.bind(window);
  window.fetch = async function (u, o) {
    const s = typeof u === 'string' ? u : (u && u.url) || '';
    const m = s.match(/\/_blob\/([A-Za-z0-9_-]+)/);
    if (m && CONN) {
      try { return new Response(await fileBlob(m[1]), { status: 200 }); }
      catch (e) { return new Response('', { status: 404 }); }
    }
    return realFetch(u, o);
  };
  /* and any <img src="/_blob/<id>"> */
  function fixImg(img) {
    const s = img.getAttribute('src') || '', m = s.match(/^\/_blob\/([A-Za-z0-9_-]+)/);
    if (!m || img.dataset.gcFixing) return;
    img.dataset.gcFixing = '1';
    fileBlob(m[1]).then(b => { img.src = URL.createObjectURL(b); }).catch(() => {});
  }
  new MutationObserver(ms => ms.forEach(mu => {
    if (mu.type === 'attributes' && mu.target.tagName === 'IMG') fixImg(mu.target);
    mu.addedNodes && mu.addedNodes.forEach(n => { if (n.nodeType !== 1) return; if (n.tagName === 'IMG') fixImg(n); n.querySelectorAll && n.querySelectorAll('img[src^="/_blob/"]').forEach(fixImg); });
  })).observe(document.documentElement, { subtree: true, childList: true, attributes: true, attributeFilter: ['src'] });

  /* ---------- database ---------- */
  const watchers = new Map();   // path -> {cbs:Set, last}
  const snap = (path, exists, data) => ({ id: path.split('/').pop(), exists: !!exists, data: () => (data == null ? undefined : JSON.parse(JSON.stringify(data))), metadata: { hasPendingWrites: false, fromCache: false } });
  function notify(path, data, exists) {
    const w = watchers.get(path); if (!w) return;
    w.last = JSON.stringify([exists, data]);
    w.cbs.forEach(cb => { try { cb(snap(path, exists, data)); } catch (e) {} });
  }
  async function poll() {
    if (!CONN || document.hidden || !watchers.size) return;
    const paths = [...watchers.keys()];
    try {
      const j = await call('getMany', { paths });
      paths.forEach(p => { const d = j.docs[p] || {}; const sig = JSON.stringify([!!d.exists, d.data]); const w = watchers.get(p); if (w && w.last !== sig) notify(p, d.data, d.exists); });
    } catch (e) {}
  }
  setInterval(poll, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) poll(); });

  /* collections: a small "__index" doc in each collection lists its doc ids, so a whole
     collection can be read and watched with the plain get/set the Google script offers */
  const manifests = {};   // collection path -> Set of ids (once read)
  const idxPath = col => col + '/__index';
  const loading = {}, chains = {};
  function manifest(col) {
    if (manifests[col]) return Promise.resolve(manifests[col]);
    if (!loading[col]) loading[col] = call('get', { path: idxPath(col) }).then(j => (manifests[col] = new Set((j.exists && j.data && j.data.ids) || []))).finally(() => { delete loading[col]; });
    return loading[col];
  }
  /* one manifest change at a time per collection, so saves made at the same moment never drop an id */
  function editManifest(col, fn) {
    const run = async () => { const m = await manifest(col); if (fn(m)) await call('set', { path: idxPath(col), data: { ids: [...m] } }); };
    chains[col] = (chains[col] || Promise.resolve()).then(run, run);
    return chains[col];
  }
  const addToManifest = (col, id) => editManifest(col, m => (m.has(id) ? false : (m.add(id), true)));
  const dropFromManifest = (col, id) => editManifest(col, m => m.delete(id));
  async function readCollection(col) {
    const j = await call('get', { path: idxPath(col) });
    const ids = (j.exists && j.data && j.data.ids) || [];
    if (!chains[col] || !manifests[col]) manifests[col] = new Set(ids); else ids.forEach(i => manifests[col].add(i));
    const docs = [];
    for (let i = 0; i < ids.length; i += 50) {
      const part = ids.slice(i, i + 50).map(id => col + '/' + id);
      const r = await call('getMany', { paths: part });
      part.forEach((p, k) => { const d = r.docs[p] || {}; if (d.exists) docs.push(snap(p, true, d.data)); });
    }
    return docs;
  }
  const colWatchers = new Map(); // col -> {cbs:Set, last}
  async function pollCols() {
    for (const [col, w] of colWatchers) {
      try { const docs = await readCollection(col); const sig = JSON.stringify(docs.map(d => [d.id, d.data()])); if (sig !== w.last) { w.last = sig; const qs = qsnap(docs); w.cbs.forEach(cb => { try { cb(qs); } catch (e) {} }); } } catch (e) {}
    }
  }
  const qsnap = docs => ({ docs, size: docs.length, empty: !docs.length, forEach: f => docs.forEach(f) });
  setInterval(() => { if (CONN && !document.hidden && colWatchers.size) pollCols(); }, 20000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && colWatchers.size) pollCols(); });

  function docRef(path, inCol) {
    path = String(path).replace(/^\/+|\/+$/g, '');
    const col = path.slice(0, path.lastIndexOf('/')), id = path.split('/').pop();
    return {
      id, path,
      collection(name) { return colRef(path + '/' + name); },
      async get() { const j = await call('get', { path }); return snap(path, j.exists, j.data); },
      async set(data, opts) {
        let d = data;
        if (opts && opts.merge) { const cur = await call('get', { path }); d = Object.assign({}, cur.exists ? cur.data : {}, data); }
        await call('set', { path, data: d }); if (inCol) await addToManifest(col, id); notify(path, d, true);
      },
      async update(patch) { const cur = await call('get', { path }); const d = Object.assign({}, cur.exists ? cur.data : {}, patch); await call('set', { path, data: d }); if (inCol) await addToManifest(col, id); notify(path, d, true); },
      async delete() { await call('del', { path }); if (inCol) await dropFromManifest(col, id); notify(path, undefined, false); },
      onSnapshot(cb, err) {
        let w = watchers.get(path); if (!w) { w = { cbs: new Set(), last: null }; watchers.set(path, w); }
        w.cbs.add(cb);
        call('get', { path }).then(j => { w.last = JSON.stringify([!!j.exists, j.data]); cb(snap(path, j.exists, j.data)); }).catch(e => { if (err) err(e); });
        return () => { w.cbs.delete(cb); if (!w.cbs.size) watchers.delete(path); };
      }
    };
  }
  function colRef(path) {
    path = String(path).replace(/^\/+|\/+$/g, '');
    return {
      path,
      doc(id) { return docRef(path + '/' + (id || Date.now().toString(36) + Math.random().toString(36).slice(2, 8)), true); },
      async get() { return qsnap(await readCollection(path)); },
      async add(data) { const r = this.doc(); await r.set(data); return r; },
      onSnapshot(cb, err) {
        let w = colWatchers.get(path); if (!w) { w = { cbs: new Set(), last: null }; colWatchers.set(path, w); }
        w.cbs.add(cb);
        readCollection(path).then(docs => { w.last = JSON.stringify(docs.map(d => [d.id, d.data()])); cb(qsnap(docs)); }).catch(e => { if (err) err(e); });
        return () => { w.cbs.delete(cb); if (!w.cbs.size) colWatchers.delete(path); };
      }
    };
  }
  const db = { doc: docRef, collection: colRef };
  const user = { async id() { return 'me'; } };
  const downloads = {
    async save({ filename, data, type }) {
      const b = data instanceof Blob ? data : new Blob([data], { type: type || 'application/octet-stream' });
      const a = document.createElement('a'); a.href = URL.createObjectURL(b); a.download = filename || 'download';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(a.href), 60000);
    }
  };
  const SERVICES = { db, user, assets, downloads };
  window.claude = { use: async name => (CONN ? SERVICES[name] || null : null) };

  /* ---------- connect screen + backups (shown over the app) ---------- */
  const css = `.gc-ov{position:fixed;inset:0;z-index:2147483000;background:rgba(10,14,20,.55);display:flex;align-items:center;justify-content:center;padding:16px;font:17px -apple-system,BlinkMacSystemFont,sans-serif}
  .gc-card{background:#fff;color:#1b1f24;border-radius:16px;max-width:520px;width:100%;max-height:90vh;overflow:auto;box-shadow:0 10px 40px rgba(0,0,0,.35)}
  .gc-top{display:grid;grid-template-columns:1fr auto 1fr;align-items:center;padding:10px 12px;border-bottom:1px solid #e2e5e9}
  .gc-x{justify-self:start;border:0;background:#eef1f5;width:36px;height:36px;border-radius:50%;font-size:17px;font-weight:700;cursor:pointer}
  .gc-body{padding:16px}.gc-body p{color:#66707a;margin:0 0 12px}
  .gc-in{width:100%;box-sizing:border-box;font:16px monospace;padding:10px;border:1.5px solid #d3d9e2;border-radius:10px;margin:6px 0 12px}
  .gc-btn{border:0;border-radius:10px;padding:12px 18px;font:600 17px -apple-system,sans-serif;background:#1f6feb;color:#fff;cursor:pointer}
  .gc-btn.red{background:#cf222e}.gc-btn.ghost{background:#dde7f8;color:#1758c2}
  .gc-st{min-height:1.2em;font-size:15px;margin-top:10px}.gc-st.bad{color:#cf222e;font-weight:600}
  .gc-row{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:10px 0;border-bottom:1px solid #e2e5e9}
  @media (prefers-color-scheme:dark){.gc-card{background:#181c22;color:#e8ebef}.gc-in{background:#0f1216;color:#e8ebef;border-color:#2a3038}.gc-top,.gc-row{border-color:#2a3038}.gc-x{background:#22324a;color:#e8ebef}}`;
  function overlay(html) {
    const st = document.createElement('style'); st.textContent = css;
    const ov = document.createElement('div'); ov.className = 'gc-ov'; ov.innerHTML = '<div class="gc-card">' + html + '</div>';
    ov.appendChild(st); document.body.appendChild(ov); return ov;
  }
  function showConnect(msg) {
    const ov = overlay(`<div class="gc-top"><span></span><b>Connect to Google Drive</b><span></span></div>
      <div class="gc-body"><p>Paste your GLugo Apps connection (the Web app URL, then <b>|</b>, then the key) — the same one for Plans, Panel Mapper and Home Planner. Once per device.</p>
      <input class="gc-in" id="gcCode" placeholder="https://script.google.com/macros/s/…/exec|key" autocapitalize="off" autocorrect="off" spellcheck="false">
      <div style="font-size:14px;color:#8b949e">Key (only if it isn't already at the end of the line above)</div>
      <input class="gc-in" id="gcKey" placeholder="key from your email" autocapitalize="off" autocorrect="off" spellcheck="false">
      <button class="gc-btn" id="gcGo">Connect</button><div class="gc-st ${msg ? 'bad' : ''}" id="gcSt">${msg || ''}</div></div>`);
    ov.querySelector('#gcGo').onclick = async () => {
      const c = parseConn(ov.querySelector('#gcCode').value, ov.querySelector('#gcKey').value), st = ov.querySelector('#gcSt');
      if (!c) { st.className = 'gc-st bad'; st.textContent = 'Paste the Web app URL (ending in /exec) in the first box and the key in the second box.'; return; }
      st.className = 'gc-st'; st.textContent = 'Connecting…';
      try { await call('ping', {}, c); ls.set(CONN_KEY, c); st.textContent = 'Connected ✓'; setTimeout(() => location.reload(), 400); }
      catch (e) { st.className = 'gc-st bad'; st.textContent = e.code === 'permission-denied' ? 'The key was not accepted.' : 'Could not reach your Google script. Check the URL and that it is deployed for "Anyone".'; }
    };
  }
  async function showBackups() {
    const ov = overlay(`<div class="gc-top"><button class="gc-x" id="gcX" aria-label="Close">✕</button><b>Restore a backup</b><span></span></div><div class="gc-body" id="gcB"><p>Loading backups…</p></div>`);
    ov.querySelector('#gcX').onclick = () => { ov.remove(); history.replaceState(null, '', location.pathname); };
    const box = ov.querySelector('#gcB');
    try {
      const j = await call('backups', {});
      if (!j.list.length) { box.innerHTML = '<p>No backups yet — one is made every night.</p>'; return; }
      box.innerHTML = '<p>Pick a night to go back to. What you have now is saved as a backup first, so you can undo this.</p>' +
        j.list.slice(0, 40).map((b, i) => `<div class="gc-row"><span>${new Date(b.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}${/before-restore/.test(b.name) ? ' (before a restore)' : ''}</span><button class="gc-btn ghost" data-i="${i}">Restore</button></div>`).join('');
      box.querySelectorAll('[data-i]').forEach(btn => btn.onclick = async () => {
        if (!confirm('Restore this backup? Your current data is saved as a backup first.')) return;
        btn.disabled = true; btn.textContent = 'Restoring…';
        try { await call('restore', { id: j.list[+btn.dataset.i].id }); try { Object.keys(localStorage).forEach(k => { if (/^glp\.(p\.|index)/.test(k)) localStorage.removeItem(k); }); } catch (e) {} alert('Restored. The app will reload.'); location.href = location.pathname; }
        catch (e) { alert('Not restored: ' + e.message); btn.disabled = false; btn.textContent = 'Restore'; }
      });
    } catch (e) { box.innerHTML = '<p>Could not load backups: ' + e.message + '</p>'; }
  }
  GA.showConnect = showConnect; GA.showBackups = showBackups;

  function start() {
    const h = decodeURIComponent(location.hash.slice(1));
    if (h.startsWith('connect=')) { const c = parseConn(h.slice(8)); history.replaceState(null, '', location.pathname); if (c) { ls.set(CONN_KEY, c); CONN = c; location.reload(); return; } }
    if (!CONN) { showConnect(''); return; }
    if (h === 'backups') showBackups();
  }
  window.addEventListener('hashchange', () => { if (location.hash.indexOf('#connect=') === 0) start(); });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
})();
