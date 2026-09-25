# FTP / SFTP Automated Recon Tool — Especificación

Blueprint completo para clonar el comportamiento de `smb-recon-tool` pero apuntando a **FTP (21, 990)** y **SFTP (22)**, con un extra clave: cuando se detecta un servicio accesible (anónimo, credenciales por defecto o sin auth obligatoria), el sistema entrega un **link de ingreso listo** clickeable (`ftp://…`, `sftp://…`) y un set de comandos one-click para macOS, Linux, Windows, móvil y navegador.

---

## 1. Objetivo

Detectar, enumerar y validar acceso a servidores **FTP / FTPS / SFTP** dentro de un rango de red, exponiendo resultados en tiempo real vía WebSocket y dejando al operador a un click de entrar al recurso.

| Capacidad SMB original | Equivalente FTP/SFTP |
|---|---|
| Masscan a 139/445 | Masscan a 21, 22, 990, 2121, 2222 |
| Enumeración `smbclient -L` | Banner grab + `LIST /` (FTP) / `readdir('/')` (SFTP) |
| Test sesión nula (anónimo) | `USER anonymous` / `PASS anonymous@` + diccionario corto en SFTP |
| Validación `smbclient -c ls` | `client.list()` (basic-ftp) / `sftp.readdir()` (ssh2) |
| Critical findings (read access) | Anonymous-read + writable + sensitive paths |
| Share Explorer modal | File Explorer remoto (read-only) en navegador |
| **(nuevo)** | **Link de acceso listo + comandos one-click + QR para móvil** |

---

## 2. Stack

