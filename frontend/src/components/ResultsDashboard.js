import React, { useState } from 'react';
import { Download, RefreshCw, ChevronDown, ChevronRight, Server, Share, CheckCircle, XCircle, AlertTriangle, Timer, ShieldAlert } from 'lucide-react';

const ADMIN_SHARES = ['admin$', 'c$', 'd$', 'e$', 'f$'];
const isAdminShare = (name) => name && ADMIN_SHARES.includes(String(name).toLowerCase());

const ResultsDashboard = ({ results, onNewScan, scanId, onOpenShareExplorer }) => {
  const [expandedHosts, setExpandedHosts] = useState(new Set());
  const [showAllHosts, setShowAllHosts] = useState(false);

  const toggleHostExpansion = (ip) => {
    const newExpanded = new Set(expandedHosts);
    if (newExpanded.has(ip)) {
      newExpanded.delete(ip);
    } else {
      newExpanded.add(ip);
    }
    setExpandedHosts(newExpanded);
  };

  // Calculate summary statistics
  const totalHosts = Object.keys(results).length;
  const reachableHosts = Object.values(results).filter(host => host.host_status === 'reachable').length;
  const totalShares = Object.values(results).reduce((sum, host) => {
    return sum + Object.keys(host.shares || {}).length;
  }, 0);
  const accessibleShares = Object.values(results).reduce((sum, host) => {
    return sum + Object.values(host.shares || {}).filter(share => share.access === 'READ').length;
  }, 0);

  // Separate hosts with and without accessible shares
  const hostsWithAccessibleShares = Object.entries(results).filter(([ip, hostData]) =>
    Object.values(hostData.shares || {}).some(share => share.access === 'READ')
  );

  const hostsWithoutAccessibleShares = Object.entries(results).filter(([ip, hostData]) =>
    !Object.values(hostData.shares || {}).some(share => share.access === 'READ')
  );

  // Combine with accessible shares first
  const sortedHosts = [...hostsWithAccessibleShares, ...hostsWithoutAccessibleShares];

  const getAccessBadge = (access) => {
    switch (access) {
      case 'READ':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-1 bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded-full text-xs font-medium">
            <CheckCircle className="h-3 w-3" />
            <span>READ</span>
          </span>
        );
      case 'DENIED':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-1 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded-full text-xs font-medium">
            <XCircle className="h-3 w-3" />
            <span>DENIED</span>
          </span>
        );
      case 'ERROR':
        return (
          <span className="inline-flex items-center space-x-1 px-2 py-1 bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200 rounded-full text-xs font-medium">
            <AlertTriangle className="h-3 w-3" />
            <span>ERROR</span>
          </span>
        );
      default:
        return (
          <span className="inline-flex items-center px-2 py-1 bg-gray-100 text-gray-800 dark:bg-gray-900 dark:text-gray-200 rounded-full text-xs font-medium">
            <span>UNKNOWN</span>
          </span>
        );
    }
  };

  const handleExport = async () => {
    try {
      const response = await fetch(`http://localhost:3005/api/scan/export/${scanId}`);
      if (response.ok) {
        const blob = await response.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `smb-scan-${scanId}.json`;
        document.body.appendChild(a);
        a.click();
        window.URL.revokeObjectURL(url);
        document.body.removeChild(a);
      }
    } catch (error) {
      console.error('Failed to export results:', error);
    }
  };

  return (
    <div className="w-full max-w-9xl mx-auto space-y-6 lg:space-y-8">
      {/* Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4 lg:gap-6">
        <div className="bg-card p-5 lg:p-6 rounded-lg border border-border">
          <div className="flex items-center space-x-3">
            <Server className="h-6 w-6 text-primary shrink-0" />
            <div>
              <p className="text-2xl lg:text-3xl font-bold">{totalHosts}</p>
              <p className="text-sm lg:text-base text-muted-foreground">Total Hosts</p>
            </div>
          </div>
        </div>
        <div className="bg-card p-5 lg:p-6 rounded-lg border border-border">
          <div className="flex items-center space-x-3">
            <CheckCircle className="h-6 w-6 text-primary shrink-0" />
            <div>
              <p className="text-2xl lg:text-3xl font-bold">{reachableHosts}</p>
              <p className="text-sm lg:text-base text-muted-foreground">SMB Active</p>
            </div>
          </div>
        </div>
        <div className="bg-card p-5 lg:p-6 rounded-lg border border-border">
          <div className="flex items-center space-x-3">
            <Share className="h-6 w-6 text-primary shrink-0" />
            <div>
              <p className="text-2xl lg:text-3xl font-bold">{totalShares}</p>
              <p className="text-sm lg:text-base text-muted-foreground">Shares Found</p>
            </div>
          </div>
        </div>
        <div className="bg-card p-5 lg:p-6 rounded-lg border border-border">
          <div className="flex items-center space-x-3">
            <AlertTriangle className="h-6 w-6 text-destructive shrink-0" />
            <div>
              <p className="text-2xl lg:text-3xl font-bold">{accessibleShares}</p>
              <p className="text-sm lg:text-base text-muted-foreground">Accessible</p>
            </div>
          </div>
        </div>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-4 sm:flex-row sm:justify-between sm:items-center">
        <div>
          <h2 className="text-xl sm:text-2xl font-semibold">Detailed Results</h2>
          <p className="text-sm sm:text-base text-muted-foreground">
            Showing {showAllHosts ? sortedHosts.length : hostsWithAccessibleShares.length} of {sortedHosts.length} hosts
          </p>
        </div>
        <div className="flex space-x-2">
          <button
            onClick={() => setShowAllHosts(!showAllHosts)}
            className="flex items-center space-x-2 px-4 py-2 bg-muted text-muted-foreground rounded-md hover:bg-muted/80 transition-colors"
          >
            <span>{showAllHosts ? 'Hide' : 'Show'} All Hosts</span>
          </button>
          <button
            onClick={handleExport}
            className="flex items-center space-x-2 px-4 py-2 bg-secondary text-secondary-foreground rounded-md hover:bg-secondary/80 transition-colors"
          >
            <Download className="h-4 w-4" />
            <span>Export JSON</span>
          </button>
          <button
            onClick={onNewScan}
            className="flex items-center space-x-2 px-4 py-2 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 transition-colors"
          >
            <RefreshCw className="h-4 w-4" />
            <span>New Scan</span>
          </button>
        </div>
      </div>

      {/* Host Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {(showAllHosts ? sortedHosts : hostsWithAccessibleShares).map(([ip, hostData]) => {
          const hasAccessibleShares = Object.values(hostData.shares || {}).some(share => share.access === 'READ');
          const accessibleShareNames = Object.entries(hostData.shares || {})
            .filter(([, info]) => info.access === 'READ')
            .map(([name]) => name);
          const hasAdminShareAccessible = accessibleShareNames.some(name => isAdminShare(name));
          const shareCount = Object.keys(hostData.shares || {}).length;
          const accessibleShareCount = Object.values(hostData.shares || {}).filter(share => share.access === 'READ').length;

          return (
            <div key={ip} className={`bg-card rounded-lg border p-4 hover:shadow-md transition-shadow ${hasAdminShareAccessible ? 'border-amber-500 dark:border-amber-600 ring-1 ring-amber-500/30' : 'border-border'}`}>
              <div className="flex items-start justify-between mb-3">
                <div className="flex items-center space-x-2">
                  <Server className="h-4 w-4 text-muted-foreground" />
                  <h3 className="font-medium font-mono text-sm">{ip}</h3>
                </div>
                <div className="flex items-center gap-1.5 flex-wrap justify-end">
                  {hasAdminShareAccessible && (
                    <span className="inline-flex items-center gap-1 px-2 py-1 bg-amber-100 text-amber-800 dark:bg-amber-900 dark:text-amber-200 rounded text-xs font-medium">
                      <ShieldAlert className="h-3 w-3" />
                      admin$/SISTEMA
                    </span>
                  )}
                  {hasAccessibleShares && (
                    <span className="px-2 py-1 bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200 rounded text-xs font-medium">
                      ⚠️ ACCESSIBLE
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-2 text-xs">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Status:</span>
                  <span className={`font-medium ${hostData.host_status === 'reachable' ? 'text-green-600' : 'text-yellow-600'}`}>
                    {hostData.host_status}
                  </span>
                </div>
                {hostData.response_ms != null && (
                  <div className="flex justify-between items-center">
                    <span className="text-muted-foreground">Response:</span>
                    <span className="font-mono font-medium inline-flex items-center gap-1">
                      <Timer className="h-3 w-3 text-muted-foreground" />
                      {hostData.response_ms} ms
                    </span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Ports:</span>
                  <span className="font-mono">{hostData.open_ports?.join(', ')}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">Shares:</span>
                  <span className="font-medium">
                    {shareCount} total
                    {accessibleShareCount > 0 && (
                      <span className="text-red-600 ml-1">({accessibleShareCount} accessible)</span>
                    )}
                  </span>
                </div>
              </div>

              {/* Quick Shares Preview */}
              {hasAccessibleShares && Object.keys(hostData.shares || {}).length > 0 && (
                <div className="mt-3 pt-3 border-t border-border">
                  <div className="text-xs text-muted-foreground mb-2">Accessible shares:</div>
                  <div className="space-y-1">
                    {Object.entries(hostData.shares)
                      .filter(([_, shareInfo]) => shareInfo.access === 'READ')
                      .slice(0, 2)
                      .map(([shareName, shareInfo]) => (
                        <div key={shareName} className="flex items-center justify-between text-xs gap-2">
                          <span className="font-mono truncate">{shareName}</span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            {isAdminShare(shareName) && (
                              <span className="px-1.5 py-0.5 bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 rounded text-[10px] font-medium">admin</span>
                            )}
                            {getAccessBadge(shareInfo.access)}
                          </div>
                        </div>
                      ))}
                    {Object.values(hostData.shares).filter(share => share.access === 'READ').length > 2 && (
                      <div className="text-xs text-muted-foreground">
                        +{Object.values(hostData.shares).filter(share => share.access === 'READ').length - 2} more...
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* Expand button */}
              <button
                onClick={() => toggleHostExpansion(ip)}
                className="w-full mt-3 pt-2 border-t border-border text-xs text-muted-foreground hover:text-foreground transition-colors flex items-center justify-center space-x-1"
              >
                {expandedHosts.has(ip) ? (
                  <>
                    <ChevronDown className="h-3 w-3" />
                    <span>Collapse</span>
                  </>
                ) : (
                  <>
                    <ChevronRight className="h-3 w-3" />
                    <span>Details</span>
                  </>
                )}
              </button>

              {/* Expanded Details */}
              {expandedHosts.has(ip) && (
                <div className="mt-3 pt-3 border-t border-border space-y-3">
                  {/* Shares Table */}
                  {Object.keys(hostData.shares || {}).length > 0 ? (
                    <div>
                      <h4 className="font-medium text-sm mb-2">All Shares</h4>
                      <div className="space-y-1">
                        {Object.entries(hostData.shares).map(([shareName, shareInfo]) => (
                          <div key={shareName} className="flex items-center justify-between text-xs py-1 gap-2">
                            <span className="font-mono truncate mr-2">{shareName}</span>
                            <div className="flex items-center space-x-2 shrink-0">
                              {shareInfo.access === 'READ' && onOpenShareExplorer && (
                                <button
                                  type="button"
                                  onClick={() => onOpenShareExplorer(ip, shareName, shareInfo)}
                                  className="text-primary hover:underline font-medium"
                                >
                                  Explorar
                                </button>
                              )}
                              <span className={`text-muted-foreground ${shareInfo.type === 'NFS' ? 'text-cyan-600 dark:text-cyan-400 font-medium' : ''}`}>
                                {shareInfo.type}
                              </span>
                              {getAccessBadge(shareInfo.access)}
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-xs">No shares found</p>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {/* Show message when no accessible shares and toggle is off */}
      {!showAllHosts && hostsWithAccessibleShares.length === 0 && (
        <div className="text-center py-8">
          <p className="text-muted-foreground">No hosts with accessible shares found.</p>
          <button
            onClick={() => setShowAllHosts(true)}
            className="mt-2 text-sm text-primary hover:underline"
          >
            Show all hosts
          </button>
        </div>
      )}
    </div>
  );
};

export default ResultsDashboard;