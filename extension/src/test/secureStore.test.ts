import { beforeEach, describe, expect, it } from 'vitest';
import { resetSessionStorageArea, sessionStorageArea } from '../background/secureStore';

type Areas = Parameters<typeof sessionStorageArea>[0];
const areas = (setAccessLevel?: () => Promise<void>) => {
  const local = { name: 'local', ...(setAccessLevel ? { setAccessLevel } : {}) };
  const session = { name: 'session' };
  return { local, session } as unknown as NonNullable<Areas>;
};

beforeEach(() => resetSessionStorageArea());

describe('where the session is stored', () => {
  it('uses local storage once it is closed to content scripts', async () => {
    const a = areas(async () => undefined);
    expect(await sessionStorageArea(a)).toBe(a.local);
  });

  it('falls back to session storage when local storage cannot be restricted', async () => {
    const rejected = areas(async () => {
      throw new Error('This StorageArea is not available for setting access level');
    });
    expect(await sessionStorageArea(rejected)).toBe(rejected.session);
    resetSessionStorageArea();
    const missing = areas();
    expect(await sessionStorageArea(missing)).toBe(missing.session);
  });
});
