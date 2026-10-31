// One command to run everything: npm run go
// 1) starts a free Cloudflare quick tunnel (no account needed) and reads its public URL
// 2) starts the CallPilot server on that URL
// 3) points your Twilio TwiML App at it and checks every key
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = process.env.PORT || readEnvValue('PORT') || '5050';

function readEnvValue(key) {
  try {
    const line = fs.readFileSync(path.join(root, '.env'), 'utf8').split(/\r?\n/).find((l) => l.startsWith(`${key}=`));
    return line ? line.slice(key.length + 1).trim() : '';
  } catch {
    return '';
  }
}

function findCloudflared() {
  if (process.env.CLOUDFLARED_PATH) return process.env.CLOUDFLARED_PATH;
  const candidates = [
    'C:\\Program Files (x86)\\cloudflared\\cloudflared.exe',
    'C:\\Program Files\\cloudflared\\cloudflared.exe',
    path.join(process.env.LOCALAPPDATA || '', 'Microsoft', 'WinGet', 'Links', 'cloudflared.exe'),
  ];
  return candidates.find((p) => p && fs.existsSync(p)) || 'cloudflared';
}

if (!fs.existsSync(path.join(root, '.env'))) {
  console.error('\nNo .env file yet. Run:  copy .env.example .env   then paste your keys into .env\n');
  process.exit(1);
}

console.log('\nStarting the public tunnel...');
const bin = findCloudflared();
const tunnel = spawn(bin, ['tunnel', '--no-autoupdate', '--url', `http://localhost:${port}`], { stdio: ['ignore', 'pipe', 'pipe'] });

tunnel.on('error', (err) => {
  if (err.code === 'ENOENT') {
    console.error('\ncloudflared is not installed. Install it with:\n\n  winget install --id Cloudflare.cloudflared\n\nthen close and reopen this window and run  npm run go  again.\n');
  } else console.error('Tunnel failed to start:', err.message);
  process.exit(1);
});

const host = await new Promise((resolve) => {
  let buf = '';
  const timer = setTimeout(() => {
    console.error('\nThe tunnel did not report a URL within 45 seconds. Check your internet connection and try again.\n');
    tunnel.kill();
    process.exit(1);
  }, 45000);
  const onData = (d) => {
    buf += d.toString();
    const m = buf.match(/https:\/\/([a-z0-9-]+\.trycloudflare\.com)/);
    if (m) {
      clearTimeout(timer);
      tunnel.stdout.off('data', onData);
      tunnel.stderr.off('data', onData);
      resolve(m[1]);
    }
  };
  tunnel.stdout.on('data', onData);
  tunnel.stderr.on('data', onData);
});
// Keep reading tunnel output so its pipe never fills up and stalls the tunnel.
tunnel.stdout.resume();
tunnel.stderr.resume();

process.env.PUBLIC_HOST = host;
console.log(`Public URL: https://${host}`);

// Start the server in this process, now that PUBLIC_HOST is set.
await import('./server.js');

// Wait until the tunnel actually serves our app (DNS for a new tunnel can take a few seconds).
const healthUrl = `https://${host}/api/health`;
let reachable = false;
console.log('Waiting for the public link to come online (up to a minute)...');
for (let i = 0; i < 30 && !reachable; i++) {
  try {
    const res = await fetch(healthUrl);
    reachable = res.ok;
  } catch {}
  if (!reachable) await new Promise((r) => setTimeout(r, 2000));
}
if (!reachable) console.log('! The public URL is not answering yet; Twilio may not reach the app. Restart with  npm run go  if calls fail.');

// Point Twilio at this URL and verify every key.
const check = spawn(process.execPath, [path.join(root, 'src', 'check.js'), '--fix'], { stdio: 'inherit', env: process.env });
check.on('exit', (code) => {
  console.log(code === 0
    ? `\n  Open this on your laptop or phone:  https://${host}\n  Passcode: the APP_PASSCODE in your .env\n  Leave this window open during calls. Press Ctrl+C to stop.\n`
    : `\n  Fix the items marked above, then stop (Ctrl+C) and run  npm run go  again.\n  The app is still running at https://${host}\n`);
});

const stop = () => {
  tunnel.kill();
  process.exit(0);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
