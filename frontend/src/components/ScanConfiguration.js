import React, { useState, useEffect } from 'react';
import { Play, Settings, Network } from 'lucide-react';
import { storage } from '../utils/storage';

const defaultConfig = {
  name: '',
  ipRange: '',
  ports: '139,445,2049',
  rate: 1500,
  seed: 22346,
  sourcePort: 80,
  wait: 5,
  randomizeHosts: true,
  excludeSubnets: []
};

const ScanConfiguration = ({ onScanStart, isScanning }) => {
  const [config, setConfig] = useState(defaultConfig);

  useEffect(() => {
    const savedConfig = storage.getLastScanConfig();
    if (savedConfig) {
      const savedPorts = savedConfig.ports ?? '139,445,2049';
      // Migrate legacy SMB-only default to include NFS
      const ports =
        savedPorts === '139,445' || savedPorts === '445,139'
          ? '139,445,2049'
          : savedPorts;

      setConfig({
        name: savedConfig.name ?? '',
        ipRange: savedConfig.ipRange ?? '',
        ports,
        rate: savedConfig.rate ?? 1500,
        seed: savedConfig.seed ?? 22346,
        sourcePort: savedConfig.sourcePort ?? 80,
        wait: savedConfig.wait ?? 5,
        randomizeHosts: savedConfig.randomizeHosts !== false,
        excludeSubnets: Array.isArray(savedConfig.excludeSubnets) ? savedConfig.excludeSubnets : []
      });
    }
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (!config.ipRange.trim()) {
      alert('Please enter an IP range');
      return;
    }

    // Save current config as last used
    storage.saveLastScanConfig(config);

    onScanStart(config);
  };

  return (
    <div className="w-full">
      <div className="bg-card rounded-lg border border-border p-6 sm:p-8 lg:p-10">
        <div className="flex items-center space-x-3 mb-6 lg:mb-8">
          <Settings className="h-7 w-7 sm:h-8 sm:w-8 text-primary" />
          <h2 className="text-xl sm:text-2xl font-semibold">Scan Configuration</h2>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 lg:space-y-8">
          {/* IP Range */}
          <div>
            <label className="block text-sm sm:text-base font-medium text-foreground mb-2">
              IP Range *
            </label>
            <div className="flex items-center space-x-2">
              <Network className="h-5 w-5 text-muted-foreground shrink-0" />
              <input
                type="text"
                value={config.ipRange}
                onChange={(e) => setConfig(prev => ({ ...prev, ipRange: e.target.value }))}
                placeholder="e.g., 192.168.1.0/24 or 10.0.0.1"
                className="flex-1 px-4 py-3 bg-background border border-input rounded-md text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={isScanning}
              />
            </div>
            <p className="text-xs text-muted-foreground mt-1">
              Use CIDR notation (192.168.1.0/24) or single IP address
            </p>
          </div>

          {/* Ports */}
          <div>
            <label className="block text-sm sm:text-base font-medium text-foreground mb-2">
              Ports (SMB / NFS)
            </label>
            <input
              type="text"
              value={config.ports}
              onChange={(e) => setConfig(prev => ({ ...prev, ports: e.target.value }))}
              placeholder="139,445,2049"
              className="w-full px-4 py-3 bg-background border border-input rounded-md text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={isScanning}
            />
            <p className="text-xs text-muted-foreground mt-1">
              Default: 139,445 (SMB) + 2049 (NFS)
            </p>
          </div>

          {/* Masscan Parameters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 lg:gap-6">
            <div>
              <label className="block text-sm sm:text-base font-medium text-foreground mb-2">
                Rate (pps)
              </label>
              <input
                type="number"
                value={config.rate}
                onChange={(e) => setConfig(prev => ({ ...prev, rate: parseInt(e.target.value) }))}
                className="w-full px-4 py-3 bg-background border border-input rounded-md text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={isScanning}
              />
            </div>
            <div>
              <label className="block text-sm sm:text-base font-medium text-foreground mb-2">
                Seed
              </label>
              <input
                type="number"
                value={config.seed}
                onChange={(e) => setConfig(prev => ({ ...prev, seed: parseInt(e.target.value) }))}
                className="w-full px-4 py-3 bg-background border border-input rounded-md text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={isScanning}
              />
            </div>
            <div>
              <label className="block text-sm sm:text-base font-medium text-foreground mb-2">
                Source Port
              </label>
              <input
                type="number"
                value={config.sourcePort}
                onChange={(e) => setConfig(prev => ({ ...prev, sourcePort: parseInt(e.target.value) }))}
                className="w-full px-4 py-3 bg-background border border-input rounded-md text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-ring"
                disabled={isScanning}
              />
            </div>
          </div>

          {/* Wait time */}
          <div>
            <label className="block text-sm sm:text-base font-medium text-foreground mb-2">
              Wait Time (seconds)
            </label>
            <input
              type="number"
              value={config.wait}
              onChange={(e) => setConfig(prev => ({ ...prev, wait: parseInt(e.target.value) }))}
              className="w-full px-4 py-3 bg-background border border-input rounded-md text-sm sm:text-base focus:outline-none focus:ring-2 focus:ring-ring"
              disabled={isScanning}
            />
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Time to wait for responses after scan completion
            </p>
          </div>

          {/* Randomize hosts */}
          <div className="flex items-center space-x-2">
            <input
              type="checkbox"
              id="randomizeHosts"
              checked={config.randomizeHosts}
              onChange={(e) => setConfig(prev => ({ ...prev, randomizeHosts: e.target.checked }))}
              disabled={isScanning}
              className="rounded border-input"
            />
            <label htmlFor="randomizeHosts" className="text-sm sm:text-base font-medium text-foreground">
              Randomize host scanning order
            </label>
          </div>

          {/* Action buttons */}
          <div className="pt-4">
            <button
              type="submit"
              disabled={isScanning}
              className="w-full flex items-center justify-center space-x-2 px-8 py-4 text-base sm:text-lg bg-primary text-primary-foreground rounded-md font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
            >
              <Play className="h-5 w-5" />
              <span>{isScanning ? 'Scanning...' : 'Start Reconnaissance'}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default ScanConfiguration;