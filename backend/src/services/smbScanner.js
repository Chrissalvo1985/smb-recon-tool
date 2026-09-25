const fs = require('fs');
const os = require('os');
const path = require('path');
const CommandExecutor = require('../utils/commandExecutor');
const logger = require('../utils/logger');
const sudoSession = require('../utils/sudoSession');

const SMB_PORTS = new Set([139, 445]);
const NFS_PORT = 2049;
const DEFAULT_PORTS = '139,445,2049';

class SMBScanner {
  constructor(io = null) {
    this.io = io;
    this.activeScans = new Map();
  }

  emitProgress(scanId, stage, data) {
    if (this.io) {
      this.io.emit('scan-progress', { scanId, stage, data });
    }
  }

  async startScan(scanId, config) {
    const normalizedConfig = {
      ...config,
      ports: config.ports || DEFAULT_PORTS
    };

    if (normalizedConfig.sudoPassword) {
      sudoSession.set(normalizedConfig.sudoPassword);
    }

    this.activeScans.set(scanId, { 
      status: 'running', 
      config: normalizedConfig, 
      results: {},
      cancelled: false 
    });

    try {
      this.emitProgress(scanId, 'started', { message: 'Starting SMB/NFS reconnaissance scan' });

      // Phase 1: Masscan execution
      const masscanResults = await this.executeMasscan(scanId, normalizedConfig);
      
      // Check if cancelled
      if (this.isCancelled(scanId)) {
        throw new Error('Scan cancelled by user');
      }

      if (!masscanResults.success) {
        throw new Error(`Masscan failed: ${masscanResults.error}`);
      }

      // Phase 1.5: Filter problematic subnets (3rd octet with > 7 hosts)
      const filteredHosts = this.filterProblematicSubnets(scanId, masscanResults.hosts);

      // Check if cancelled
      if (this.isCancelled(scanId)) {
        throw new Error('Scan cancelled by user');
      }

      // Phase 2: Quick host reachability check (filter dead hosts)
      const reachableHosts = await this.filterReachableHosts(scanId, filteredHosts);

      // Check if cancelled
      if (this.isCancelled(scanId)) {
        throw new Error('Scan cancelled by user');
      }

      // Phase 3: SMB enumeration (only reachable hosts)
      const enumerationResults = await this.enumerateSMBHosts(scanId, reachableHosts);

      // Check if cancelled
      if (this.isCancelled(scanId)) {
        throw new Error('Scan cancelled by user');
      }

      // Phase 4: Access validation
      const finalResults = await this.validateShareAccess(scanId, enumerationResults);

      this.activeScans.set(scanId, {
        status: 'completed',
        config: normalizedConfig,
        results: finalResults,
        completedAt: new Date()
      });

      this.emitProgress(scanId, 'completed', { results: finalResults });

      return finalResults;

    } catch (error) {
      logger.error('Scan failed:', error);
      
      const scanData = this.activeScans.get(scanId);
      const isCancelled = scanData && scanData.cancelled;
      
      this.activeScans.set(scanId, {
        status: isCancelled ? 'cancelled' : 'failed',
        config: normalizedConfig,
        error: error.message,
        failedAt: new Date()
      });
      
      this.emitProgress(scanId, isCancelled ? 'cancelled' : 'failed', { error: error.message });
      throw error;
    }
  }

  isCancelled(scanId) {
    const scan = this.activeScans.get(scanId);
    return scan && scan.cancelled === true;
  }

