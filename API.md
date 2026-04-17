# ELEVO Deployer API — v4.1

Base URL: `https://deploy.elevo.solutions`

## Authentifizierung

Alle `/api/*` Endpoints (außer `/api/health` und `/api/login`) erfordern Auth.

### Optionen

| Methode | Beschreibung |
|---|---|
| `Authorization: Bearer <key>` | Empfohlen für programmatischen Zugriff (API_KEYS oder DEPLOY_SECRET) |
| `?token=<DEPLOY_SECRET>` | Query-Parameter (nur DEPLOY_SECRET) |
| Cookie `deploy_token` | Web UI nach Login |

### API Keys einrichten

In der Coolify-Umgebung die Variable `API_KEYS` setzen (kommagetrennt):

```
API_KEYS=mein-key-1,mein-key-2
```

---

## Endpoints

### `GET /api/health`
Health Check — kein Auth erforderlich.

**Response:**
```json
{ "status": "ok", "version": "4.1", "ts": "2026-04-17T...", "coolify": true, "github": true }
```

---

### `GET /api/config`
Zeigt welche Integrationen aktiv sind.

---

### `POST /api/deploy` ⭐ NEU
Deployment programmatisch triggern. Sucht die App in Coolify und startet einen Redeploy.

**Request Body** (eines der Felder angeben):
```json
{ "uuid": "coolify-app-uuid" }
{ "slug": "firma-name" }
{ "name": "Firma Name" }
{ "repo": "firma-name-preview" }
```

**Beispiel (cURL):**
```bash
curl -X POST https://deploy.elevo.solutions/api/deploy \
  -H "Authorization: Bearer mein-api-key" \
  -H "Content-Type: application/json" \
  -d '{"slug": "muster-gmbh"}'
```

**Response (200):**
```json
{ "success": true, "uuid": "abc123", "name": "muster-gmbh-preview" }
```

**Response (404):**
```json
{ "error": "App not found. Provide uuid, slug, name, or repo." }
```

---

### `GET /api/deploy/:uuid` (Legacy)
Startet Redeploy direkt per Coolify-UUID. Weiterhin unterstützt für Rückwärtskompatibilität.

---

### `POST /api/deploy-full`
Vollständiger Build + Deploy: Repo erstellen (wenn nötig), Dateien pushen, Coolify-App anlegen.

**Request Body:**
```json
{
  "name": "Firma Name",
  "html": "<html>...</html>",
  "css": "/* optional */",
  "js": "// optional",
  "files": [{ "name": "extra.json", "content": "{}" }]
}
```

---

### `GET /api/apps`
Listet alle Coolify-Apps.

---

### `GET /api/dashboard`
Pipeline-Übersicht: Prospects, Conversion-Rates, Pipedrive-Activities.

---

### `GET /api/prospects`
Alle Prospects abrufen.

### `POST /api/prospect`
Prospect anlegen: `{ name, url, email, contact, branch, anrede, score, notes }`

### `POST /api/prospects/import`
CSV-Import: `{ csv: "..." }`

### `PUT /api/prospect/:slug`
Prospect bearbeiten.

### `DELETE /api/prospect/:slug`
Prospect löschen.

### `POST /api/prospect/:slug/status`
Status setzen: `{ status: "neu"|"preview"|"mail"|"followup"|"termin"|"skip" }`

### `GET /api/prospect/:slug/mail-generate`
Mail-Entwurf generieren.

### `POST /api/prospect/:slug/send-mail`
Mail via Pipedrive senden: `{ subject?, body? }`

### `POST /api/prospect/:slug/mail-sent`
Mail manuell als gesendet markieren.

---

### `POST /api/build`
Preview-HTML mit Claude generieren: `{ url?, prompt }`

### `GET /api/code/:repo`
Alle editierbaren Dateien eines GitHub-Repos laden.

### `POST /api/code/:repo`
Dateien in GitHub pushen + Redeploy: `{ html?, css?, js?, files? }`

### `DELETE /api/app/:uuid`
Coolify-App löschen.

---

### `POST /api/research`
Google Places Recherche: `{ query, limit? }`

### `GET /api/pipedrive/person-fields`
Pipedrive Custom Fields anzeigen.

### `GET /api/pipedrive/sync`
Prospects mit Pipedrive synchronisieren.

### `POST /api/login`
Web-UI Login: `{ token }` → setzt Cookie.

---

## Logging

Der Deployer schreibt strukturiertes JSON-Logging für alle wichtigen Events:

```json
{ "ts": "2026-04-17T12:00:00Z", "level": "info", "msg": "deploy triggered via API", "uuid": "abc", "name": "firma-preview", "status": 200 }
```

Logs sind via Coolify-Dashboard oder `docker logs` einsehbar.
