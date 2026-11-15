/**
 * GLugo Apps — one Google Apps Script that stores data for GLugo Plans,
 * GLugo Panel Mapper and GLugo Home Planner in your own Google Drive
 * (folder "GLugo Apps"), with a backup of every app every night.
 *
 * Setup (one time, on the Mac in Chrome, signed in as gus@glugoelectric.com):
 *  1. script.google.com → New project → name it "GLugo Apps" → paste this whole file over Code.gs → Save.
 *  2. Deploy → New deployment → gear → Web app → Execute as: Me, Who has access: Anyone → Deploy → Allow.
 *     Copy the Web app URL (it ends in /exec).
 *  3. Pick "setup" in the function menu → Run. It moves your current data in, turns on
 *     the nightly backup, and emails you the connection key.
 *  4. Open an app and paste:  <Web app URL>|<key>  into the first box. Once per device —
 *     all GLugo apps on glugoelectric.github.io share it.
 *
 * The key lives only in this script's settings, never in the apps' public code.
 */

const ROOT_NAME = 'GLugo Apps';
const IMPORT_NAME = 'glugo-apps-import.json';
const KEEP_BACKUPS = 30;            // per app
const APPS = ['plans', 'panel-mapper', 'home-planner'];

/* ---------------- setup ---------------- */
function setup() {
  const props = PropertiesService.getScriptProperties();
  let key = props.getProperty('KEY');
  if (!key) { key = Utilities.getUuid().replace(/-/g, '').slice(0, 20); props.setProperty('KEY', key); }
  const moved = importOld_();
  ScriptApp.getProjectTriggers().forEach(t => { if (t.getHandlerFunction() === 'dailyBackup') ScriptApp.deleteTrigger(t); });
  ScriptApp.newTrigger('dailyBackup').timeBased().everyDays(1).atHour(2).create();
  dailyBackup();
  const me = Session.getEffectiveUser().getEmail();
  MailApp.sendEmail({
    to: me,
    subject: 'GLugo Apps: your connection key',
    htmlBody: '<div style="font:16px -apple-system,Arial,sans-serif">' +
      '<p>Your GLugo Apps key (Plans, Panel Mapper, Home Planner):</p><p style="font:700 22px monospace">' + key + '</p>' +
      '<p>In an app, paste the Web app URL from Deploy → Manage deployments (it ends in <b>/exec</b>), then <b>|</b>, then this key, all in the first box:</p>' +
      '<p style="font:13px monospace;background:#f2f4f7;padding:8px;border-radius:6px">https://script.google.com/macros/s/…/exec|' + key + '</p>' +
      (moved ? '<p style="color:#666;font-size:14px">' + moved + '</p>' : '') +
      '<p style="color:#666;font-size:13px">Keep this email private.</p></div>'
  });
  Logger.log('Key: ' + key);
  Logger.log(moved || 'Nothing to move in.');
}

/* ---------------- storage ---------------- */
function folder_(parent, name) {
  const it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  return it.hasNext() ? it.next() : (parent ? parent.createFolder(name) : DriveApp.createFolder(name));
}
const root_ = () => folder_(null, ROOT_NAME);
const appDir_ = app => folder_(root_(), app);
const docsDir_ = app => folder_(appDir_(app), 'docs');
const filesDir_ = app => folder_(appDir_(app), 'files');
const backupsDir_ = () => folder_(root_(), 'Backups');
const fname_ = path => encodeURIComponent(path) + '.json';

function docFile_(app, path) {
  const it = docsDir_(app).getFilesByName(fname_(path));
  return it.hasNext() ? it.next() : null;
}
function getDoc_(app, path) {
  const f = docFile_(app, path);
  if (!f) return { exists: false };
  const o = JSON.parse(f.getBlob().getDataAsString() || '{}');
  return { exists: true, data: o.data, t: o.t || 0 };
}
function setDoc_(app, path, data) {
  const body = JSON.stringify({ path: path, t: Date.now(), data: data });
  const f = docFile_(app, path);
  if (f) f.setContent(body); else docsDir_(app).createFile(fname_(path), body, 'application/json');
}
function delDoc_(app, path) {
  const f = docFile_(app, path);
  if (f) f.setTrashed(true);
}

function importOld_() {
  const it = DriveApp.getFilesByName(IMPORT_NAME);
  if (!it.hasNext()) return '';
  const file = it.next();
  const imp = JSON.parse(file.getBlob().getDataAsString());
  const app = imp.app;
  if (APPS.indexOf(app) < 0) return '';
  let n = 0;
  Object.keys(imp.docs || {}).forEach(p => { if (!docFile_(app, p)) { setDoc_(app, p, imp.docs[p]); n++; } });
  (imp.files || []).forEach(id => { try { DriveApp.getFileById(id).moveTo(filesDir_(app)); } catch (e) {} });
  file.setName(IMPORT_NAME.replace('.json', ' (' + app + ', moved in).json'));
  file.moveTo(appDir_(app));
  return 'Moved in ' + n + ' saved items for ' + app + '.';
}