  async executeMasscan(scanId, config) {
    this.emitProgress(scanId, 'masscan-start', { 
      message: 'Starting masscan execution',
      scanning: true 
    });

    // Check if we can run masscan with sudo (or if we're already root)
    const isRoot = process.getuid && process.getuid() === 0;
    const sudoPassword = config.sudoPassword;

    if (!isRoot) {
      // First try passwordless sudo (non-interactive)
      const sudoCheck = await CommandExecutor.executeCommand('sudo -n true', { timeout: 5000 });
      
      if (!sudoCheck.success) {
        // Passwordless sudo is not configured
        if (sudoPassword) {
          // We have a password, test it
          this.emitProgress(scanId, 'masscan-auth', {
            message: 'Authenticating with provided sudo password...'
          });

          // Test the password by trying a simple sudo command
          const testCommand = `echo "${sudoPassword}" | sudo -S true 2>&1`;
          const testResult = await CommandExecutor.executeCommand(testCommand, { timeout: 5000 });

          if (!testResult.success || testResult.stdout.includes('incorrect password')) {
            throw new Error('Invalid sudo password provided. Please check your password and try again.');
          }
        } else {
          // No password provided and passwordless sudo is not configured
          // We MUST show the modal - throw specific error
          throw new Error('Masscan requires root privileges. Please provide a sudo password.');
        }
      }
    }

    const {
      ipRange,
      ports = DEFAULT_PORTS,
      rate = 1500,
      seed = 22346,
      sourcePort = 80,
      wait = 5,
      excludeSubnets = []
    } = config;

    // Build masscan command (use sudo only if not running as root)
    let command;
    if (isRoot) {
      command = `masscan -p${ports} --rate=${rate} --open --randomize-hosts --seed=${seed} --source-port ${sourcePort} --wait=${wait} ${ipRange}`;
    } else if (sudoPassword) {
      // Use password with sudo -S (read from stdin)
      command = `echo "${sudoPassword}" | sudo -S masscan -p${ports} --rate=${rate} --open --randomize-hosts --seed=${seed} --source-port ${sourcePort} --wait=${wait} ${ipRange}`;
    } else {
      command = `sudo masscan -p${ports} --rate=${rate} --open --randomize-hosts --seed=${seed} --source-port ${sourcePort} --wait=${wait} ${ipRange}`;
    }

    // Add exclusions if specified
    if (excludeSubnets.length > 0) {
      const excludeArgs = excludeSubnets.map(subnet => `--exclude ${subnet}`).join(' ');
      command += ` ${excludeArgs}`;
    }

    logger.info(`Executing masscan: ${command.replace(sudoPassword || '', '[PASSWORD]')}`);

    // Execute with real-time output capture
    const result = await CommandExecutor.executeCommand(command, { 
      timeout: 300000,
      scanId: scanId,
      onData: (data) => {
        // Parse real-time output for status updates
        const statusMatch = data.match(/rate:\s*[\d.]+\S*,\s*([\d.]+)%\s*done(?:,\s*(.+?)\s*remaining)?/);
        if (statusMatch) {
          const percentDone = parseFloat(statusMatch[1]);
          const timeRemaining = statusMatch[2] || 'calculating...';
          
          this.emitProgress(scanId, 'masscan-progress', {
            message: `Scanning in progress`,
            percentDone: percentDone,
            timeRemaining: timeRemaining,
            scanning: true
          });
        }
        
        // Also check for host discoveries in real-time
        const portMatch = data.match(/Discovered open port (\d+)\/tcp on ([^\s]+)/);
        if (portMatch) {
          const port = parseInt(portMatch[1]);
          const ip = portMatch[2];
          
          this.emitProgress(scanId, 'masscan-progress', {
            message: `Found: ${ip}:${port}`,
            hostFound: { ip, openPorts: [port] },
            scanning: true
          });
        }
      }
    });

    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Parse masscan output and emit progress as we find hosts
    const hosts = this.parseMasscanOutput(result.stdout, (host) => {
      // Emit progress for each host found (final parse)
      this.emitProgress(scanId, 'masscan-progress', {
        message: `Found host: ${host.ip} with ports ${host.openPorts.join(', ')}`,
        hostFound: host,
        scanning: true
      });
    });
    
    logger.info(`Masscan complete: ${hosts.length} hosts found`);

    this.emitProgress(scanId, 'masscan-complete', {
      message: `Masscan completed. Found ${hosts.length} hosts with open ports`,
      hostsFound: hosts.length
    });

    return { success: true, hosts };
  }

