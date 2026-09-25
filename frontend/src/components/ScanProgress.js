import React, { useState, useEffect, useRef } from 'react';
import { Activity, X, CheckCircle, AlertCircle, Clock } from 'lucide-react';

const POLL_BACKOFF_AFTER_FAILURES = 3; // Stop polling after N consecutive connection failures

// Estimate total IPs from an ipRange string (CIDRs / single IPs, space or comma separated)
const countTotalIps = (ipRange) => {
  if (!ipRange) return 0;
  return ipRange
    .split(/[\s,]+/)
    .filter(Boolean)
    .reduce((total, entry) => {
      const cidrMatch = entry.match(/\/(\d{1,2})$/);
      if (cidrMatch) {
        const prefix = parseInt(cidrMatch[1], 10);
        if (prefix >= 0 && prefix <= 32) return total + 2 ** (32 - prefix);
        return total;
      }
      return total + 1; // single IP
    }, 0);
};

const ScanProgress = ({ scanId, config, progressData, onCancel, onComplete, onSudoRequired }) => {
  const [scanStatus, setScanStatus] = useState(null);
  const [currentStage, setCurrentStage] = useState('waiting');
  const [hostsFound, setHostsFound] = useState([]);
  const [masscanProgress, setMasscanProgress] = useState({ percentDone: 0, timeRemaining: null });
  const [backendUnreachable, setBackendUnreachable] = useState(false);
  const pollFailuresRef = useRef(0);

  // Reset component state when scanId changes
  useEffect(() => {
    setScanStatus(null);
    setCurrentStage('waiting');
    setHostsFound([]);
    setMasscanProgress({ percentDone: 0, timeRemaining: null });
    setBackendUnreachable(false);
    pollFailuresRef.current = 0;
  }, [scanId]);

  const fetchResults = React.useCallback(async () => {
    try {
      const response = await fetch(`http://localhost:3005/api/scan/results/${scanId}`);
      if (response.ok) {
        const results = await response.json();
        onComplete(results);
      }
    } catch (error) {
      console.error('Failed to fetch results:', error);
    }
  }, [scanId, onComplete]);

  useEffect(() => {
    if (progressData) {
      setCurrentStage(progressData.stage);

      // Reset hosts list when starting a new scan
      if (progressData.stage === 'started') {
        setHostsFound([]);
        setMasscanProgress({ percentDone: 0, timeRemaining: null });
      }

      // Track hosts found during masscan
      if (progressData.stage === 'masscan-progress' && progressData.data?.hostFound) {
        setHostsFound(prev => [...prev, progressData.data.hostFound]);
      }

      // Track masscan progress (percentage and time remaining)
      if (progressData.stage === 'masscan-progress' && progressData.data?.percentDone !== undefined) {
        setMasscanProgress({
          percentDone: progressData.data.percentDone,
          timeRemaining: progressData.data.timeRemaining
        });
      }

      if (progressData.stage === 'completed') {
        // Fetch final results
        fetchResults();
      } else if (progressData.stage === 'failed') {
        setScanStatus('failed');
        
        // Check if it's a sudo error from socket event
        const errorMessage = progressData.data?.error || '';
        
        if (errorMessage.toLowerCase().includes('root privileges') || 
            errorMessage.toLowerCase().includes('sudo password')) {
          if (onSudoRequired) {
            onSudoRequired();
          } else {
            console.error('onSudoRequired callback is not defined');
          }
        }
      }
    }
  }, [progressData, onSudoRequired, fetchResults]);

  // Poll scan status to detect failures; stop and show message if backend unreachable
  useEffect(() => {
    if (!scanId) return;

    let sudoModalShown = false;
    let intervalId = null;

    const pollStatus = async () => {
      try {
        const response = await fetch(`http://localhost:3005/api/scan/status/${scanId}`);
        pollFailuresRef.current = 0; // reset on success
        if (response.ok) {
          const status = await response.json();
          if (status.status === 'failed') {
            setScanStatus('failed');
            setCurrentStage('failed');
            const errorMsg = status.error || '';
            const isSudoError = errorMsg.toLowerCase().includes('root privileges') ||
              errorMsg.toLowerCase().includes('sudo password');
            if (isSudoError && !sudoModalShown) {
              sudoModalShown = true;
              if (onSudoRequired) onSudoRequired();
              return;
            }
            if (onComplete && !sudoModalShown) onComplete(null, status.error);
          }
        }
      } catch (error) {
        const failures = pollFailuresRef.current + 1;
        pollFailuresRef.current = failures;
        if (failures === 1) {
          console.warn('Backend unreachable (is the server running on port 3005?):', error?.message || error);
        }
        if (failures >= POLL_BACKOFF_AFTER_FAILURES) {
          setBackendUnreachable(true);
          if (intervalId) clearInterval(intervalId);
        }
      }
    };

    intervalId = setInterval(pollStatus, 2000);
    pollStatus();

    return () => {
      if (intervalId) clearInterval(intervalId);
    };
  }, [scanId, onComplete, onSudoRequired]);

  const getStageInfo = (stage) => {
    const stages = {
      started: { label: 'Initializing', icon: Clock, color: 'text-primary' },
      'masscan-start': { label: 'Masscan Scanning', icon: Activity, color: 'text-primary' },
      'masscan-complete': { label: 'Masscan Complete', icon: CheckCircle, color: 'text-foreground' },
      'subnet-filter': { label: 'Filtering Problematic Subnets', icon: AlertCircle, color: 'text-primary' },
      'reachability-start': { label: 'Testing Host Reachability', icon: Activity, color: 'text-primary' },
      'reachability-progress': { label: 'Testing Host Reachability', icon: Activity, color: 'text-primary' },
      'reachability-complete': { label: 'Reachability Check Complete', icon: CheckCircle, color: 'text-foreground' },
      'enumeration-start': { label: 'SMB/NFS Enumeration', icon: Activity, color: 'text-primary' },
      'enumeration-progress': { label: 'SMB/NFS Enumeration', icon: Activity, color: 'text-primary' },
      'enumeration-complete': { label: 'Enumeration Complete', icon: CheckCircle, color: 'text-foreground' },
      'validation-start': { label: 'Access Validation', icon: Activity, color: 'text-primary' },
      'validation-progress': { label: 'Access Validation', icon: Activity, color: 'text-primary' },
      'validation-complete': { label: 'Validation Complete', icon: CheckCircle, color: 'text-foreground' },
      completed: { label: 'Scan Complete', icon: CheckCircle, color: 'text-foreground' },
      failed: { label: 'Scan Failed', icon: AlertCircle, color: 'text-destructive' },
      cancelled: { label: 'Scan Cancelled', icon: X, color: 'text-muted-foreground' }
    };
    return stages[stage] || { label: 'Unknown', icon: Activity, color: 'text-muted-foreground' };
  };

  const stageInfo = getStageInfo(currentStage);
  const StageIcon = stageInfo.icon;

  const totalIps = React.useMemo(() => countTotalIps(config?.ipRange), [config?.ipRange]);
  const scannedIps = currentStage === 'masscan-complete'
    ? totalIps
    : Math.floor(totalIps * (masscanProgress.percentDone / 100));

  return (
    <div className="w-full max-w-9xl mx-auto">
      {backendUnreachable && (
        <div className="mb-4 p-4 rounded-lg border border-primary/40 bg-primary/10 flex items-center gap-3">
          <AlertCircle className="h-5 w-5 text-primary shrink-0" />
          <div>
            <p className="font-medium text-foreground">No se puede conectar con el servidor</p>
            <p className="text-sm text-muted-foreground">
              Comprueba que el backend esté en ejecución (puerto 3005). Desde la raíz del proyecto:{' '}
              <code className="bg-muted px-1 rounded text-foreground">npm run dev</code>
            </p>
          </div>
        </div>
      )}
      <div className="bg-card rounded-lg border border-border p-6 sm:p-8 lg:p-10">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between mb-8 lg:mb-10">
          <div className="flex items-center space-x-4">
            <div className="p-3 sm:p-4 bg-primary/20 rounded-full">
              <Activity className="h-8 w-8 sm:h-10 sm:w-10 text-primary animate-pulse" />
            </div>
            <div>
              <h2 className="text-2xl sm:text-3xl font-bold text-foreground">Scan Progress</h2>
              <p className="text-sm sm:text-base text-muted-foreground">Monitoring network reconnaissance in real-time</p>
            </div>
          </div>
          <button
            onClick={onCancel}
            className="w-full sm:w-auto px-6 py-3.5 text-base sm:text-lg bg-destructive text-destructive-foreground rounded-lg hover:bg-destructive/90 transition-colors font-medium"
          >
            Cancel Scan
          </button>
        </div>

        {/* Current Stage */}
        <div className="mb-8">
          <div className="flex items-center space-x-4 p-6 bg-muted/60 rounded-xl border border-border/60">
            <div className="p-3 bg-background rounded-full border border-border">
              <StageIcon className={`h-6 w-6 ${stageInfo.color}`} />
            </div>
            <div className="flex-1">
              <h3 className="text-lg font-semibold text-foreground mb-1">{stageInfo.label}</h3>
              {progressData?.data?.message && (
                <p className="text-base text-muted-foreground">{progressData.data.message}</p>
              )}
              {(currentStage === 'masscan-start' || currentStage === 'masscan-progress') && progressData?.data?.scanning && (
                <div className="mt-3 p-3 bg-primary/5 rounded-lg border border-primary/20">
                  <p className="text-sm text-primary font-medium">
                    🔍 Masscan is actively scanning your network for open SMB/NFS ports ({config?.ports || '139,445,2049'})
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Progress Details */}
        <div className="space-y-6">
          {/* Hosts found */}
          {progressData?.data?.hostsFound !== undefined && (
            <div className="p-4 bg-background rounded-lg border border-border">
              <div className="flex justify-between items-center mb-2">
                <span className="text-base font-semibold text-foreground">Hosts with SMB/NFS ports open:</span>
                <span className="text-lg font-bold font-mono bg-primary text-primary-foreground px-3 py-1 rounded-lg">
                  {progressData.data.hostsFound}
                </span>
              </div>
              <p className="text-sm text-muted-foreground">
                Found hosts with open ports ({config?.ports || '139,445,2049'}) in your network
              </p>
            </div>
          )}

          {/* Masscan status (text only, no progress bar) */}
          {(currentStage === 'masscan-start' || currentStage === 'masscan-progress' || currentStage === 'masscan-auth' || currentStage === 'masscan-complete') && (
            <div className="p-6 bg-muted rounded-lg border border-border">
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center space-x-3">
                  <div className="p-2 bg-primary/20 rounded-full">
                    <Activity className={`h-5 w-5 text-primary ${currentStage === 'masscan-complete' ? '' : 'animate-pulse'}`} />
                  </div>
                  <div>
                    <h3 className="text-lg font-semibold text-foreground">
                      {currentStage === 'masscan-auth' 
                        ? 'Authenticating...' 
                        : currentStage === 'masscan-complete'
                          ? 'Port Scanning Complete'
                          : 'Port Scanning in Progress'}
                    </h3>
                    <p className="text-sm text-muted-foreground">
                      {progressData?.data?.message || `Scanning network for open ports (${config?.ports || '139,445,2049'})`}
                    </p>
                  </div>
                </div>
                
                {/* Status information */}
                <div className="text-right">
                  {currentStage === 'masscan-complete' ? (
                    <div className="text-primary font-semibold">
                      ✓ Complete
                    </div>
                  ) : (
                    <>
                      {masscanProgress.percentDone > 0 && (
                        <div className="text-2xl font-bold font-mono text-primary">
                          {masscanProgress.percentDone.toFixed(2)}%
                        </div>
                      )}
                      {masscanProgress.timeRemaining && (
                        <div className="text-sm text-muted-foreground mt-1">
                          {masscanProgress.timeRemaining} remaining
                        </div>
                      )}
                      {masscanProgress.percentDone === 0 && (
                        <div className="text-sm text-muted-foreground italic">
                          Initializing scan...
                        </div>
                      )}
                    </>
                  )}
                </div>
              </div>

              {/* Scanned IPs counter */}
              {totalIps > 0 && (
                <div className="flex items-center justify-between p-3 mb-3 bg-background rounded-lg border border-border">
                  <span className="text-sm font-medium text-foreground">
                    IPs scanned:
                  </span>
                  <span className="text-lg font-bold font-mono text-primary tabular-nums">
                    {scannedIps.toLocaleString()} / {totalIps.toLocaleString()}
                  </span>
                </div>
              )}

              {/* Hosts discovered counter */}
              <div className="flex items-center justify-between p-3 bg-background rounded-lg border border-border">
                <span className="text-sm font-medium text-foreground">
                  Hosts discovered:
                </span>
                <span className="text-lg font-bold font-mono text-primary">
                  {progressData?.data?.hostsFound !== undefined 
                    ? progressData.data.hostsFound 
                    : hostsFound.length}
                </span>
              </div>
              
              {/* Live host list */}
              {hostsFound.length > 0 && (
                <div className="mt-4 max-h-40 overflow-y-auto bg-background rounded-lg p-3 border border-border">
                  <p className="text-xs font-semibold text-foreground mb-2">Recently Discovered:</p>
                  <div className="space-y-1">
                    {hostsFound.slice(-10).reverse().map((host, idx) => (
                      <div key={`${host.ip}-${idx}`} className="text-xs font-mono text-foreground flex items-center space-x-2 animate-fade-in">
                        <span className="text-primary">●</span>
                        <span className="font-medium">{host.ip}</span>
                        <span className="text-muted-foreground">ports: {host.openPorts.join(', ')}</span>
                      </div>
                    ))}
                    {hostsFound.length > 10 && (
                      <p className="text-xs text-muted-foreground italic">
                        ...and {hostsFound.length - 10} more
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Subnet filter notification */}
          {currentStage === 'subnet-filter' && progressData?.data && (
            <div className="p-6 bg-muted rounded-lg border border-border">
              <div className="flex items-center space-x-3 mb-4">
                <div className="p-2 bg-primary/20 rounded-full">
                  <AlertCircle className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-foreground">
                    Subnet Filtering
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {progressData.data.message}
                  </p>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3 mb-3">
                <div className="p-3 bg-background rounded-lg border border-border text-center">
                  <div className="text-2xl font-bold text-foreground">
                    {progressData.data.filteredCount}
                  </div>
                  <div className="text-xs text-muted-foreground">Kept for enumeration</div>
                </div>
                <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/40 text-center">
                  <div className="text-2xl font-bold text-destructive">
                    {progressData.data.originalCount - progressData.data.filteredCount}
                  </div>
                  <div className="text-xs text-destructive/80">Filtered out</div>
                </div>
              </div>

              {progressData.data.discardedSubnets && progressData.data.discardedSubnets.length > 0 && (
                <div className="mt-3 p-3 bg-background rounded-lg border border-border">
                  <p className="text-xs font-semibold text-foreground mb-2">
                    Discarded Subnets (3rd octet with &gt;7 hosts):
                  </p>
                  <div className="space-y-1 max-h-32 overflow-y-auto">
                    {progressData.data.discardedSubnets.map((subnet, idx) => (
                      <div key={idx} className="text-xs font-mono text-muted-foreground flex items-center justify-between">
                        <span>{subnet.subnet}.*</span>
                        <span className="text-primary">{subnet.count} hosts</span>
                      </div>
                    ))}
                  </div>
                  <p className="text-xs text-muted-foreground mt-2 italic">
                    ⚡ These subnets likely have timeout/connectivity issues and were skipped
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Reachability check progress */}
          {(currentStage === 'reachability-start' || currentStage === 'reachability-progress' || currentStage === 'reachability-complete') && (
            <div className="p-6 bg-muted rounded-lg border border-border">
              <div className="flex justify-between items-center mb-3">
                <span className="text-lg font-semibold text-foreground">
                  Host Reachability Check
                </span>
                {progressData?.data?.tested !== undefined && progressData?.data?.total !== undefined ? (
                  <span className="text-sm font-medium text-muted-foreground">
                    {progressData.data.tested} / {progressData.data.total}
                  </span>
                ) : (
                  <span className="text-sm font-medium text-muted-foreground">
                    Starting...
                  </span>
                )}
              </div>
              
              <div className="w-full bg-background rounded-full h-4 mb-3 overflow-hidden">
                <div
                  className="bg-primary h-4 rounded-full transition-all duration-500 ease-out"
                  style={{ 
                    width: progressData?.data?.tested !== undefined && progressData?.data?.total !== undefined
                      ? `${(progressData.data.tested / progressData.data.total) * 100}%`
                      : '5%'
                  }}
                ></div>
              </div>

              <div className="grid grid-cols-3 gap-3 mb-3">
                <div className="p-3 bg-background rounded-lg border border-border text-center">
                  <div className="text-2xl font-bold text-foreground">
                    {progressData?.data?.reachable || 0}
                  </div>
                  <div className="text-xs text-muted-foreground">Reachable</div>
                </div>
                <div className="p-3 bg-destructive/10 rounded-lg border border-destructive/40 text-center">
                  <div className="text-2xl font-bold text-destructive">
                    {progressData?.data?.unreachable || 0}
                  </div>
                  <div className="text-xs text-destructive/80">Unreachable</div>
                </div>
                <div className="p-3 bg-background rounded-lg border border-border text-center">
                  <div className="text-2xl font-bold text-foreground">
                    {progressData?.data?.total || 0}
                  </div>
                  <div className="text-xs text-muted-foreground">Total</div>
                </div>
              </div>

              <div className="flex items-center text-sm">
                <p className="text-muted-foreground">
                  🔌 {progressData?.data?.message || 'Filtering unreachable hosts to save time'}
                </p>
              </div>

              {progressData?.data?.currentHost && (
                <div className="mt-2 text-xs font-mono text-muted-foreground bg-background px-3 py-2 rounded border border-border">
                  Testing: <span className="font-bold">{progressData.data.currentHost}</span>
                </div>
              )}

              {currentStage === 'reachability-complete' && progressData?.data?.unreachable > 0 && (
                <div className="mt-3 p-3 bg-background rounded-lg border border-border">
                  <p className="text-xs text-muted-foreground">
                    ⚡ Skipped {progressData.data.unreachable} unreachable host(s) - this will significantly speed up the scan!
                  </p>
                </div>
              )}
            </div>
          )}

          {/* Enumeration progress */}
          {(currentStage === 'enumeration-start' || currentStage === 'enumeration-progress' || currentStage === 'enumeration-complete') && (
              <div className="p-6 bg-muted rounded-lg border border-border">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-lg font-semibold text-foreground">SMB/NFS Enumeration Progress</span>
                  {progressData?.data?.processed !== undefined && progressData?.data?.total !== undefined ? (
                    <span className="text-sm font-medium text-muted-foreground">
                      {progressData.data.processed} / {progressData.data.total}
                    </span>
                  ) : (
                    <span className="text-sm font-medium text-muted-foreground">
                      Initializing...
                    </span>
                  )}
                </div>
                <div className="w-full bg-background rounded-full h-4 mb-3 overflow-hidden">
                  <div
                    className="bg-primary h-4 rounded-full transition-all duration-500 ease-out"
                    style={{ 
                      width: progressData?.data?.processed !== undefined && progressData?.data?.total !== undefined
                        ? `${(progressData.data.processed / progressData.data.total) * 100}%`
                        : '10%'
                    }}
                  ></div>
                </div>
                {progressData?.data?.currentHost ? (
                  <div className="flex items-center justify-between text-sm">
                    <p className="text-muted-foreground">
                      🔍 Currently processing: <span className="font-mono font-medium">{progressData.data.currentHost}</span>
                    </p>
                    {progressData?.data?.processed !== undefined && progressData?.data?.total !== undefined && (
                      <span className="text-primary font-medium">
                        {Math.round((progressData.data.processed / progressData.data.total) * 100)}% Complete
                      </span>
                    )}
                  </div>
                ) : (
                  <div className="flex items-center text-sm">
                    <p className="text-muted-foreground">
                      🔍 Preparing to enumerate SMB shares / NFS exports on discovered hosts...
                    </p>
                  </div>
                )}
              </div>
            )}

            {/* Validation progress */}
            {(currentStage === 'validation-start' || currentStage === 'validation-progress' || currentStage === 'validation-complete') && (
              <div className="p-6 bg-muted rounded-lg border border-border">
                <div className="flex justify-between items-center mb-3">
                  <span className="text-lg font-semibold text-foreground">Access Validation Progress</span>
                  {progressData?.data?.validated !== undefined && progressData?.data?.total !== undefined ? (
                    <span className="text-sm font-medium text-muted-foreground">
                      {progressData.data.validated} / {progressData.data.total}
                    </span>
                  ) : (
                    <span className="text-sm font-medium text-muted-foreground">
                      Starting...
                    </span>
                  )}
                </div>
                <div className="w-full bg-background rounded-full h-4 mb-3 overflow-hidden">
                  <div
                    className="bg-primary h-4 rounded-full transition-all duration-500 ease-out"
                    style={{ 
                      width: progressData?.data?.validated !== undefined && progressData?.data?.total !== undefined
                        ? `${(progressData.data.validated / progressData.data.total) * 100}%`
                        : '5%'
                    }}
                  ></div>
                </div>
                <div className="flex items-center justify-between text-sm">
                  <div className="flex-1">
                    <p className="text-muted-foreground mb-1">
                      🛡️ Testing read access to discovered shares
                    </p>
                    {progressData?.data?.currentHost && progressData?.data?.currentShare ? (
                      <p className="text-xs font-mono text-muted-foreground mt-2 bg-background px-3 py-2 rounded border border-border">
                        Currently validating: <span className="font-bold">{progressData.data.currentHost}</span> / <span className="font-semibold">{progressData.data.currentShare}</span>
                      </p>
                    ) : currentStage === 'validation-start' && (
                      <p className="text-xs text-muted-foreground mt-2 bg-background px-3 py-2 rounded italic border border-border">
                        Preparing access validation tests...
                      </p>
                    )}
                  </div>
                  {progressData?.data?.validated !== undefined && progressData?.data?.total !== undefined && (
                    <span className="text-primary font-medium ml-4">
                      {Math.round((progressData.data.validated / progressData.data.total) * 100)}% Complete
                    </span>
                  )}
                </div>
              </div>
            )}
        </div>

        {/* Scan Configuration Summary */}
        <div className="mt-6 p-4 bg-muted/50 rounded-lg">
          <h4 className="font-medium text-foreground mb-2">Scan Configuration</h4>
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <span className="text-muted-foreground">IP Range:</span>
              <span className="ml-2 font-mono">{config?.ipRange}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Ports:</span>
              <span className="ml-2 font-mono">{config?.ports}</span>
            </div>
            <div>
              <span className="text-muted-foreground">Rate:</span>
              <span className="ml-2 font-mono">{config?.rate} pps</span>
            </div>
            <div>
              <span className="text-muted-foreground">Seed:</span>
              <span className="ml-2 font-mono">{config?.seed}</span>
            </div>
          </div>
        </div>

        {/* Error Display */}
        {scanStatus === 'failed' && progressData?.data?.error && (
          <div className="mt-4 p-4 bg-destructive/10 border border-destructive/20 rounded-lg">
            <div className="flex items-center space-x-2">
              <AlertCircle className="h-4 w-4 text-destructive" />
              <span className="font-medium text-destructive">Scan Failed</span>
            </div>
            <p className="text-sm text-destructive/80 mt-1">{progressData.data.error}</p>
          </div>
        )}
      </div>
    </div>
  );
};

export default ScanProgress;