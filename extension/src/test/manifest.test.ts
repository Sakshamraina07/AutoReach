import { describe, expect, it } from 'vitest';
// @ts-expect-error -- plain ESM build helper without type declarations
import { buildManifest, originPattern } from '../../scripts/manifest.mjs';

describe('manifest', () => {
  const m = buildManifest({ version: '2.0.0', apiUrl: 'https://api.autoreach.example/', supabaseUrl: 'https://abc.supabase.co' });

  it('asks only for the permissions the features need', () => {
    expect(m.manifest_version).toBe(3);
    expect([...m.permissions].sort()).toEqual(['activeTab', 'alarms', 'identity', 'scripting', 'sidePanel', 'storage']);
    expect(m.permissions).not.toContain('tabs');
    expect(m.host_permissions).toEqual(['https://api.autoreach.example/*', 'https://abc.supabase.co/*']);
    expect(JSON.stringify(m)).not.toContain('<all_urls>');
    expect(JSON.stringify(m)).not.toContain('linkedin');
    expect(m).not.toHaveProperty('web_accessible_resources');
    expect(m).not.toHaveProperty('oauth2');
  });

  it('runs the Gmail assist only on Gmail', () => {
    expect(m.content_scripts).toEqual([{ matches: ['https://mail.google.com/*'], js: ['content-gmail.js'], run_at: 'document_idle' }]);
  });

  it('accepts http only for localhost', () => {
    expect(originPattern('http://localhost:3001')).toBe('http://localhost:3001/*');
    expect(() => originPattern('http://api.example.com')).toThrow(/https/);
  });
});
