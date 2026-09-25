/**
 * Share browse API: read-only directory listing for SMB shares.
 */
const express = require('express');
const router = express.Router();
const shareBrowser = require('../services/shareBrowserService');
const logger = require('../utils/logger');

/**
 * GET /api/share/browse
 * Query: host (required), share (required), path (optional), protocol (optional: smb|nfs)
 */
router.get('/browse', async (req, res) => {
  const { host, share, path, protocol } = req.query;
  const requestPath = path ?? '';

  if (!host || !share) {
    return res.status(400).json({ error: 'Missing required query: host, share' });
  }

  const hostStr = String(host).trim();
  const shareStr = String(share).trim();
  if (!hostStr || !shareStr) {
    return res.status(400).json({ error: 'host and share cannot be empty' });
  }

  logger.info('Share browse attempt', { host: hostStr, share: shareStr, path: requestPath, protocol });

  try {
    const entries = await shareBrowser.browse(hostStr, shareStr, requestPath, protocol);
    return res.json(entries);
  } catch (err) {
    logger.warn('Share browse failed', { host: hostStr, share: shareStr, error: err.message });
    const code = err.message.includes('timeout') ? 408 : 502;
    return res.status(code).json({ error: err.message || 'Browse failed' });
  }
});

module.exports = router;
