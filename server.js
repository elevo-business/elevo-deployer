// ═══════════════════════════════════════════════════════════════════
// ELEVO DEPLOYER v2.0 — Coolify Auto-Create
// deploy.elevo.solutions
// 
// Endpoints:
//   GET  /                        → Status
//   GET  /api/coolify-test        → Coolify API connection test
//   GET  /api/apps                → List all Coolify apps
//   POST /api/create-preview      → Auto-create preview app in Coolify
//   POST /api/create-and-push     → Create GitHub repo + push HTML + create Coolify app
//   GET  /api/deploy/:appUuid     → Trigger redeploy of existing app
//   GET  /api/status/:appUuid     → Get app status
//   DELETE /api/app/:appUuid      → Delete app from Coolify
//
// Env Vars (set in Coolify):
//   COOLIFY_URL           → http://159.195.37.216:8000
//   COOLIFY_TOKEN         → Coolify API Bearer Token
//   COOLIFY_SERVER_UUID   → rg87l8f5009gy2yp665a2iyg
//   COOLIFY_PROJECT_UUID  → vqem6h43k3pimdxapypmz6hf
//   COOLIFY_DEST_UUID     → bona6q9oxd0j53n7c7jjttl6
//   GITHUB_APP_UUID       → (from Coolify Sources → GitHub App → UUID in URL)
//   GITHUB_TOKEN          → GitHub Personal Access Token (repo scope)
//   GITHUB_ORG            → elevo-business
//   DEPLOY_SECRET         → Simple auth token for this API
//   PORT                  → 3000
// ═══════════════════════════════════════════════════════════════════

const http = require('http');
const https = require('https');
const { URL } = require('url');

// ─── Config ───────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
const COOLIFY_URL = process.env.COOLIFY_URL || 'http://159.195.37.216:8000';
const COOLIFY_TOKEN = process.env.COOLIFY_TOKEN || '';
const COOLIFY_SERVER_UUID = process.env.COOLIFY_SERVER_UUID || '';
const COOLIFY_PROJECT_UUID = process.env.COOLIFY_PROJECT_UUID || '';
const COOLIFY_DEST_UUID = process.env.COOLIFY_DEST_UUID || '';
const GITHUB_APP_UUID = process.env.GITHUB_APP_UUID || '';
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_ORG = process.env.GITHUB_ORG || 'elevo-business';
const DEPLOY_SECRET = process.env.DEPLOY_SECRET || '';

// ─── Helpers ──────────────────────────────────────────────────────

