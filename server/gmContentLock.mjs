import { spawn } from 'node:child_process';
import path from 'node:path';

/** Linux process-held flock. The child owns the descriptor until stdin closes. */
export function createGmContentLock({ directory, platform = process.platform, spawnProcess = spawn } = {}) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory)) throw new TypeError('directory must be absolute');
  const lockPath = path.join(path.resolve(directory), 'switch.lock');
  return {
    async run(callback) {
      if (typeof callback !== 'function') throw new TypeError('callback required');
      if (platform !== 'linux') throw Object.assign(new Error('gm_content_lock_unavailable'), { code: 'gm_content_lock_unavailable' });
      const child = spawnProcess('flock', ['-n', lockPath, process.execPath, '-e',
        "process.stdout.write('locked\\n'); process.stdin.resume()"],
      { stdio: ['pipe', 'pipe', 'ignore'], windowsHide: true });
      let output = '', readyResolve, readyReject;
      const closed = new Promise((resolve) => child.once('close', resolve));
      const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
      child.stdout.setEncoding('utf8');
      child.stdout.on('data', (chunk) => {
        output += chunk;
        if (output.includes('\n')) readyResolve();
      });
      child.once('error', () => readyReject(Object.assign(new Error('gm_content_lock_unavailable'), { code: 'gm_content_lock_unavailable' })));
      child.once('exit', (code) => {
        if (!output.includes('\n')) {
          const errorCode = code === 1 ? 'gm_content_lock_busy' : 'gm_content_lock_unavailable';
          readyReject(Object.assign(new Error(errorCode), { code: errorCode }));
        }
      });
      let readinessTimer;
      try {
        await Promise.race([ready, new Promise((_, reject) => {
          readinessTimer = setTimeout(() => reject(Object.assign(new Error('gm_content_lock_busy'), { code: 'gm_content_lock_busy' })), 2000);
        })]);
        clearTimeout(readinessTimer);
        if (!output.startsWith('locked\n')) throw new Error('gm_content_lock_unavailable');
        const assertHeld = () => {
          if (child.exitCode !== null || child.signalCode !== null) {
            throw Object.assign(new Error('gm_content_lock_lost'), { code: 'gm_content_lock_lost' });
          }
        };
        return await callback({ assertHeld });
      } finally {
        clearTimeout(readinessTimer);
        child.stdin?.end();
        const exited = child.exitCode !== null || child.signalCode !== null;
        if (!exited) {
          let closeTimer;
          const closedQuickly = await Promise.race([closed.then(() => true), new Promise((resolve) => {
            closeTimer = setTimeout(() => resolve(false), 2000);
          })]);
          clearTimeout(closeTimer);
          if (!closedQuickly) {
            child.kill('SIGKILL');
            let forcedTimer;
            const forcedClose = await Promise.race([closed.then(() => true), new Promise((resolve) => {
              forcedTimer = setTimeout(() => resolve(false), 2000);
            })]);
            clearTimeout(forcedTimer);
            if (!forcedClose) throw Object.assign(new Error('gm_content_lock_unavailable'), { code: 'gm_content_lock_unavailable' });
          }
        }
      }
    },
  };
}