  parseMasscanOutput(output, onHostFound = null) {
    const hosts = new Map();

    // Match lines like: Discovered open port 445/tcp on 192.168.1.100
    const portRegex = /Discovered open port (\d+)\/tcp on ([^\s]+)/g;
    let match;

    while ((match = portRegex.exec(output)) !== null) {
      const port = parseInt(match[1]);
      const ip = match[2];

      if (!hosts.has(ip)) {
        const hostData = { ip, openPorts: [] };
        hosts.set(ip, hostData);
        
        // Notify about new host found
        if (onHostFound) {
          onHostFound(hostData);
        }
      }

      if (!hosts.get(ip).openPorts.includes(port)) {
        hosts.get(ip).openPorts.push(port);
      }
    }

    return Array.from(hosts.values());
  }

  filterProblematicSubnets(scanId, hosts) {
    // Group hosts by third octet (e.g., 192.168.1.* -> "192.168.1")
    // Track unique IPs for counting, but keep ALL host records
    const subnetMap = new Map();
    
    for (const host of hosts) {
      const octets = host.ip.split('.');
      if (octets.length >= 3) {
        const thirdOctetSubnet = `${octets[0]}.${octets[1]}.${octets[2]}`;
        
        if (!subnetMap.has(thirdOctetSubnet)) {
          subnetMap.set(thirdOctetSubnet, {
            uniqueIPs: new Set(),  // For counting unique IPs
            hosts: []              // Keep ALL hosts (including duplicate IPs with different ports)
          });
        }
        
        const subnetData = subnetMap.get(thirdOctetSubnet);
        
        // Track this IP as seen (for counting)
        subnetData.uniqueIPs.add(host.ip);
        
        // Always add the host (even if IP is duplicate - different ports)
        subnetData.hosts.push(host);
      }
    }

    // Filter out subnets with > 7 unique IPs (likely problematic/timed out subnets)
    const filteredHosts = [];
    const discardedSubnets = [];
    
    for (const [subnet, subnetData] of subnetMap.entries()) {
      const uniqueIPCount = subnetData.uniqueIPs.size;
      
      if (uniqueIPCount > 15) {
        // Discard entire subnet (all hosts including duplicate IPs)
        discardedSubnets.push({ subnet, count: uniqueIPCount });
        logger.warn(`Discarding subnet ${subnet}.* (${uniqueIPCount} unique IPs - likely timeout)`);
      } else {
        // Keep all hosts from this subnet (including duplicate IPs with different ports)
        filteredHosts.push(...subnetData.hosts);
      }
    }

    const totalDiscarded = hosts.length - filteredHosts.length;
    
    if (totalDiscarded > 0) {
      this.emitProgress(scanId, 'subnet-filter', {
        message: `Filtered out ${totalDiscarded} hosts from ${discardedSubnets.length} problematic subnets`,
        originalCount: hosts.length,
        filteredCount: filteredHosts.length,
        discardedSubnets: discardedSubnets
      });
      
      logger.info(`Subnet filter: kept ${filteredHosts.length}/${hosts.length} hosts`);
    }

    // Deduplicate IPs: keep only one entry per unique IP
    // Merge ports from duplicate IPs into a single host entry
    const uniqueHostsMap = new Map();
    
    for (const host of filteredHosts) {
      if (!uniqueHostsMap.has(host.ip)) {
        uniqueHostsMap.set(host.ip, {
          ip: host.ip,
          openPorts: [...host.openPorts]
        });
      } else {
        // Merge ports from duplicate IP
        const existingHost = uniqueHostsMap.get(host.ip);
        for (const port of host.openPorts) {
          if (!existingHost.openPorts.includes(port)) {
            existingHost.openPorts.push(port);
          }
        }
      }
    }

    const uniqueHosts = Array.from(uniqueHostsMap.values());
    
    if (uniqueHosts.length < filteredHosts.length) {
      logger.info(`Deduplicated: ${filteredHosts.length} records → ${uniqueHosts.length} unique IPs`);
    }

    return uniqueHosts;
  }

