import React, { useState, useEffect, useCallback, useMemo } from 'react';
import {
  Save,
  Trash2,
  Play,
  Clock,
  Server,
  Share,
  AlertTriangle,
  CheckSquare,
  Square,
  X,
  Copy,
  ShieldAlert,
  CheckCircle,
  FolderOpen,
  Search,
} from 'lucide-react';
import { storage } from '../utils/storage';

const formatDate = (dateString) => {
  if (!dateString) return '—';
  try {
    const d = new Date(dateString);
    return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
  } catch {
    return '—';
  }
};

const ADMIN_SHARES = ['admin$', 'c$', 'd$', 'e$', 'f$'];
const isAdminShare = (name) => name && ADMIN_SHARES.includes(String(name).toLowerCase());

const getRiskySharesFromResults = (results) => {
  if (!results || typeof results !== 'object') return [];
  const list = [];
  Object.entries(results).forEach(([ip, hostData]) => {
    Object.entries(hostData.shares || {}).forEach(([shareName, shareInfo]) => {
      if (shareInfo.access === 'READ') {
        list.push({
          ip,
          shareName,
          type: shareInfo.type,
          protocol: shareInfo.protocol || (shareInfo.type === 'NFS' ? 'nfs' : 'smb'),
          evidence: shareInfo.evidence,
          hostStatus: hostData.host_status,
          openPorts: hostData.open_ports,
          isAdminShare: isAdminShare(shareName),
          admin_extra: shareInfo.admin_extra || null,
        });
      }
    });
  });
  return list;
};

const escapeRegExp = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Terms with at least 2 chars; shorter tokens are ignored (no filter). */
const getShareSearchWords = (queryTrimmed) =>
  queryTrimmed
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length >= 2);

/**
 * Whole-word match on share name (case-insensitive): the term must appear as a full token,
 * delimited by non-alphanumeric or start/end (so "in" does not match inside "printing").
 */
const shareNameMatchesWords = (shareName, words) => {
  if (words.length === 0) return true;
  const name = String(shareName);
  return words.every((word) => {
    const q = escapeRegExp(word);
    const re = new RegExp(`(?:^|[^a-z0-9])${q}(?:[^a-z0-9]|$)`, 'i');
    return re.test(name);
  });
};

/** Only shares with READ access (accesibles / validados en el escaneo). */
const isAccessibleShare = (shareInfo) => shareInfo?.access === 'READ';

const resultsMatchShareWordQuery = (results, queryTrimmed) => {
  const words = getShareSearchWords(queryTrimmed);
  if (words.length === 0) return true;
  if (!results || typeof results !== 'object') return false;
  for (const host of Object.values(results)) {
    const shares = host?.shares;
    if (!shares || typeof shares !== 'object') continue;
    for (const [name, info] of Object.entries(shares)) {
      if (!isAccessibleShare(info)) continue;
      if (shareNameMatchesWords(name, words)) return true;
    }
  }
  return false;
};

const getScanMetrics = (scan) => {
  const config = scan?.config || {};
  const results = scan?.results;
  const totalHosts = results ? Object.keys(results).length : 0;
  const reachableHosts = results
    ? Object.values(results).filter((h) => h.host_status === 'reachable').length
    : 0;
  const totalShares = results
    ? Object.values(results).reduce((sum, h) => sum + Object.keys(h.shares || {}).length, 0)
    : 0;
  const riskyCount = results ? getRiskySharesFromResults(results).length : 0;
  return {
    totalHosts,
    reachableHosts,
    totalShares,
    riskyCount,
    configLabel: `${config.ipRange || 'N/A'} • ${config.ports ?? '445'} • Rate: ${config.rate ?? 'N/A'}`,
  };
};

