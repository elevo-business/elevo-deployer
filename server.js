/**
 * ELEVO Deployer — Mobile Deploy API
 * 
 * Workflow: Handy → Firmenname + HTML → GitHub Repo → Coolify Deploy → Live
 * 
 * Endpoints:
 *   POST /api/deploy     — Neues Projekt erstellen + deployen
 *   POST /api/update     — Bestehendes Projekt updaten
 *   GET  /api/projects   — Alle deployen Projekte auflisten
 *   GET  /api/status/:name — Status eines Projekts prüfen
 */

const express = require('express');
const https = require('https');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 3000;

// Config from environment
const CONFIG = {
  githubToken: process.env.GITHUB_TOKEN,           // Personal Access Token (repo scope)
  githubOrg: process.env.GITHUB_ORG || 'elevo-business',
  coolifyToken: process.env.COOLIFY_TOKEN,          // Coolify API Token
  coolifyUrl: process.env.COOLIFY_URL || 'https://159.195.37.216:8000',
  apiKey: process.env.DEPLOYER_API_KEY,             // Simple auth for this API
  previewDomain: process.env.PREVIEW_DOMAIN || 'preview.elevo.solutions',
  coolifyServerId: process.env.COOLIFY_SERVER_ID,   // UUID of the Netcup server in Coolify
  coolifyProjectId: process.env.COOLIFY_PROJECT_ID, // UUID of the "Kunden-Previews" project
  githubAppId: process.env.GITHUB_APP_ID,           // Coolify's GitHub App source ID
};

// Middleware
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Simple API key auth
function authenticate(req, res, next) {
  const key = req.headers['x-api-key'] || req.query.key;
  if (!CONFIG.apiKey) return next(); // No key set = no auth (rely on Cloudflare Zero Trust)
  if (key === CONFIG.apiKey) return next();
  return res.status(401).json({ error: 'Unauthorized' });
}

// ═══════════════════════════════════════════
// GitHub API Helper
// ═══════════════════════════════════════════

function githubRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.github.com',
      path: endpoint,
      method: method,
      headers: {
        'Authorization': `Bearer ${CONFIG.githubToken}`,
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'ELEVO-Deployer/1.0',
        'Content-Type': 'application/json',
      }
    };

    const req = https.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          if (res.statusCode >= 200 && res.statusCode < 300) {
            resolve(parsed);
          } else {
            reject({ status: res.statusCode, message: parsed.message || 'GitHub API error', data: parsed });
          }
        } catch (e) {
          reject({ status: res.statusCode, message: 'Invalid JSON response' });
        }
      });
    });

    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ═══════════════════════════════════════════
// Coolify API Helper
// ═══════════════════════════════════════════

function coolifyRequest(method, endpoint, body = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(CONFIG.coolifyUrl);
    const options = {
      hostname: url.hostname,
      port: url.port || 443,
      path: `/api/v1${endpoint}`,
      method: method,
      headers: {
        'Authorization': `Bearer ${CONFIG.coolifyToken}`,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
      },
      rejectUnauthorized: false, // Self-signed cert on Coolify
    };

    const protocol = url.protocol === 'https:' ? https : require('http');
    const req = protocol.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const parsed = data ? JSON.parse(data) : {};
          resolve({ status: res.statusCode, data: parsed });
        } catch (e) {
          resolve({ status: res.statusCode, data: { raw: data } });
        }
      });
    });

    req.on('error', (err) => {
      reject({ message: 'Coolify API error: ' + err.message });
    });
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

// ═══════════════════════════════════════════
// Core Functions
// ═══════════════════════════════════════════

