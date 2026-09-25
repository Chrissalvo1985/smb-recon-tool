import React from 'react';
import { AlertTriangle, RefreshCw, Copy, CheckCircle, ShieldAlert, FolderOpen, FolderTree } from 'lucide-react';

const ADMIN_SHARES = ['admin$', 'c$', 'd$', 'e$', 'f$'];
const isAdminShare = (name) => name && ADMIN_SHARES.includes(String(name).toLowerCase());

const CriticalFindings = ({ results, onNewScan, onOpenShareExplorer }) => {
  // Find all accessible shares
  const accessibleShares = [];
  Object.entries(results).forEach(([ip, hostData]) => {
    Object.entries(hostData.shares || {}).forEach(([shareName, shareInfo]) => {
      if (shareInfo.access === 'READ') {
        accessibleShares.push({
          ip,
          shareName,
          type: shareInfo.type,
          protocol: shareInfo.protocol || (shareInfo.type === 'NFS' ? 'nfs' : 'smb'),
          evidence: shareInfo.evidence,
          hostStatus: hostData.host_status,
          openPorts: hostData.open_ports,
          isAdminShare: isAdminShare(shareName),
          admin_extra: shareInfo.admin_extra || null
        });
      }
    });
  });
  // Admin shares first (admin$ then other $)
  accessibleShares.sort((a, b) => {
    const aAdmin = a.isAdminShare ? (a.shareName.toLowerCase() === 'admin$' ? 2 : 1) : 0;
    const bAdmin = b.isAdminShare ? (b.shareName.toLowerCase() === 'admin$' ? 2 : 1) : 0;
    return bAdmin - aAdmin;
  });

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  if (accessibleShares.length === 0) {
    return (
      <div className="w-full max-w-6xl mx-auto">
        <div className="bg-card rounded-lg border border-border p-8 md:p-10 lg:p-12 text-center">
          <div className="flex justify-center mb-4">
            <div className="p-3 bg-green-100 dark:bg-green-900 rounded-full">
              <CheckCircle className="h-6 w-6 md:h-8 md:w-8 text-green-600 dark:text-green-400" />
            </div>
          </div>
          <h2 className="text-lg md:text-xl font-semibold text-foreground mb-2">No Critical Security Findings</h2>
          <p className="text-sm md:text-base text-muted-foreground mb-6">
            No shares with anonymous read access were found during this scan. This is excellent from a security perspective.
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <button
              onClick={onNewScan}
              className="flex items-center justify-center space-x-2 px-6 py-3 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors"
            >
              <RefreshCw className="h-4 w-4" />
              <span>Start New Scan</span>
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="w-full max-w-9xl mx-auto space-y-6 lg:space-y-8">
      {/* Header */}
      <div className="bg-card rounded-lg border border-border p-4 md:p-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <div className="p-2 bg-red-100 dark:bg-red-900 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h2 className="text-lg md:text-xl font-semibold text-foreground">Critical Security Findings</h2>
              <p className="text-sm text-muted-foreground">Shares with anonymous read access</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xl md:text-2xl font-bold text-red-600 dark:text-red-400">{accessibleShares.length}</p>
            <p className="text-xs md:text-sm text-muted-foreground">Vulnerable Shares</p>
          </div>
        </div>
      </div>

      {/* Critical Shares Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {accessibleShares.map((share, index) => (
          <div key={`${share.ip}-${share.shareName}`} className={`bg-card rounded-lg border overflow-hidden hover:shadow-md transition-shadow ${share.isAdminShare ? 'border-amber-500 dark:border-amber-600 ring-1 ring-amber-500/30' : 'border-border'}`}>
            {/* Header with IP and Alert */}
            <div className={`border-b px-4 py-3 ${share.isAdminShare ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800' : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'}`}>
              <div className="flex items-center justify-between">
                <h3 className={`font-semibold font-mono text-sm ${share.isAdminShare ? 'text-amber-800 dark:text-amber-200' : 'text-red-700 dark:text-red-300'}`}>
                  {share.ip}
                </h3>
                <div className="flex items-center gap-2">
                  {share.isAdminShare && (
                    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded text-xs font-bold bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100">
                      <ShieldAlert className="h-3 w-3" />
                      SISTEMA EXPUESTO
                    </span>
                  )}
                  <span className="inline-flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-red-600 dark:text-red-400" />
                    <span className="text-xs font-medium text-red-700 dark:text-red-300">CRITICAL</span>
                  </span>
                </div>
              </div>
            </div>

            {/* Share Details */}
            <div className="p-4">
              <div className="space-y-3">
                {share.isAdminShare && (
                  <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded p-2.5">
                    <p className="text-xs font-medium text-amber-800 dark:text-amber-200">
                      {share.shareName.toLowerCase() === 'admin$'
                        ? 'Acceso de lectura a C:\\Windows. Riesgo alto: configs, credenciales y datos de sistema expuestos.'
                        : 'Share administrativo accesible sin autenticación. Riesgo alto de exposición de datos.'}
                    </p>
                  </div>
                )}
                {/* Share + puertos (compacto) */}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs">
                  <span className="font-mono font-medium bg-muted px-2 py-0.5 rounded">{share.shareName}</span>
                  {(share.type === 'NFS' || share.protocol === 'nfs') && (
                    <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-cyan-100 text-cyan-800 dark:bg-cyan-900/50 dark:text-cyan-200">NFS</span>
                  )}
                  {share.openPorts?.length > 0 && (
                    <span className="text-muted-foreground">Puertos: {share.openPorts.join(', ')}</span>
                  )}
                </div>

                {/* Pruebas admin$ (solo si hay admin_extra) */}
                {share.shareName?.toLowerCase() === 'admin$' && share.admin_extra && (
                  <div className="bg-muted/50 border border-border rounded p-2.5 space-y-2">
                    <span className="text-xs font-medium text-foreground">Pruebas admin$</span>
                    <div className="grid grid-cols-2 gap-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">win.ini leído:</span>
                        <span className={share.admin_extra.winIniRead ? 'text-green-600 dark:text-green-400 font-medium' : 'text-muted-foreground'}>
                          {share.admin_extra.winIniRead ? 'Sí' : 'No'}
                        </span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-muted-foreground">System32 listado:</span>
                        <span className={share.admin_extra.system32Listed ? 'text-green-600 dark:text-green-400 font-medium' : 'text-muted-foreground'}>
                          {share.admin_extra.system32Listed ? 'Sí' : 'No'}
                        </span>
                      </div>
                    </div>
                    {share.admin_extra.winIniPreview && (
                      <details className="text-xs">
                        <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Vista previa win.ini</summary>
                        <pre className="mt-1 p-2 bg-background rounded font-mono whitespace-pre-wrap break-all overflow-x-auto max-h-24 overflow-y-auto">
                          {share.admin_extra.winIniPreview}
                        </pre>
                      </details>
                    )}
                  </div>
                )}

                {/* Explorar + Abrir en Finder */}
                <div className="pt-2 border-t border-border space-y-2">
                  {onOpenShareExplorer && (
                    <button
                      type="button"
                      onClick={() => onOpenShareExplorer(share.ip, share.shareName, share)}
                      className="w-full flex items-center justify-center gap-2 py-2 px-3 bg-primary text-primary-foreground rounded-md hover:bg-primary/90 text-sm font-medium"
                    >
                      <FolderTree className="h-4 w-4" />
                      Explorar {share.type === 'NFS' || share.protocol === 'nfs' ? 'export' : 'share'}
                    </button>
                  )}
                  {(() => {
                    const isNfs = share.type === 'NFS' || share.protocol === 'nfs' || String(share.shareName).startsWith('/');
                    const openUrl = isNfs
                      ? `nfs://${share.ip}${share.shareName.startsWith('/') ? share.shareName : `/${share.shareName}`}`
                      : `smb://${share.ip}/${share.shareName}`;
                    return (
                      <div className="flex items-center gap-2 p-2 bg-muted/50 rounded-md group">
                        <FolderOpen className="h-4 w-4 text-muted-foreground shrink-0" />
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium text-foreground">
                            {isNfs ? 'Mount / abrir NFS' : 'Abrir en Finder'}
                          </div>
                          <code className="text-[11px] text-muted-foreground block truncate" title={openUrl}>
                            {openUrl}
                          </code>
                        </div>
                        <button
                          type="button"
                          onClick={() => copyToClipboard(openUrl)}
                          className="shrink-0 p-1.5 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                          title="Copiar ruta"
                        >
                          <Copy className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    );
                  })()}
                </div>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Summary and Actions */}
      <div className="bg-card rounded-lg border border-border p-4 md:p-6">
        <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
          <div>
            <h3 className="font-semibold text-foreground mb-1">Security Recommendations</h3>
            <ul className="text-sm text-muted-foreground space-y-1">
              <li>• Review share permissions and remove anonymous access</li>
              <li>• Implement proper authentication and authorization</li>
              <li>• Consider network segmentation for sensitive resources</li>
            </ul>
          </div>
          <button
            onClick={onNewScan}
            className="flex items-center space-x-2 px-6 py-3 bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 transition-colors whitespace-nowrap"
          >
            <RefreshCw className="h-4 w-4" />
            <span>Start New Scan</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export default CriticalFindings;