function json(res, status, data) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization'
  });
  res.end(JSON.stringify(data, null, 2));
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', chunk => {
      body += chunk;
      if (body.length > 5e6) { req.destroy(); reject(new Error('Body too large')); }
    });
    req.on('end', () => {
      try { resolve(JSON.parse(body)); } 
      catch (e) { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

function checkAuth(req) {
  if (!DEPLOY_SECRET) return true; // No secret = no auth (dev mode)
  const auth = req.headers.authorization;
  if (auth && auth === `Bearer ${DEPLOY_SECRET}`) return true;
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.searchParams.get('token') === DEPLOY_SECRET) return true;
  return false;
}

// ─── HTTP Request Helpers ─────────────────────────────────────────

function coolifyRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${COOLIFY_URL}/api/v1${path}`);
    const isHTTPS = url.protocol === 'https:';
    const transport = isHTTPS ? https : http;

    const options = {
      hostname: url.hostname,
      port: url.port || (isHTTPS ? 443 : 80),
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Authorization': `Bearer ${COOLIFY_TOKEN}`,
        'Content-Type': 'application/json',
        'Accept': 'application/json'
      }
    };

    if (data) {
      const payload = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = transport.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', err => reject(err));
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

function githubRequest(method, path, data = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      port: 443,
      path: path,
      method: method,
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'ELEVO-Deployer/2.0',
        'X-GitHub-Api-Version': '2022-11-28',
        'Content-Type': 'application/json'
      }
    };

    if (data) {
      const payload = JSON.stringify(data);
      options.headers['Content-Length'] = Buffer.byteLength(payload);
    }

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: body });
        }
      });
    });

    req.on('error', err => reject(err));
    if (data) req.write(JSON.stringify(data));
    req.end();
  });
}

// ─── Slug Helper ──────────────────────────────────────────────────

function toSlug(name) {
  return name
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// ─── Route Handlers ───────────────────────────────────────────────

async function handleStatus(req, res) {
  json(res, 200, {
    service: 'ELEVO Deployer v2.0',
    status: 'running',
    endpoints: [
      'GET  /api/coolify-test',
      'GET  /api/apps',
      'POST /api/create-preview',
      'POST /api/create-and-push',
      'GET  /api/deploy/:appUuid',
      'GET  /api/status/:appUuid',
      'DELETE /api/app/:appUuid'
    ],
    config: {
      coolify: COOLIFY_URL ? '✓' : '✗',
      github: GITHUB_TOKEN ? '✓' : '✗',
      githubOrg: GITHUB_ORG,
      auth: DEPLOY_SECRET ? 'enabled' : 'disabled'
    }
  });
}

async function handleCoolifyTest(req, res) {
  try {
    const [apps, servers, projects] = await Promise.all([
      coolifyRequest('GET', '/applications'),
      coolifyRequest('GET', '/servers'),
      coolifyRequest('GET', '/projects')
    ]);
    json(res, 200, {
      success: true,
      coolifyUrl: COOLIFY_URL,
      apps: { status: apps.status, count: Array.isArray(apps.data) ? apps.data.length : '?' },
      servers: { status: servers.status, data: servers.data },
      projects: { status: projects.status, data: projects.data }
    });
  } catch (err) {
    json(res, 500, { error: `Coolify API error: ${err.message}` });
  }
}

async function handleListApps(req, res) {
  try {
    const result = await coolifyRequest('GET', '/applications');
    if (result.status !== 200) {
      return json(res, result.status, { error: 'Failed to list apps', data: result.data });
    }
    
    const apps = Array.isArray(result.data) ? result.data.map(app => ({
      uuid: app.uuid,
      name: app.name,
      fqdn: app.fqdn,
      status: app.status,
      git_repository: app.git_repository,
      git_branch: app.git_branch,
      build_pack: app.build_pack,
      created_at: app.created_at
    })) : [];
    
    json(res, 200, { count: apps.length, apps });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════
// CORE: Create Preview App in Coolify
// Expects: { name: "firmenname" } or { name: "firmenname", repo: "custom-repo-name" }
// Creates: App in Coolify → firmenname-preview.elevo.solutions
// ═══════════════════════════════════════════════════════════════════

async function handleCreatePreview(req, res) {
  try {
    const body = await parseBody(req);
    const { name, repo } = body;

    if (!name) {
      return json(res, 400, { error: 'Missing "name" field. Example: { "name": "schmuckgarten" }' });
    }

    // Validate required config
    if (!GITHUB_APP_UUID) return json(res, 500, { error: 'GITHUB_APP_UUID not configured' });
    if (!COOLIFY_SERVER_UUID) return json(res, 500, { error: 'COOLIFY_SERVER_UUID not configured' });
    if (!COOLIFY_PROJECT_UUID) return json(res, 500, { error: 'COOLIFY_PROJECT_UUID not configured' });

    const slug = toSlug(name);
    const repoName = repo || `${slug}-preview`;
    const domain = `https://${slug}-preview.elevo.solutions`;
    const gitRepo = `${GITHUB_ORG}/${repoName}`;

    console.log(`[CREATE] Creating preview app: ${slug}`);
    console.log(`[CREATE] Repo: ${gitRepo} → Domain: ${domain}`);

    // Step 1: Create the application in Coolify
    const createPayload = {
      project_uuid: COOLIFY_PROJECT_UUID,
      server_uuid: COOLIFY_SERVER_UUID,
      environment_name: 'production',
      github_app_uuid: GITHUB_APP_UUID,
      git_repository: gitRepo,
      git_branch: 'main',
      build_pack: 'static',
      ports_exposes: '80',
      domains: domain,
      name: `${slug}-preview`,
      description: `Preview-Website für ${name} — ELEVO Solutions`,
      instant_deploy: true,
      is_static: true
    };

    // Add destination if configured
    if (COOLIFY_DEST_UUID) {
      createPayload.destination_uuid = COOLIFY_DEST_UUID;
    }

    const result = await coolifyRequest('POST', '/applications/private-github-app', createPayload);

    if (result.status === 201 || result.status === 200) {
      console.log(`[CREATE] ✓ App created: ${result.data.uuid}`);
      json(res, 201, {
        success: true,
        message: `Preview-App für "${name}" erstellt und Deploy gestartet.`,
        app: {
          uuid: result.data.uuid,
          domain: domain,
          repo: gitRepo,
          build_pack: 'static',
          status: 'deploying'
        },
        next_steps: [
          `GitHub App Repo-Access prüfen: ${repoName} muss Zugriff haben`,
          `Website live unter: ${domain}`,
          `Status checken: GET /api/status/${result.data.uuid}`
        ]
      });
    } else {
      console.log(`[CREATE] ✗ Failed:`, JSON.stringify(result.data));
      json(res, result.status || 500, {
        success: false,
        error: 'Coolify App-Erstellung fehlgeschlagen',
        details: result.data,
        payload_sent: createPayload
      });
    }
  } catch (err) {
    console.error('[CREATE] Error:', err.message);
    json(res, 500, { error: err.message });
  }
}

