// ELEVO DEPLOY CENTER v3.0 — deploy.elevo.solutions
// Tabs: Deploy | Apps | Outreach
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

let ghAppUuid = GITHUB_APP_UUID;

// ═══ DATA DIRECTORY ═══
const DATA_DIR = path.join(__dirname, 'data');
const PROSPECTS_FILE = path.join(DATA_DIR, 'prospects.json');

function ensureDataDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(PROSPECTS_FILE)) fs.writeFileSync(PROSPECTS_FILE, '[]', 'utf8');
}
ensureDataDir();

function loadProspects() {
  try { return JSON.parse(fs.readFileSync(PROSPECTS_FILE, 'utf8')); } catch (e) { return []; }
}
function saveProspects(data) {
  fs.writeFileSync(PROSPECTS_FILE, JSON.stringify(data, null, 2), 'utf8');
}

// ═══ HELPERS ═══
function json(res, s, d) { res.writeHead(s, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' }); res.end(JSON.stringify(d)); }
function parseBody(req) { return new Promise((r, j) => { let b = ''; req.on('data', c => { b += c; if (b.length > 10e6) { req.destroy(); j(new Error('too large')); } }); req.on('end', () => { try { r(JSON.parse(b)); } catch (e) { j(e); } }); req.on('error', j); }); }
function toSlug(n) { return n.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''); }
function checkAuth(req) {
  if (!DEPLOY_SECRET) return true;
  const a = req.headers.authorization; if (a === `Bearer ${DEPLOY_SECRET}`) return true;
  const u = new URL(req.url, `http://${req.headers.host}`); if (u.searchParams.get('token') === DEPLOY_SECRET) return true;
  const c = req.headers.cookie || ''; const m = c.match(/deploy_token=([^;]+)/); if (m && m[1] === DEPLOY_SECRET) return true;
  return false;
}

function httpReq(transport, opts, payload) {
  return new Promise((resolve, reject) => {
    const req = transport.request(opts, res => {
      let body = ''; res.on('data', c => body += c);
      res.on('end', () => { try { resolve({ status: res.statusCode, data: JSON.parse(body) }); } catch (e) { resolve({ status: res.statusCode, data: body }); } });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function coolify(method, p, data) {
  const url = new URL(`${COOLIFY_URL}/api/v1${p}`);
  const t = url.protocol === 'https:' ? https : http;
  const payload = data ? JSON.stringify(data) : null;
  const opts = { hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80), path: url.pathname + url.search, method, headers: { 'Authorization': `Bearer ${COOLIFY_TOKEN}`, 'Content-Type': 'application/json', 'Accept': 'application/json' } };
  if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
  return httpReq(t, opts, payload);
}

function github(method, p, data) {
  const payload = data ? JSON.stringify(data) : null;
  const opts = { hostname: 'api.github.com', port: 443, path: p, method, headers: { 'Authorization': `Bearer ${GITHUB_TOKEN}`, 'Accept': 'application/vnd.github+json', 'User-Agent': 'ELEVO/3', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' } };
  if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
  return httpReq(https, opts, payload);
}

function claude(messages, system) {
  const payload = JSON.stringify({ model: 'claude-sonnet-4-20250514', max_tokens: 16000, system, messages });
  const opts = { hostname: 'api.anthropic.com', port: 443, path: '/v1/messages', method: 'POST', headers: { 'x-api-key': ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } };
  return httpReq(https, opts, payload);
}

// ═══ PIPEDRIVE ═══
function pipedrive(method, endpoint, data) {
  const url = new URL(`https://api.pipedrive.com/v1${endpoint}`);
  url.searchParams.set('api_token', PIPEDRIVE_API_KEY);
  const payload = data ? JSON.stringify(data) : null;
  const opts = { hostname: url.hostname, port: 443, path: url.pathname + url.search, method, headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' } };
  if (payload) opts.headers['Content-Length'] = Buffer.byteLength(payload);
  return httpReq(https, opts, payload);
}

async function detectGHApp() {
  if (ghAppUuid) return ghAppUuid;
  try { const r = await coolify('GET', '/github-apps'); if (r.status === 200 && Array.isArray(r.data) && r.data.length) { ghAppUuid = r.data[0].uuid; console.log('[INIT] GH App:', ghAppUuid); } } catch (e) { console.log('[INIT] GH detect fail:', e.message); }
  return ghAppUuid;
}

// ═══ COLD MAIL TEMPLATE (v7) ═══
function generateMail(prospect) {
  const anrede = prospect.anrede || 'Sie';
  const du = anrede === 'du';
  const name = prospect.contact || prospect.name;
  const firstName = name.split(' ')[0];
  const domain = (prospect.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '');
  const previewUrl = `https://${prospect.slug}-preview.elevo.solutions`;
  const bookingUrl = 'https://termin.elevo.solutions';

  const subject = domain || prospect.name;

  let body;
  if (du) {
    body = `Hallo ${firstName},

wir haben uns ${domain} angeschaut und einen Entwurf gebaut, der zeigt, was möglich wäre:

${previewUrl}

Falls es dich interessiert — 15 Minuten reichen für einen ersten Eindruck:
${bookingUrl}

Kein Pitch. Wenn es nicht passt, hat niemand etwas verloren.

Viele Grüße
Mert von ELEVO`;
  } else {
    body = `Guten Tag ${name},

wir haben uns ${domain} angeschaut und einen Entwurf gebaut, der zeigt, was möglich wäre:

${previewUrl}

Falls es Sie interessiert — 15 Minuten reichen für einen ersten Eindruck:
${bookingUrl}

Kein Pitch. Wenn es am Ende nicht passt, hat niemand etwas verloren.

Viele Grüße
Mert von ELEVO`;
  }

  return { subject, body, to: prospect.email };
}

const SYSTEM_PROMPT = `Du bist der kreative Direktor von ELEVO Solutions — einer Boutique-Digitalagentur. Du baust Preview-Websites für Cold Outreach.

AUFGABE: Wenn dir eine URL gegeben wird, analysiere die bestehende Website und baue eine BESSERE Version. Übernimm Logo, Farben, Fonts, Bilder, gute Texte. Elevate das Branding.

TECHNISCHE REGELN:
- Eine einzige HTML-Datei, alles inline (CSS im <style>, JS im <script>)
- Google Fonts via <link>, Lucide via unpkg CDN
- Responsive (900px + 600px Breakpoints)
- Min 700 Zeilen, deployfertig
- Web3Forms Key: 28d113b8-4c7a-48c7-b10c-eabbc0f0c1d8
- Signature Feature: 1x interaktives konvertierendes Element
- Hero Word-by-Word Reveal, Animated Counters, Scroll Reveals, Staggered Animations
- Kontakt = "Letzte Seite" mit emotionalem CTA
- Impressum + Datenschutz als Modals, Cookie Banner
- Schema.org, scrollRestoration manual, 16px Inputs Mobile
- Headline Safety CSS (word-spacing normal, kein flex auf Headlines)
- KEINE generischen Stockphotos, KEINE AI-Bilder
- Originalbilder von der bestehenden Website übernehmen
- KEIN "Baukasten", KEIN "Template", KEINE Toolnamen

TONALITÄT: Du-Ansprache (oder Sie wenn der Prospect formal ist), seriös aber menschlich, kurz & kraftvoll.

OUTPUT: NUR die komplette HTML-Datei. Kein Kommentar. Nur Code.`;

// ═══ SERVER ═══
const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Methods': 'GET,POST,PUT,DELETE,OPTIONS', 'Access-Control-Allow-Headers': 'Content-Type,Authorization' }); return res.end(); }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  // Serve frontend
  if (p === '/' || p === '/index.html') {
    if (DEPLOY_SECRET) { const c = req.headers.cookie || ''; const m = c.match(/deploy_token=([^;]+)/); if (!m || m[1] !== DEPLOY_SECRET) { res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(__dirname, 'public', 'login.html'), 'utf8')); } }
    res.writeHead(200, { 'Content-Type': 'text/html' }); return res.end(fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8'));
  }

  // Login
  if (p === '/api/login' && req.method === 'POST') { const b = await parseBody(req); if (b.token === DEPLOY_SECRET || !DEPLOY_SECRET) { res.writeHead(200, { 'Content-Type': 'application/json', 'Set-Cookie': `deploy_token=${DEPLOY_SECRET};Path=/;HttpOnly;SameSite=Strict;Max-Age=2592000` }); return res.end('{"success":true}'); } return json(res, 401, { error: 'Wrong token' }); }

  // Auth
  if (p.startsWith('/api/') && p !== '/api/login' && !checkAuth(req)) return json(res, 401, { error: 'Unauthorized' });

  try {
    // Config
    if (p === '/api/config') return json(res, 200, { coolify: !!COOLIFY_TOKEN, github: !!GITHUB_TOKEN, anthropic: !!ANTHROPIC_API_KEY, pipedrive: !!PIPEDRIVE_API_KEY, ghApp: ghAppUuid || 'pending' });

    // ═══ PROSPECT ROUTES ═══

    // List all prospects
    if (p === '/api/prospects' && req.method === 'GET') {
      const prospects = loadProspects();
      return json(res, 200, { count: prospects.length, prospects });
    }

    // Create prospect
    if (p === '/api/prospect' && req.method === 'POST') {
      const b = await parseBody(req);
      if (!b.name) return json(res, 400, { error: 'Name fehlt' });
      const prospects = loadProspects();
      const slug = toSlug(b.name);
      if (prospects.find(p => p.slug === slug)) return json(res, 409, { error: 'Prospect existiert bereits' });
      const prospect = {
        slug,
        name: b.name,
        url: b.url || '',
        email: b.email || '',
        contact: b.contact || '',
        branch: b.branch || '',
        anrede: b.anrede || 'Sie',
        status: 'neu',
        score: b.score || 0,
        notes: b.notes || '',
        preview: `${slug}-preview.elevo.solutions`,
        mailSent: null,
        mailText: null,
        pipedriveId: null,
        created: new Date().toISOString(),
        updated: new Date().toISOString()
      };
      prospects.push(prospect);
      saveProspects(prospects);
      return json(res, 201, { success: true, prospect });
    }

    // Update prospect
    const putMatch = p.match(/^\/api\/prospect\/([a-z0-9-]+)$/);
    if (putMatch && req.method === 'PUT') {
      const slug = putMatch[1];
      const b = await parseBody(req);
      const prospects = loadProspects();
      const idx = prospects.findIndex(p => p.slug === slug);
      if (idx === -1) return json(res, 404, { error: 'Nicht gefunden' });
      const allowed = ['name', 'url', 'email', 'contact', 'branch', 'anrede', 'status', 'score', 'notes'];
      allowed.forEach(k => { if (b[k] !== undefined) prospects[idx][k] = b[k]; });
      prospects[idx].updated = new Date().toISOString();
      saveProspects(prospects);
      return json(res, 200, { success: true, prospect: prospects[idx] });
    }

    // Delete prospect
    if (putMatch && req.method === 'DELETE') {
      const slug = putMatch[1];
      let prospects = loadProspects();
      const before = prospects.length;
      prospects = prospects.filter(p => p.slug !== slug);
      if (prospects.length === before) return json(res, 404, { error: 'Nicht gefunden' });
      saveProspects(prospects);
      return json(res, 200, { success: true });
    }

    // Update prospect status
    const statusMatch = p.match(/^\/api\/prospect\/([a-z0-9-]+)\/status$/);
    if (statusMatch && req.method === 'POST') {
      const slug = statusMatch[1];
      const b = await parseBody(req);
      if (!b.status) return json(res, 400, { error: 'Status fehlt' });
      const valid = ['neu', 'preview', 'mail', 'followup', 'termin', 'skip'];
      if (!valid.includes(b.status)) return json(res, 400, { error: 'Ungültiger Status: ' + valid.join(', ') });
      const prospects = loadProspects();
      const idx = prospects.findIndex(p => p.slug === slug);
      if (idx === -1) return json(res, 404, { error: 'Nicht gefunden' });
      prospects[idx].status = b.status;
      prospects[idx].updated = new Date().toISOString();
      saveProspects(prospects);
      return json(res, 200, { success: true, prospect: prospects[idx] });
    }

    // Generate mail for prospect
    const mailGenMatch = p.match(/^\/api\/prospect\/([a-z0-9-]+)\/mail-generate$/);
    if (mailGenMatch && req.method === 'GET') {
      const slug = mailGenMatch[1];
      const prospects = loadProspects();
      const prospect = prospects.find(p => p.slug === slug);
      if (!prospect) return json(res, 404, { error: 'Nicht gefunden' });
      if (!prospect.email) return json(res, 400, { error: 'Keine E-Mail hinterlegt' });
      const mail = generateMail(prospect);
      return json(res, 200, { success: true, mail });
    }

    // Mark mail as sent
    const mailSentMatch = p.match(/^\/api\/prospect\/([a-z0-9-]+)\/mail-sent$/);
    if (mailSentMatch && req.method === 'POST') {
      const slug = mailSentMatch[1];
      const b = await parseBody(req).catch(() => ({}));
      const prospects = loadProspects();
      const idx = prospects.findIndex(p => p.slug === slug);
      if (idx === -1) return json(res, 404, { error: 'Nicht gefunden' });
      prospects[idx].mailSent = new Date().toISOString();
      prospects[idx].mailText = b.mailText || null;
      prospects[idx].status = 'mail';
      prospects[idx].updated = new Date().toISOString();
      saveProspects(prospects);
      return json(res, 200, { success: true, prospect: prospects[idx] });
    }

    // Create Pipedrive lead
    const pdMatch = p.match(/^\/api\/prospect\/([a-z0-9-]+)\/pipedrive$/);
    if (pdMatch && req.method === 'POST') {
      const slug = pdMatch[1];
      if (!PIPEDRIVE_API_KEY) return json(res, 500, { error: 'PIPEDRIVE_API_KEY nicht konfiguriert' });
      const prospects = loadProspects();
      const idx = prospects.findIndex(p => p.slug === slug);
      if (idx === -1) return json(res, 404, { error: 'Nicht gefunden' });
      const prospect = prospects[idx];

      // Create person first
      const personData = { name: prospect.contact || prospect.name };
      if (prospect.email) personData.email = [{ value: prospect.email, primary: true }];
      const personR = await pipedrive('POST', '/persons', personData);
      if (personR.status !== 201 && personR.status !== 200) return json(res, 500, { error: 'Pipedrive Person fehlgeschlagen', details: personR.data });
      const personId = personR.data && personR.data.data ? personR.data.data.id : null;

      // Create lead
      const leadData = {
        title: `ELEVO Preview — ${prospect.name}`,
        person_id: personId
      };
      const leadR = await pipedrive('POST', '/leads', leadData);
      if (leadR.status !== 201 && leadR.status !== 200) return json(res, 500, { error: 'Pipedrive Lead fehlgeschlagen', details: leadR.data });

      const leadId = leadR.data && leadR.data.data ? leadR.data.data.id : null;
      prospects[idx].pipedriveId = leadId;
      prospects[idx].updated = new Date().toISOString();
      saveProspects(prospects);
      return json(res, 200, { success: true, personId, leadId });
    }

    // ═══ EXISTING ROUTES ═══

    // List apps
    if (p === '/api/apps' && req.method === 'GET') {
      const r = await coolify('GET', '/applications');
      const apps = (Array.isArray(r.data) ? r.data : []).map(a => ({ uuid: a.uuid, name: a.name, fqdn: a.fqdn, status: a.status, git_repository: a.git_repository, build_pack: a.build_pack, environment_id: a.environment_id, created_at: a.created_at }));
      return json(res, 200, { count: apps.length, apps });
    }

    // Build website with Claude
    if (p === '/api/build' && req.method === 'POST') {
      const b = await parseBody(req);
      if (!b.url && !b.prompt) return json(res, 400, { error: 'url oder prompt fehlt' });
      if (!ANTHROPIC_API_KEY) return json(res, 500, { error: 'ANTHROPIC_API_KEY fehlt' });
      const msg = b.url ? `Baue eine Preview-Website für: ${b.url}\nAnalysiere die bestehende Website, extrahiere Branding und baue eine Premium-Version.\n${b.prompt || ''}` : b.prompt;
      const r = await claude([{ role: 'user', content: msg }], SYSTEM_PROMPT);
      if (r.status === 200 && r.data.content) { return json(res, 200, { success: true, html: r.data.content.map(c => c.text || '').join(''), usage: r.data.usage }); }
      return json(res, r.status || 500, { error: 'Claude failed', details: r.data });
    }

    // Create + Push + Deploy (Full Auto)
    if (p === '/api/deploy-full' && req.method === 'POST') {
      const b = await parseBody(req);
      if (!b.name || !b.html) return json(res, 400, { error: 'name + html required' });
      const slug = toSlug(b.name), repoName = `${slug}-preview`;

      const repoR = await github('POST', `/user/repos`, { name: repoName, description: `Preview ${b.name} — ELEVO`, private: true, auto_init: true });
      const exists = repoR.status === 422;
      if (!exists && repoR.status !== 201) return json(res, 500, { error: 'Repo creation failed', details: repoR.data });

      if (!exists) await new Promise(r => setTimeout(r, 2000));

      let sha = null;
      if (exists) {
        const ex = await github('GET', `/repos/${GITHUB_ORG}/${repoName}/contents/index.html`);
        if (ex.status === 200 && ex.data && ex.data.sha) sha = ex.data.sha;
      }
      if (!exists) await new Promise(r => setTimeout(r, 1000));
      const pushP = { message: exists && sha ? 'Update via Deploy Center' : 'Initial via Deploy Center', content: Buffer.from(b.html).toString('base64'), branch: 'main' };
      if (sha) pushP.sha = sha;
      let pushR = await github('PUT', `/repos/${GITHUB_ORG}/${repoName}/contents/index.html`, pushP);
      if (pushR.status === 409 || pushR.status === 422) {
        const re = await github('GET', `/repos/${GITHUB_ORG}/${repoName}/contents/index.html`);
        if (re.status === 200 && re.data && re.data.sha) { pushP.sha = re.data.sha; pushR = await github('PUT', `/repos/${GITHUB_ORG}/${repoName}/contents/index.html`, pushP); }
      }
      if (pushR.status !== 200 && pushR.status !== 201) return json(res, 500, { error: 'Push failed: ' + (pushR.data && pushR.data.message ? pushR.data.message : JSON.stringify(pushR.data)), status: pushR.status });

      const appsR = await coolify('GET', '/applications');
      const existing = Array.isArray(appsR.data) ? appsR.data.find(a => a.git_repository === `${GITHUB_ORG}/${repoName}`) : null;

      if (existing) {
        await coolify('GET', `/applications/${existing.uuid}/restart`);
        return json(res, 200, { success: true, action: 'updated', uuid: existing.uuid, domain: existing.fqdn });
      }

      const ga = await detectGHApp();
      if (!ga) return json(res, 500, { error: 'GitHub App UUID fehlt' });
      const domain = `https://${slug}-preview.elevo.solutions`;
      const cr = await coolify('POST', '/applications/private-github-app', {
        project_uuid: COOLIFY_PROJECT_UUID, server_uuid: COOLIFY_SERVER_UUID, environment_name: 'production',
        github_app_uuid: ga, destination_uuid: COOLIFY_DEST_UUID, git_repository: `${GITHUB_ORG}/${repoName}`,
        git_branch: 'main', build_pack: 'static', ports_exposes: '80', domains: domain, name: `${slug}-preview`, instant_deploy: true, is_static: true
      });
      if (cr.status === 201 || cr.status === 200) return json(res, 201, { success: true, action: 'created', uuid: cr.data.uuid, domain });
      return json(res, 500, { error: 'Coolify failed', repo_ok: true, details: cr.data });
    }

    // Redeploy
    const dm = p.match(/^\/api\/deploy\/(.+)$/);
    if (dm) { const r = await coolify('GET', `/applications/${dm[1]}/restart`); return json(res, 200, { success: r.status === 200 }); }

    // GET code from GitHub repo
    const codeGet = p.match(/^\/api\/code\/(.+)$/);
    if (codeGet && req.method === 'GET') {
      const repo = decodeURIComponent(codeGet[1]);
      const r = await github('GET', `/repos/${GITHUB_ORG}/${repo}/contents/index.html`);
      if (r.status === 200 && r.data && r.data.content) {
        const html = Buffer.from(r.data.content, 'base64').toString('utf8');
        return json(res, 200, { success: true, html, sha: r.data.sha, size: html.length });
      }
      return json(res, r.status || 404, { error: 'Code nicht gefunden', details: r.data });
    }

    // POST updated code to GitHub + redeploy
    if (codeGet && req.method === 'POST') {
      const repo = decodeURIComponent(codeGet[1]);
      const b = await parseBody(req);
      if (!b.html) return json(res, 400, { error: 'html fehlt' });
      const ex = await github('GET', `/repos/${GITHUB_ORG}/${repo}/contents/index.html`);
      const sha = (ex.status === 200 && ex.data && ex.data.sha) ? ex.data.sha : null;
      const pushP = { message: 'Update via Deploy Center', content: Buffer.from(b.html).toString('base64'), branch: 'main' };
      if (sha) pushP.sha = sha;
      const pushR = await github('PUT', `/repos/${GITHUB_ORG}/${repo}/contents/index.html`, pushP);
      if (pushR.status !== 200 && pushR.status !== 201) return json(res, 500, { error: 'Push failed: ' + (pushR.data && pushR.data.message ? pushR.data.message : 'unknown') });
      const appsR = await coolify('GET', '/applications');
      const app = Array.isArray(appsR.data) ? appsR.data.find(a => a.git_repository && a.git_repository.includes(repo)) : null;
      if (app) await coolify('GET', `/applications/${app.uuid}/restart`);
      return json(res, 200, { success: true, redeployed: !!app, uuid: app ? app.uuid : null });
    }

    // Delete app
    const del = p.match(/^\/api\/app\/(.+)$/);
    if (del && req.method === 'DELETE') { const r = await coolify('DELETE', `/applications/${del[1]}`); return json(res, 200, { success: r.status === 200 }); }

    json(res, 404, { error: 'Not found' });
  } catch (e) { console.error(e); json(res, 500, { error: e.message }); }
});

server.listen(PORT, async () => {
  console.log(`\n  ELEVO Deploy Center v3.0 | Port ${PORT}`);
  console.log(`  Coolify: ${COOLIFY_URL} | Claude: ${ANTHROPIC_API_KEY ? '✓' : '✗'} | Pipedrive: ${PIPEDRIVE_API_KEY ? '✓' : '✗'}\n`);
  await detectGHApp();
});
