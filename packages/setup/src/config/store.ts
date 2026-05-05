import { readFileSync, writeFileSync, renameSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export const CONFIG_DIR = join(homedir(), '.config', 'slack-bases');
export const CONFIG_PATH = join(CONFIG_DIR, 'config.json');
export const TOKEN_PATH = join(CONFIG_DIR, 'token');

export interface AppConfig {
  app_id: string;
  client_id: string;
  team_id: string;
  created: string;
  manifest_snapshot: Record<string, unknown>;
  manifest_sha256: string;
}

const REQUIRED_FIELDS: (keyof AppConfig)[] = [
  'app_id', 'client_id', 'team_id', 'created', 'manifest_snapshot', 'manifest_sha256',
];

interface ConfigIO {
  readFile?: (path: string) => string;
  writeFile?: (path: string, content: string) => void;
  rename?: (from: string, to: string) => void;
}

export function readConfig(io?: ConfigIO): AppConfig | null {
  const read = io?.readFile ?? defaultReadFile;
  let raw: string;
  try {
    raw = read(CONFIG_PATH);
  } catch {
    return null;
  }
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(raw) as Record<string, unknown>;
  } catch {
    return null;
  }
  for (const field of REQUIRED_FIELDS) {
    if (parsed[field] === undefined || parsed[field] === null) return null;
  }
  return parsed as unknown as AppConfig;
}

function defaultReadFile(path: string): string {
  return readFileSync(path, 'utf8');
}

export function writeConfig(config: AppConfig, io?: ConfigIO): void {
  const write = io?.writeFile ?? defaultWriteFile;
  const rename = io?.rename ?? defaultRename;
  const tmp = CONFIG_PATH + '.tmp';
  const content = JSON.stringify(config, null, 2) + '\n';
  write(tmp, content);
  rename(tmp, CONFIG_PATH);
}

function defaultWriteFile(path: string, content: string): void {
  writeFileSync(path, content, { mode: 0o600 });
}

function defaultRename(from: string, to: string): void {
  renameSync(from, to);
}
