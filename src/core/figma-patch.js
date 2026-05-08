import { existsSync, readFileSync, writeFileSync, statSync, readdirSync } from 'fs';
import { execSync, spawn } from 'child_process';
import { platform, homedir } from 'os';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import chalk from 'chalk';

const IS_WINDOWS = platform() === 'win32';
const IS_MAC = platform() === 'darwin';
const IS_LINUX = platform() === 'linux';

const CDP_PORT_START = 9222;
const CDP_PORT_END = 9322;

// ---------------------------------------------------------------------------
// Cross-platform Figma install detection.
//
// Figma installs into different locations on each OS, and on Windows the
// Squirrel auto-updater nests the executable under `app-<version>` directories
// that change over time. Walk a list of candidate paths and pick the first
// one that exists.
// ---------------------------------------------------------------------------

function listInstallCandidates() {
  if (IS_MAC) {
    return [
      { exe: '/Applications/Figma.app', asar: '/Applications/Figma.app/Contents/Resources/app.asar' },
      { exe: join(homedir(), 'Applications', 'Figma.app'), asar: join(homedir(), 'Applications', 'Figma.app', 'Contents', 'Resources', 'app.asar') }
    ];
  }
  if (IS_WINDOWS) {
    const localAppData = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
    const programFiles = process.env['ProgramFiles'] || 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] || 'C:\\Program Files (x86)';
    const candidateDirs = [
      join(localAppData, 'Figma'),
      join(localAppData, 'Programs', 'Figma'),
      join(programFiles, 'Figma'),
      join(programFilesX86, 'Figma')
    ];
    const out = [];
    for (const dir of candidateDirs) {
      if (!existsSync(dir)) continue;
      const updateExe = join(dir, 'Update.exe');
      // Direct Figma.exe in the install dir
      const direct = join(dir, 'Figma.exe');
      if (existsSync(direct)) {
        out.push({ exe: direct, asar: join(dir, 'resources', 'app.asar'), updateExe: existsSync(updateExe) ? updateExe : null, baseDir: dir });
      }
      // Squirrel layout: app-<version>/Figma.exe
      try {
        for (const entry of readdirSync(dir)) {
          if (!entry.startsWith('app-')) continue;
          const subdir = join(dir, entry);
          const exe = join(subdir, 'Figma.exe');
          if (existsSync(exe)) {
            out.push({ exe, asar: join(subdir, 'resources', 'app.asar'), updateExe: existsSync(updateExe) ? updateExe : null, baseDir: dir });
          }
        }
      } catch {}
    }
    // Prefer most-recently-modified install (= latest Squirrel version).
    return out.sort((a, b) => mtime(b.exe) - mtime(a.exe));
  }
  // Linux — community/unofficial builds (Snap, AUR, manual extracts)
  return [
    { exe: '/usr/bin/figma-linux', asar: '/opt/figma-linux/resources/app.asar' },
    { exe: '/usr/bin/figma', asar: '/usr/share/figma/resources/app.asar' },
    { exe: '/opt/figma-linux/figma-linux', asar: '/opt/figma-linux/resources/app.asar' },
    { exe: join(homedir(), '.local/share/figma-linux/figma-linux'), asar: join(homedir(), '.local/share/figma-linux/resources/app.asar') }
  ];
}

function mtime(p) {
  try { return statSync(p).mtimeMs; } catch { return 0; }
}

function getInstall() {
  for (const c of listInstallCandidates()) {
    if (existsSync(c.exe) && existsSync(c.asar)) return c;
  }
  // Fallback: return first candidate even if missing, so error messages name it.
  return listInstallCandidates()[0] || { exe: '(unknown)', asar: '(unknown)', updateExe: null, baseDir: null };
}

export function getFigmaAppPath() {
  return getInstall().exe;
}

export function getFigmaUpdateExePath() {
  return getInstall().updateExe || null;
}

function getAsarPath() {
  return getInstall().asar;
}

// ---------------------------------------------------------------------------
// Patch state
// ---------------------------------------------------------------------------

const ORIGINAL = 'removeSwitch("remote-debugging-port")';
const PATCHED = 'removeSwitch("remote-debugXing-port")';

function readAsarBytes(asarPath) {
  return readFileSync(asarPath);
}

function bytesToLatin1String(buf) {
  // latin1 roundtrips 1:1 with bytes (0-255) so we don't corrupt app.asar.
  return buf.toString('latin1');
}

function latin1StringToBytes(str) {
  return Buffer.from(str, 'latin1');
}

export function isPatched() {
  const asarPath = getAsarPath();
  if (!existsSync(asarPath)) return null;

  try {
    const content = bytesToLatin1String(readAsarBytes(asarPath));
    if (content.includes(PATCHED)) return true;
    if (content.includes(ORIGINAL)) return false;
    return null; // Unknown layout (newer Figma without the switch removal)
  } catch {
    return null;
  }
}

