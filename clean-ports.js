#!/usr/bin/env node

/**
 * Port Cleaning Script for SMB Recon Tool
 *
 * This script automatically cleans development ports (3000 and 3001) that may be
 * occupied by previous development server instances. It's automatically executed
 * before starting the development servers with `npm run dev`.
 *
 * Usage:
 *   node clean-ports.js
 *   npm run clean-ports
 *
 * The script will:
 * 1. Check if ports 3000 and 3001 are in use
 * 2. Kill any processes using these ports
 * 3. Wait for ports to be freed
 * 4. Exit with success/failure code
 *
 * In CI environments, the script will warn but not kill processes to avoid
 * interfering with other test suites.
 */

const { execSync, spawn } = require('child_process');
const os = require('os');

const PORTS_TO_CHECK = [3000, 3005];
const isCI = process.env.CONTINUOUS_INTEGRATION ||
             process.env.BUILD_NUMBER ||
             process.env.TRAVIS ||
             process.env.CIRCLECI ||
             process.env.GITHUB_ACTIONS ||
             process.env.GITLAB_CI ||
             process.env.JENKINS_HOME;

function getProcessUsingPort(port) {
  try {
    const output = execSync(`lsof -i :${port} -t`, { encoding: 'utf8' });
    const pids = output.trim().split('\n').filter(pid => pid.length > 0);
    return pids.length > 0 ? pids : null;
  } catch (error) {
    return null;
  }
}

function killProcesses(pids) {
  console.log(`🔪 Killing processes: ${pids.join(', ')}`);
  try {
    if (os.platform() === 'win32') {
      // On Windows, try taskkill first, then fallback to other methods
      try {
        execSync(`taskkill /PID ${pids.join(' /PID ')} /F /T`);
      } catch (e) {
        // Fallback: try to kill node processes specifically
        execSync(`for %p in (${pids.join(' ')}) do taskkill /PID %p /F 2>nul`);
      }
    } else {
      execSync(`kill -9 ${pids.join(' ')}`);
    }
  } catch (error) {
    console.warn(`⚠️  Failed to kill some processes: ${error.message}`);
    // Try alternative killing method on macOS/Linux
    if (os.platform() !== 'win32') {
      try {
        execSync(`pkill -9 -P ${pids.join(' -P ')}`);
      } catch (e) {
        // Ignore secondary kill failures
      }
    }
  }
}

function waitForPortToFree(port, maxWait = 5000) {
  const startTime = Date.now();
  while (Date.now() - startTime < maxWait) {
    if (!getProcessUsingPort(port)) {
      return true;
    }
    // Wait 100ms before checking again
    const waitUntil = Date.now() + 100;
    while (Date.now() < waitUntil) {}
  }
  return false;
}

function cleanPort(port) {
  console.log(`🔍 Checking port ${port}...`);

  const pids = getProcessUsingPort(port);
  if (!pids) {
    console.log(`✅ Port ${port} is free`);
    return true;
  }

  console.log(`🚨 Port ${port} is in use by processes: ${pids.join(', ')}`);

  if (isCI) {
    console.warn(`⚠️  CI environment detected. Skipping process termination for port ${port}`);
    console.warn(`💡 In CI, ensure ports are free before running tests`);
    return false;
  }

  killProcesses(pids);

  // Wait for port to be freed
  if (waitForPortToFree(port)) {
    console.log(`✅ Port ${port} is now free`);
    return true;
  } else {
    console.error(`❌ Failed to free port ${port}`);
    return false;
  }
}

function main() {
  console.log('🧹 Cleaning development ports...');

  let allClean = true;
  for (const port of PORTS_TO_CHECK) {
    if (!cleanPort(port)) {
      allClean = false;
    }
  }

  if (allClean) {
    console.log('🎉 All ports cleaned successfully!');
    process.exit(0);
  } else {
    console.error('💥 Failed to clean some ports');
    if (isCI) {
      console.error('💡 In CI environments, ensure ports 3000 and 3005 are free before running');
    } else {
      console.error('💡 Try running: npm run clean-ports');
      console.error('💡 Or manually kill processes using: lsof -ti:3000,3005 | xargs kill -9');
    }
    process.exit(1);
  }
}

if (require.main === module) {
  main();
}

module.exports = { cleanPort, getProcessUsingPort };