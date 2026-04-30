import { describe, expect, test } from 'vitest';
import { DOUBLE_PASS_LABEL, buildDoublePassBindings, mergeTvingWavveServicesForManagement, resolveDoublePassBundleNo } from '../src/lib/tving-wavve-bundle';

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

  test('merges service groups into one double-pass group while preserving original account service types', () => {
    const management = {
      services: [
        { serviceType: '티빙', accounts: [{ serviceType: '티빙', email: 'gtwavve12', usingCount: 1, activeCount: 1, totalIncome: 1000, totalRealizedIncome: 500 }], totalUsingMembers: 1, totalActiveMembers: 1, totalIncome: 1000, totalRealized: 500 },
        { serviceType: '웨이브', accounts: [{ serviceType: '웨이브', email: 'wavve12@example.com', usingCount: 2, activeCount: 2, totalIncome: 2000, totalRealizedIncome: 800 }], totalUsingMembers: 2, totalActiveMembers: 2, totalIncome: 2000, totalRealized: 800 },
        { serviceType: '티빙+웨이브', accounts: [{ serviceType: '티빙+웨이브', email: 'gtwavve13@example.com', usingCount: 0, activeCount: 0, totalIncome: 0, totalRealizedIncome: 0 }], totalUsingMembers: 0, totalActiveMembers: 0, totalIncome: 0, totalRealized: 0 },
        { serviceType: '넷플릭스', accounts: [{ serviceType: '넷플릭스', email: 'netflix1@example.com' }], totalUsingMembers: 1, totalActiveMembers: 1, totalIncome: 3000, totalRealized: 1000 },
      ],
      summary: { totalAccounts: 3 },
    };

    const merged = mergeTvingWavveServicesForManagement(management);
    const doublePass = merged.services.find((service: any) => service.serviceType === DOUBLE_PASS_LABEL);

    expect(doublePass).toBeTruthy();
    expect(doublePass.accounts.map((account: any) => account.serviceType)).toEqual(['티빙', '웨이브', '티빙+웨이브']);
    expect(doublePass.accounts.filter((account: any) => account.serviceType !== '티빙+웨이브').every((account: any) => account.doublePassBundle?.bundleId === 'double-pass:12')).toBe(true);
    expect(doublePass.totalUsingMembers).toBe(3);
    expect(merged.services.some((service: any) => service.serviceType === '티빙')).toBe(false);
    expect(merged.services.some((service: any) => service.serviceType === '웨이브')).toBe(false);
  });
});
