/**
 * ADLER · Costo prodotto — backend multiutente (Google Apps Script)
 *
 * - Login con ID e password verificati QUI, sul server (la pagina non contiene password).
 * - Dati salvati in un Google Sheet privato (creato da setup()), un "documento" per riga.
 * - Salvataggio con controllo di versione: se due persone modificano lo stesso documento
 *   il secondo riceve un conflitto invece di sovrascrivere in silenzio.
 * - Storico di ogni salvataggio (chi, quando, quale documento, contenuto precedente recuperabile).
 *
 * Installazione: vedi README.md nella cartella principale.
 */

var NOME_ARCHIVIO = 'Costo Prodotto ADLER – ARCHIVIO PRIVATO';
var TOKEN_TTL = 6 * 60 * 60;      // 6 ore (massimo consentito da CacheService)
var MAX_TENTATIVI = 6;            // tentativi di login errati ...
var BLOCCO_SEC = 15 * 60;         // ... per utente, ogni 15 minuti
var MAX_DOC = 45000;              // limite caratteri per cella Google Sheets: 50.000

/* ---------- utilità foglio ---------- */
function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SSID');
  if (!id) throw new Error('Archive not initialised: run setup()');
  return SpreadsheetApp.openById(id);
}
function sheet_(nome, intestazioni) {
  var ss = ss_(), s = ss.getSheetByName(nome);
  if (!s) { s = ss.insertSheet(nome); s.appendRow(intestazioni); s.setFrozenRows(1); }
  return s;
}
function shUtenti_() { return sheet_('Utenti', ['utente', 'nome', 'ruolo', 'salt', 'hash', 'attivo']); }
function shDati_()   { return sheet_('Dati',   ['key', 'v', 'json', 'by', 'ts']); }
function shStorico_(){ return sheet_('Storico',['ts', 'user', 'key', 'v', 'action', 'json']); }
function ora_() { return Utilities.formatDate(new Date(), 'Europe/Rome', 'yyyy-MM-dd HH:mm:ss'); }

/* ---------- da eseguire UNA VOLTA dall'editor ---------- */
function setup() {
  var props = PropertiesService.getScriptProperties();
  if (!props.getProperty('SSID')) {
    var ss = SpreadsheetApp.create(NOME_ARCHIVIO);
    props.setProperty('SSID', ss.getId());
    Logger.log('Archivio creato: ' + ss.getUrl());
  }
  shUtenti_(); shDati_(); shStorico_();
  var ss2 = ss_(), s1 = ss2.getSheetByName('Foglio1') || ss2.getSheetByName('Sheet1');
  if (s1) ss2.deleteSheet(s1);
  Logger.log('Setup completato. Ora eseguire creaUtente() per ogni persona.');
}

/**
 * Crea o aggiorna un utente. Si esegue dall'editor Apps Script modificando i parametri nella
 * funzione utentiIniziali() qui sotto; poi CANCELLARE le password dal codice.
 * ruolo: 'admin' (tutto, incluso azzeramento), 'editor' (modifica), 'viewer' (sola lettura)
 */
function creaUtente(utente, password, nome, ruolo) {
  utente = String(utente).trim().toLowerCase();
  if (!/^[a-z0-9._-]{2,30}$/.test(utente)) throw new Error('Invalid user ID');
  if (String(password).length < 10) throw new Error('Password too short (minimum 10 characters)');
  if (['admin', 'editor', 'viewer'].indexOf(ruolo) < 0) throw new Error('Invalid role');
  var s = shUtenti_(), v = s.getDataRange().getValues(), salt = Utilities.getUuid(), h = hash_(salt, password), riga = -1;
  for (var i = 1; i < v.length; i++) if (v[i][0] === utente) riga = i + 1;
  var rec = [utente, nome, ruolo, salt, h, true];
  if (riga > 0) s.getRange(riga, 1, 1, 6).setValues([rec]); else s.appendRow(rec);
  Logger.log('Utente ' + utente + ' (' + ruolo + ') salvato.');
}
function utentiIniziali() {
  // Modificare le password, eseguire UNA VOLTA, poi cancellare le password da questo file.
  creaUtente('tullio', 'CAMBIAMI-password-lunga-1', 'Tullio Serci', 'admin');
  creaUtente('juan',   'CAMBIAMI-password-lunga-2', 'Juan',         'editor');
  creaUtente('paolo',  'CAMBIAMI-password-lunga-3', 'Paolo',        'editor');
}
function disattivaUtente(utente) {
  var s = shUtenti_(), v = s.getDataRange().getValues();
  for (var i = 1; i < v.length; i++) if (v[i][0] === String(utente).toLowerCase()) s.getRange(i + 1, 6).setValue(false);
}