| Capa | Tecnología | Justificación |
|---|---|---|
| Backend | Node.js 20+, Express 4, Socket.IO 4 | Idéntico al original, mínima curva |
| Port scan | `masscan` | Reutiliza pipeline existente |
| FTP client | [`basic-ftp`](https://www.npmjs.com/package/basic-ftp) | API moderna, soporta TLS (FTPS implícito/explícito), promesas nativas |
| SFTP/SSH client | [`ssh2`](https://www.npmjs.com/package/ssh2) v1.x | Standard de facto, soporta banner+algos+host key |
| Banner/TLS probe | `node:tls`, `node:net` | Sin dependencias extra para AUTH TLS |
| Frontend | React 18 + Vite + Tailwind 4 + shadcn/ui | Actualizar de CRA: Vite arranca 10× más rápido |
| Estado | Zustand (UI) + TanStack Query (server-state) | Reemplaza fetch/useState ad-hoc |
| Realtime | Socket.IO client | Mismo patrón |
| QR | `qrcode` (node, server-side render) | Para `sftp://`/`ftp://` escaneable desde móvil |
| Logs | Winston + rotating files | Igual al original |
| Tests | Vitest + supertest + msw | Reemplaza Jest (más rápido, ESM nativo) |

> Decisión: migrar **frontend de CRA → Vite** y de **react-scripts → shadcn/ui + Tailwind 4** ya que estamos arrancando limpio. Mismo modelo single-port: backend sirve el build en `:3005`.

---

## 3. Arquitectura

```
┌──────────────────────────────────────────────────────────────┐
│                       React SPA (Vite)                       │
│  ScanConfig  →  ScanProgress  →  ResultsDashboard            │
│                                  ├─ CriticalFindings         │
│                                  ├─ AccessLinkPanel (★ nuevo)│
│                                  └─ RemoteExplorer           │
└────────────────┬─────────────────────────────────────────────┘
                 │  REST + Socket.IO   (single origin :3005)
┌────────────────▼─────────────────────────────────────────────┐
│                  Express + Socket.IO server                  │
│                                                              │
│  /api/scan/*    /api/access/*    /api/browse/*    /api/qr/*  │
│       │              │                  │                    │
│       ▼              ▼                  ▼                    │
│   ReconOrchestrator  AccessLinkBuilder  RemoteBrowser        │
│       │                                                      │
│       ├─ MasscanRunner   (sudo, raw sockets)                 │
│       ├─ FtpProbe        (basic-ftp + tls)                   │
│       ├─ SftpProbe       (ssh2)                              │
│       ├─ CredentialBruteforcer (diccionario corto, opt-in)   │
│       └─ ReachabilityChecker (nc/net.connect)                │
└──────────────────────────────────────────────────────────────┘
```

---

## 4. Flujo de escaneo (5 fases)

```
[1] Masscan          →  hosts con 21/22/990/2121/2222 abiertos
[2] Filter subnets   →  descarta /24 con >15 IPs (igual SMB)
[3] Reachability     →  TCP connect en paralelo (lotes de 10)
[4] Service probe    →  banner grab → clasifica FTP / FTPS / SFTP
[5] Access validation→  anon-FTP / default-creds-SFTP / writable test
```

### 4.1 Masscan (fase 1)

Reutilizar `commandExecutor` del repo SMB. Único cambio: puertos por defecto.

```bash
sudo masscan -p21,22,990,2121,2222 --rate=1500 --open \
  --randomize-hosts --seed=22346 --source-port 80 --wait=5 \
  192.168.1.0/24
```

### 4.2 Service classification (fase 4)

Por cada `host:port` se hace un **banner grab** de 3 segundos:

```js
// pseudo
const banner = await readFirstChunk(host, port, 3000);

if (port === 22 || /^SSH-/.test(banner))         return 'SFTP';
if (port === 990)                                return 'FTPS_IMPLICIT';
if (/^220[ -].*FTP/i.test(banner))               return 'FTP';
// FTP server, ver si soporta AUTH TLS
const tlsOk = await ftpCommand(host, port, 'AUTH TLS');
return tlsOk ? 'FTPS_EXPLICIT' : 'FTP';
```

Banner output capturado: versión, OS hints, software (vsftpd 3.0.5, OpenSSH 9.6p1, ProFTPD, FileZilla Server, etc.).

### 4.3 Access validation (fase 5)

**FTP / FTPS**:
```js
const { Client } = require('basic-ftp');
const c = new Client(8000);          // 8s timeout
c.ftp.verbose = false;
try {
  await c.access({
    host, port,
    user: 'anonymous',
    password: 'anon@recon.tool',
    secure: kind === 'FTPS_IMPLICIT' ? 'implicit' :
            kind === 'FTPS_EXPLICIT' ? true : false,
    secureOptions: { rejectUnauthorized: false }
  });
  const list = await c.list('/');
  const writable = await tryWrite(c);   // intenta UPLOAD /.__recon_probe
  return { access: 'ANON_READ', writable, entries: list.length, sample: list.slice(0,10) };
} catch (e) {
  return { access: 'AUTH_REQUIRED', reason: e.message };
} finally { c.close(); }
```

**SFTP**:
```js
const { Client } = require('ssh2');
const DEFAULT_CREDS = [
  ['root','root'], ['root','toor'], ['root','admin'],
  ['admin','admin'], ['admin','password'],
  ['user','user'], ['pi','raspberry'],
  ['ubuntu','ubuntu'], ['ftp','ftp'],
  ['anonymous','anonymous'],
];
// Sólo si config.bruteSftp === true (opt-in explícito)
for (const [u,p] of DEFAULT_CREDS) {
  const r = await trySftp(host, port, u, p, 8000);
  if (r.ok) return { access: 'DEFAULT_CREDS', user: u, pass: p,
                     entries: r.entries, hostKey: r.fingerprint };
}
return { access: 'AUTH_REQUIRED', hostKey: await grabHostKey(host, port) };
```

> ⚠️ El bruteforce SFTP es **opt-in** y limitado a un diccionario diminuto (10 pares) con backoff de 500ms entre intentos para evitar fail2ban y dejar huella mínima. Documentar legalidad/autorización antes de habilitarlo.

---

## 5. Link de ingreso listo (★ feature estrella)

Por cada servicio accesible se genera un **AccessBundle**:

```ts
type AccessBundle = {
  protocol: 'ftp' | 'ftps' | 'sftp';
  host: string;
  port: number;
  user?: string;          // anonymous para FTP, root/admin/etc para SFTP
  pass?: string;          // sólo si credencial conocida
  url: string;            // ftp://anonymous@1.2.3.4:21/  | sftp://root:root@1.2.3.4:22/
  oneClick: {
    macos: string;        // open ftp://...
    finder: string;       // smb-style: open 'ftp://...'   (Cmd+K equivalente)
    linux: string;        // xdg-open  / gio mount
    windows: string;      // explorer ftp://...
    cli: string;          // lftp -u user,pass ftp://...   |  sftp user@host
    filezilla: string;    // filezilla "sftp://user:pass@host:port"
  };
  qrSvg: string;          // QR del url, para escanear desde móvil (Solid Explorer, FE File Explorer)
  warnings: string[];     // ["password en URL", "TLS self-signed", ...]
};
```

### 5.1 Reglas de generación

```js
function buildUrl({ protocol, host, port, user, pass }) {
  const auth = user
    ? (pass ? `${enc(user)}:${enc(pass)}@` : `${enc(user)}@`)
    : '';
  const defaultPort = { ftp:21, ftps:990, sftp:22 }[protocol];
  const portPart = port === defaultPort ? '' : `:${port}`;
  return `${protocol}://${auth}${host}${portPart}/`;
}
```

### 5.2 One-click por plataforma

| Plataforma | Comando | Comportamiento |
|---|---|---|
| macOS Finder | `open 'ftp://anon@host/'` | Monta como volumen read-only |
| macOS Finder SFTP | `open 'sftp://root@host/'` | Abre Cyberduck/Transmit si está |
| Linux GNOME | `gio mount 'sftp://root@host/'` | Monta en `~/.gvfs/` |
| Linux KDE | `kioclient5 exec 'sftp://root@host/'` | Abre en Dolphin |
| Windows | `explorer.exe ftp://anon@host/` | Abre como carpeta FTP nativa |
| CLI FTP | `lftp -u anonymous,anon@ ftp://host` | Shell interactiva moderna |
| CLI SFTP | `sftp -P 22 root@host` | OpenSSH client |
| FileZilla | `filezilla sftp://root:root@host:22` | GUI multiplataforma |
| WinSCP | `winscp.exe sftp://root:root@host/` | Windows GUI |
| iOS/Android | Escanear QR con FE File Explorer / Solid Explorer | Monta directamente |

### 5.3 Endpoint

```
GET  /api/access/:findingId          → AccessBundle
GET  /api/access/:findingId/qr.svg   → SVG inline
POST /api/access/:findingId/launch   → ejecuta `open <url>` en la máquina del backend (toggle, off por defecto)
```

---

## 6. Estructura de proyecto

```
ftp-sftp-recon-tool/
├─ backend/
│  ├─ src/
│  │  ├─ server.js
│  │  ├─ routes/
│  │  │   ├─ scan.js
│  │  │   ├─ access.js          ← genera AccessBundle + QR
│  │  │   └─ browse.js          ← explorador remoto (read-only)
│  │  ├─ services/
│  │  │   ├─ reconOrchestrator.js
│  │  │   ├─ probes/
│  │  │   │    ├─ masscan.js
│  │  │   │    ├─ ftp.js        ← basic-ftp wrapper
│  │  │   │    ├─ sftp.js       ← ssh2 wrapper
│  │  │   │    └─ banner.js     ← TCP/TLS banner grabber
│  │  │   ├─ accessLinkBuilder.js
│  │  │   ├─ credentialDictionary.js
│  │  │   └─ remoteBrowser.js
│  │  ├─ utils/
│  │  │   ├─ commandExecutor.js
│  │  │   ├─ logger.js
│  │  │   └─ ipUtils.js
│  │  └─ data/
│  │      └─ default-creds.json ← versionado, editable
│  └─ package.json
├─ frontend/
│  ├─ src/
│  │  ├─ App.tsx
│  │  ├─ pages/
│  │  │   └─ ReconTool.tsx
│  │  ├─ components/
│  │  │   ├─ ScanConfiguration.tsx
│  │  │   ├─ ScanProgress.tsx
│  │  │   ├─ ResultsDashboard.tsx
│  │  │   ├─ CriticalFindings.tsx
│  │  │   ├─ AccessLinkPanel.tsx  ← NUEVO
│  │  │   ├─ RemoteExplorerModal.tsx
│  │  │   └─ SudoPasswordModal.tsx
│  │  ├─ stores/recon.store.ts    ← Zustand
│  │  ├─ hooks/useScanSocket.ts
│  │  └─ services/api.ts          ← TanStack Query
│  └─ vite.config.ts
├─ clean-ports.js
├─ check-prerequisites.js
├─ start.sh / start-sudo.sh
├─ docs/
│  ├─ ARCHITECTURE.md
│  ├─ ACCESS_LINKS.md
│  └─ THREAT_MODEL.md
└─ README.md
```

---

## 7. API REST

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/api/scan/start` | Inicia escaneo con `{ ipRange, ports?, rate?, bruteSftp?, includeFtps?, sudoPassword? }` |
| GET  | `/api/scan/status/:scanId` | Estado actual |
| GET  | `/api/scan/results/:scanId` | Resultados finales |
| GET  | `/api/scan/export/:scanId` | Descarga JSON/CSV |
| POST | `/api/scan/cancel/:scanId` | Cancela y mata procesos asociados |
| GET  | `/api/access/:findingId` | AccessBundle completo |
| GET  | `/api/access/:findingId/qr.svg` | QR del URL |
| POST | `/api/access/:findingId/launch` | Lanza app local con la URL (opt-in) |
| GET  | `/api/browse/list?findingId&path=/` | Listado remoto read-only |
| GET  | `/api/browse/download?findingId&path=/file` | Descarga directa (streamed) |

### 7.1 Eventos Socket.IO

```ts
type ScanProgressEvent =
  | { stage:'started', message:string }
  | { stage:'masscan-progress', percentDone:number, hostFound?:Host }
  | { stage:'banner-progress', host:string, banner:string, kind:Protocol }
  | { stage:'validation-progress', host:string, port:number, result:Access }
  | { stage:'finding', finding:Finding }     // emit por cada hit accesible
  | { stage:'completed', results:Results }
  | { stage:'cancelled' | 'failed', error?:string };
```

---

## 8. Modelo de datos

```jsonc
{
  "192.168.1.42": {
    "host_status": "reachable",
    "open_ports": [21, 22],
    "services": {
      "21/ftp": {
        "kind": "FTP",
        "banner": "220 (vsFTPd 3.0.5)",
        "version": "vsFTPd 3.0.5",
        "access": "ANON_READ",
        "writable": false,
        "sample_entries": ["pub/", "incoming/", "readme.txt"],
        "warnings": ["plain-text protocol"],
        "access_bundle_id": "f1b2…"
      },
      "22/sftp": {
        "kind": "SFTP",
        "banner": "SSH-2.0-OpenSSH_9.6p1 Debian-1",
        "version": "OpenSSH 9.6p1",
        "host_key": {
          "type": "ssh-ed25519",
          "fingerprint": "SHA256:abcd…",
          "first_seen": "2026-06-07T05:42:11Z"
        },
        "access": "DEFAULT_CREDS",
        "credentials": { "user": "pi", "pass": "raspberry" },
        "sample_entries": ["bin/", "etc/", "home/"],
        "warnings": ["weak credentials"],
        "access_bundle_id": "a93e…"
      }
    },
    "response_ms": 412
  }
}
```

---

## 9. UI / UX

### 9.1 ScanConfiguration
Mismo layout que SMB, con switches extra:

- ☐ Incluir FTPS (puerto 990 + AUTH TLS en 21)
- ☐ Probar credenciales por defecto SFTP *(requiere confirmación legal — modal)*
- ☐ Probar escritura (sube/borra `__recon_probe.txt`)
- Slider de rate (packets/s)
- Multi-select de puertos extra (2121, 2222, 8021…)

### 9.2 ScanProgress
Igual al actual, con un track por protocolo (chip FTP / FTPS / SFTP con conteo en vivo).

### 9.3 ResultsDashboard

Cada host se expande mostrando un **card por servicio** con badge de color:

| Estado | Color | Acción primaria |
|---|---|---|
| `ANON_READ` (FTP) | rojo crítico | "Abrir como volumen" |
| `DEFAULT_CREDS` (SFTP) | rojo crítico | "Abrir terminal SFTP" |
| `AUTH_REQUIRED` | amarillo | "Copiar host key fingerprint" |
| `WRITABLE` | rojo + warning | "Banner + advertencia" |
| `ERROR` | gris | "Mostrar log" |

### 9.4 AccessLinkPanel (★)

Componente nuevo. Por cada hallazgo accesible:

```
┌──────────────────────────────────────────────────────────┐
│ ▸ 192.168.1.42 · vsFTPd 3.0.5 · ANON_READ           [QR]│
│                                                          │
│  ftp://anonymous@192.168.1.42/        [Copy] [Open ↗]   │
│                                                          │
│  ▸ macOS Finder     open 'ftp://anonymous@…'      [Run] │
│  ▸ Linux GNOME      gio mount 'ftp://…'           [Run] │
│  ▸ Windows          explorer.exe ftp://…          [Copy]│
│  ▸ CLI (lftp)       lftp -u anonymous, ftp://…    [Copy]│
│  ▸ FileZilla        filezilla 'ftp://anon@…'      [Copy]│
│                                                          │
│  📱  [QR grande para escanear desde móvil]              │
└──────────────────────────────────────────────────────────┘
```

Microinteracciones:
- Copy → animación de tick verde + toast
- Open ↗ → confirma y dispara `POST /access/:id/launch` (sólo si el backend corre en la misma máquina del operador)
- QR clickeable → fullscreen modal para escaneo cómodo
- Hover sobre warnings → tooltip explicativo

### 9.5 RemoteExplorerModal

Mismo patrón que `ShareExplorerModal` del SMB tool, pero:
- Para FTP usa `basic-ftp.list(path)`
- Para SFTP usa `sftp.readdir(path)`
- Permite descarga streamed vía `/api/browse/download`
- Breadcrumbs, ordenamiento por nombre/tamaño/fecha, búsqueda fuzzy

---

## 10. Seguridad

### 10.1 Lo que SÍ hacemos
- Single-port en `:3005` (igual SMB tool) tras backend con Helmet (CSP relajada para servir el SPA).
- CORS limitado a `localhost:3005` / `localhost:3000`.
- Sudo password nunca persistida; sólo en memoria durante el escaneo.
- Logs sanitizados: tokens y passwords se enmascaran como `[REDACTED]`.
- Diccionario de credenciales versionado y auditable.
- Rate-limit en `/api/access/:id/launch` (5 req/min).
- HostKey de SFTP almacenada y comparada en futuros escaneos → alerta por **MITM/host key change**.

### 10.2 Lo que NO hacemos (y por qué)
- ❌ Bruteforce real (más de 10 intentos): pasamos a fail2ban-territory rápido.
- ❌ Lanzar `open` automático en hallazgos sin confirmación humana.
- ❌ Mantener credenciales en clear-text al exportar; exportar genera placeholders `<REDACTED>` salvo flag `--include-secrets`.

### 10.3 Threat model resumido
| Riesgo | Mitigación |
|---|---|
| Operador escanea sin autorización | Banner legal obligatorio al iniciar, checkbox firmado por sesión |
| Captura de host keys SFTP rota | Whitelist por fingerprint persistida |
| Backend expuesto a Internet | Forzar bind `127.0.0.1` por defecto, `--public` requiere flag explícito |
| Inyección en `commandExecutor` | Validar IP/CIDR con regex + escapar shell-args con `shell-quote` |
| Stored XSS en banners parseados | Sanitizar con DOMPurify al render |

---

## 11. Comandos de arranque

```bash
npm run setup        # instala root + backend + frontend
npm run dev          # vite dev :3000 + nodemon backend :3005
npm start            # build SPA + arranca todo en :3005
./start-sudo.sh      # idem, con root para masscan
```

`check-prerequisites.js` verifica:
- `masscan` instalado
- Node 20+
- Permisos `sudo -n` o solicita password
- `lftp` opcional (sólo para mostrar one-click CLI)

---

## 12. Roadmap futuro (post-MVP)

| Hito | Valor |
|---|---|
| WebSFTP integrado (servir explorador SFTP en `:3005` con `ssh2-sftp-client` proxy) | UX wow, no requiere cliente externo |
| Detección de **SMB-over-SSH tunneling** | Pivot recon |
| Plugin system: añadir Telnet (23), RDP (3389), VNC (5900) | Reutiliza pipeline |
| Persistencia con SQLite (mejor que JSON en disco) | Histórico, diffs entre escaneos |
| Diff de escaneos: "nuevos hosts accesibles desde última vez" | Detección continua |
| Modo headless / API key | Integración con CI/CD de pentest |
| Export a Markdown report con screenshots auto-generadas | Entregables pro |
| AI summarizer: resume críticos en lenguaje natural | "3 SFTP con `pi:raspberry`, 1 vsFTPd 3.0.5 con CVE-2021-30047 colgando" |

---

## 13. Snippets de bootstrap

### 13.1 `package.json` raíz
```json
{
  "name": "ftp-sftp-recon-tool",
  "scripts": {
    "dev": "node clean-ports.js && node check-prerequisites.js && concurrently \"npm:dev:*\"",
    "dev:backend": "cd backend && npm run dev",
    "dev:frontend": "cd frontend && npm run dev",
    "build": "cd frontend && npm run build",
    "start": "node check-prerequisites.js && npm run build && cd backend && npm start",
    "setup": "npm i && cd backend && npm i && cd ../frontend && npm i"
  },
  "devDependencies": { "concurrently": "^9.0.0" }
}
```

### 13.2 `backend/package.json`
```json
{
  "dependencies": {
    "basic-ftp": "^5.0.5",
    "ssh2": "^1.16.0",
    "express": "^4.21.0",
    "socket.io": "^4.8.0",
    "helmet": "^8.0.0",
    "cors": "^2.8.5",
    "winston": "^3.14.0",
    "uuid": "^10.0.0",
    "qrcode": "^1.5.4",
    "shell-quote": "^1.8.1"
  },
  "devDependencies": { "nodemon": "^3.1.7" }
}
```

### 13.3 `frontend/package.json` (Vite + shadcn)
```json
{
  "dependencies": {
    "react": "^18.3.1",
    "react-dom": "^18.3.1",
    "socket.io-client": "^4.8.0",
    "@tanstack/react-query": "^5.59.0",
    "zustand": "^5.0.0",
    "lucide-react": "^0.456.0",
    "clsx": "^2.1.1",
    "tailwind-merge": "^2.5.4"
  },
  "devDependencies": {
    "vite": "^5.4.0",
    "@vitejs/plugin-react": "^4.3.0",
    "tailwindcss": "^4.0.0-beta",
    "typescript": "^5.6.0"
  }
}
```

### 13.4 `accessLinkBuilder.js` — núcleo
```js
const QRCode = require('qrcode');
const { quote } = require('shell-quote');

const DEFAULT_PORT = { ftp: 21, ftps: 990, sftp: 22 };

function enc(s) { return encodeURIComponent(s); }

function buildUrl({ protocol, host, port, user, pass }) {
  const auth = user ? (pass ? `${enc(user)}:${enc(pass)}@` : `${enc(user)}@`) : '';
  const portPart = port === DEFAULT_PORT[protocol] ? '' : `:${port}`;
  return `${protocol}://${auth}${host}${portPart}/`;
}

async function buildBundle(finding) {
  const url = buildUrl(finding);
  const warnings = [];
  if (finding.pass) warnings.push('password is embedded in URL — handle with care');
  if (finding.protocol === 'ftp') warnings.push('FTP transmits credentials in plain-text');

  return {
    protocol: finding.protocol,
    host: finding.host,
    port: finding.port,
    user: finding.user,
    pass: finding.pass,
    url,
    oneClick: {
      macos:     `open ${quote([url])}`,
      linux:     `xdg-open ${quote([url])}`,
      gnome:     `gio mount ${quote([url])}`,
      windows:   `explorer.exe ${url}`,
      cliFtp:    finding.protocol.startsWith('ftp')
                   ? `lftp -u ${quote([`${finding.user || 'anonymous'},${finding.pass || ''}`])} ${quote([url])}`
                   : null,
      cliSftp:   finding.protocol === 'sftp'
                   ? `sftp -P ${finding.port} ${quote([`${finding.user}@${finding.host}`])}`
                   : null,
      filezilla: `filezilla ${quote([url])}`,
      winscp:    `winscp.exe ${quote([url])}`,
    },
    qrSvg: await QRCode.toString(url, { type: 'svg', margin: 1, width: 256 }),
    warnings,
  };
}

module.exports = { buildBundle, buildUrl };
```

### 13.5 `probes/ftp.js` — probe ejemplo
```js
const { Client } = require('basic-ftp');

async function probeFtp(host, port, kind) {
  const c = new Client(8000);
  c.ftp.verbose = false;
  try {
    await c.access({
      host, port,
      user: 'anonymous',
      password: 'anon@recon.tool',
      secure: kind === 'FTPS_IMPLICIT' ? 'implicit'
            : kind === 'FTPS_EXPLICIT' ? true
            : false,
      secureOptions: { rejectUnauthorized: false },
    });
    const list = await c.list('/');
    return {
      access: 'ANON_READ',
      writable: await tryWrite(c).catch(() => false),
      entries: list.length,
      sample: list.slice(0, 10).map(e => ({ name: e.name, size: e.size, isDir: e.isDirectory })),
    };
  } catch (e) {
    return { access: 'AUTH_REQUIRED', reason: e.message };
  } finally {
    c.close();
  }
}

async function tryWrite(c) {
  const name = `.__recon_probe_${Date.now()}.txt`;
  try {
    await c.uploadFrom(Buffer.from('probe'), name);
    await c.remove(name);
    return true;
  } catch { return false; }
}

module.exports = { probeFtp };
```

### 13.6 `probes/sftp.js` — probe ejemplo
```js
const { Client } = require('ssh2');

function probeSftp(host, port, user, pass, timeoutMs = 8000) {
  return new Promise((resolve) => {
    const conn = new Client();
    let done = false;
    const t = setTimeout(() => { if (!done) { conn.end(); resolve({ ok: false, reason: 'timeout' }); } }, timeoutMs);

    let fingerprint = null;
    conn.on('hostkeys', keys => { fingerprint = keys[0]?.fingerprint?.('sha256'); });
    conn.on('ready', () => {
      conn.sftp((err, sftp) => {
        if (err) { done = true; clearTimeout(t); conn.end(); return resolve({ ok: false, reason: err.message }); }
        sftp.readdir('/', (err2, list) => {
          done = true; clearTimeout(t); conn.end();
          if (err2) return resolve({ ok: false, reason: err2.message, fingerprint });
          resolve({
            ok: true,
            fingerprint,
            entries: list.length,
            sample: list.slice(0, 10).map(e => ({ name: e.filename, size: e.attrs.size, isDir: e.attrs.isDirectory() })),
          });
        });
      });
    });
    conn.on('error', (e) => { done = true; clearTimeout(t); resolve({ ok: false, reason: e.message }); });
    conn.connect({ host, port, username: user, password: pass, readyTimeout: timeoutMs, algorithms: { serverHostKey: ['ssh-ed25519','ecdsa-sha2-nistp256','rsa-sha2-512','rsa-sha2-256'] } });
  });
}

module.exports = { probeSftp };
```

---

## 14. Criterios de aceptación (MVP)

- [ ] Escaneo `/24` en <60s con 1500 pps de rate
- [ ] Detecta y clasifica correctamente FTP, FTPS, SFTP por banner
- [ ] Valida anon-FTP y entrega `AccessBundle` clickeable
- [ ] Genera QR escaneable que abre la URL en Solid Explorer (Android)
- [ ] `open <url>` en macOS abre Finder con el FTP montado
- [ ] Explorer modal navegable hasta 5 niveles sin recargar
- [ ] Cancelación mata procesos hijos correctamente (igual SMB)
- [ ] Export JSON + CSV
- [ ] Banner legal mostrado al arranque + obligatorio para usar bruteforce SFTP
- [ ] HostKey persistido y alerta si cambia entre escaneos

---

## 15. Disclaimer

Esta herramienta es para **pentesting autorizado y educación**. El escaneo de redes sin permiso explícito puede ser ilegal según jurisdicción. El operador es responsable de cumplir con leyes locales, términos de servicio y políticas de uso aceptable. La inclusión de credenciales por defecto es para auditoría de hardening — no para abuso.
