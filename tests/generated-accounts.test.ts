import { describe, expect, test } from 'vitest';
import { buildGeneratedAccount, deleteGeneratedAccountFromStore, extractSimpleLoginAliasRef, generateAccountPassword, generatedAccountKey, getGeneratedAccountCreationCopy, mergeGeneratedAccountsIntoManagement, nextGeneratedAliasPrefix, normalizeGeneratedAccountPatch, normalizeManualAliasPrefix, serviceAliasStem } from '../src/lib/generated-accounts';

describe('generated accounts', () => {
  test('generates a 10 character password with lowercase start, digit, and symbol', () => {
    const values = [0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 0.11, 0.21];
    let i = 0;
    const password = generateAccountPassword(() => values[i++ % values.length]);
    expect(password).toHaveLength(10);
    expect(password).toMatch(/^[a-z]/);
    expect(password).toMatch(/[0-9]/);
    expect(password).toMatch(/[!@]/);
  });

  test('builds a pending generated account and stable key', () => {
    const account = buildGeneratedAccount({
      serviceType: '넷플릭스',
      alias: { id: 101, email: 'NewAlias@Example.com' },
      password: 'a12345678!',
      pin: '654321',
      memo: 'memo',
      now: '2026-04-29T12:00:00.000Z',
    });
    expect(account).toMatchObject({
      serviceType: '넷플릭스',
      email: 'newalias@example.com',
      paymentStatus: 'pending',
      paidAt: null,
      source: 'account-generator',
    });
    expect(generatedAccountKey(account.serviceType, account.email)).toBe('넷플릭스:newalias@example.com');
  });

  test('merges generated accounts into management only when they are not already existing emails', () => {
    const generated = buildGeneratedAccount({ serviceType: '넷플릭스', alias: { id: 101, email: 'new@example.com' }, password: 'a12345678!', pin: '123456', memo: 'memo', now: '2026-04-29T12:00:00.000Z' });
    const existing = buildGeneratedAccount({ serviceType: '넷플릭스', alias: { id: 102, email: 'old@example.com' }, password: 'a12345678!', pin: '123456', memo: 'memo', now: '2026-04-29T12:01:00.000Z' });
    const doublePass = buildGeneratedAccount({ serviceType: '티빙+웨이브', alias: { id: 103, email: 'gtwavve7@example.com' }, password: 'a12345678!', pin: '123456', memo: 'memo', now: '2026-04-29T12:02:00.000Z' });
    const management = {
      services: [{ serviceType: '넷플릭스', accounts: [{ serviceType: '넷플릭스', email: 'old@example.com' }], totalUsingMembers: 0, totalActiveMembers: 0, totalIncome: 0, totalRealized: 0 }],
      summary: { totalAccounts: 1 },
    };
    const result = mergeGeneratedAccountsIntoManagement(management, { [generated.id]: generated, [existing.id]: existing, [doublePass.id]: doublePass });
    expect(result.services[0].accounts.map(a => a.email)).toEqual(['new@example.com', 'old@example.com']);
    expect(result.services[0].accounts[0].generatedAccount.paymentStatus).toBe('pending');
    const doublePassService = result.services.find(s => s.serviceType === '티빙+웨이브');
    expect(doublePassService?.accounts[0]).toMatchObject({ serviceType: '티빙+웨이브', totalSlots: 4 });
    expect(result.summary.totalAccounts).toBe(3);
  });

  test('splits paid 티빙+웨이브 generated accounts into 티빙 and 웨이브 management rows', () => {
    const doublePass = {
      ...buildGeneratedAccount({ serviceType: '티빙+웨이브', alias: { id: 103, email: 'gtwavve8.fastball266@aleeas.com' }, password: 'a12345678!', pin: '123456', memo: 'memo', now: '2026-04-29T12:02:00.000Z' }),
      paymentStatus: 'paid' as const,
      paidAt: '2026-04-29T12:10:00.000Z',
    };
    const result = mergeGeneratedAccountsIntoManagement({ services: [], summary: { totalAccounts: 0 } }, { [doublePass.id]: doublePass });

    expect(result.services.find(s => s.serviceType === '티빙+웨이브')).toBeUndefined();
    const tving = result.services.find(s => s.serviceType === '티빙')?.accounts[0];
    const wavve = result.services.find(s => s.serviceType === '웨이브')?.accounts[0];
    expect(tving).toMatchObject({ serviceType: '티빙', email: 'gtwavve8', totalSlots: 4, keepPasswd: 'a12345678!' });
    expect(wavve).toMatchObject({ serviceType: '웨이브', email: 'gtwavve8.fastball266@aleeas.com', totalSlots: 4, keepPasswd: 'a12345678!' });
    expect(tving?.generatedAccount).toMatchObject({ id: doublePass.id, sourceServiceType: '티빙+웨이브', linkedServiceType: '티빙', wavveEmail: 'gtwavve8.fastball266@aleeas.com', tvingLoginId: 'gtwavve8' });
    expect(wavve?.generatedAccount).toMatchObject({ id: doublePass.id, sourceServiceType: '티빙+웨이브', linkedServiceType: '웨이브', wavveEmail: 'gtwavve8.fastball266@aleeas.com', tvingLoginId: 'gtwavve8' });
    expect(result.summary.totalAccounts).toBe(2);
  });

  test('normalizes paid/pending payment checkbox patches', () => {
    expect(normalizeGeneratedAccountPatch({ paymentStatus: 'paid', paidAt: '2026-04-29T12:00:00.000Z' })).toEqual({ paymentStatus: 'paid', paidAt: '2026-04-29T12:00:00.000Z' });
    expect(normalizeGeneratedAccountPatch({ paymentStatus: 'pending' })).toEqual({ paymentStatus: 'pending', paidAt: null });
  });

  test('extracts SimpleLogin alias refs from random alias response shapes', () => {
    expect(extractSimpleLoginAliasRef({ alias: 'NewAlias@Example.com' })).toEqual({ email: 'newalias@example.com' });
    expect(extractSimpleLoginAliasRef({ alias: { id: 123, email: 'Alias@Id.test' } })).toEqual({ id: 123, email: 'alias@id.test' });
    expect(extractSimpleLoginAliasRef({ data: { alias: { alias_id: 'abc', address: 'Nested@Example.com' } } })).toEqual({ id: 'abc', email: 'nested@example.com' });
    expect(extractSimpleLoginAliasRef({ alias: 'not-an-email' })).toBeNull();
  });

  test('uses short service-number prefixes for generated SimpleLogin aliases', () => {
    expect(serviceAliasStem('웨이브')).toBe('wavve');
    expect(serviceAliasStem('넷플릭스')).toBe('netflix');
    expect(serviceAliasStem('티빙+웨이브')).toBe('gtwavve');
    expect(nextGeneratedAliasPrefix('웨이브', ['wavve1.foo@example.com', 'wavve3@example.com', 'netflix9@example.com'])).toBe('wavve4');
    expect(nextGeneratedAliasPrefix('티빙', ['tving2.foo@example.com'])).toBe('tving3');
    expect(nextGeneratedAliasPrefix('티빙+웨이브', ['gtwavve12@example.com'])).toBe('gtwavve13');
  });

  test('explains 티빙+웨이브 generated account prefixes as TVING login IDs bound to Wavve email aliases', () => {
    const copy = getGeneratedAccountCreationCopy('티빙+웨이브');
    expect(copy.serviceLabel).toBe('티빙+웨이브 더블 플랜');
    expect(copy.prefixLabel).toBe('더블플랜 번호 / 티빙 로그인 ID');
    expect(copy.prefixPlaceholder).toBe('예: gtwavve7, gtwavve44');
    expect(copy.prefixHelp).toContain('티빙 로그인 ID는 gtwavveN');
    expect(copy.prefixHelp).toContain('웨이브 로그인은 같은 prefix의 Email alias');
    expect(copy.description).toContain('웨이브 19,500원 더블 플랜');
  });

  test('keeps normal generated account prefix copy focused on SimpleLogin alias prefixes', () => {
    const copy = getGeneratedAccountCreationCopy('넷플릭스');
    expect(copy.serviceLabel).toBe('넷플릭스');
    expect(copy.prefixLabel).toBe('alias prefix 직접 설정');
    expect(copy.prefixPlaceholder).toContain('netflix12');
    expect(copy.prefixHelp).toContain('SimpleLogin alias');
  });

  test('normalizes a manually entered alias prefix and rejects unsafe values', () => {
    expect(normalizeManualAliasPrefix(' Wavve-07 ')).toBe('wavve07');
    expect(normalizeManualAliasPrefix('gtwavve44')).toBe('gtwavve44');
    expect(() => normalizeManualAliasPrefix('웨이브7')).toThrow(/영문/);
    expect(() => normalizeManualAliasPrefix('ab')).toThrow(/3자 이상/);
    expect(() => normalizeManualAliasPrefix('already@example.com')).toThrow(/@/);
  });

  test('uses manual prefix exactly when provided instead of auto-numbering', () => {
    expect(nextGeneratedAliasPrefix('웨이브', ['wavve1@example.com'], 'Custom77')).toBe('custom77');
  });

  test('deletes generated accounts from the sensitive runtime store by id', () => {
    const keep = buildGeneratedAccount({ serviceType: '넷플릭스', alias: { id: 101, email: 'keep@example.com' }, password: 'a12345678!', pin: '123456', memo: 'memo', now: '2026-04-29T12:00:00.000Z' });
    const remove = buildGeneratedAccount({ serviceType: '웨이브', alias: { id: 102, email: 'remove@example.com' }, password: 'a12345678!', pin: '123456', memo: 'memo', now: '2026-04-29T12:01:00.000Z' });
    const result = deleteGeneratedAccountFromStore({ [keep.id]: keep, [remove.id]: remove }, remove.id);
    expect(result.deleted?.email).toBe('remove@example.com');
    expect(Object.keys(result.store)).toEqual([keep.id]);
  });
});
