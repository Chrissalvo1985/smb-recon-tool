const express = require('express');
const { v4: uuidv4 } = require('uuid');
const SMBScanner = require('../services/smbScanner');
const logger = require('../utils/logger');

const router = express.Router();

// Initialize scanner with Socket.IO instance
let scanner = null;

router.use((req, res, next) => {
  if (!scanner) {
    scanner = new SMBScanner(req.app.get('io'));
  }
  next();
});

// Start a new scan
router.post('/start', async (req, res) => {
  try {
    const scanId = uuidv4();
    const config = req.body;

    // Validate required parameters
    if (!config.ipRange) {
      return res.status(400).json({ error: 'ipRange is required' });
    }

    // Validate IP range format (basic validation)
    const ipRangeRegex = /^(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\/\d{1,2}|\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/;
    if (!ipRangeRegex.test(config.ipRange)) {
      return res.status(400).json({ error: 'Invalid IP range format. Use CIDR notation (e.g., 192.168.1.0/24) or single IP' });
    }

    // Start scan asynchronously
    scanner.startScan(scanId, config).catch(error => {
      logger.error('Scan failed:', error);
    });

    res.json({
      scanId,
      status: 'started',
      message: 'SMB reconnaissance scan started'
    });

  } catch (error) {
    logger.error('Failed to start scan:', error);
    res.status(500).json({ error: 'Failed to start scan' });
  }
});

// Get scan status
router.get('/status/:scanId', (req, res) => {
  const { scanId } = req.params;
  const scanData = scanner.getScanStatus(scanId);

  if (!scanData) {
    return res.status(404).json({ error: 'Scan not found' });
  }

  res.json(scanData);
});

// Cancel a scan
router.post('/cancel/:scanId', (req, res) => {
  const { scanId } = req.params;
  const cancelled = scanner.cancelScan(scanId);

  if (cancelled) {
    res.json({ message: 'Scan cancelled successfully' });
  } else {
    res.status(400).json({ error: 'Could not cancel scan' });
  }
});

// Get scan results
router.get('/results/:scanId', (req, res) => {
  const { scanId } = req.params;
  const scanData = scanner.getScanStatus(scanId);

  if (!scanData) {
    return res.status(404).json({ error: 'Scan not found' });
  }

  if (scanData.status !== 'completed') {
    return res.status(400).json({ error: 'Scan not yet completed' });
  }

  res.json(scanData.results);
});

// Export results as JSON
router.get('/export/:scanId', (req, res) => {
  const { scanId } = req.params;
  const scanData = scanner.getScanStatus(scanId);

  if (!scanData || scanData.status !== 'completed') {
    return res.status(404).json({ error: 'Completed scan not found' });
  }

  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename=smb-scan-${scanId}.json`);
  res.json(scanData);
});

// Get active scans
router.get('/active', (req, res) => {
  const activeScans = Array.from(scanner.activeScans.entries())
    .filter(([, scan]) => scan.status === 'running')
    .map(([scanId, scan]) => ({
      scanId,
      status: scan.status,
      startedAt: scan.startedAt,
      config: scan.config
    }));

  res.json(activeScans);
});

module.exports = router;