import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const TOKEN_PATH = join(homedir(), '.config', 'slack-bases', 'token');

interface ResolveTokenInput {
  token: string | null;
  env: Record<string, string | undefined>;
  readFile?: (path: string) => string;
}

export function resolveToken(input: ResolveTokenInput): string | null {
  if (input.token) return input.token;
  if (input.env.SLACK_CONFIG_TOKEN) return input.env.SLACK_CONFIG_TOKEN;
  const read = input.readFile ?? defaultReadFile;
  const fileToken = read(TOKEN_PATH);
  return fileToken || null;
}

function defaultReadFile(path: string): string {
  try {
    return readFileSync(path, 'utf8').trim();
  } catch {
    return '';
  }
}
