const { exec, spawn } = require('child_process');
const logger = require('./logger');

const isWin = process.platform === 'win32';

class CommandExecutor {
  // Track active processes by scan ID
  static activeProcesses = new Map();

  static async executeCommand(command, options = {}) {
    const {
      timeout = 30000,
      cwd = process.cwd(),
      env = process.env,
      onData = null,
      scanId = null
    } = options;

    // If onData callback is provided, use spawn for real-time output
    if (onData) {
      return this.executeCommandWithProgress(command, (stream, data) => {
        onData(data);
      }, { timeout, cwd, env, scanId });
    }

    return new Promise((resolve, reject) => {
      const child = exec(command, {
        timeout,
        cwd,
        env,
        maxBuffer: 1024 * 1024 * 10 // 10MB buffer
      }, (error, stdout, stderr) => {
        // Remove from active processes
        if (scanId && this.activeProcesses.has(scanId)) {
          const processes = this.activeProcesses.get(scanId);
          const index = processes.indexOf(child);
          if (index > -1) {
            processes.splice(index, 1);
          }
        }

        if (error) {
          if (error.code === 'ETIMEDOUT') {
            resolve({ success: false, error: 'TIMEOUT', stdout: '', stderr: '' });
            return;
          }

          resolve({
            success: false,
            error: error.message,
            stdout: stdout || '',
            stderr: stderr || ''
          });
          return;
        }

        resolve({
          success: true,
          stdout: stdout || '',
          stderr: stderr || ''
        });
      });

      // Track this process if scanId provided
      if (scanId) {
        if (!this.activeProcesses.has(scanId)) {
          this.activeProcesses.set(scanId, []);
        }
        this.activeProcesses.get(scanId).push(child);
      }
    });
  }

  static async executeCommandWithProgress(command, onProgress, options = {}) {
    const {
      timeout = 60000,
      cwd = process.cwd(),
      env = process.env,
      scanId = null
    } = options;

    return new Promise((resolve, reject) => {
      const child = spawn(command, [], {
        shell: true,
        cwd,
        env,
        stdio: ['pipe', 'pipe', 'pipe']
      });

      let stdout = '';
      let stderr = '';
      let resolved = false;

      // Track this process if scanId provided
      if (scanId) {
        if (!this.activeProcesses.has(scanId)) {
          this.activeProcesses.set(scanId, []);
        }
        this.activeProcesses.get(scanId).push(child);
      }

      const cleanup = () => {
        if (scanId && this.activeProcesses.has(scanId)) {
          const processes = this.activeProcesses.get(scanId);
          const index = processes.indexOf(child);
          if (index > -1) {
            processes.splice(index, 1);
          }
        }
      };

      const timeoutId = setTimeout(() => {
        if (!resolved) {
          resolved = true;
          child.kill('SIGTERM');
          cleanup();
          resolve({ success: false, error: 'TIMEOUT', stdout, stderr });
        }
      }, timeout);

      child.stdout.on('data', (data) => {
        const chunk = data.toString();
        stdout += chunk;
        if (onProgress) {
          onProgress('stdout', chunk);
        }
      });

      child.stderr.on('data', (data) => {
        const chunk = data.toString();
        stderr += chunk;
        if (onProgress) {
          onProgress('stderr', chunk);
        }
      });

      child.on('close', (code) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          cleanup();

          if (code === 0 || code === null) {
            resolve({ success: true, stdout, stderr, code });
          } else {
            logger.error(`Command failed with code ${code}: ${command}`, { stderr });
            resolve({ success: false, error: `Exit code ${code}`, stdout, stderr, code });
          }
        }
      });

      child.on('error', (error) => {
        if (!resolved) {
          resolved = true;
          clearTimeout(timeoutId);
          cleanup();
          logger.error(`Command execution error: ${command}`, { error: error.message });
          resolve({ success: false, error: error.message, stdout, stderr });
        }
      });
    });
  }

  static killScanProcesses(scanId) {
    if (!this.activeProcesses.has(scanId)) {
      return 0;
    }

    const processes = this.activeProcesses.get(scanId);
    let killedCount = 0;

    for (const child of processes) {
      if (!child || !child.pid) continue;
      try {
        // 1) Kill the direct child (shell running the command)
        child.kill(isWin ? 'SIGKILL' : 'SIGTERM');
        killedCount++;
      } catch (e) {
        logger.warn(`Failed to kill child: ${e.message}`);
      }
      try {
        if (isWin) {
          // Windows: kill process tree with taskkill
          require('child_process').execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: 'ignore', windowsHide: true });
        } else {
          // Unix: kill process group so masscan/smbclient/nc actually stop
          process.kill(-child.pid, 'SIGKILL');
        }
      } catch (e) {
        if (e.code !== 'ESRCH' && e.status !== 1) logger.warn(`Failed to kill process group: ${e.message}`);
      }
    }

    this.activeProcesses.delete(scanId);
    logger.info(`Killed ${killedCount} processes for scan ${scanId}`);
    return killedCount;
  }
}

module.exports = CommandExecutor;