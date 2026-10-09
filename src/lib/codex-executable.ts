import { access, readdir, stat } from 'node:fs/promises';
import { constants } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

const executableName = process.platform === 'win32' ? 'codex.exe' : 'codex';
const bundle = `${process.platform === 'darwin' ? 'macos' : process.platform === 'win32' ? 'windows' : 'linux'}-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`;
const extensionName = /^openai\.chatgpt-\d/;

async function executable(file: string) {
  try {
    // These executables belong to the host, not the application bundle.
    if (!(await stat(/* turbopackIgnore: true */ file)).isFile()) return false;
    await access(/* turbopackIgnore: true */ file, process.platform === 'win32' ? constants.F_OK : constants.X_OK);
    return true;
  } catch { return false; }
}

function extensionRoot(file: string) {
  let directory = path.dirname(path.resolve(file));
  while (path.dirname(directory) !== directory) {
    if (extensionName.test(path.basename(directory))) return path.dirname(directory);
    directory = path.dirname(directory);
  }
}

async function newestExtensionExecutable(root: string) {
  const versions = (await readdir(/* turbopackIgnore: true */ root).catch(() => []))
    .filter(name => extensionName.test(name))
    .sort((a, b) => b.localeCompare(a, 'en', { numeric: true }));
  for (const version of versions) {
    const candidate = path.join(root, version, 'bin', bundle, executableName);
    if (await executable(candidate)) return candidate;
  }
}

/** Resolve on every launch: extension updates can remove a previously valid binary. */
export async function resolveCodexExecutable(configured: string, discovery: {
  home?: string; searchPath?: string; extensionRoots?: string[];
} = {}): Promise<string> {
  const home = discovery.home ?? homedir();
  const setting = configured.trim() || 'codex';
  const isPath = path.isAbsolute(setting) || /[/\\]/.test(setting);
  const managedRoot = isPath ? extensionRoot(setting) : undefined;
  if (isPath && await executable(setting)) return path.resolve(/* turbopackIgnore: true */ setting);

  // A custom override is intentional. Only the default command or a vanished
  // versioned Codex extension bundle may recover to a different installation.
  if (isPath && !managedRoot) {
    const exists = await stat(/* turbopackIgnore: true */ setting).then(() => true).catch(() => false);
    throw new Error(exists ? `CODEX_BIN is not executable: ${setting}` : `Codex CLI was not found at CODEX_BIN: ${setting}`);
  }
  if (managedRoot) {
    const replacement = await newestExtensionExecutable(managedRoot);
    if (replacement) return replacement;
  }
  const command = setting === 'codex' || managedRoot ? executableName : setting;
  for (const directory of (discovery.searchPath ?? process.env.PATH ?? '').split(path.delimiter).filter(Boolean)) {
    const candidate = path.resolve(directory, command);
    if (await executable(candidate)) return candidate;
  }
  if (command !== executableName) throw new Error(`Codex CLI was not found. Check CODEX_BIN (${setting}).`);

  for (const directory of [path.join(home, '.local', 'bin'), path.join(home, '.npm-global', 'bin'), path.dirname(process.execPath), '/usr/local/bin', '/opt/homebrew/bin', '/usr/bin']) {
    const candidate = path.join(directory, executableName);
    if (await executable(candidate)) return candidate;
  }
  const roots = discovery.extensionRoots ?? [
    path.join(home, '.vscode', 'extensions'), path.join(home, '.vscode-insiders', 'extensions'),
    path.join(home, '.vscode-server', 'extensions'), path.join(home, '.vscode-server-insiders', 'extensions'),
  ];
  for (const root of new Set(roots)) {
    const candidate = await newestExtensionExecutable(root);
    if (candidate) return candidate;
  }
  throw new Error('Codex CLI was not found in PATH, standard install locations, or installed VS Code extensions. Install Codex or set CODEX_BIN to a stable executable path.');
}
