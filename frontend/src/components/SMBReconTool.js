import React, { useState, useEffect, useRef } from 'react';
import { io } from 'socket.io-client';
import { storage } from '../utils/storage';
import ScanConfiguration from './ScanConfiguration';
import ScanProgress from './ScanProgress';
import ResultsDashboard from './ResultsDashboard';
import CriticalFindings from './CriticalFindings';
import SudoPasswordModal from './SudoPasswordModal';
import SavedScans from './SavedScans';
import ShareExplorerModal from './ShareExplorerModal';
import { Shield, Activity, AlertTriangle, History } from 'lucide-react';

const SMBReconTool = () => {
  const [currentView, setCurrentView] = useState('config'); // config, scanning, results
  const [scanId, setScanId] = useState(null);
  const [scanConfig, setScanConfig] = useState(null);
  const [scanResults, setScanResults] = useState(null);
  const [progressData, setProgressData] = useState(null);
  const [showSudoModal, setShowSudoModal] = useState(false);
  const [sudoError, setSudoError] = useState(null);
  const [showSavedScansModal, setShowSavedScansModal] = useState(false);
  const [sudoModalShownForScan, setSudoModalShownForScan] = useState(null);
  const [shareExplorer, setShareExplorer] = useState({ open: false, host: null, share: null, protocol: 'smb' });
  const socketRef = useRef(null);

  const openShareExplorer = (host, share, shareMeta = null) => {
    const protocol =
      shareMeta?.protocol === 'nfs' || shareMeta?.type === 'NFS' || String(share || '').startsWith('/')
        ? 'nfs'
        : 'smb';
    setShareExplorer({ open: true, host, share, protocol });
  };

  useEffect(() => {
    let mounted = true;

    // Connect to backend Socket.IO
    try {
      socketRef.current = io('http://localhost:3005', {
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionAttempts: 5,
        timeout: 5000
      });

      socketRef.current.on('connect', () => {
        // Socket connected
      });

      socketRef.current.on('scan-progress', (data) => {
        if (mounted) setProgressData(data);
      });

      socketRef.current.on('disconnect', () => {
        // Socket disconnected
      });

      socketRef.current.on('connect_error', (error) => {
        // Don't block the UI if backend is not available
      });
    } catch (error) {
      // Don't block the UI if Socket.IO fails
    }

    return () => {
      mounted = false;
      if (socketRef.current) {
        socketRef.current.disconnect();
      }
    };
  }, []);

  const handleScanStart = async (config) => {
    // Prevent multiple scans
    if (currentView === 'scanning') {
      return;
    }

    // Prevent starting a scan if the IP range is already stored in history
    try {
      const savedScans = storage.getSavedScans();
      const existsForIp = savedScans.some(
        (scan) => scan?.config?.ipRange && scan.config.ipRange === config.ipRange
      );

      if (existsForIp) {
        alert(`Ya existe un escaneo guardado para la IP/rango "${config.ipRange}". Revisa las búsquedas guardadas antes de lanzar uno nuevo.`);
        return;
      }
    } catch (e) {
      // If localStorage fails, we silently ignore and allow the scan
    }

    // Reset ALL modal state when starting a new scan
    setShowSudoModal(false);
    setSudoError(null);
    setSudoModalShownForScan(null);

    try {
      const response = await fetch('http://localhost:3005/api/scan/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(config),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start scan');
      }

      const data = await response.json();
      setScanId(data.scanId);
      setScanConfig(config);
      setCurrentView('scanning');
      setProgressData({ stage: 'started', data: { message: 'Starting SMB reconnaissance scan' } });
    } catch (error) {
      console.error('Failed to start scan:', error);
      alert(`Failed to start scan: ${error.message}`);
    }
  };

  const handleSudoPasswordSubmit = async (password) => {
    try {
      // Cancel the previous scan if it exists
      if (scanId) {
        try {
          await fetch(`http://localhost:3005/api/scan/cancel/${scanId}`, {
            method: 'POST',
          });
        } catch (cancelError) {
          // Ignore cancellation errors
        }
      }

      const configWithPassword = { ...scanConfig, sudoPassword: password };

      const response = await fetch('http://localhost:3005/api/scan/start', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(configWithPassword),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || 'Failed to start scan with sudo password');
      }

      const data = await response.json();
      
      // IMPORTANT: Clear modal state and progress FIRST
      setShowSudoModal(false);
      setSudoError(null);
      setSudoModalShownForScan(null);
      setProgressData(null); // Clear old progress
      
      // Then set new scan ID (this will trigger component reset via key prop)
      setScanId(data.scanId);
      setScanConfig(configWithPassword);
      
      // Wait a bit before setting progress to ensure component has reset
      setTimeout(() => {
        setProgressData({ 
          stage: 'started', 
          data: { message: 'Starting SMB reconnaissance scan with elevated privileges' } 
        });
      }, 100);
    } catch (error) {
      console.error('Failed to start scan with sudo password:', error);
      setSudoError(error.message);
    }
  };

  const handleSudoPasswordCancel = () => {
    setShowSudoModal(false);
    setScanConfig(null);
    setSudoError(null);
    setSudoModalShownForScan(null);
  };

  const handleScanComplete = (results, error) => {
    if (error && error.toLowerCase().includes('root privileges')) {
      // If the error is about root privileges, show the sudo modal
      setShowSudoModal(true);
      setSudoError(null);
      // Keep the current view and config, just show modal
      return;
    } else if (error) {
      // Other error
      alert(`Scan failed: ${error}`);
      setCurrentView('config');
      setScanId(null);
      setScanConfig(null);
      setScanResults(null);
      setProgressData(null);
    } else {
      // Save to history only if the scan had exposed shares (READ access)
      const hasExposedShares = results && Object.values(results).some((host) =>
        Object.values(host.shares || {}).some((s) => s.access === 'READ')
      );
      if (hasExposedShares) {
        try {
          const saved = storage.saveScan({
            name: scanConfig.name || `Scan ${new Date().toLocaleString()}`,
            config: scanConfig,
            results: results
          });
          // Debug: confirm save
          // eslint-disable-next-line no-console
          console.debug('Saved scan to history', { id: saved?.id, name: saved?.name, timestamp: saved?.timestamp });
        } catch (saveError) {
          // eslint-disable-next-line no-console
          console.error('Failed to save scan to history', saveError);
        }
      } else {
        // Debug: nothing to save (no READ shares)
        // eslint-disable-next-line no-console
        console.debug('Scan not saved: no exposed READ shares detected', { config: scanConfig });
      }

      setScanResults(results);
      setCurrentView('results');
    }
  };

  const handleScanCancel = async () => {
    if (!scanId) return;

    try {
      await fetch(`http://localhost:3005/api/scan/cancel/${scanId}`, {
        method: 'POST',
      });
      setCurrentView('config');
      setScanId(null);
      setScanConfig(null);
      setScanResults(null);
      setShowSudoModal(false);
      setSudoError(null);
      setSudoModalShownForScan(null);
      setProgressData(null);
    } catch (error) {
      console.error('Failed to cancel scan:', error);
    }
  };

  const handleNewScan = () => {
    setCurrentView('config');
    setScanId(null);
    setScanConfig(null);
    setScanResults(null);
    setProgressData(null);
    setShowSudoModal(false);
    setSudoError(null);
    setSudoModalShownForScan(null);
  };

  const handleLoadSavedScan = (config) => {
    // Load the saved configuration
    setScanConfig(config);
    setCurrentView('config');
  };

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="border-b border-border bg-card">
        <div className="w-full max-w-9xl mx-auto px-5 sm:px-8 lg:px-10 py-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-3">
              <Shield className="h-9 w-9 sm:h-10 sm:w-10 text-primary shrink-0" />
              <div>
                <h1 className="text-2xl sm:text-3xl font-bold text-foreground">SMB Automated Recon Tool</h1>
                <p className="text-sm sm:text-base text-muted-foreground">Automated SMB discovery and access validation</p>
              </div>
            </div>
            <div className="flex items-center space-x-4">
              <button
                onClick={() => setShowSavedScansModal(true)}
                className="flex items-center space-x-2 px-4 py-2.5 text-sm sm:text-base bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
                title="View saved scans"
              >
                <History className="h-5 w-5" />
                <span className="hidden md:inline">Saved Scans</span>
              </button>
              {scanId && (
                <div className="flex items-center space-x-2 text-sm sm:text-base text-muted-foreground">
                  <Activity className="h-5 w-5" />
                  <span>Scan ID: {scanId.slice(0, 8)}...</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </header>

      {/* Navigation */}
      <nav className="border-b border-border bg-muted/50">
        <div className="w-full max-w-9xl mx-auto px-5 sm:px-8 lg:px-10">
          <div className="flex space-x-8 lg:space-x-10">
            <button
              onClick={() => setCurrentView('config')}
              className={`py-4 lg:py-5 px-2 border-b-2 font-medium text-sm sm:text-base ${
                currentView === 'config'
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              Configuration
            </button>
            {scanResults && (
              <>
                <button
                  onClick={() => setCurrentView('results')}
                  className={`py-4 lg:py-5 px-2 border-b-2 font-medium text-sm sm:text-base ${
                    currentView === 'results'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  Results
                </button>
                <button
                  onClick={() => setCurrentView('critical')}
                  className={`py-4 lg:py-5 px-2 border-b-2 font-medium text-sm sm:text-base flex items-center space-x-1 ${
                    currentView === 'critical'
                      ? 'border-primary text-primary'
                      : 'border-transparent text-muted-foreground hover:text-foreground'
                  }`}
                >
                  <AlertTriangle className="h-4 w-4" />
                  <span>Critical Findings</span>
                </button>
              </>
            )}
          </div>
        </div>
      </nav>

      {/* Main Content */}
      <main className="w-full max-w-9xl mx-auto px-5 sm:px-8 lg:px-10 py-8 lg:py-12">
        {currentView === 'config' && (
          <ScanConfiguration
            onScanStart={handleScanStart}
            isScanning={currentView === 'scanning'}
          />
        )}

        {currentView === 'scanning' && scanId && (
          <ScanProgress
            key={scanId}
            scanId={scanId}
            config={scanConfig}
            progressData={progressData}
            onCancel={handleScanCancel}
            onComplete={handleScanComplete}
            onSudoRequired={() => {
              // Only show modal once per scan
              if (sudoModalShownForScan === scanId) {
                return;
              }
              setShowSudoModal(true);
              setSudoError(null);
              setSudoModalShownForScan(scanId);
            }}
          />
        )}

        {currentView === 'results' && scanResults && (
          <ResultsDashboard
            results={scanResults}
            onNewScan={handleNewScan}
            scanId={scanId}
            onOpenShareExplorer={openShareExplorer}
          />
        )}

        {currentView === 'critical' && scanResults && (
          <CriticalFindings
            results={scanResults}
            onNewScan={handleNewScan}
            onOpenShareExplorer={openShareExplorer}
          />
        )}
      </main>

      {/* Sudo Password Modal */}
      <SudoPasswordModal
        isOpen={showSudoModal}
        onSubmit={handleSudoPasswordSubmit}
        onCancel={handleSudoPasswordCancel}
        error={sudoError}
      />

      {/* Saved Scans Modal */}
      {showSavedScansModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-background border border-border rounded-lg shadow-xl max-w-9xl w-full max-h-[90vh] overflow-hidden">
            <div className="p-6 border-b border-border">
              <div className="flex items-center justify-between">
                <h2 className="text-xl font-semibold">Búsquedas Guardadas</h2>
                <button
                  onClick={() => setShowSavedScansModal(false)}
                  className="p-2 hover:bg-muted rounded-md transition-colors"
                >
                  <span className="text-2xl">&times;</span>
                </button>
              </div>
            </div>
            <div className="p-6 max-h-[calc(90vh-120px)] overflow-y-auto">
              <SavedScans
                onLoadScan={handleLoadSavedScan}
                onClose={() => setShowSavedScansModal(false)}
                onOpenShareExplorer={openShareExplorer}
              />
            </div>
          </div>
        </div>
      )}

      {/* Share Explorer (fullscreen SMB/NFS file browser) */}
      <ShareExplorerModal
        isOpen={shareExplorer.open}
        onClose={() => setShareExplorer({ open: false, host: null, share: null, protocol: 'smb' })}
        host={shareExplorer.host}
        share={shareExplorer.share}
        protocol={shareExplorer.protocol}
      />
    </div>
  );
};

export default SMBReconTool;