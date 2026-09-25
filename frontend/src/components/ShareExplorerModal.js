import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  X,
  Folder,
  FileText,
  Image,
  FileSpreadsheet,
  Archive,
  File,
  LayoutGrid,
  List,
  ChevronRight,
  Loader2,
  AlertCircle,
} from 'lucide-react';
import { browseShare } from '../services/shareBrowserApi';

const VIEW_GRID = 'grid';
const VIEW_LIST = 'list';

function getEntryIcon(entry) {
  if (entry.type === 'folder') return Folder;
  const name = (entry.name || '').toLowerCase();
  if (name.endsWith('.zip') || name.endsWith('.rar') || name.endsWith('.7z')) return Archive;
  if (name.match(/\.(png|jpg|jpeg|gif|webp|bmp|svg)$/)) return Image;
  if (name.match(/\.(xlsx|xls|csv)$/)) return FileSpreadsheet;
  if (name.endsWith('.txt') || name.endsWith('.md') || name.endsWith('.log')) return FileText;
  return File;
}

function FileItem({ entry, path, onOpenFolder, viewMode }) {
  const Icon = getEntryIcon(entry);
  const isFolder = entry.type === 'folder';

  const handleClick = () => {
    if (isFolder) {
      const nextPath = path ? `${path}/${entry.name}` : entry.name;
      onOpenFolder(nextPath);
    }
  };

  const iconColor = isFolder ? 'text-amber-600' : 'text-muted-foreground';
  const sensitiveBadge = entry.isSensitive && (
    <span className="ml-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-red-100 text-red-700 dark:bg-red-900/40 dark:text-red-300">
      Sensitive
    </span>
  );

  if (viewMode === VIEW_LIST) {
    return (
      <button
        type="button"
        onClick={handleClick}
        disabled={!isFolder}
        className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-left transition-colors ${
          isFolder ? 'hover:bg-muted/80' : 'cursor-default opacity-80'
        }`}
      >
        <Icon className={`h-5 w-5 shrink-0 ${iconColor}`} />
        <span className="flex-1 truncate font-medium text-sm">{entry.name}</span>
        {sensitiveBadge}
        {entry.type === 'file' && entry.size != null && (
          <span className="text-xs text-muted-foreground shrink-0">
            {entry.size >= 1024 ? `${(entry.size / 1024).toFixed(1)} KB` : `${entry.size} B`}
          </span>
        )}
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!isFolder}
      className={`flex flex-col items-center gap-2 p-4 rounded-xl border border-border transition-colors ${
        isFolder ? 'hover:bg-muted/80 hover:border-primary/30' : 'cursor-default opacity-80'
      }`}
    >
      <Icon className={`h-10 w-10 shrink-0 ${iconColor}`} />
      <div className="flex items-center justify-center gap-1 w-full min-w-0">
        <span className="text-sm font-medium truncate">{entry.name}</span>
        {sensitiveBadge}
      </div>
    </button>
  );
}

export default function ShareExplorerModal({ isOpen, onClose, host, share, protocol }) {
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [currentPath, setCurrentPath] = useState('');
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [viewMode, setViewMode] = useState(VIEW_GRID);
  const cacheRef = useRef({});
  const resolvedProtocol =
    protocol ||
    (String(share || '').startsWith('/') ? 'nfs' : 'smb');

  const fetchPath = useCallback(
    async (path) => {
      if (!host || !share) return;
      const cacheKey = path || '/';
      if (cacheRef.current[cacheKey]) {
        setEntries(cacheRef.current[cacheKey]);
        setError(null);
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const data = await browseShare(host, share, path, resolvedProtocol);
        const list = Array.isArray(data) ? data : [];
        setEntries(list);
        cacheRef.current = { ...cacheRef.current, [cacheKey]: list };
      } catch (err) {
        setError(err.message || 'Failed to load directory');
        setEntries([]);
      } finally {
        setLoading(false);
      }
    },
    [host, share, resolvedProtocol]
  );

  useEffect(() => {
    if (!isOpen || !host || !share) return;
    setCurrentPath('');
    setBreadcrumbs([{ label: share, path: '' }]);
    cacheRef.current = {};
    setError(null);
  }, [isOpen, host, share]);

  useEffect(() => {
    if (!isOpen || !host || !share) return;
    fetchPath(currentPath);
  }, [isOpen, host, share, currentPath, fetchPath]);

  const handleOpenFolder = (nextPath) => {
    const segments = nextPath.split('/').filter(Boolean);
    setBreadcrumbs([
      { label: share, path: '' },
      ...segments.map((name, i) => ({
        label: name,
        path: segments.slice(0, i + 1).join('/'),
      })),
    ]);
    setCurrentPath(nextPath);
  };

  const handleBreadcrumbClick = (path) => {
    const segments = path ? path.split('/').filter(Boolean) : [];
    setBreadcrumbs([
      { label: share, path: '' },
      ...segments.map((name, i) => ({
        label: name,
        path: segments.slice(0, i + 1).join('/'),
      })),
    ]);
    setCurrentPath(path);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background">
      {/* Header */}
      <header className="shrink-0 flex items-center gap-4 px-4 py-3 border-b border-border bg-card">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {breadcrumbs.map((crumb, i) => (
            <React.Fragment key={crumb.path}>
              {i > 0 && <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />}
              <button
                type="button"
                onClick={() => handleBreadcrumbClick(crumb.path)}
                className="text-sm font-medium text-foreground hover:text-primary truncate max-w-[120px] md:max-w-[200px]"
                title={crumb.label}
              >
                {crumb.label}
              </button>
            </React.Fragment>
          ))}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className="text-xs text-muted-foreground font-mono">{host}</span>
          <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">
            {resolvedProtocol === 'nfs' ? 'NFS' : 'SMB'}
          </span>
          <button
            type="button"
            onClick={() => setViewMode(viewMode === VIEW_GRID ? VIEW_LIST : VIEW_GRID)}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
            title={viewMode === VIEW_GRID ? 'List view' : 'Grid view'}
          >
            {viewMode === VIEW_GRID ? <List className="h-4 w-4" /> : <LayoutGrid className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-muted text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>
      </header>

      {/* Content */}
      <main className="flex-1 overflow-auto p-4">
        {loading && (
          <div className="flex items-center justify-center py-16">
            <Loader2 className="h-8 w-8 animate-spin text-primary" />
          </div>
        )}

        {error && !loading && (
          <div className="flex flex-col items-center justify-center py-16 gap-3">
            <AlertCircle className="h-12 w-12 text-destructive" />
            <p className="text-sm text-muted-foreground text-center max-w-md">{error}</p>
          </div>
        )}

        {!loading && !error && entries.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
            <Folder className="h-12 w-12 mb-2 opacity-50" />
            <p className="text-sm">This folder is empty</p>
          </div>
        )}

        {!loading && !error && entries.length > 0 && (
          viewMode === VIEW_GRID ? (
            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-3">
              {entries.map((entry) => (
                <FileItem
                  key={entry.name}
                  entry={entry}
                  path={currentPath}
                  onOpenFolder={handleOpenFolder}
                  viewMode={VIEW_GRID}
                />
              ))}
            </div>
          ) : (
            <div className="max-w-3xl space-y-0.5">
              {entries.map((entry) => (
                <FileItem
                  key={entry.name}
                  entry={entry}
                  path={currentPath}
                  onOpenFolder={handleOpenFolder}
                  viewMode={VIEW_LIST}
                />
              ))}
            </div>
          )
        )}
      </main>
    </div>
  );
}
