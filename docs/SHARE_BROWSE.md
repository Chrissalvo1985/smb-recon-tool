# Share Browse (SMB / NFS File Explorer)

Read-only in-app file explorer for SMB shares and NFS exports that have anonymous read access.

## Backend

- **Route:** `GET /api/share/browse?host=<ip>&share=<name>&path=<optional>&protocol=<smb|nfs>`
- **SMB:** `smb2` null session on port 445.
- **NFS:** temporary mount of the export (requires root or sudo; reuses sudo password from the last scan when available). Share names starting with `/` are treated as NFS exports.
- **Security:** Path sanitized (no `..`), max depth 30, 60s timeout, read-only. Access is logged.

## Frontend

- **Component:** `ShareExplorerModal` – fullscreen modal with breadcrumb, grid/list view, folder navigation, cache.
- **API base URL:** Optional `REACT_APP_API_URL` (default `http://localhost:3005`). Set only if the API is served from another origin.

## Usage

From **Critical Findings**, **Results** (expanded share list), or **Saved Scans** (risky shares modal), use **Explorar** to open the browser. NFS findings show an `nfs://` link; SMB keeps `smb://`.
