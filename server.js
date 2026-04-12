// ELEVO DEPLOY CENTER v4.0 — deploy.elevo.solutions
const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

const PORT = process.env.PORT || 3000;
const COOLIFY_URL = process.env.COOLIFY_URL || 'http://159.195.37.216:8000';
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN || '';
const COOLIFY_SERVER_UUID = process.env.COOLIFY_SERVER_UUID || 'rg87l8f5009gy2yp665a2iyg';
const COOLIFY_PROJECT_UUID = process.env.COOLIFY_PROJECT_UUID || 'vqem6h43k3pimdxapypmz6hf';
const COOLIFY_DEST_UUID = process.env.COOLIFY_DEST_UUID || 'bona6q9oxd0j53n7c7jjttl6';
const GITHUB_APP_UUID = process.env.GITHUB_APP_UUID || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_ORG = process.env.GITHUB_ORG || 'elevo-business';
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY || '';
const DEPLOY_SECRET = process.env.DEPLOY_SECRET || '';
const PIPEDRIVE_API_KEY = process.env.PIPEDRIVE_API_KEY || '';
const PIPEDRIVE_OUTREACH_FIELD = process.env.PIPEDRIVE_OUTREACH_FIELD || '';
const PIPEDRIVE_OUTREACH_VALUE = process.env.PIPEDRIVE_OUTREACH_VALUE || '';

let ghAppUuid = GITHUB_APP_UUID;

// ═══ DATA ═══
const DATA_DIR = path.join(__dirname, 'data');
const PROSPECTS_FILE = path.join(DATA_DIR, 'prospects.json');
function ensureDataDir() { if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true }); if (!fs.existsSync(PROSPECTS_FILE)) fs.writeFileSync(PROSPECTS_FILE, '[]', 'utf8'); }
ensureDataDir();
function loadProspects() { try { return JSON.parse(fs.readFileSync(PROSPECTS_FILE, 'utf8')); } catch (e) { return []; } }
function saveProspects(data) { fs.writeFileSync(PROSPECTS_FILE, JSON.stringify(data, null, 2), 'utf8'); }

