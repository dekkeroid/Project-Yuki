import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const electron = require('electron');

const WATCH_FILES = ['main.electron.cjs', 'preload.cjs'];
const RESTART_DEBOUNCE_MS = 250;
const KILL_TIMEOUT_MS = 3000;

let child = null;
let restartTimer = null;

function start() {
  console.log('[dev-main-watch] Starting Electron...');
  child = spawn(electron, ['.'], { stdio: 'inherit', env: { ...process.env } });
  child.on('exit', (code) => {
    const exited = child;
    child = null;
    if (!exited._killing) {
      console.log(`[dev-main-watch] Electron exited (code ${code}). Waiting for file changes...`);
    }
  });
}

function stopChild() {
  return new Promise((resolve) => {
    if (!child) return resolve();
    const c = child;
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      if (child === c) child = null;
      resolve();
    };
    c._killing = true;
    c.once('exit', done);
    if (process.platform === 'win32') {
      try {
        spawn('taskkill', ['/pid', String(c.pid), '/T', '/F'], { stdio: 'ignore' });
      } catch (_) {
        c.kill();
      }
    } else {
      c.kill('SIGTERM');
    }
    setTimeout(done, KILL_TIMEOUT_MS);
  });
}

function restart() {
  if (restartTimer) return;
  console.log('[dev-main-watch] Change detected — restarting Electron...');
  restartTimer = setTimeout(async () => {
    restartTimer = null;
    await stopChild();
    start();
  }, RESTART_DEBOUNCE_MS);
}

for (const file of WATCH_FILES) {
  fs.watch(file, () => restart());
}

start();

process.on('SIGINT', () => {
  if (child) child.kill();
  process.exit(0);
});
process.on('SIGTERM', () => {
  if (child) child.kill();
  process.exit(0);
});
