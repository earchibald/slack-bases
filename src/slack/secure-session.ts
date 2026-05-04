import type { SlackSession } from './types';

export interface SessionCipher {
  decrypt(value: string): string;
  encrypt(value: string): string;
  isAvailable(): boolean;
}

interface ElectronSafeStorage {
  decryptString(value: Buffer): string;
  encryptString(value: string): Buffer;
  isEncryptionAvailable(): boolean;
}

export function createElectronSessionCipher(): SessionCipher | null {
  const safeStorage = getElectronSafeStorage();

  if (!safeStorage) {
    return null;
  }

  return {
    decrypt: (value) => safeStorage.decryptString(Buffer.from(value, 'base64')),
    encrypt: (value) => safeStorage.encryptString(value).toString('base64'),
    isAvailable: () => safeStorage.isEncryptionAvailable(),
  };
}

export function decodeSecureSession(value: string, cipher: SessionCipher): SlackSession {
  return JSON.parse(cipher.decrypt(value)) as SlackSession;
}

export function encodeSecureSession(session: SlackSession, cipher: SessionCipher): string {
  if (!cipher.isAvailable()) {
    throw new Error('Secure session storage is unavailable');
  }

  return cipher.encrypt(JSON.stringify(session));
}

function getElectronSafeStorage(): ElectronSafeStorage | null {
  const requireFn = (globalThis as { require?: (id: string) => unknown }).require;

  if (!requireFn) {
    return null;
  }

  let electron: { safeStorage?: ElectronSafeStorage; remote?: { safeStorage?: ElectronSafeStorage } } = {};

  try {
    electron = requireFn('electron') as typeof electron;
  } catch {
    return null;
  }

  if (electron.remote?.safeStorage) {
    return electron.remote.safeStorage;
  }

  try {
    const electronRemote = requireFn('@electron/remote') as { safeStorage?: ElectronSafeStorage };
    if (electronRemote.safeStorage) {
      return electronRemote.safeStorage;
    }
  } catch {
    // @electron/remote not available — fall through.
  }

  return electron.safeStorage ?? null;
}