// ═══ HELPERS ═══
function json(res, s, d) { res.writeHead(s, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' }); res.end(JSON.stringify(d)); }
function parseBody(req) { return new Promise((r, j) => { let b = ''; req.on('data', c => { b += c; if (b.length > 10e6) { req.destroy(); j(new Error('too large')); } }); req.on('end', () => { try { r(JSON.parse(b)); } catch (e) { j(e); } }); req.on('error', j); }); }
function toSlug(n) { return n.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function checkAuth(req) { if (!DEPLOY_SECRET) return true; const a = req.headers.authorization; if (a === `Bearer ${DEPLOY_SECRET}`) return true; const u = new URL(req.url, `http://${req.headers.host}`); if (u.searchParams.get('token') === DEPLOY_SECRET) return true; const c = req.headers.cookie || ''; const m = c.match(/deploy_token=([^;]+)/); if (m && m[1] === DEPLOY_SECRET) return true; return false; }
function httpReq(transport, opts, payload) { return new Promise((resolve, reject) => { const req = transport.request(opts, res => { let body = ''; res.on('data', c => body += c); res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(body) }); } catch (e) { resolve({ status: res.statusCode, data: body }); } }); }); req.on('error', reject); if (payload) req.write(payload); req.end(); }); }
function coolify(method, p, data) { const url = new URL(`${COOLIFY_URL}/api/v1${p}`); const t = url.protocol === 'https:' ? https : http; const payload = data ? JSON.stringify(data) : null; const opts = { hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname + url.search, method, headers: { 'Authorization': `Bearer ${COOLIFY_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/json' } }; if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload); return httpReq(t, opts, payload); }
function github(method, p, data) { const payload = data ? JSON.stringify(data) : null; const opts = { hostname: 'api.github.com', port: 443, path: p, method, headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'ELEVO/4', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' } }; if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload); return httpReq(https, opts, payload); }
function claude(messages, system) { const payload = JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 16000, system, messages }); const opts = { hostname: 'api.anthropic.com', port: 443, path: '/v1/messages', method: 'POST', headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } }; return httpReq(https, opts, payload); }
function pipedrive(method, endpoint, data) { const url = new URL(`https://api.pipedrive.com/v1${endpoint}`); url.searchParams.set('api_token', PIPEDRIVE_API_KEY); const payload = data ? JSON.stringify(data) : null; const opts = { hostname: url.hostname, port: 443, path: url.pathname + url.search, method, headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } }; if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload); return httpReq(https, opts, payload); }
async function detectGHApp() { if (ghAppUuid) return ghAppUuid; try { const r = await coolify('GET', '/github-apps'); if (r.status === 200 && Array.isArray(r.data) && r.data.length) ghAppUuid = r.data[0].uuid; } catch (e) {} return ghAppUuid; }

// ═══ CSV ═══
function parseCSV(text) {
  const lines = text.trim().split(/\r?\n/).filter(l => l.trim());
  if (lines.length < 2) return [];
  const sep = (lines[0].match(/;/g) || []).length >= (lines[0].match(/,/g) || []).length ? ';' : ',';
  const headers = csvLine(lines[0], sep).map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
  return lines.slice(1).map(line => { const v = csvLine(line, sep); const o = {}; headers.forEach((h, i) => o[h] = (v[i] || '').trim().replace(/^["']|["']$/g, '')); return o; });
}
function csvLine(line, sep) { const r = []; let c = '', q = false; for (const ch of line) { if (ch === '"') { q = !q; continue; } if (ch === sep && !q) { r.push(c); c = ''; continue; } c += ch; } r.push(c); return r; }
function mapCSV(row) {
  const g = (...k) => { for (const x of k) if (row[x]) return row[x]; return ''; };
  return { name: g('name', 'firma', 'firmenname', 'company', 'unternehmen'), url: g('url', 'website', 'domain', 'webseite', 'homepage'), email: g('email', 'e-mail', 'mail'), contact: g('kontakt', 'ansprechpartner', 'contact', 'person'), branch: g('branche', 'branch', 'kategorie'), score: parseInt(g('score', 'punkte')) || 0, anrede: g('anrede') || 'Sie', notes: g('notizen', 'notes', 'kommentar') };
}

// ═══ MAIL ═══
const SIGNATURE = '—\nTermin buchen: https://termin.elevo.solutions\n\nViele Grüße\nMert von ELEVO\nelevo.solutions';

function generateMail(prospect) {
  const du = (prospect.anrede || 'Sie') === 'du';
  const name = prospect.contact || prospect.name;
  const first = name.split(' ')[0];
  const domain = (prospect.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const preview = `https://${prospect.slug}-preview.elevo.solutions`;
  const subject = domain || prospect.name;
  const body = du
    ? `Hallo ${first},\n\nwir haben uns ${domain} angeschaut und einen Entwurf gebaut, der zeigt, was möglich wäre:\n\n${preview}\n\nFalls es dich interessiert — 15 Minuten reichen für einen ersten Eindruck.\nKein Pitch. Wenn es nicht passt, hat niemand etwas verloren.`
    : `Guten Tag ${name},\n\nwir haben uns ${domain} angeschaut und einen Entwurf gebaut, der zeigt, was möglich wäre:\n\n${preview}\n\nFalls es Sie interessiert — 15 Minuten reichen für einen ersten Eindruck.\nKein Pitch. Wenn es am Ende nicht passt, hat niemand etwas verloren.`;
  return { subject, body, signature: SIGNATURE, to: prospect.email };
}

const SYS_PROMPT = `Du bist der kreative Direktor von ELEVO Solutions. Du baust Preview-Websites für Cold Outreach. Eine einzige HTML-Datei, alles inline. Google Fonts, responsive, min 700 Zeilen. Signature Feature, Kontakt = Letzte Seite. Originalbilder übernehmen. OUTPUT: NUR HTML. Kein Kommentar.`;

// ═══ SERVER ═══
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' }); return res.end(); }
  const url = new URL(req.url, `http://${req.headers.host}`); const p = url.pathname;

  if (p === '/' || p === '/index.html') {
    if (DEPLOY_SECRET) { const c = req.headers.cookie || ''; const m = c.match(/deploy_token=([^;]+)/); if (!m || m[1] !== DEPLOY_SECRET) { try { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(__dirname, 'public', 'login.html'), 'utf8')); } catch (e) { return json(res, 401, { error: 'Login required' }); } } }
    res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'));
  }
  if (p === '/api/login' && req.method === 'POST') { const b = await parseBody(req); if (b.token === DEPLOY_SECRET || !DEPLOY_SECRET) { res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `deploy_token=${DEPLOY_SECRET};Path=/;HttpOnly;SameSite=Strict;Max-Age=2592000` }); return res.end('{"success":true}'); } return json(res, 401, { error: 'Wrong' }); }
  if (p.startsWith('/api/') && p !== '/api/login' && !checkAuth(req)) return json(res, 401, { error: 'Unauthorized' });

  try {
    if (p === '/api/config') return json(res, 200, { coolify: !!COOLIFY_TOKEN, github: !!GITHUB_TOKEN, anthropic: !!ANTHROPIC_API_KEY, pipedrive: !!PIPEDRIVE_API_KEY, outreachField: !!PIPEDRIVE_OUTREACH_FIELD });

    // ═══ DASHBOARD ═══
    if (p === '/api/dashboard') {
      const prospects = loadProspects();
      const local = { total: prospects.length, neu: 0, preview: 0, mail: 0, followup: 0, termin: 0, skip: 0 };
      prospects.forEach(pr => local[pr.status] = (local[pr.status] || 0) + 1);

      let pd = { persons: 0, activities: [], synced: false };
      if (PIPEDRIVE_API_KEY) {
        try {
          const pR = await pipedrive('GET', '/persons?limit=100&sort=add_time%20DESC');
          if (pR.status === 200 && pR.data?.data) {
            pd.persons = pR.data.data.length; pd.synced = true;
            if (PIPEDRIVE_OUTREACH_FIELD) {
              for (const person of pR.data.data) {
                const email = person.primary_email || person.email?.[0]?.value || '';
                if (!email) continue;
                const idx = prospects.findIndex(pr => pr.email?.toLowerCase() === email.toLowerCase());
                if (idx >= 0) { prospects[idx].pipedrivePersonId = person.id; prospects[idx].pipedriveStatus = person[PIPEDRIVE_OUTREACH_FIELD] || null; }
              }
              saveProspects(prospects);
            }
          }
          const aR = await pipedrive('GET', '/activities?limit=15&done=0&sort=due_date%20ASC');
          if (aR.status === 200 && aR.data?.data) {
            pd.activities = aR.data.data.map(a => ({ id: a.id, subject: a.subject, type: a.type, due_date: a.due_date, person_name: a.person_name, overdue: a.due_date < new Date().toISOString().split('T')[0] }));
          }
        } catch (e) { pd.error = e.message; }
      }

      const actions = [];
      const readyMail = prospects.filter(pr => pr.status === 'preview' && pr.email);
      const needPrev = prospects.filter(pr => pr.status === 'neu');
      const needFU = prospects.filter(pr => pr.status === 'mail' && pr.mailSent && (Date.now() - new Date(pr.mailSent)) > 3 * 86400000);
      if (needPrev.length) actions.push({ type: 'preview', count: needPrev.length, label: `${needPrev.length} Preview${needPrev.length > 1 ? 's' : ''} bauen` });
      if (readyMail.length) actions.push({ type: 'mail', count: readyMail.length, label: `${readyMail.length} Mail${readyMail.length > 1 ? 's' : ''} senden` });
      if (needFU.length) actions.push({ type: 'followup', count: needFU.length, label: `${needFU.length} Follow-up${needFU.length > 1 ? 's' : ''} fällig` });

      return json(res, 200, { local, pipedrive: pd, actions });
    }

    // ═══ PROSPECTS ═══
    if (p === '/api/prospects' && req.method === 'GET') return json(res, 200, { prospects: loadProspects() });

    if (p === '/api/prospect' && req.method === 'POST') {
      const b = await parseBody(req); if (!b.name) return json(res, 400, { error: 'Name fehlt' });
      const prospects = loadProspects(); const slug = toSlug(b.name);
      if (prospects.find(x => x.slug === slug)) return json(res, 409, { error: 'Existiert bereits' });
      const pr = { slug, name: b.name, url: b.url || '', email: b.email || '', contact: b.contact || '', branch: b.branch || '', anrede: b.anrede || 'Sie', status: 'neu', score: b.score || 0, notes: b.notes || '', preview: `${slug}-preview.elevo.solutions`, mailSent: null, mailText: null, pipedrivePersonId: null, pipedriveStatus: null, created: new Date().toISOString(), updated: new Date().toISOString() };
      prospects.push(pr); saveProspects(prospects);
      return json(res, 201, { success: true, prospect: pr });
    }

    if (p === '/api/prospects/import' && req.method === 'POST') {
      const b = await parseBody(req); if (!b.csv) return json(res, 400, { error: 'csv fehlt' });
      const rows = parseCSV(b.csv); if (!rows.length) return json(res, 400, { error: 'Keine Daten' });
      const prospects = loadProspects(); let imported = 0, skipped = 0;
      for (const row of rows) {
        const m = mapCSV(row); if (!m.name) { skipped++; continue; }
        const slug = toSlug(m.name);
        if (prospects.find(x => x.slug === slug)) { skipped++; continue; }
        prospects.push({ slug, ...m, status: 'neu', preview: `${slug}-preview.elevo.solutions`, mailSent: null, mailText: null, pipedrivePersonId: null, pipedriveStatus: null, created: new Date().toISOString(), updated: new Date().toISOString() });
        imported++;
      }
      saveProspects(prospects);
      return json(res, 200, { success: true, imported, skipped, total: rows.length });
    }

    const slugMatch = p.match(/^\/api\/prospect\/([a-z0-9-]+)$/);
    if (slugMatch && req.method === 'PUT') {
      const slug = slugMatch[1]; const b = await parseBody(req); const prospects = loadProspects();
      const idx = prospects.findIndex(x => x.slug === slug); if (idx < 0) return json(res, 404, { error: 'Nicht gefunden' });
      ['name', 'url', 'email', 'contact', 'branch', 'anrede', 'status', 'score', 'notes'].forEach(k => { if (b[k] !== undefined) prospects[idx][k] = b[k]; });
      prospects[idx].updated = new Date().toISOString(); saveProspects(prospects);
      return json(res, 200, { success: true, prospect: prospects[idx] });
    }
    if (slugMatch && req.method === 'DELETE') {
      const slug = slugMatch[1]; let prospects = loadProspects(); const n = prospects.length;
      prospects = prospects.filter(x => x.slug !== slug); if (prospects.length === n) return json(res, 404, { error: 'Nicht gefunden' });
      saveProspects(prospects); return json(res, 200, { success: true });
    }

    const statusMatch = p.match(/^\/api\/prospect\/([a-z0-9-]+)\/status$/);
    if (statusMatch && req.method === 'POST') {
      const b = await parseBody(req); const valid = ['neu', 'preview', 'mail', 'followup', 'termin', 'skip'];
      if (!valid.includes(b.status)) return json(res, 400, { error: 'Ungültiger Status' });
      const prospects = loadProspects(); const idx = prospects.findIndex(x => x.slug === statusMatch[1]);
      if (idx < 0) return json(res, 404, { error: 'Nicht gefunden' });
      prospects[idx].status = b.status; prospects[idx].updated = new Date().toISOString(); saveProspects(prospects);
      return json(res, 200, { success: true });
    }

    const mailGen = p.match(/^\/api\/prospect\/([a-z0-9-]+)\/mail-generate$/);
    if (mailGen && req.method === 'GET') {
      const pr = loadProspects().find(x => x.slug === mailGen[1]);
      if (!pr) return json(res, 404, { error: 'Nicht gefunden' });
      if (!pr.email) return json(res, 400, { error: 'Keine E-Mail' });
      return json(res, 200, { success: true, mail: generateMail(pr) });
    }

    // Send mail via Pipedrive
    const sendMatch = p.match(/^\/api\/prospect\/([a-z0-9-]+)\/send-mail$/);
    if (sendMatch && req.method === 'POST') {
      if (!PIPEDRIVE_API_KEY) return json(res, 500, { error: 'PIPEDRIVE_API_KEY fehlt' });
      const b = await parseBody(req).catch(() => ({}));
      const prospects = loadProspects(); const idx = prospects.findIndex(x => x.slug === sendMatch[1]);
      if (idx < 0) return json(res, 404, { error: 'Nicht gefunden' });
      const prospect = prospects[idx]; if (!prospect.email) return json(res, 400, { error: 'Keine E-Mail' });

      const gen = generateMail(prospect);
      const subject = b.subject || gen.subject;
      const body = b.body || gen.body;
      const full = body + '\n\n' + SIGNATURE;
      const steps = [];

      // Person
      let pid = prospect.pipedrivePersonId || null;
      if (!pid) {
        const pd = { name: prospect.contact || prospect.name, email: [{ value: prospect.email, primary: true }] };
        if (PIPEDRIVE_OUTREACH_FIELD && PIPEDRIVE_OUTREACH_VALUE) pd[PIPEDRIVE_OUTREACH_FIELD] = PIPEDRIVE_OUTREACH_VALUE;
        const r = await pipedrive('POST', '/persons', pd);
        if (r.status !== 201 && r.status !== 200) return json(res, 500, { error: 'Person fehlgeschlagen', details: r.data });
        pid = r.data?.data?.id; steps.push('person');
      } else if (PIPEDRIVE_OUTREACH_FIELD && PIPEDRIVE_OUTREACH_VALUE) {
        await pipedrive('PUT', `/persons/${pid}`, { [PIPEDRIVE_OUTREACH_FIELD]: PIPEDRIVE_OUTREACH_VALUE }); steps.push('status');
      }

      // Mail
      const html = full.replace(/\n/g, '<br>').replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1">$1</a>');
      const mR = await pipedrive('POST', '/mailbox/mailMessages', { subject, body: html, to: [{ email: prospect.email, name: prospect.contact || prospect.name }] });
      if (mR.status !== 200 && mR.status !== 201) {
        prospects[idx].pipedrivePersonId = pid; prospects[idx].updated = new Date().toISOString(); saveProspects(prospects);
        return json(res, 500, { error: 'Mail fehlgeschlagen. E-Mail-Sync aktiv?', details: mR.data, pid, steps });
      }
      steps.push('mail');

      // Activity
      const aR = await pipedrive('POST', '/activities', { subject: `Cold Mail: ${prospect.name}`, type: 'email', done: 1, person_id: pid, note: `Preview: https://${prospect.preview}\n\n${full}` });
      if (aR.status === 200 || aR.status === 201) steps.push('activity');

      prospects[idx].pipedrivePersonId = pid; prospects[idx].mailSent = new Date().toISOString();
      prospects[idx].mailText = full; prospects[idx].status = 'mail'; prospects[idx].updated = new Date().toISOString();
      saveProspects(prospects);
      return json(res, 200, { success: true, pid, steps });
    }

    // Manual mail-sent
    const mSent = p.match(/^\/api\/prospect\/([a-z0-9-]+)\/mail-sent$/);
    if (mSent && req.method === 'POST') {
      const b = await parseBody(req).catch(() => ({})); const prospects = loadProspects();
      const idx = prospects.findIndex(x => x.slug === mSent[1]); if (idx < 0) return json(res, 404, { error: 'Nicht gefunden' });
      prospects[idx].mailSent = new Date().toISOString(); prospects[idx].mailText = b.mailText || null;
      prospects[idx].status = 'mail'; prospects[idx].updated = new Date().toISOString(); saveProspects(prospects);
      return json(res, 200, { success: true });
    }

    // Pipedrive fields
    if (p === '/api/pipedrive/person-fields') {
      if (!PIPEDRIVE_API_KEY) return json(res, 500, { error: 'Key fehlt' });
      const r = await pipedrive('GET', '/personFields');
      if (r.status === 200 && r.data?.data) return json(res, 200, { fields: r.data.data.filter(f => f.edit_flag).map(f => ({ key: f.key, name: f.name, type: f.field_type, options: f.options })), config: { field: PIPEDRIVE_OUTREACH_FIELD || '–', value: PIPEDRIVE_OUTREACH_VALUE || '–' } });
      return json(res, 500, { error: 'Fehlgeschlagen' });
    }

    // Pipedrive sync
    if (p === '/api/pipedrive/sync') {
      if (!PIPEDRIVE_API_KEY) return json(res, 500, { error: 'Key fehlt' });
      const prospects = loadProspects();
      const pR = await pipedrive('GET', '/persons?limit=200&sort=add_time%20DESC');
      if (pR.status !== 200 || !pR.data?.data) return json(res, 500, { error: 'Abruf fehlgeschlagen' });
      let synced = 0;
      for (const person of pR.data.data) {
        const email = person.primary_email || person.email?.[0]?.value || '';
        if (!email) continue;
        const idx = prospects.findIndex(pr => pr.email?.toLowerCase() === email.toLowerCase());
        if (idx >= 0) { prospects[idx].pipedrivePersonId = person.id; if (PIPEDRIVE_OUTREACH_FIELD) prospects[idx].pipedriveStatus = person[PIPEDRIVE_OUTREACH_FIELD] || null; synced++; }
      }
      saveProspects(prospects);
      return json(res, 200, { success: true, synced, total: pR.data.data.length });
    }

    // ═══ APPS + DEPLOY ═══
    if (p === '/api/apps') { const r = await coolify('GET', '/applications'); return json(res, 200, { apps: (Array.isArray(r.data) ? r.data : []).map(a => ({ uuid: a.uuid, name: a.name, fqdn: a.fqdn, status: a.status, git_repository: a.git_repository, environment_id: a.environment_id, created_at: a.created_at })) }); }

    if (p === '/api/build' && req.method === 'POST') { const b = await parseBody(req); if (!b.url && !b.prompt) return json(res, 400, { error: 'url/prompt fehlt' }); if (!ANTHROPIC_API_KEY) return json(res, 500, { error: 'Key fehlt' }); const r = await claude([{ role: 'user', content: b.url ? `Baue Preview für: ${b.url}\n${b.prompt || ''}` : b.prompt }], SYS_PROMPT); if (r.status === 200 && r.data.content) return json(res, 200, { success: true, html: r.data.content.map(c => c.text || '').join('') }); return json(res, 500, { error: 'Claude failed' }); }

    if (p === '/api/deploy-full' && req.method === 'POST') {
      const b = await parseBody(req); if (!b.name || !b.html) return json(res, 400, { error: 'name+html' });
      const slug = toSlug(b.name), repo = `${slug}-preview`;
      const rR = await github('POST', '/user/repos', { name: repo, description: `Preview ${b.name}`, private: true, auto_init: true });
      const exists = rR.status === 422; if (!exists && rR.status !== 201) return json(res, 500, { error: 'Repo failed' });
      if (!exists) await new Promise(r => setTimeout(r, 2500));
      let sha = null; if (exists) { const ex = await github('GET', `/repos/${GITHUB_ORG}/${repo}/contents/index.html`); sha = ex.data?.sha || null; }
      const pp = { message: sha ? 'Update' : 'Initial', content: Buffer.from(b.html).toString('base64'), branch: 'main' }; if (sha) pp.sha = sha;
      let pR = await github('PUT', `/repos/${GITHUB_ORG}/${repo}/contents/index.html`, pp);
      if (pR.status === 409 || pR.status === 422) { const re = await github('GET', `/repos/${GITHUB_ORG}/${repo}/contents/index.html`); if (re.data?.sha) { pp.sha = re.data.sha; pR = await github('PUT', `/repos/${GITHUB_ORG}/${repo}/contents/index.html`, pp); } }
      if (pR.status !== 200 && pR.status !== 201) return json(res, 500, { error: 'Push failed' });
      const aR = await coolify('GET', '/applications'); const ex = Array.isArray(aR.data) ? aR.data.find(a => a.git_repository === `${GITHUB_ORG}/${repo}`) : null;
      if (ex) { await coolify('GET', `/applications/${ex.uuid}/restart`); return json(res, 200, { success: true, action: 'updated', uuid: ex.uuid, domain: ex.fqdn }); }
      const ga = await detectGHApp(); if (!ga) return json(res, 500, { error: 'GH App fehlt' });
      const domain = `https://${slug}-preview.elevo.solutions`;
      const cR = await coolify('POST', '/applications/private-github-app', { project_uuid: COOLIFY_PROJECT_UUID, server_uuid: COOLIFY_SERVER_UUID, environment_name: 'production', github_app_uuid: ga, destination_uuid: COOLIFY_DEST_UUID, git_repository: `${GITHUB_ORG}/${repo}`, git_branch: 'main', build_pack: 'static', ports_exposes: '80', domains: domain, name: `${slug}-preview`, instant_deploy: true, is_static: true });
      if (cR.status === 201 || cR.status === 200) return json(res, 201, { success: true, action: 'created', uuid: cR.data.uuid, domain });
      return json(res, 500, { error: 'Coolify failed' });
    }

    const dM = p.match(/^\/api\/deploy\/(.+)$/); if (dM) { await coolify('GET', `/applications/${dM[1]}/restart`); return json(res, 200, { success: true }); }
    const cM = p.match(/^\/api\/code\/(.+)$/);
    if (cM && req.method === 'GET') { const r = await github('GET', `/repos/${GITHUB_ORG}/${decodeURIComponent(cM[1])}/contents/index.html`); if (r.status === 200 && r.data?.content) return json(res, 200, { success: true, html: Buffer.from(r.data.content, 'base64').toString('utf8'), sha: r.data.sha }); return json(res, 404, { error: 'Nicht gefunden' }); }
    if (cM && req.method === 'POST') { const repo = decodeURIComponent(cM[1]); const b = await parseBody(req); const ex = await github('GET', `/repos/${GITHUB_ORG}/${repo}/contents/index.html`); const pp = { message: 'Update', content: Buffer.from(b.html).toString('base64'), branch: 'main' }; if (ex.data?.sha) pp.sha = ex.data.sha; const pR = await github('PUT', `/repos/${GITHUB_ORG}/${repo}/contents/index.html`, pp); if (pR.status !== 200 && pR.status !== 201) return json(res, 500, { error: 'Push failed' }); const aR = await coolify('GET', '/applications'); const app = Array.isArray(aR.data) ? aR.data.find(a => a.git_repository?.includes(repo)) : null; if (app) await coolify('GET', `/applications/${app.uuid}/restart`); return json(res, 200, { success: true }); }
    const delM = p.match(/^\/api\/app\/(.+)$/); if (delM && req.method === 'DELETE') { await coolify('DELETE', `/applications/${delM[1]}`); return json(res, 200, { success: true }); }

    json(res, 404, { error: 'Not found' });
  } catch (e) { console.error(e); json(res, 500, { error: e.message }); }
});

server.listen(PORT, async () => { console.log(`\n  ELEVO v4.0 | :${PORT} | PD:${PIPEDRIVE_API_KEY ? '✓' : '✗'} | CF:${COOLIFY_TOKEN ? '✓' : '✗'}\n`); await detectGHApp(); });