/* ---------- sicurezza ---------- */
function hex_(bytes) { return bytes.map(function (b) { return ('0' + (b & 0xff).toString(16)).slice(-2); }).join(''); }
function hash_(salt, password) {
  var h = salt + '|' + password;
  for (var i = 0; i < 400; i++) h = hex_(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, h, Utilities.Charset.UTF_8));
  return h;
}
function uguali_(a, b) { // confronto a tempo costante
  if (a.length !== b.length) return false;
  var r = 0; for (var i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}
function apiLogin(utente, password) {
  utente = String(utente || '').trim().toLowerCase();
  var cache = CacheService.getScriptCache(), kf = 'fail:' + utente, n = parseInt(cache.get(kf) || '0', 10);
  if (n >= MAX_TENTATIVI) throw new Error('Too many failed attempts: try again in 15 minutes');
  var v = shUtenti_().getDataRange().getValues(), u = null;
  for (var i = 1; i < v.length; i++) if (v[i][0] === utente && v[i][5] === true) u = v[i];
  var ok = u && uguali_(hash_(String(u[3]), String(password || '')), String(u[4]));
  if (!ok) { cache.put(kf, String(n + 1), BLOCCO_SEC); Utilities.sleep(800); throw new Error('Incorrect user ID or password'); }
  cache.remove(kf);
  var token = Utilities.getUuid() + Utilities.getUuid().replace(/-/g, '');
  cache.put('tok:' + token, JSON.stringify({ u: utente, nome: u[1], ruolo: u[2] }), TOKEN_TTL);
  return { token: token, nome: u[1], ruolo: u[2] };
}
function sessione_(token) {
  var raw = token ? CacheService.getScriptCache().get('tok:' + token) : null;
  if (!raw) { var e = new Error('Session expired'); e.status = 401; throw e; }
  return JSON.parse(raw);
}

/* ---------- dati ---------- */
function chiaveValida_(k) { return /^[a-z]{2,12}(:[A-Za-z0-9_-]{1,40})?$/.test(k); }
function leggi_() {
  var v = shDati_().getDataRange().getValues(), out = {};
  for (var i = 1; i < v.length; i++) out[v[i][0]] = { v: v[i][1], json: v[i][2], by: v[i][3], ts: v[i][4], row: i + 1 };
  return out;
}
function apiLoadAll(ses) {
  var d = leggi_(), docs = {};
  for (var k in d) docs[k] = { v: d[k].v, json: d[k].json, by: d[k].by, ts: d[k].ts };
  return { docs: docs };
}
function apiPoll(ses, known) {
  var d = leggi_(), changed = {}, keys = [];
  known = known || {};
  for (var k in d) {
    keys.push(k);
    if (known[k] === undefined || known[k] !== d[k].v) changed[k] = { v: d[k].v, json: d[k].json, by: d[k].by, ts: d[k].ts };
  }
  return { changed: changed, keys: keys };
}
function apiSaveDoc(ses, key, json, baseV) {
  if (ses.ruolo === 'viewer') throw new Error('Read-only account');
  if (!chiaveValida_(key)) throw new Error('Invalid key');
  json = String(json);
  if (json.length > MAX_DOC) throw new Error('Document too large (' + json.length + ' characters)');
  JSON.parse(json); // deve essere JSON valido
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var d = leggi_(), cur = d[key], s = shDati_(), ts = ora_();
    if (cur && cur.v !== baseV) return { conflict: true, current: { v: cur.v, json: cur.json, by: cur.by, ts: cur.ts } };
    if (!cur && baseV) return { conflict: true, current: { v: 0, json: 'null', by: '(eliminato)', ts: ts } };
    var nv = (cur ? cur.v : 0) + 1, rec = [key, nv, json, ses.nome, ts];
    if (cur) s.getRange(cur.row, 1, 1, 5).setValues([rec]); else s.appendRow(rec);
    shStorico_().appendRow([ts, ses.nome, key, nv, 'salva', json]);
    return { v: nv, by: ses.nome, ts: ts };
  } finally { lock.releaseLock(); }
}
function apiDeleteDoc(ses, key, baseV) {
  if (ses.ruolo === 'viewer') throw new Error('Read-only account');
  if (!chiaveValida_(key)) throw new Error('Invalid key');
  var lock = LockService.getScriptLock(); lock.waitLock(20000);
  try {
    var cur = leggi_()[key];
    if (!cur) return { ok: true };
    if (cur.v !== baseV) return { conflict: true, current: { v: cur.v, json: cur.json, by: cur.by, ts: cur.ts } };
    shStorico_().appendRow([ora_(), ses.nome, key, cur.v, 'elimina', cur.json]); // contenuto recuperabile dallo Storico
    shDati_().deleteRow(cur.row);
    return { ok: true };
  } finally { lock.releaseLock(); }
}
function apiHistory(ses, n) {
  var s = shStorico_(), last = s.getLastRow(), from = Math.max(2, last - (n || 60) + 1), out = [];
  if (last < 2) return out;
  var v = s.getRange(from, 1, last - from + 1, 5).getValues();
  for (var i = v.length - 1; i >= 0; i--) out.push({ ts: String(v[i][0]), user: v[i][1], key: v[i][2], v: v[i][3], action: v[i][4] });
  return out;
}

/* ---------- ingresso HTTP ---------- */
var ROTTE = { apiLoadAll: apiLoadAll, apiPoll: apiPoll, apiSaveDoc: apiSaveDoc, apiDeleteDoc: apiDeleteDoc, apiHistory: apiHistory };
function risposta_(o) { return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON); }
function doGet() { return risposta_({ ok: true, servizio: 'ADLER costo prodotto' }); }
function doPost(e) {
  try {
    var r = JSON.parse(e.postData.contents), fn = r.fn, a = r.args || [];
    if (fn === 'apiLogin') return risposta_({ data: apiLogin(a[0], a[1]) });
    if (!ROTTE[fn]) throw new Error('Unknown function');
    var ses = sessione_(r.token);
    return risposta_({ data: ROTTE[fn].apply(null, [ses].concat(a)) });
  } catch (err) {
    return risposta_({ error: String(err.message || err), status: err.status || 400 });
  }
}