export function patchFigma() {
  const asarPath = getAsarPath();
  if (!existsSync(asarPath)) {
    throw new Error(`Figma app.asar not found. Looked at: ${asarPath}. Is Figma Desktop installed?`);
  }

  const content = bytesToLatin1String(readAsarBytes(asarPath));
  if (content.includes(PATCHED)) return;
  let patchedContent = content;
  if (patchedContent.includes(ORIGINAL)) {
    patchedContent = patchedContent.replace(ORIGINAL, PATCHED);
  } else {
    // Some builds use single quotes.
    const altOriginals = [
      `removeSwitch('remote-debugging-port')`,
      `removeSwitch(\`remote-debugging-port\`)`
    ];
    const altPatched = [
      `removeSwitch('remote-debugXing-port')`,
      `removeSwitch(\`remote-debugXing-port\`)`
    ];
    let replaced = false;
    for (let i = 0; i < altOriginals.length; i++) {
      if (patchedContent.includes(altOriginals[i])) {
        patchedContent = patchedContent.replace(altOriginals[i], altPatched[i]);
        replaced = true;
        break;
      }
    }
    if (!replaced) {
      throw new Error(
        'Cannot find patch target in Figma. This usually means Figma changed its Electron bootstrap.\n' +
          'Update opencode-figma or install a matching Figma build; connection requires a successful patch for CDP.'
      );
    }
  }
  try {
    writeFileSync(asarPath, latin1StringToBytes(patchedContent));
  } catch (e) {
    if (e.code === 'EACCES' || e.code === 'EPERM') {
      throw new Error(IS_WINDOWS
        ? 'Permission denied writing Figma app.asar. Run terminal as Administrator and retry.'
        : 'Permission denied writing Figma app.asar. On macOS grant Terminal Full Disk Access; on Linux retry with sudo.');
    }
    throw e;
  }

  if (IS_MAC) {
    try {
      execSync(`codesign --force --deep --sign - "${getFigmaAppPath()}"`, { stdio: 'pipe' });
    } catch {
      throw new Error('Failed to re-sign Figma after patch. Try running as administrator/sudo.');
    }
  }
}

export function unpatchFigma() {
  const asarPath = getAsarPath();
  if (!existsSync(asarPath)) throw new Error(`Figma app.asar not found at: ${asarPath}`);

  const content = readFileSync(asarPath, 'utf8');
  if (!content.includes(PATCHED)) return;

  const restoredContent = content.replace(PATCHED, ORIGINAL);
  writeFileSync(asarPath, restoredContent);

  if (IS_MAC) {
    try {
      execSync(`codesign --force --deep --sign - "${getFigmaAppPath()}"`, { stdio: 'pipe' });
    } catch {
      throw new Error('Failed to re-sign Figma after unpatch.');
    }
  }
}

export function getCdpPort() {
  return Math.floor(Math.random() * (CDP_PORT_END - CDP_PORT_START + 1)) + CDP_PORT_START;
}

// ---------------------------------------------------------------------------
// Process control
// ---------------------------------------------------------------------------

export function killFigma() {
  try {
    if (IS_MAC) {
      execSync('pkill -x Figma 2>/dev/null || true', { stdio: 'pipe', shell: '/bin/sh' });
    } else if (IS_WINDOWS) {
      // /F = force, /T = include children. Errors silenced.
      try { execSync('taskkill /IM Figma.exe /F /T', { stdio: 'pipe', windowsHide: true }); } catch {}
    } else {
      execSync('pkill -x figma 2>/dev/null || true', { stdio: 'pipe', shell: '/bin/sh' });
      execSync('pkill -x figma-linux 2>/dev/null || true', { stdio: 'pipe', shell: '/bin/sh' });
    }
  } catch {
    // Best effort — Figma may not be running.
  }
}

export function startFigma(port) {
  const figmaPath = getFigmaAppPath();
  const args = [`--remote-debugging-port=${port}`];

  if (IS_MAC) {
    spawn('open', ['-a', 'Figma', '--args', ...args], { detached: true, stdio: 'ignore' }).unref();
    return;
  }

  if (!existsSync(figmaPath)) {
    throw new Error(`Figma executable not found at: ${figmaPath}. Is Figma Desktop installed?`);
  }

  if (IS_WINDOWS) {
    // Squirrel apps (like Figma on Windows) are best launched through Update.exe
    // so arguments propagate to the real browser process. Launching Figma.exe
    // directly often results in a relaunch that drops the original args.
    const updateExe = getFigmaUpdateExePath();
    if (updateExe && existsSync(updateExe)) {
      const argStr = args.join(' ');
      spawn(updateExe, ['--processStart', 'Figma.exe', '--process-start-args', argStr], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }).unref();
    } else {
      spawn(figmaPath, args, { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    }
  } else {
    spawn(figmaPath, args, { detached: true, stdio: 'ignore' }).unref();
  }
}

export function getFigmaCommand(port) {
  if (IS_MAC) return `open -a Figma --args --remote-debugging-port=${port}`;
  if (IS_WINDOWS) {
    const updateExe = getFigmaUpdateExePath();
    if (updateExe) {
      return `"${updateExe}" --processStart Figma.exe --process-start-args \"--remote-debugging-port=${port}\"`;
    }
    return `"${getFigmaAppPath()}" --remote-debugging-port=${port}`;
  }
  return `${getFigmaAppPath()} --remote-debugging-port=${port}`;
}
