/**
 * Share browser service: read-only directory listing for SMB and NFS.
 * SMB uses smb2 null session. NFS uses temporary mount (requires root/sudo).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');
const SMB2 = require('smb2');
const logger = require('../utils/logger');
const sudoSession = require('../utils/sudoSession');

const MAX_DEPTH = 30;
const BROWSE_TIMEOUT_MS = 60000; // 60s for slow shares / many files
const SENSITIVE_EXTENSIONS = new Set(['.sql', '.bak', '.xlsx', '.csv', '.env', '.config', '.key', '.pem']);
const SENSITIVE_SUBSTRINGS = ['backup', 'payroll', 'password', 'secret', 'credential'];

/**
 * Normalize and validate path. Prevents path traversal (../).
 * @param {string} rawPath - path from query
 * @returns {{ valid: boolean, normalized: string, error?: string }}
 */
function sanitizePath(rawPath) {
  if (rawPath == null || typeof rawPath !== 'string') {
    return { valid: true, normalized: '' };
  }
  const trimmed = rawPath.trim();
  if (trimmed === '') return { valid: true, normalized: '' };
  if (trimmed.includes('..') || /[<>"|?*]/.test(trimmed)) {
    return { valid: false, normalized: '', error: 'Invalid path' };
  }
  const normalized = trimmed.replace(/\/+/g, '/').replace(/^\/|\/$/g, '');
  const segments = normalized ? normalized.split('/') : [];
  if (segments.length > MAX_DEPTH) {
    return { valid: false, normalized: '', error: 'Path too deep' };
  }
  return { valid: true, normalized };
}

/**
 * Check if a file entry should be marked as sensitive.
 */
function isSensitiveFileName(name) {
  const lower = name.toLowerCase();
  const ext = lower.includes('.') ? lower.slice(lower.lastIndexOf('.')) : '';
  if (SENSITIVE_EXTENSIONS.has(ext)) return true;
  return SENSITIVE_SUBSTRINGS.some((s) => lower.includes(s));
}

/**
 * Run a promise with a timeout.
 */
function withTimeout(promise, ms, message) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(message || 'Timeout')), ms)
    )
  ]);
}

function isNfsShare(shareName, protocol) {
  if (protocol && String(protocol).toLowerCase() === 'nfs') return true;
  return String(shareName || '').startsWith('/');
}

function buildPrivilegedCommand(baseCommand) {
  const isRoot = process.getuid && process.getuid() === 0;
  if (isRoot) return baseCommand;
  const sudoPassword = sudoSession.get();
  if (sudoPassword) {
    return `echo "${sudoPassword}" | sudo -S ${baseCommand}`;
  }
  return `sudo -n ${baseCommand}`;
}

function runShell(command, timeoutMs = 20000) {
  try {
    const stdout = execSync(command, {
      timeout: timeoutMs,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe']
    });
    return { success: true, stdout: stdout || '', stderr: '' };
  } catch (err) {
    return {
      success: false,
      stdout: (err.stdout && String(err.stdout)) || '',
      stderr: (err.stderr && String(err.stderr)) || err.message || ''
    };
  }
}

function mountNFS(host, exportPath, mountPoint) {
  const safeExport = String(exportPath).startsWith('/') ? exportPath : `/${exportPath}`;
  const target = `${host}:${safeExport}`;
  const opts = 'ro,soft,timeo=5,retrans=1,nolock';
  const attempts = [
    `mount -t nfs -o ${opts} ${target} ${mountPoint} 2>&1`,
    `mount -t nfs4 -o ro,soft ${target} ${mountPoint} 2>&1`,
    `mount -t nfs -o vers=4,ro,soft ${target} ${mountPoint} 2>&1`
  ];

  let last = { success: false, stdout: '', stderr: 'mount failed' };
  for (const base of attempts) {
    last = runShell(buildPrivilegedCommand(base));
    if (last.success) return last;
    const combined = `${last.stdout} ${last.stderr}`.toLowerCase();
    if (combined.includes('a password is required') || combined.includes('incorrect password')) {
      return last;
    }
  }
  return last;
}

function unmountNFS(mountPoint) {
  const attempts = [
    `umount ${mountPoint} 2>&1`,
    `umount -f ${mountPoint} 2>&1`,
    `diskutil unmount force ${mountPoint} 2>&1`
  ];
  for (const base of attempts) {
    const result = runShell(buildPrivilegedCommand(base), 10000);
    if (result.success) return;
  }
}

