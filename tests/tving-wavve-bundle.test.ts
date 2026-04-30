import { describe, expect, test } from 'vitest';
import { buildDoublePassBindings, resolveDoublePassBundleNo } from '../src/lib/tving-wavve-bundle';

describe('TVING/Wavve double-pass binding', () => {
  test('matches TVING gtwavve IDs and Wavve accounts by numeric suffix', () => {
    const bindings = buildDoublePassBindings([
      { serviceType: '티빙', email: 'gtwavve12' },
      { serviceType: '웨이브', email: 'wavve12@example.com' },
    ]);

    expect(bindings).toHaveLength(1);
    expect(bindings[0]).toMatchObject({
      bundleId: 'double-pass:12',
      bundleNo: 12,
      source: 'auto-number',
    });
    expect(bindings[0].services.tving?.accountId).toBe('gtwavve12');
    expect(bindings[0].services.wavve?.accountId).toBe('wavve12@example.com');
  });

  test('uses the known manual exception gtwavve44 equals Wavve 5', () => {
    expect(resolveDoublePassBundleNo({ serviceType: '티빙', loginId: 'gtwavve44' })).toBe(5);

    const bindings = buildDoublePassBindings([
      { serviceType: '티빙', email: 'gtwavve44' },
      { serviceType: '웨이브', email: 'wavve5@example.com' },
    ]);

    expect(bindings).toHaveLength(1);
    expect(bindings[0].bundleNo).toBe(5);
    expect(bindings[0].source).toBe('manual-exception');
  });

  test('keeps unpaired TVING/Wavve accounts visible without leaking secrets', () => {
    const bindings = buildDoublePassBindings([
      { serviceType: '티빙', email: 'gtwavve7', password: 'secret', pin: '123456', memo: 'memo' },
    ] as any);

    expect(bindings).toHaveLength(1);
    expect(bindings[0].services.tving?.accountId).toBe('gtwavve7');
    expect(bindings[0].services.wavve).toBeUndefined();
    expect(JSON.stringify(bindings[0])).not.toMatch(/secret|123456|memo/);
  });

});