  async filterReachableHosts(scanId, hosts) {
    this.emitProgress(scanId, 'reachability-start', {
      message: 'Testing host reachability to filter unreachable targets',
      totalHosts: hosts.length
    });

    const reachableHosts = [];
    const unreachableHosts = [];
    let tested = 0;

    // Test hosts in parallel batches of 10 for speed
    const batchSize = 10;
    for (let i = 0; i < hosts.length; i += batchSize) {
      const batch = hosts.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(host => this.testHostReachability(host, scanId))
      );

      for (let j = 0; j < results.length; j++) {
        tested++;
        const host = batch[j];
        const isReachable = results[j];

        if (isReachable) {
          reachableHosts.push(host);
        } else {
          unreachableHosts.push(host);
        }

        this.emitProgress(scanId, 'reachability-progress', {
          message: `Testing connectivity: ${host.ip}`,
          tested,
          total: hosts.length,
          reachable: reachableHosts.length,
          unreachable: unreachableHosts.length,
          currentHost: host.ip
        });
      }
    }

    this.emitProgress(scanId, 'reachability-complete', {
      message: `Reachability check complete. ${reachableHosts.length}/${hosts.length} hosts are reachable`,
      reachable: reachableHosts.length,
      unreachable: unreachableHosts.length,
      total: hosts.length
    });

    logger.info(`Reachability: ${reachableHosts.length} reachable / ${unreachableHosts.length} unreachable`);
    