// ═══════════════════════════════════════════════════════════════════
// FULL AUTO: Create GitHub Repo + Push HTML + Create Coolify App
// Expects: { name: "firmenname", html: "<html>...</html>" }
// Does everything: Repo → HTML push → Coolify App → Deploy
// ═══════════════════════════════════════════════════════════════════

async function handleCreateAndPush(req, res) {
  try {
    const body = await parseBody(req);
    const { name, html } = body;

    if (!name) return json(res, 400, { error: 'Missing "name"' });
    if (!html) return json(res, 400, { error: 'Missing "html" — die HTML-Datei als String' });
    if (!GITHUB_TOKEN) return json(res, 500, { error: 'GITHUB_TOKEN not configured' });

    const slug = toSlug(name);
    const repoName = `${slug}-preview`;
    const domain = `https://${slug}-preview.elevo.solutions`;

    console.log(`[FULL-AUTO] Starting for: ${name}`);

    // Step 1: Create GitHub repo
    console.log(`[FULL-AUTO] Step 1: Creating GitHub repo ${GITHUB_ORG}/${repoName}`);
    
    const repoResult = await githubRequest('POST', `/orgs/${GITHUB_ORG}/repos`, {
      name: repoName,
      description: `Preview-Website für ${name} — ELEVO Solutions`,
      private: true,
      auto_init: false
    });

    if (repoResult.status !== 201 && repoResult.status !== 422) {
      // 422 = repo already exists, which is fine
      return json(res, repoResult.status, {
        error: 'GitHub Repo konnte nicht erstellt werden',
        details: repoResult.data
      });
    }

    const repoExists = repoResult.status === 422;
    console.log(`[FULL-AUTO] Repo ${repoExists ? 'existiert bereits' : 'erstellt'}`);

    // Step 2: Push index.html to repo
    console.log(`[FULL-AUTO] Step 2: Pushing index.html`);
    
    const htmlBase64 = Buffer.from(html).toString('base64');
    
    // Check if file exists (for update)
    let fileSha = null;
    if (repoExists) {
      const existing = await githubRequest('GET', `/repos/${GITHUB_ORG}/${repoName}/contents/index.html`);
      if (existing.status === 200 && existing.data.sha) {
        fileSha = existing.data.sha;
      }
    }

    const pushPayload = {
      message: repoExists ? 'Website aktualisiert via ELEVO Deployer' : 'Initial commit via ELEVO Deployer',
      content: htmlBase64,
      branch: 'main'
    };
    if (fileSha) pushPayload.sha = fileSha;

    // If repo was just created (no branch yet), we need to create with initial commit
    const pushResult = await githubRequest('PUT', `/repos/${GITHUB_ORG}/${repoName}/contents/index.html`, pushPayload);

    if (pushResult.status !== 200 && pushResult.status !== 201) {
      return json(res, pushResult.status, {
        error: 'HTML konnte nicht gepusht werden',
        details: pushResult.data
      });
    }
    console.log(`[FULL-AUTO] ✓ index.html gepusht`);

    // Step 3: Create Coolify App (only if repo is new)
    console.log(`[FULL-AUTO] Step 3: Creating Coolify app`);

    // Check if app already exists
    const appsResult = await coolifyRequest('GET', '/applications');
    let existingApp = null;
    if (Array.isArray(appsResult.data)) {
      existingApp = appsResult.data.find(app => 
        app.git_repository === `${GITHUB_ORG}/${repoName}` || 
        app.name === `${slug}-preview`
      );
    }

    if (existingApp) {
      // App exists → just redeploy
      console.log(`[FULL-AUTO] App existiert (${existingApp.uuid}), triggere Redeploy`);
      const deployResult = await coolifyRequest('GET', `/applications/${existingApp.uuid}/restart`);
      
      json(res, 200, {
        success: true,
        action: 'updated',
        message: `Website für "${name}" aktualisiert. Redeploy läuft.`,
        app: {
          uuid: existingApp.uuid,
          domain: domain,
          repo: `${GITHUB_ORG}/${repoName}`,
          status: 'redeploying'
        }
      });
    } else {
      // Create new app
      const createPayload = {
        project_uuid: COOLIFY_PROJECT_UUID,
        server_uuid: COOLIFY_SERVER_UUID,
        environment_name: 'production',
        github_app_uuid: GITHUB_APP_UUID,
        git_repository: `${GITHUB_ORG}/${repoName}`,
        git_branch: 'main',
        build_pack: 'static',
        ports_exposes: '80',
        domains: domain,
        name: `${slug}-preview`,
        description: `Preview-Website für ${name} — ELEVO Solutions`,
        instant_deploy: true,
        is_static: true
      };

      if (COOLIFY_DEST_UUID) {
        createPayload.destination_uuid = COOLIFY_DEST_UUID;
      }

      const createResult = await coolifyRequest('POST', '/applications/private-github-app', createPayload);

      if (createResult.status === 201 || createResult.status === 200) {
        console.log(`[FULL-AUTO] ✓ Alles fertig: ${domain}`);
        json(res, 201, {
          success: true,
          action: 'created',
          message: `Alles erledigt! Repo erstellt, HTML gepusht, Coolify-App erstellt, Deploy läuft.`,
          app: {
            uuid: createResult.data.uuid,
            domain: domain,
            repo: `${GITHUB_ORG}/${repoName}`,
            status: 'deploying'
          }
        });
      } else {
        json(res, createResult.status || 500, {
          success: false,
          error: 'GitHub + Push OK, aber Coolify-Erstellung fehlgeschlagen',
          repo_created: true,
          html_pushed: true,
          coolify_error: createResult.data,
          manual_fix: `Erstelle die App manuell in Coolify: Repo ${GITHUB_ORG}/${repoName}, Static, Domain ${domain}`
        });
      }
    }
  } catch (err) {
    console.error('[FULL-AUTO] Error:', err.message);
    json(res, 500, { error: err.message });
  }
}

