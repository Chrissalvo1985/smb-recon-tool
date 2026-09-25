/**
 * API client for share browse (read-only SMB/NFS directory listing).
 */
const API_BASE = process.env.REACT_APP_API_URL || 'http://localhost:3005';

export async function browseShare(host, share, path = '', protocol) {
  const params = new URLSearchParams({ host, share });
  if (path) params.set('path', path);
  if (protocol) params.set('protocol', protocol);
  const res = await fetch(`${API_BASE}/api/share/browse?${params.toString()}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || res.statusText || 'Browse failed');
  }
  return res.json();
}