const RiskySharesModal = ({ scan, onClose, onOpenShareExplorer }) => {
  const riskyShares = scan ? getRiskySharesFromResults(scan.results) : [];

  const copyToClipboard = (text) => {
    navigator.clipboard.writeText(text);
  };

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[60] flex items-center justify-center p-4">
      <div className="bg-background border border-border rounded-xl shadow-2xl max-w-7xl w-full max-h-[85vh] overflow-hidden flex flex-col">
        <div className="p-4 border-b border-border flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-900/40 rounded-lg">
              <ShieldAlert className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <h2 className="text-lg font-semibold text-foreground">
                Shares riesgosos — {scan?.name ?? 'Escaneo'}
              </h2>
              <p className="text-sm text-muted-foreground">
                {riskyShares.length} share(s) con acceso de lectura anónimo
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 hover:bg-muted rounded-lg transition-colors text-muted-foreground hover:text-foreground"
            aria-label="Cerrar"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="p-4 overflow-y-auto flex-1">
          {riskyShares.length === 0 ? (
            <div className="text-center py-12">
              <div className="inline-flex p-4 bg-green-100 dark:bg-green-900/30 rounded-full mb-4">
                <CheckCircle className="h-8 w-8 text-green-600 dark:text-green-400" />
              </div>
              <p className="text-foreground font-medium">Sin shares riesgosos</p>
              <p className="text-sm text-muted-foreground mt-1">
                {scan?.results
                  ? 'Este escaneo no tiene shares con acceso anónimo de lectura.'
                  : 'No hay datos de resultados guardados para este escaneo.'}
              </p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {riskyShares.map((share) => (
                <div
                  key={`${share.ip}-${share.shareName}`}
                  className={`bg-card rounded-lg border overflow-hidden hover:shadow-md transition-shadow ${share.isAdminShare ? 'border-amber-500 dark:border-amber-600 ring-1 ring-amber-500/30' : 'border-border'}`}
                >
                  <div className={`border-b px-4 py-2.5 ${share.isAdminShare ? 'bg-amber-50 dark:bg-amber-950/40 border-amber-200 dark:border-amber-800' : 'bg-red-50 dark:bg-red-950/30 border-red-200 dark:border-red-800'}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className={`font-mono text-sm font-semibold ${share.isAdminShare ? 'text-amber-800 dark:text-amber-200' : 'text-red-700 dark:text-red-300'}`}>
                        {share.ip}
                      </span>
                      <div className="flex items-center gap-1.5 flex-shrink-0">
                        {share.isAdminShare && (
                          <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-amber-200 dark:bg-amber-800 text-amber-900 dark:text-amber-100 rounded text-xs font-bold">
                            <ShieldAlert className="h-3 w-3" />
                            SISTEMA EXPUESTO
                          </span>
                        )}
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 bg-red-200 dark:bg-red-800 text-red-800 dark:text-red-200 rounded text-xs font-medium">
                          <AlertTriangle className="h-3 w-3" />
                          CRITICAL
                        </span>
                      </div>
                    </div>
                  </div>
                  <div className="p-3 space-y-2">
                    {share.isAdminShare && (
                      <p className="text-xs font-medium text-amber-800 dark:text-amber-200 bg-amber-50 dark:bg-amber-900/20 rounded p-2">
                        {share.shareName.toLowerCase() === 'admin$'
                          ? 'Acceso a C:\\Windows. Riesgo alto: configs y credenciales.'
                          : 'Share administrativo accesible sin autenticación.'}
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-2 text-xs">
                      <span className="font-mono font-medium bg-muted px-2 py-0.5 rounded">{share.shareName}</span>
                      {share.openPorts?.length > 0 && (
                        <span className="text-muted-foreground">Puertos: {share.openPorts.join(', ')}</span>
                      )}
                    </div>
                    {share.shareName?.toLowerCase() === 'admin$' && share.admin_extra && (
                      <div className="bg-muted/50 border border-border rounded p-2 space-y-1 text-xs">
                        <span className="font-medium text-foreground">Pruebas admin$</span>
                        <div className="flex gap-3">
                          <span className={share.admin_extra.winIniRead ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}>
                            win.ini: {share.admin_extra.winIniRead ? 'Sí' : 'No'}
                          </span>
                          <span className={share.admin_extra.system32Listed ? 'text-green-600 dark:text-green-400' : 'text-muted-foreground'}>
                            System32: {share.admin_extra.system32Listed ? 'Sí' : 'No'}
                          </span>
                        </div>
                      </div>
                    )}
                    <div className="pt-2 border-t border-border space-y-1.5">
                      {onOpenShareExplorer && (
                        <button
                          type="button"
                          onClick={() => onOpenShareExplorer(share.ip, share.shareName, share)}
                          className="w-full flex items-center justify-center gap-1.5 py-1.5 px-2 bg-primary text-primary-foreground rounded text-xs font-medium hover:bg-primary/90"
                        >
                          Explorar {share.type === 'NFS' || share.protocol === 'nfs' ? 'export' : 'share'}
                        </button>
                      )}
                      <div className="flex items-center gap-2 p-1.5 bg-muted/50 rounded group">
                        <FolderOpen className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="text-xs flex-1 truncate">
                          {(share.type === 'NFS' || share.protocol === 'nfs' || String(share.shareName).startsWith('/'))
                            ? 'Copiar nfs://'
                            : 'Abrir en Finder'}
                        </span>
                        <button
                          type="button"
                          onClick={() => {
                            const isNfs = share.type === 'NFS' || share.protocol === 'nfs' || String(share.shareName).startsWith('/');
                            const url = isNfs
                              ? `nfs://${share.ip}${String(share.shareName).startsWith('/') ? share.shareName : `/${share.shareName}`}`
                              : `smb://${share.ip}/${share.shareName}`;
                            copyToClipboard(url);
                          }}
                          className="shrink-0 p-1 rounded hover:bg-muted text-muted-foreground hover:text-foreground"
                          title="Copiar ruta"
                        >
                          <Copy className="h-3 w-3" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

const SavedScans = ({ onLoadScan, onClose, onOpenShareExplorer }) => {
  const [savedScans, setSavedScans] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState(new Set());
  const [detailScan, setDetailScan] = useState(null);
  const [shareSearchQuery, setShareSearchQuery] = useState('');
  const [ipSearchQuery, setIpSearchQuery] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(8);
  const [sortBy, setSortBy] = useState('date_desc');

  const loadSavedScans = useCallback(() => {
    try {
      const scans = storage.getSavedScans();
      setSavedScans(Array.isArray(scans) ? scans : []);
    } catch (error) {
      console.error('Error loading saved scans:', error);
      setSavedScans([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadSavedScans();
  }, [loadSavedScans]);

  const handleDeleteScan = (scanId, e) => {
    e?.stopPropagation?.();
    try {
      storage.deleteScan(scanId);
      setSelectedIds((prev) => {
        const next = new Set(prev);
        next.delete(scanId);
        return next;
      });
      loadSavedScans();
    } catch (error) {
      console.error('Error deleting scan:', error);
      alert('Error al eliminar la búsqueda');
    }
  };

  const handleBulkDelete = (e) => {
    e?.stopPropagation?.();
    const ids = Array.from(selectedIds);
    if (ids.length === 0) return;
    try {
      storage.deleteScans(ids);
      setSelectedIds(new Set());
      setSelectionMode(false);
      loadSavedScans();
    } catch (error) {
      console.error('Error deleting scans:', error);
      alert('Error al eliminar las búsquedas');
    }
  };

  const handleLoadScan = (scan, e) => {
    e?.stopPropagation?.();
    if (onLoadScan) {
      onLoadScan(scan.config);
      onClose();
    }
  };

  const toggleSelect = (scanId, e) => {
    e?.stopPropagation?.();
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(scanId)) next.delete(scanId);
      else next.add(scanId);
      return next;
    });
  };

  // Filter, sort and paginate saved scans
  const filteredScans = useMemo(() => {
    const shareQ = shareSearchQuery.trim();
    const ipQ = ipSearchQuery.trim();

    const words = getShareSearchWords(shareQ);
    const afterShareFilter =
      words.length === 0 ? savedScans : savedScans.filter((s) => resultsMatchShareWordQuery(s.results, shareQ));

    const afterIpFilter = (() => {
      if (ipQ === '') return afterShareFilter;
      const ipLower = ipQ.toLowerCase();
      return afterShareFilter.filter((s) => {
        const results = s.results;
        const ipMatchInResults =
          results && typeof results === 'object'
            ? Object.keys(results).some((ip) => String(ip).toLowerCase().startsWith(ipLower))
            : false;

        if (ipMatchInResults) return true;

        const cfgIp = s?.config?.ipRange;
        if (cfgIp && String(cfgIp).toLowerCase().startsWith(ipLower)) return true;

        return false;
      });
    })();

    // Sorting
    const sortFn = (a, b) => {
      if (sortBy === 'date_desc') return (new Date(b.timestamp || 0)) - (new Date(a.timestamp || 0));
      if (sortBy === 'date_asc') return (new Date(a.timestamp || 0)) - (new Date(b.timestamp || 0));
      if (sortBy === 'name_asc') return String(a.name || '').localeCompare(String(b.name || ''));
      if (sortBy === 'name_desc') return String(b.name || '').localeCompare(String(a.name || ''));
      if (sortBy === 'risk_desc') return getScanMetrics(b).riskyCount - getScanMetrics(a).riskyCount;
      if (sortBy === 'risk_asc') return getScanMetrics(a).riskyCount - getScanMetrics(b).riskyCount;
      return 0;
    };

    return [...afterIpFilter].sort(sortFn);
  }, [savedScans, shareSearchQuery, ipSearchQuery, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredScans.length / perPage));
  useEffect(() => {
    if (page > totalPages) setPage(totalPages);
  }, [page, totalPages]);

  const pageItems = useMemo(() => {
    const start = (page - 1) * perPage;
    return filteredScans.slice(start, start + perPage);
  }, [filteredScans, page, perPage]);

  const selectAll = () => {
    const ids = filteredScans.map((s) => s.id);
    const allVisibleSelected = ids.length > 0 && ids.every((id) => selectedIds.has(id));
    if (allVisibleSelected) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(ids));
    }
  };

  // Global metrics
  const totalRisky = savedScans.reduce(
    (acc, s) => acc + getScanMetrics(s).riskyCount,
    0
  );
  const scansWithRisks = savedScans.filter((s) => getScanMetrics(s).riskyCount > 0).length;
  const dates = savedScans
    .map((s) => (s.timestamp ? new Date(s.timestamp).getTime() : null))
    .filter(Boolean);
  const oldestNewest =
    dates.length > 0
      ? `${formatDate(new Date(Math.min(...dates)).toISOString())} — ${formatDate(new Date(Math.max(...dates)).toISOString())}`
      : '—';

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="animate-spin rounded-full h-10 w-10 border-2 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="w-full max-w-9xl mx-auto space-y-6 lg:space-y-8">
      {/* Metrics header */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-primary/10 rounded-lg">
              <Save className="h-5 w-5 text-primary" />
            </div>
            <div>
              <p className="text-2xl font-bold text-foreground">{savedScans.length}</p>
              <p className="text-xs text-muted-foreground">Escaneos guardados</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-red-100 dark:bg-red-900/40 rounded-lg">
              <AlertTriangle className="h-5 w-5 text-red-600 dark:text-red-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-red-600 dark:text-red-400">{totalRisky}</p>
              <p className="text-xs text-muted-foreground">Shares riesgosos (total)</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-amber-100 dark:bg-amber-900/40 rounded-lg">
              <ShieldAlert className="h-5 w-5 text-amber-600 dark:text-amber-400" />
            </div>
            <div>
              <p className="text-2xl font-bold text-amber-600 dark:text-amber-400">
                {scansWithRisks}
              </p>
              <p className="text-xs text-muted-foreground">Escaneos con riesgos</p>
            </div>
          </div>
        </div>
        <div className="bg-card rounded-xl border border-border p-4 col-span-2 md:col-span-1">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-muted rounded-lg">
              <Clock className="h-5 w-5 text-muted-foreground" />
            </div>
            <div className="min-w-0">
              <p className="text-xs text-muted-foreground truncate" title={oldestNewest}>
                Rango de fechas
              </p>
              <p className="text-sm font-medium text-foreground truncate" title={oldestNewest}>
                {oldestNewest}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Global search: filters scan cards across all saved scans (share name + IP) */}
      {savedScans.length > 0 && (
        <div className="bg-card rounded-xl border border-border p-4 sm:p-5">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="saved-scans-share-search" className="block text-sm font-medium text-foreground mb-2">
                Buscar por palabra en el nombre del share
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
                <input
                  id="saved-scans-share-search"
                  type="search"
                  autoComplete="off"
                  placeholder="Ej. IPC, admin, datos — palabra completa (mín. 2 letras por término)"
                  value={shareSearchQuery}
                  onChange={(e) => setShareSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-11 py-3 rounded-lg bg-background border border-input text-sm sm:text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {shareSearchQuery.trim() !== '' && (
                  <button
                    type="button"
                    onClick={() => setShareSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    aria-label="Limpiar búsqueda"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Solo en shares <span className="text-foreground font-medium">accesibles</span> (acceso de lectura validado). La palabra debe aparecer entera en el nombre; varios términos separados por espacio deben cumplirse en el mismo share.
              </p>
              {getShareSearchWords(shareSearchQuery).length > 0 && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Mostrando{' '}
                  <span className="font-semibold text-foreground">{filteredScans.length}</span> de{' '}
                  <span className="font-semibold text-foreground">{savedScans.length}</span> escaneo(s) con al menos un share que coincide (aplicable junto con el filtro IP si está activo).
                </p>
              )}
              {shareSearchQuery.trim() !== '' && getShareSearchWords(shareSearchQuery).length === 0 && (
                <p className="mt-1 text-sm text-amber-600 dark:text-amber-400">
                  Escribe al menos 2 caracteres por término para activar el filtro.
                </p>
              )}
            </div>

            <div>
              <label htmlFor="saved-scans-ip-search" className="block text-sm font-medium text-foreground mb-2">
                Filtrar por IP
              </label>
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-muted-foreground pointer-events-none" />
                <input
                  id="saved-scans-ip-search"
                  type="search"
                  autoComplete="off"
                  placeholder="Ej. 10.0.0.5 o 10.0.0 — filtra al escribir"
                  value={ipSearchQuery}
                  onChange={(e) => setIpSearchQuery(e.target.value)}
                  className="w-full pl-11 pr-11 py-3 rounded-lg bg-background border border-input text-sm sm:text-base text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
                />
                {ipSearchQuery.trim() !== '' && (
                  <button
                    type="button"
                    onClick={() => setIpSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 p-2 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                    aria-label="Limpiar búsqueda IP"
                  >
                    <X className="h-4 w-4" />
                  </button>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Filtra los escaneos que contengan hosts cuya IP incluya el texto escrito. La búsqueda es incremental y no requiere longitud mínima.
              </p>
              {ipSearchQuery.trim() !== '' && (
                <p className="mt-1 text-sm text-muted-foreground">
                  Mostrando <span className="font-semibold text-foreground">{filteredScans.length}</span> de <span className="font-semibold text-foreground">{savedScans.length}</span> escaneo(s) que contienen la IP indicada.
                </p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Toolbar: selection mode + bulk delete */}
      {savedScans.length > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setSelectionMode((m) => !m);
                if (selectionMode) setSelectedIds(new Set());
              }}
              className={`inline-flex items-center gap-2 px-4 py-2 rounded-lg font-medium text-sm transition-colors ${
                selectionMode
                  ? 'bg-primary text-primary-foreground hover:bg-primary/90'
                  : 'bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground'
              }`}
            >
              {selectionMode ? (
                <>
                  <CheckSquare className="h-4 w-4" />
                  Salir de selección
                </>
              ) : (
                <>
                  <Square className="h-4 w-4" />
                  Seleccionar
                </>
              )}
            </button>
            {selectionMode && (
              <button
                onClick={selectAll}
                className="inline-flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium bg-muted text-muted-foreground hover:bg-muted/80 hover:text-foreground transition-colors"
              >
                {selectedIds.size === filteredScans.length && filteredScans.length > 0
                  ? 'Deseleccionar todos'
                  : 'Seleccionar todos'}
              </button>
            )}
          </div>
          <div className="flex items-center gap-3">
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">Ordenar:</label>
              <select
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  setPage(1);
                }}
                className="px-2 py-1 rounded bg-background border border-input text-sm"
              >
                <option value="date_desc">Fecha — más recientes</option>
                <option value="date_asc">Fecha — más antiguas</option>
                <option value="risk_desc">Riesgos — más altos</option>
                <option value="risk_asc">Riesgos — más bajos</option>
                <option value="name_asc">Nombre A→Z</option>
                <option value="name_desc">Nombre Z→A</option>
              </select>
            </div>
            <div className="flex items-center gap-2">
              <label className="text-sm text-muted-foreground">Por página:</label>
              <select
                value={perPage}
                onChange={(e) => {
                  setPerPage(Number(e.target.value));
                  setPage(1);
                }}
                className="px-2 py-1 rounded bg-background border border-input text-sm"
              >
                <option value={5}>5</option>
                <option value={8}>8</option>
                <option value={12}>12</option>
                <option value={20}>20</option>
              </select>
            </div>
          </div>
          {selectionMode && selectedIds.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-sm text-muted-foreground">
                {selectedIds.size} seleccionado(s)
              </span>
              <button
                onClick={handleBulkDelete}
                className="inline-flex items-center gap-2 px-4 py-2 bg-destructive text-destructive-foreground rounded-lg font-medium text-sm hover:bg-destructive/90 transition-colors"
              >
                <Trash2 className="h-4 w-4" />
                Eliminar seleccionados
              </button>
            </div>
          )}
        </div>
      )}

      {/* List */}
      {savedScans.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-10 text-center">
          <div className="flex justify-center mb-4">
            <div className="p-4 bg-muted rounded-full">
              <Save className="h-10 w-10 text-muted-foreground" />
            </div>
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">No hay búsquedas guardadas</h3>
          <p className="text-muted-foreground mb-6 max-w-sm mx-auto">
            Las búsquedas que guardes aparecerán aquí. Haz clic en un escaneo para ver shares
            riesgosos y usar Cargar o eliminar.
          </p>
          <button
            onClick={onClose}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            Comenzar nueva búsqueda
          </button>
        </div>
      ) : getShareSearchWords(shareSearchQuery).length > 0 && filteredScans.length === 0 ? (
        <div className="bg-card rounded-xl border border-border p-10 text-center">
          <div className="flex justify-center mb-4">
            <div className="p-4 bg-muted rounded-full">
              <Search className="h-10 w-10 text-muted-foreground" />
            </div>
          </div>
          <h3 className="text-lg font-semibold text-foreground mb-2">Sin coincidencias</h3>
          <p className="text-muted-foreground mb-6 max-w-md mx-auto">
            Ningún share <span className="text-foreground">accesible</span> (lectura validada) coincide con la(s) palabra(s) en los escaneos guardados.
          </p>
          <button
            type="button"
            onClick={() => setShareSearchQuery('')}
            className="px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            Limpiar búsqueda
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          {pageItems.map((scan) => {
            const metrics = getScanMetrics(scan);
            const isSelected = selectedIds.has(scan.id);
            return (
              <div
                key={scan.id}
                onClick={() => {
                  if (selectionMode) return;
                  setDetailScan(scan);
                }}
                className={`bg-card rounded-xl border transition-all ${
                  selectionMode ? '' : 'cursor-pointer hover:border-primary/50 hover:shadow-md'
                } ${isSelected ? 'border-primary ring-1 ring-primary/30' : 'border-border'}`}
              >
                <div className="p-4 flex flex-wrap items-start gap-4">
                  {selectionMode && (
                    <button
                      onClick={(e) => toggleSelect(scan.id, e)}
                      className="flex-shrink-0 p-1 rounded border border-border hover:bg-muted mt-0.5"
                      aria-label={isSelected ? 'Deseleccionar' : 'Seleccionar'}
                    >
                      {isSelected ? (
                        <CheckSquare className="h-5 w-5 text-primary" />
                      ) : (
                        <Square className="h-5 w-5 text-muted-foreground" />
                      )}
                    </button>
                  )}
                  <div className="flex-1 min-w-0">
                    <div className="flex flex-wrap items-center gap-2 mb-1">
                      <h3 className="font-semibold text-foreground truncate">{scan.name}</h3>
                      {scan.results != null && (
                        <span className="px-2 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded text-xs font-medium">
                          Completado
                        </span>
                      )}
                      {metrics.riskyCount > 0 && (
                        <span className="px-2 py-0.5 bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300 rounded text-xs font-medium">
                          {metrics.riskyCount} riesgo(s)
                        </span>
                      )}
                    </div>
                    <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground mb-2">
                      <span className="inline-flex items-center gap-1">
                        <Clock className="h-4 w-4" />
                        {formatDate(scan.timestamp)}
                      </span>
                      <span className="text-muted-foreground">{metrics.configLabel}</span>
                    </div>
                    <div className="flex flex-wrap gap-4 text-xs">
                      <span className="inline-flex items-center gap-1">
                        <Server className="h-3.5 w-3.5" />
                        {metrics.totalHosts} hosts
                      </span>
                      <span className="inline-flex items-center gap-1">
                        <Share className="h-3.5 w-3.5" />
                        {metrics.totalShares} shares
                      </span>
                      {metrics.riskyCount > 0 && (
                        <span className="inline-flex items-center gap-1 text-red-600 dark:text-red-400">
                          <AlertTriangle className="h-3.5 w-3.5" />
                          {metrics.riskyCount} accesibles
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0" onClick={(e) => e.stopPropagation()}>
                    {!selectionMode && (
                      <>
                        <button
                          onClick={(e) => handleLoadScan(scan, e)}
                          className="inline-flex items-center gap-2 px-4 py-2 bg-primary text-primary-foreground rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
                          title="Cargar esta búsqueda"
                        >
                          <Play className="h-4 w-4" />
                          Cargar
                        </button>
                        <button
                          onClick={(e) => handleDeleteScan(scan.id, e)}
                          className="p-2 text-destructive hover:bg-destructive/10 rounded-lg transition-colors"
                          title="Eliminar búsqueda"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="flex flex-col items-center gap-3 pt-4">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page <= 1}
            className={`px-3 py-2 rounded-lg border ${page <= 1 ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted'}`}
          >
            Anterior
          </button>
          <div className="text-sm text-muted-foreground">
            Página <span className="font-medium text-foreground">{page}</span> de <span className="font-medium text-foreground">{totalPages}</span>
          </div>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page >= totalPages}
            className={`px-3 py-2 rounded-lg border ${page >= totalPages ? 'opacity-50 cursor-not-allowed' : 'hover:bg-muted'}`}
          >
            Siguiente
          </button>
        </div>
        <div>
          <button
            onClick={onClose}
            className="px-6 py-3 bg-secondary text-secondary-foreground rounded-lg font-medium hover:bg-secondary/80 transition-colors"
          >
            Cerrar
          </button>
        </div>
      </div>

      {detailScan && (
        <RiskySharesModal scan={detailScan} onClose={() => setDetailScan(null)} onOpenShareExplorer={onOpenShareExplorer} />
      )}
    </div>
  );
};

export default SavedScans;