// ─── Redeploy ─────────────────────────────────────────────────────

async function handleDeploy(req, res, appUuid) {
  try {
    const result = await coolifyRequest('GET', `/applications/${appUuid}/restart`);
    json(res, result.status, {
      success: result.status === 200,
      message: result.status === 200 ? 'Redeploy gestartet' : 'Fehler',
      data: result.data
    });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
}

// ─── Status ───────────────────────────────────────────────────────

async function handleAppStatus(req, res, appUuid) {
  try {
    const result = await coolifyRequest('GET', `/applications/${appUuid}`);
    if (result.status === 200) {
      const app = result.data;
      json(res, 200, {
        uuid: app.uuid,
        name: app.name,
        fqdn: app.fqdn,
        status: app.status,
        git_repository: app.git_repository,
        build_pack: app.build_pack,
        created_at: app.created_at,
        updated_at: app.updated_at
      });
    } else {
      json(res, result.status, result.data);
    }
  } catch (err) {
    json(res, 500, { error: err.message });
  }
}

// ─── Delete ───────────────────────────────────────────────────────

async function handleDeleteApp(req, res, appUuid) {
  try {
    const result = await coolifyRequest('DELETE', `/applications/${appUuid}`);
    json(res, result.status, {
      success: result.status === 200,
      message: result.status === 200 ? 'App gelöscht' : 'Fehler',
      data: result.data
    });
  } catch (err) {
    json(res, 500, { error: err.message });
  }
}

// ─── Router ───────────────────────────────────────────────────────

const server = http.createServer(async (req, res) => {
  // CORS preflight
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization'
    });
    return res.end();
  }

  const url = new URL(req.url, `http://${req.headers.host}`);
  const path = url.pathname;

  // Public endpoints (no auth)
  if (path === '/' && req.method === 'GET') {
    return handleStatus(req, res);
  }

  // Auth check for all /api/ routes
  if (path.startsWith('/api/') && !checkAuth(req)) {
    return json(res, 401, { error: 'Unauthorized. Bearer Token oder ?token= Parameter fehlt.' });
  }

  // Routes
  try {
    if (path === '/api/coolify-test' && req.method === 'GET') {
      return await handleCoolifyTest(req, res);
    }
    
    if (path === '/api/apps' && req.method === 'GET') {
      return await handleListApps(req, res);
    }
    
    if (path === '/api/create-preview' && req.method === 'POST') {
      return await handleCreatePreview(req, res);
    }
    
    if (path === '/api/create-and-push' && req.method === 'POST') {
      return await handleCreateAndPush(req, res);
    }

    // Dynamic routes: /api/deploy/:uuid, /api/status/:uuid, /api/app/:uuid
    const deployMatch = path.match(/^\/api\/deploy\/(.+)$/);
    if (deployMatch && req.method === 'GET') {
      return await handleDeploy(req, res, deployMatch[1]);
    }

    const statusMatch = path.match(/^\/api\/status\/(.+)$/);
    if (statusMatch && req.method === 'GET') {
      return await handleAppStatus(req, res, statusMatch[1]);
    }

    const deleteMatch = path.match(/^\/api\/app\/(.+)$/);
    if (deleteMatch && req.method === 'DELETE') {
      return await handleDeleteApp(req, res, deleteMatch[1]);
    }

    json(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('Unhandled error:', err);
    json(res, 500, { error: err.message });
  }
});

server.listen(PORT, () => {
  console.log(`═══════════════════════════════════════`);
  console.log(`  ELEVO Deployer v2.0`);
  console.log(`  Port: ${PORT}`);
  console.log(`  Coolify: ${COOLIFY_URL}`);
  console.log(`  GitHub Org: ${GITHUB_ORG}`);
  console.log(`  Auth: ${DEPLOY_SECRET ? 'enabled' : 'disabled'}`);
  console.log(`═══════════════════════════════════════`);
});