function sanitizeName(name) {
  return name
    .toLowerCase()
    .replace(/[äöüß]/g, c => ({ 'ä': 'ae', 'ö': 'oe', 'ü': 'ue', 'ß': 'ss' }[c]))
    .replace(/[^a-z0-9-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

async function createRepo(repoName) {
  try {
    const repo = await githubRequest('POST', `/user/repos`, {
      name: repoName,
      private: true,
      auto_init: false,
      description: `ELEVO Preview — ${repoName}`,
    });
    return { success: true, repo };
  } catch (err) {
    if (err.status === 422) {
      // Repo already exists
      return { success: true, exists: true };
    }
    throw err;
  }
}

async function pushFile(repoName, filePath, content, message) {
  const contentBase64 = Buffer.from(content, 'utf-8').toString('base64');
  
  // Check if file exists (need SHA for update)
  let sha = null;
  try {
    const existing = await githubRequest('GET', `/repos/${CONFIG.githubOrg}/${repoName}/contents/${filePath}`);
    sha = existing.sha;
  } catch (e) {
    // File doesn't exist yet — that's fine
  }

  const body = {
    message: message,
    content: contentBase64,
    branch: 'main',
  };
  if (sha) body.sha = sha;

  return githubRequest('PUT', `/repos/${CONFIG.githubOrg}/${repoName}/contents/${filePath}`, body);
}

async function initRepoWithBranch(repoName) {
  // GitHub needs at least one commit to have a main branch
  // Create a minimal README as initial commit
  const readmeContent = Buffer.from(`# ${repoName}\nELEVO Preview Website\n`).toString('base64');
  await githubRequest('PUT', `/repos/${CONFIG.githubOrg}/${repoName}/contents/README.md`, {
    message: 'Initial commit',
    content: readmeContent,
  });
}

// Local project tracking (simple JSON file)
const PROJECTS_FILE = path.join(__dirname, 'data', 'projects.json');

function loadProjects() {
  try {
    if (fs.existsSync(PROJECTS_FILE)) {
      return JSON.parse(fs.readFileSync(PROJECTS_FILE, 'utf-8'));
    }
  } catch (e) {}
  return {};
}

function saveProjects(projects) {
  const dir = path.dirname(PROJECTS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(PROJECTS_FILE, JSON.stringify(projects, null, 2));
}

// ═══════════════════════════════════════════
// API Endpoints
// ═══════════════════════════════════════════

// POST /api/deploy — Deploy new project
app.post('/api/deploy', authenticate, async (req, res) => {
  const { name, html, filename } = req.body;

  if (!name || !html) {
    return res.status(400).json({ error: 'Name und HTML sind erforderlich.' });
  }

  const safeName = sanitizeName(name);
  const repoName = `${safeName}-preview`;
  const domain = `${safeName}-preview.${CONFIG.previewDomain}`;
  const file = filename || 'index.html';
  const steps = [];

  try {
    // Step 1: Create GitHub repo
    steps.push({ step: 'GitHub Repo erstellen', status: 'running' });
    const repoResult = await createRepo(repoName);
    
    if (repoResult.exists) {
      steps[steps.length - 1] = { step: 'GitHub Repo existiert bereits', status: 'done' };
    } else {
      steps[steps.length - 1].status = 'done';
      
      // Initialize with README so main branch exists
      steps.push({ step: 'Branch initialisieren', status: 'running' });
      await initRepoWithBranch(repoName);
      steps[steps.length - 1].status = 'done';
    }

    // Step 2: Push HTML file
    steps.push({ step: `${file} pushen`, status: 'running' });
    await pushFile(repoName, file, html, `Deploy: ${safeName} via ELEVO Deployer`);
    steps[steps.length - 1].status = 'done';

    // Step 3: Track project
    const projects = loadProjects();
    projects[safeName] = {
      name: name,
      safeName: safeName,
      repo: repoName,
      domain: domain,
      file: file,
      githubUrl: `https://github.com/${CONFIG.githubOrg}/${repoName}`,
      previewUrl: `https://${domain}`,
      createdAt: projects[safeName]?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      deployCount: (projects[safeName]?.deployCount || 0) + 1,
    };
    saveProjects(projects);
    steps.push({ step: 'Projekt registriert', status: 'done' });

    // Step 4: Coolify (optional — if configured)
    let coolifyNote = null;
    if (CONFIG.coolifyToken && CONFIG.coolifyServerId) {
      steps.push({ step: 'Coolify App prüfen', status: 'running' });
      try {
        // List existing applications to check if it already exists
        const appsResult = await coolifyRequest('GET', '/applications');
        const existingApp = appsResult.data?.find?.(a => 
          a.fqdn?.includes(domain) || a.name === repoName
        );

        if (existingApp) {
          // Trigger redeploy
          steps[steps.length - 1] = { step: 'Coolify Redeploy triggern', status: 'running' };
          await coolifyRequest('POST', `/applications/${existingApp.uuid}/restart`);
          steps[steps.length - 1].status = 'done';
        } else {
          steps[steps.length - 1].status = 'skipped';
          coolifyNote = `App noch nicht in Coolify angelegt. Erstelle sie manuell mit Domain: ${domain}`;
        }
      } catch (coolifyErr) {
        steps[steps.length - 1] = { step: 'Coolify (übersprungen)', status: 'skipped' };
        coolifyNote = 'Coolify API nicht erreichbar. App manuell deployen.';
      }
    } else {
      coolifyNote = `Coolify nicht konfiguriert. Erstelle die App manuell:\n→ Repo: ${repoName}\n→ Build Pack: Static\n→ Domain: ${domain}`;
    }

    return res.json({
      success: true,
      project: projects[safeName],
      steps: steps,
      coolifyNote: coolifyNote,
      nextSteps: coolifyNote ? [coolifyNote] : ['Deployment läuft automatisch via Coolify.'],
    });

  } catch (err) {
    steps.push({ step: 'Fehler', status: 'error', message: err.message || JSON.stringify(err) });
    return res.status(500).json({
      success: false,
      steps: steps,
      error: err.message || 'Unbekannter Fehler',
    });
  }
});

// POST /api/update — Update existing project
app.post('/api/update', authenticate, async (req, res) => {
  const { name, html, filename } = req.body;

  if (!name || !html) {
    return res.status(400).json({ error: 'Name und HTML sind erforderlich.' });
  }

  const safeName = sanitizeName(name);
  const repoName = `${safeName}-preview`;
  const file = filename || 'index.html';

  try {
    // Push updated file
    await pushFile(repoName, file, html, `Update: ${safeName} via ELEVO Deployer`);

    // Update tracking
    const projects = loadProjects();
    if (projects[safeName]) {
      projects[safeName].updatedAt = new Date().toISOString();
      projects[safeName].deployCount = (projects[safeName].deployCount || 0) + 1;
      saveProjects(projects);
    }

    // Trigger Coolify redeploy if configured
    let coolifyStatus = 'not_configured';
    if (CONFIG.coolifyToken) {
      try {
        const appsResult = await coolifyRequest('GET', '/applications');
        const domain = `${safeName}-preview.${CONFIG.previewDomain}`;
        const app = appsResult.data?.find?.(a => 
          a.fqdn?.includes(domain) || a.name === repoName
        );
        if (app) {
          await coolifyRequest('POST', `/applications/${app.uuid}/restart`);
          coolifyStatus = 'redeployed';
        } else {
          coolifyStatus = 'app_not_found';
        }
      } catch (e) {
        coolifyStatus = 'error';
      }
    }

    return res.json({
      success: true,
      repo: repoName,
      file: file,
      coolifyStatus: coolifyStatus,
      message: `${file} aktualisiert in ${repoName}`,
    });

  } catch (err) {
    return res.status(500).json({
      success: false,
      error: err.message || 'Update fehlgeschlagen',
    });
  }
});

// GET /api/projects — List all projects
app.get('/api/projects', authenticate, (req, res) => {
  const projects = loadProjects();
  return res.json({
    count: Object.keys(projects).length,
    projects: Object.values(projects).sort((a, b) => 
      new Date(b.updatedAt) - new Date(a.updatedAt)
    ),
  });
});

// GET /api/status/:name — Project status
app.get('/api/status/:name', authenticate, async (req, res) => {
  const safeName = sanitizeName(req.params.name);
  const projects = loadProjects();
  const project = projects[safeName];

  if (!project) {
    return res.status(404).json({ error: 'Projekt nicht gefunden' });
  }

  // Check if GitHub repo is accessible
  let githubStatus = 'unknown';
  try {
    await githubRequest('GET', `/repos/${CONFIG.githubOrg}/${project.repo}`);
    githubStatus = 'accessible';
  } catch (e) {
    githubStatus = 'not_found';
  }

  return res.json({
    ...project,
    githubStatus,
  });
});

// DELETE /api/projects/:name — Remove project tracking (doesn't delete repo)
app.delete('/api/projects/:name', authenticate, (req, res) => {
  const safeName = sanitizeName(req.params.name);
  const projects = loadProjects();
  
  if (!projects[safeName]) {
    return res.status(404).json({ error: 'Projekt nicht gefunden' });
  }

  delete projects[safeName];
  saveProjects(projects);

  return res.json({ success: true, message: `${safeName} entfernt (GitHub Repo bleibt bestehen)` });
});

// GET /api/fetch/:name — Load current code from GitHub
app.get('/api/fetch/:name', authenticate, async (req, res) => {
  const safeName = sanitizeName(req.params.name);
  const repoName = `${safeName}-preview`;
  const filename = req.query.file || 'index.html';

  try {
    const file = await githubRequest('GET', `/repos/${CONFIG.githubOrg}/${repoName}/contents/${filename}`);
    
    if (file.content) {
      const content = Buffer.from(file.content, 'base64').toString('utf-8');
      return res.json({
        success: true,
        name: safeName,
        repo: repoName,
        file: filename,
        content: content,
        size: content.length,
        sha: file.sha,
      });
    } else {
      return res.status(404).json({ error: 'Datei leer oder nicht lesbar' });
    }
  } catch (err) {
    return res.status(err.status || 500).json({
      error: err.message || 'Datei konnte nicht geladen werden',
    });
  }
});

// GET /api/files/:name — List all files in a repo
app.get('/api/files/:name', authenticate, async (req, res) => {
  const safeName = sanitizeName(req.params.name);
  const repoName = `${safeName}-preview`;

  try {
    const contents = await githubRequest('GET', `/repos/${CONFIG.githubOrg}/${repoName}/contents/`);
    const files = Array.isArray(contents) 
      ? contents.map(f => ({ name: f.name, size: f.size, type: f.type }))
      : [];
    return res.json({ success: true, repo: repoName, files });
  } catch (err) {
    return res.status(err.status || 500).json({ error: err.message });
  }
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok',
    github: !!CONFIG.githubToken,
    coolify: !!CONFIG.coolifyToken,
    version: '1.0.0',
  });
});

// Coolify API test — shows raw response for debugging
app.get('/api/coolify-test', authenticate, async (req, res) => {
  if (!CONFIG.coolifyToken) {
    return res.json({ error: 'COOLIFY_TOKEN not set' });
  }
  try {
    const apps = await coolifyRequest('GET', '/applications');
    const servers = await coolifyRequest('GET', '/servers');
    const projects = await coolifyRequest('GET', '/projects');
    res.json({ 
      success: true,
      coolifyUrl: CONFIG.coolifyUrl,
      apps: apps,
      servers: servers,
      projects: projects,
    });
  } catch (err) {
    res.json({ error: err.message || JSON.stringify(err) });
  }
});

// Serve frontend
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Start
app.listen(PORT, () => {
  console.log(`\n  ⚡ ELEVO Deployer running on port ${PORT}`);
  console.log(`  📱 Open on your phone to deploy websites\n`);
  if (!CONFIG.githubToken) console.warn('  ⚠️  GITHUB_TOKEN not set — deploys will fail');
  if (!CONFIG.coolifyToken) console.log('  ℹ️  COOLIFY_TOKEN not set — manual Coolify setup needed');
});