    return reachableHosts;
  }

  async testHostReachability(host, scanId) {
    // Quick TCP connection test on discovered ports (SMB and/or NFS)
    const ports = host.openPorts || [445, 139, NFS_PORT];
    
    for (const port of ports) {
      try {
        // Use nc (netcat) without aggressive timeouts
        // -z = scan mode (no data transfer)
        // Let nc use its default timeout behavior
        const command = `nc -z ${host.ip} ${port} 2>&1`;
        const result = await CommandExecutor.executeCommand(command, { timeout: 5000, scanId });
        
        if (result.success) {
          return true;
        }
      } catch (error) {
        // Try next port
        continue;
      }
    }
    
    return false; // All ports failed
  }

  hasSmbPorts(openPorts = []) {
    return openPorts.some((p) => SMB_PORTS.has(p));
  }

  hasNfsPort(openPorts = []) {
    return openPorts.includes(NFS_PORT);
  }

  async enumerateSMBHosts(scanId, hosts) {
    this.emitProgress(scanId, 'enumeration-start', {
      message: 'Starting SMB/NFS enumeration',
      totalHosts: hosts.length
    });

    const results = {};
    let processed = 0;

    for (const host of hosts) {
      const startMs = Date.now();
      try {
        const shares = await this.enumerateHostShares(host.ip, host.openPorts || [], scanId);
        const response_ms = Date.now() - startMs;
        results[host.ip] = {
          host_status: 'reachable',
          open_ports: host.openPorts,
          shares: shares,
          response_ms
        };

        processed++;
        this.emitProgress(scanId, 'enumeration-progress', {
          message: `Enumerated ${processed}/${hosts.length} hosts`,
          currentHost: host.ip,
          processed,
          total: hosts.length
        });

      } catch (error) {
        logger.warn(`Failed to enumerate ${host.ip}: ${error.message}`);
        const response_ms = Date.now() - startMs;
        results[host.ip] = {
          host_status: 'error',
          open_ports: host.openPorts,
          error: error.message,
          shares: {},
          response_ms
        };
      }
    }

    this.emitProgress(scanId, 'enumeration-complete', {
      message: `SMB/NFS enumeration completed. Processed ${processed} hosts`
    });

    return results;
  }

  async enumerateHostShares(ip, openPorts, scanId) {
    const shares = {};
    const doSmb = this.hasSmbPorts(openPorts);
    const doNfs = this.hasNfsPort(openPorts);

    if (doSmb || (!doSmb && !doNfs)) {
      Object.assign(shares, await this.enumerateSMBShares(ip, scanId));
    }
    if (doNfs) {
      Object.assign(shares, await this.enumerateNFSExports(ip, scanId));
    }

    return shares;
  }

  async enumerateSMBShares(ip, scanId) {
    // -L = list shares on host
    // -N = no password (null session)
    // -m SMB2 = force SMB2 protocol (faster)
    // 2>&1 = redirect stderr to stdout for better error capture
    const command = `smbclient -L //${ip} -N -m SMB2 2>&1`;
    const result = await CommandExecutor.executeCommand(command, { timeout: 30000, scanId });

    // Check if we got any output (success or informative error)
    if (result.stdout && result.stdout.length > 0) {
      return this.parseSMBClientOutput(result.stdout);
    }

    if (!result.success) {
      return {};
    }

    return this.parseSMBClientOutput(result.stdout || '');
  }

  async enumerateNFSExports(ip, scanId) {
    const command = `showmount -e ${ip} 2>&1`;
    const result = await CommandExecutor.executeCommand(command, { timeout: 30000, scanId });

    if (!result.stdout && !result.success) {
      logger.warn(`showmount failed for ${ip}: ${result.error || result.stderr || 'unknown'}`);
      return {};
    }

    return this.parseShowmountOutput(result.stdout || '');
  }

  parseShowmountOutput(output) {
    const exportsMap = {};
    const lines = (output || '').split('\n');

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/^Export list for/i.test(line)) continue;
      if (/^Exports list on/i.test(line)) continue;
      if (/^Everyone$/i.test(line)) continue;

      // Formats:
      // /export        *
      // /home/share    192.168.1.0
      // /backup        10.0.0.0/8,192.168.0.0/16
      const match = line.match(/^(\/\S+)\s*(.*)$/);
      if (!match) continue;

      const exportPath = match[1];
      const clients = (match[2] || '*').trim() || '*';

      exportsMap[exportPath] = {
        type: 'NFS',
        access: 'unknown',
        protocol: 'nfs',
        clients
      };
    }

    return exportsMap;
  }

  parseSMBClientOutput(output) {
    const shares = {};

    // Split output into lines and find share listings
    const lines = output.split('\n');
    let inShareSection = false;

    for (const line of lines) {
      // Look for the start of share listings
      if (line.includes('Sharename') && line.includes('Type')) {
        inShareSection = true;
        continue;
      }

      // Stop parsing when we hit workgroup or other sections
      if (inShareSection && (line.includes('Workgroup') || line.includes('Server'))) {
        break;
      }

      if (inShareSection && line.trim()) {
        // Parse share line: "Sharename       Type      Comment"
        const parts = line.trim().split(/\s+/);
        if (parts.length >= 2) {
          const shareName = parts[0];
          const shareType = parts[1];

          // Skip IPC$, Print$ and admin$ (and variants)
          const nameLower = shareName.toLowerCase();
          if (nameLower === 'ipc$' || nameLower === 'print$' || nameLower === 'admin$') {
            continue;
          }

          // Only include Disk shares
          if (shareType === 'Disk') {
            shares[shareName] = {
              type: shareType,
              access: 'unknown' // Will be validated later
            };
          }
        }
      }
    }

    return shares;
  }

  async validateShareAccess(scanId, hostResults) {
    this.emitProgress(scanId, 'validation-start', {
      message: 'Starting share access validation'
    });

    let totalShares = 0;
    let validatedShares = 0;

    // Count total shares first
    for (const hostData of Object.values(hostResults)) {
      if (hostData.shares) {
        totalShares += Object.keys(hostData.shares).length;
      }
    }

    for (const [ip, hostData] of Object.entries(hostResults)) {
      if (hostData.shares) {
        for (const [shareName, shareInfo] of Object.entries(hostData.shares)) {
          try {
            const accessResult = await this.validateShareAccessForHost(ip, shareName, shareInfo, scanId);
            const sharePayload = {
              ...shareInfo,
              access: accessResult.access,
              evidence: accessResult.evidence
            };
            if (shareName === 'admin$' && accessResult.access === 'READ') {
              const adminExtra = await this.probeAdminShare(ip, scanId);
              if (adminExtra) sharePayload.admin_extra = adminExtra;
            }
            hostData.shares[shareName] = sharePayload;

            validatedShares++;
            this.emitProgress(scanId, 'validation-progress', {
              message: `Validating ${ip}/${shareName}`,
              currentHost: ip,
              currentShare: shareName,
              validated: validatedShares,
              total: totalShares
            });

          } catch (error) {
            logger.warn(`Access validation failed: ${ip}/${shareName}`);
            hostData.shares[shareName] = {
              ...shareInfo,
              access: 'ERROR',
              evidence: error.message
            };
          }
        }
      }
    }

    this.emitProgress(scanId, 'validation-complete', {
      message: `Share access validation completed. Validated ${validatedShares} shares`
    });

    return hostResults;
  }

  async validateShareAccessForHost(ip, shareName, shareInfo = {}, scanId) {
    if (shareInfo.type === 'NFS' || shareInfo.protocol === 'nfs' || String(shareName).startsWith('/')) {
      return this.validateNFSExportAccess(ip, shareName, scanId);
    }

    // Test connection by trying to list the root directory
    // -N = no password (null session)
    // -c "ls" = execute list command
    // -m SMB2 = force SMB2 (faster)
    const command = `smbclient "//${ip}/${shareName}" -N -m SMB2 -c "ls" 2>&1`;
    const result = await CommandExecutor.executeCommand(command, { timeout: 15000, scanId });

    // Combine stdout and stderr for comprehensive error checking
    const output = (result.stdout + ' ' + result.stderr).toLowerCase();

    // Check for explicit access denied errors
    if (output.includes('nt_status_access_denied') || 
        output.includes('access denied') ||
        output.includes('nt_status_logon_failure') ||
        output.includes('session setup failed')) {
      return { access: 'DENIED', evidence: 'access denied (authentication required)' };
    }

    // Check for successful connection (exit code 0 and some output)
    if (result.success && result.stdout.trim().length > 0) {
      return { access: 'READ', evidence: 'read access confirmed' };
    }

    // Check for empty share (accessible but empty)
    if (result.success && result.stdout.trim().length === 0) {
      return { access: 'READ', evidence: 'read access (empty share)' };
    }

    // Check for other connection errors
    if (output.includes('connection refused') || 
        output.includes('nt_status_host_unreachable') ||
        output.includes('connection timed out')) {
      return { access: 'ERROR', evidence: 'connection failed' };
    }

    // If we can't determine, return unknown
    return { access: 'UNKNOWN', evidence: 'could not determine access level' };
  }

  buildPrivilegedCommand(baseCommand, scanId) {
    const isRoot = process.getuid && process.getuid() === 0;
    if (isRoot) return baseCommand;

    const scan = this.activeScans.get(scanId);
    const sudoPassword = scan?.config?.sudoPassword || sudoSession.get();
    if (sudoPassword) {
      // Escape for shell: wrap password carefully — same pattern as masscan path
      return `echo "${sudoPassword}" | sudo -S ${baseCommand}`;
    }
    return `sudo -n ${baseCommand}`;
  }

  async validateNFSExportAccess(ip, exportPath, scanId) {
    const mountPoint = fs.mkdtempSync(path.join(os.tmpdir(), 'nfs-recon-'));
    try {
      const mountResult = await this.mountNFS(ip, exportPath, mountPoint, scanId);
      const output = `${mountResult.stdout || ''} ${mountResult.stderr || ''}`.toLowerCase();

      if (!mountResult.success) {
        if (
          output.includes('access denied') ||
          output.includes('permission denied') ||
          output.includes('operation not permitted') ||
          output.includes('authentication')
        ) {
          return { access: 'DENIED', evidence: 'nfs mount denied (auth/export ACL)' };
        }
        if (output.includes('a password is required') || output.includes('sudo:')) {
          return { access: 'UNKNOWN', evidence: 'nfs mount requires sudo privileges' };
        }
        if (output.includes('timed out') || output.includes('connection refused') || output.includes('no route')) {
          return { access: 'ERROR', evidence: 'nfs mount connection failed' };
        }
        return { access: 'UNKNOWN', evidence: `nfs mount failed: ${(mountResult.stdout || mountResult.stderr || 'unknown').trim().slice(0, 120)}` };
      }

      try {
        fs.readdirSync(mountPoint);
        return { access: 'READ', evidence: 'nfs mount + readdir confirmed' };
      } catch (err) {
        return { access: 'DENIED', evidence: `mounted but readdir failed: ${err.message}` };
      }
    } finally {
      await this.unmountNFS(mountPoint, scanId);
      try {
        fs.rmdirSync(mountPoint);
      } catch (e) {
        // ignore
      }
    }
  }

  async mountNFS(ip, exportPath, mountPoint, scanId) {
    const safeExport = String(exportPath).startsWith('/') ? exportPath : `/${exportPath}`;
    const target = `${ip}:${safeExport}`;
    const opts = 'ro,soft,timeo=5,retrans=1,nolock';

    // Prefer NFSv3-style mount; fallback to nfs4 if needed
    const attempts = [
      `mount -t nfs -o ${opts} ${target} ${mountPoint} 2>&1`,
      `mount -t nfs4 -o ro,soft ${target} ${mountPoint} 2>&1`,
      `mount -t nfs -o vers=4,ro,soft ${target} ${mountPoint} 2>&1`
    ];

    let lastResult = { success: false, stdout: '', stderr: 'mount failed' };
    for (const base of attempts) {
      const command = this.buildPrivilegedCommand(base, scanId);
      const result = await CommandExecutor.executeCommand(command, { timeout: 20000, scanId });
      lastResult = result;
      if (result.success) return result;

      // Don't retry auth/sudo failures with different nfs versions
      const combined = `${result.stdout || ''} ${result.stderr || ''}`.toLowerCase();
      if (combined.includes('a password is required') || combined.includes('incorrect password')) {
        return result;
      }
    }
    return lastResult;
  }

  async unmountNFS(mountPoint, scanId) {
    const attempts = [
      `umount ${mountPoint} 2>&1`,
      `umount -f ${mountPoint} 2>&1`,
      `diskutil unmount force ${mountPoint} 2>&1`
    ];
    for (const base of attempts) {
      const command = this.buildPrivilegedCommand(base, scanId);
      const result = await CommandExecutor.executeCommand(command, { timeout: 10000, scanId });
      if (result.success) return;
    }
  }

  /**
   * Quick probes when admin$ is accessible (READ). Two checks, 5s timeout each.
   * Returns { winIniRead, winIniPreview?, system32Listed } or null on failure.
   */
  async probeAdminShare(ip, scanId) {
    const out = { winIniRead: false, system32Listed: false };
    const timeout = 5000;

    try {
      const getWinIni = `smbclient "//${ip}/admin$" -N -m SMB2 -c "get win.ini -" 2>&1`;
      const res1 = await CommandExecutor.executeCommand(getWinIni, { timeout, scanId });
      if (res1.success && res1.stdout && res1.stdout.trim().length > 0) {
        out.winIniRead = true;
        out.winIniPreview = res1.stdout.trim().slice(0, 400).replace(/\r/g, '');
      }
    } catch (e) {
      // ignore
    }

    try {
      const lsSystem32 = `smbclient "//${ip}/admin$" -N -m SMB2 -c "ls System32" 2>&1`;
      const res2 = await CommandExecutor.executeCommand(lsSystem32, { timeout, scanId });
      if (res2.success && !/NT_STATUS_ACCESS_DENIED|error/i.test((res2.stdout || '') + (res2.stderr || ''))) {
        out.system32Listed = true;
      }
    } catch (e) {
      // ignore
    }

    return out;
  }

  getScanStatus(scanId) {
    return this.activeScans.get(scanId) || null;
  }

  cancelScan(scanId) {
    const scan = this.activeScans.get(scanId);
    if (scan && scan.status === 'running') {
      // Mark as cancelled
      scan.cancelled = true;
      scan.status = 'cancelled';
      
      // Kill all active processes for this scan
      const CommandExecutor = require('../utils/commandExecutor');
      const killedCount = CommandExecutor.killScanProcesses(scanId);
      
      logger.info(`Cancelled scan ${scanId}, killed ${killedCount} processes`);
      
      this.emitProgress(scanId, 'cancelled', { message: 'Scan cancelled by user' });
      return true;
    }
    return false;
  }
}

module.exports = SMBScanner;