/* ---------------- web app ---------------- */
function out_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function keyOk_(k) { const key = PropertiesService.getScriptProperties().getProperty('KEY'); return !!key && k === key; }
function ownFile_(app, id) {
  if (!id) return null;
  try {
    const f = DriveApp.getFileById(id), want = filesDir_(app).getId(), ps = f.getParents();
    while (ps.hasNext()) if (ps.next().getId() === want) return f;
  } catch (e) {}
  return null;
}
function doPost(e) {
  let req;
  try { req = JSON.parse(e.postData.contents); } catch (err) { return out_({ ok: false, error: 'bad request' }); }
  if (!keyOk_(req.k)) return out_({ ok: false, error: 'wrong key' });
  if (APPS.indexOf(req.app) < 0) return out_({ ok: false, error: 'unknown app' });
  const app = req.app, lock = LockService.getScriptLock();
  try {
    switch (req.a) {
      case 'ping': return out_({ ok: true });
      case 'get': { const d = getDoc_(app, String(req.path)); return out_(Object.assign({ ok: true }, d)); }
      case 'getMany': {
        const res = {};
        (req.paths || []).slice(0, 50).forEach(p => { res[p] = getDoc_(app, String(p)); });
        return out_({ ok: true, docs: res });
      }
      case 'set': { lock.waitLock(20000); setDoc_(app, String(req.path), req.data); return out_({ ok: true, t: Date.now() }); }
      case 'del': { lock.waitLock(20000); delDoc_(app, String(req.path)); return out_({ ok: true }); }
      case 'upload': {
        const blob = Utilities.newBlob(Utilities.base64Decode(req.b64), req.mime || 'application/octet-stream', req.name || 'file');
        return out_({ ok: true, id: filesDir_(app).createFile(blob).getId() });
      }
      case 'file': {
        const f = ownFile_(app, req.id);
        if (!f) return out_({ ok: false, error: 'not found' });
        const b = f.getBlob();
        return out_({ ok: true, mime: b.getContentType(), b64: Utilities.base64Encode(b.getBytes()) });
      }
      case 'trash': { const f = ownFile_(app, req.id); if (f) f.setTrashed(true); return out_({ ok: true }); }
      case 'backups': {
        const list = [], it = backupsDir_().getFiles();
        while (it.hasNext()) { const f = it.next(); if (f.getName().indexOf(app + '-') === 0) list.push({ id: f.getId(), name: f.getName(), t: f.getDateCreated().getTime() }); }
        list.sort((a, b) => b.t - a.t);
        return out_({ ok: true, list: list });
      }
      case 'restore': {
        lock.waitLock(30000);
        const f = DriveApp.getFileById(req.id);
        if (f.getName().indexOf(app + '-') !== 0) return out_({ ok: false, error: 'not a backup of this app' });
        backupApp_(app, 'before-restore');               // keep what is there now
        const blobs = Utilities.unzip(f.getBlob());
        const dir = docsDir_(app), it = dir.getFiles();
        while (it.hasNext()) it.next().setTrashed(true);   // trashed, not deleted: still in Drive's Trash for 30 days
        blobs.forEach(b => dir.createFile(b.setContentType('application/json')));
        return out_({ ok: true, n: blobs.length });
      }
      default: return out_({ ok: false, error: 'unknown action' });
    }
  } catch (err) {
    return out_({ ok: false, error: String(err && err.message || err) });
  } finally { try { lock.releaseLock(); } catch (e2) {} }
}
function doGet() { return HtmlService.createHtmlOutput('<p style="font:18px Arial;padding:30px">GLugo Apps is running.</p>'); }

/* ---------------- nightly backup ---------------- */
function backupApp_(app, tag) {
  const it = docsDir_(app).getFiles(), blobs = [];
  while (it.hasNext()) blobs.push(it.next().getBlob());
  if (!blobs.length) return;
  const stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd HHmm');
  backupsDir_().createFile(Utilities.zip(blobs, app + '-' + (tag ? tag + '-' : '') + stamp + '.zip'));
}
function dailyBackup() {
  APPS.forEach(app => {
    const it = root_().getFoldersByName(app);
    if (!it.hasNext()) return;
    backupApp_(app, '');
    const list = [], all = backupsDir_().getFiles();
    while (all.hasNext()) { const f = all.next(); if (f.getName().indexOf(app + '-') === 0) list.push(f); }
    list.sort((a, b) => b.getDateCreated() - a.getDateCreated());
    list.slice(KEEP_BACKUPS).forEach(f => f.setTrashed(true));
  });
}
