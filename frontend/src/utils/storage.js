// Utility functions for localStorage management

const SAVED_SCANS_KEY = 'smb-recon-saved-scans';
const LAST_SCAN_CONFIG_KEY = 'smb-recon-last-scan-config';

export const storage = {
  // Get all saved scans
  getSavedScans: () => {
    try {
      const scans = localStorage.getItem(SAVED_SCANS_KEY);
      return scans ? JSON.parse(scans) : [];
    } catch (error) {
      console.error('Error reading from localStorage:', error);
      return [];
    }
  },

  // Get last scan configuration
  getLastScanConfig: () => {
    try {
      const config = localStorage.getItem(LAST_SCAN_CONFIG_KEY);
      return config ? JSON.parse(config) : null;
    } catch (error) {
      console.error('Error reading last scan config:', error);
      return null;
    }
  },

  // Save last scan configuration
  saveLastScanConfig: (config) => {
    try {
      localStorage.setItem(LAST_SCAN_CONFIG_KEY, JSON.stringify(config));
    } catch (error) {
      console.error('Error saving last scan config:', error);
    }
  },

  // Save a new scan
  saveScan: (scanData) => {
    try {
      const scans = storage.getSavedScans();
      const newScan = {
        id: Date.now().toString(),
        name: scanData.name || `Scan ${new Date().toLocaleString()}`,
        config: scanData.config,
        timestamp: new Date().toISOString(),
        results: scanData.results || null
      };
      scans.unshift(newScan); // Add to beginning

      try {
        localStorage.setItem(SAVED_SCANS_KEY, JSON.stringify(scans));
        return newScan;
      } catch (err) {
        // Handle quota exceeded: try to free space by trimming oldest entries
        if (err && (err.name === 'QuotaExceededError' || err.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err.code === 22)) {
          // 1) Remove oldest scans until it fits
          let trimmed = 0;
          while (scans.length > 1) {
            scans.pop();
            trimmed += 1;
            try {
              localStorage.setItem(SAVED_SCANS_KEY, JSON.stringify(scans));
              // eslint-disable-next-line no-console
              console.warn(`Storage quota exceeded — trimmed ${trimmed} old scan(s) to save new scan`);
              return newScan;
            } catch (err2) {
              if (!(err2 && (err2.name === 'QuotaExceededError' || err2.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err2.code === 22))) {
                // different error — rethrow
                throw err2;
              }
            }
          }

          // 2) If still failing, try saving without results to reduce size
          try {
            const minimal = scans.map((s, i) => (i === 0 ? { ...s, results: null } : { ...s, results: null }));
            localStorage.setItem(SAVED_SCANS_KEY, JSON.stringify(minimal));
            // eslint-disable-next-line no-console
            console.warn('Storage quota exceeded — saved scans without results to reduce size');
            return { ...newScan, results: null };
          } catch (err3) {
            if (!(err3 && (err3.name === 'QuotaExceededError' || err3.name === 'NS_ERROR_DOM_QUOTA_REACHED' || err3.code === 22))) {
              throw err3;
            }
          }

          // 3) Final fallback: store only metadata for history
          try {
            const metaOnly = scans.map((s) => ({ id: s.id, name: s.name, config: s.config, timestamp: s.timestamp }));
            localStorage.setItem(SAVED_SCANS_KEY, JSON.stringify(metaOnly));
            // eslint-disable-next-line no-console
            console.warn('Storage quota exceeded — saved only metadata for scans');
            return { id: newScan.id, name: newScan.name, config: newScan.config, timestamp: newScan.timestamp, results: null };
          } catch (err4) {
            // All fallback attempts failed — rethrow original error
            // eslint-disable-next-line no-console
            console.error('All attempts to save scan failed due to storage quota', err4);
            throw err4;
          }
        }
        throw err;
      }
    } catch (error) {
      console.error('Error saving to localStorage:', error);
      throw error;
    }
  },

  // Delete a saved scan
  deleteScan: (scanId) => {
    try {
      const scans = storage.getSavedScans();
      const filteredScans = scans.filter(scan => scan.id !== scanId);
      localStorage.setItem(SAVED_SCANS_KEY, JSON.stringify(filteredScans));
    } catch (error) {
      console.error('Error deleting from localStorage:', error);
      throw error;
    }
  },

  // Delete multiple saved scans by id
  deleteScans: (scanIds) => {
    if (!Array.isArray(scanIds) || scanIds.length === 0) return;
    try {
      const idsSet = new Set(scanIds);
      const scans = storage.getSavedScans();
      const filteredScans = scans.filter(scan => !idsSet.has(scan.id));
      localStorage.setItem(SAVED_SCANS_KEY, JSON.stringify(filteredScans));
    } catch (error) {
      console.error('Error deleting scans from localStorage:', error);
      throw error;
    }
  },

  // Update a saved scan with results
  updateScanResults: (scanId, results) => {
    try {
      const scans = storage.getSavedScans();
      const scanIndex = scans.findIndex(scan => scan.id === scanId);
      if (scanIndex !== -1) {
        scans[scanIndex].results = results;
        scans[scanIndex].timestamp = new Date().toISOString();
        localStorage.setItem(SAVED_SCANS_KEY, JSON.stringify(scans));
      }
    } catch (error) {
      console.error('Error updating scan results:', error);
      throw error;
    }
  }
};