function listLocalDirectory(dirPath) {
  const names = fs.readdirSync(dirPath, { withFileTypes: true });
  const entries = names
    .filter((d) => d.name !== '.' && d.name !== '..')
    .map((dirent) => {
      const entry = {
        name: dirent.name,
        type: dirent.isDirectory() ? 'folder' : 'file',
        size: null,
        modified: null
      };
      if (!dirent.isDirectory()) {
        try {
          const st = fs.statSync(path.join(dirPath, dirent.name));
          entry.size = st.size;
          entry.modified = st.mtime ? st.mtime.toISOString() : null;
        } catch (e) {
          // ignore
        }
        if (isSensitiveFileName(dirent.name)) entry.isSensitive = true;
      }
      return entry;
    });
  sortEntries(entries);
  return entries;
}

async function browseNFS(host, exportPath, subPath = '') {
  const pathResult = sanitizePath(subPath);
  if (!pathResult.valid) {
    throw new Error(pathResult.error || 'Invalid path');
  }

  const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), 'nfs-browse-'));
  try {
    const mountResult = mountNFS(host, exportPath, mountPoint);
    if (!mountResult.success) {
      const detail = (mountResult.stdout || mountResult.stderr || 'mount failed').trim();
      throw new Error(`NFS mount failed: ${detail.slice(0, 200)}`);
    }

    const targetDir = pathResult.normalized
      ? path.join(mountPoint, pathResult.normalized)
      : mountPoint;

    if (!fs.existsSync(targetDir)) {
      throw new Error('Path not found on NFS export');
    }

    return listLocalDirectory(targetDir);
  } finally {
    unmountNFS(mountPoint);
    try {
      fs.rmdirSync(mountPoint);
    } catch (e) {
      // ignore
    }
  }
}

/**
 * List directory contents over SMB (null session) or NFS (temp mount). Read-only.
 * @param {string} host - IP or hostname
 * @param {string} shareName - share name (e.g. "public") or NFS export (e.g. "/export")
 * @param {string} path - optional path inside share (default "")
 * @param {string} [protocol] - optional "nfs" | "smb"
 * @returns {Promise<Array<{ name, type, size, modified, isSensitive? }>>}
 */
async function browse(host, shareName, dirPath = '', protocol) {
  if (isNfsShare(shareName, protocol)) {
    return withTimeout(
      Promise.resolve().then(() => browseNFS(host, shareName, dirPath)),
      BROWSE_TIMEOUT_MS,
      'Browse timeout'
    );
  }

  const pathResult = sanitizePath(dirPath);
  if (!pathResult.valid) {
    throw new Error(pathResult.error || 'Invalid path');
  }
  const safePath = pathResult.normalized;

  const share = `\\\\${host}\\${shareName}`;
  // Guest/anonymous (invitado): empty domain/user/pass = null session
  const client = new SMB2({
    share,
    domain: '',
    username: '',
    password: '',
    port: 445,
    autoCloseTimeout: 10000
  });

  const smbPath = safePath ? safePath.replace(/\//g, '\\') : '';

  const list = await withTimeout(
    listDirectory(client, smbPath),
    BROWSE_TIMEOUT_MS,
    'Browse timeout'
  );

  try {
    client.close();
  } catch (e) {
    // ignore
  }

  return list;
}

const RESOLVE_CONCURRENCY = 12; // limit parallel readdirs to avoid overwhelming slow shares

async function runInBatches(items, batchSize, fn) {
  const results = [];
  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    const batchResults = await Promise.all(batch.map(fn));
    results.push(...batchResults);
  }
  return results;
}

/**
 * List directory: get names, then resolve type (folder vs file) for each.
 */
function listDirectory(client, smbPath) {
  return new Promise((resolve, reject) => {
    client.readdir(smbPath, async (err, names) => {
      if (err) {
        reject(err);
        return;
      }
      if (!names || !Array.isArray(names)) {
        resolve([]);
        return;
      }
      const pathPrefix = smbPath ? smbPath + '\\' : '';
      const entries = await runInBatches(
        names,
        RESOLVE_CONCURRENCY,
        (name) => resolveEntry(client, pathPrefix, name)
      );
      sortEntries(entries.filter(Boolean));
      resolve(entries.filter(Boolean));
    });
  });
}

function resolveEntry(client, pathPrefix, name) {
  const fullPath = pathPrefix + name;
  return new Promise((res) => {
    client.readdir(fullPath, (err) => {
      const isFolder = !err;
      const entry = {
        name,
        type: isFolder ? 'folder' : 'file',
        size: null,
        modified: null
      };
      if (!isFolder && isSensitiveFileName(name)) {
        entry.isSensitive = true;
      }
      res(entry);
    });
  });
}

function sortEntries(entries) {
  entries.sort((a, b) => {
    if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  });
}

module.exports = {
  browse,
  sanitizePath,
  isSensitiveFileName,
  isNfsShare
};
