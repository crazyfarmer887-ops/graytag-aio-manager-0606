import { describe, expect, test } from 'vitest';
import { buildGeneratedAccount, deleteGeneratedAccountFromStore, extractSimpleLoginAliasRef, generateAccountPassword, generatedAccountKey, mergeGeneratedAccountsIntoManagement, nextGeneratedAliasPrefix, normalizeGeneratedAccountPatch, serviceAliasStem } from '../src/lib/generated-accounts';

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
    const management = {
      services: [{ serviceType: '넷플릭스', accounts: [{ serviceType: '넷플릭스', email: 'old@example.com' }], totalUsingMembers: 0, totalActiveMembers: 0, totalIncome: 0, totalRealized: 0 }],
      summary: { totalAccounts: 1 },
    };
    const result = mergeGeneratedAccountsIntoManagement(management, { [generated.id]: generated, [existing.id]: existing });
    expect(result.services[0].accounts.map(a => a.email)).toEqual(['new@example.com', 'old@example.com']);
    expect(result.services[0].accounts[0].generatedAccount.paymentStatus).toBe('pending');
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

  test('deletes generated accounts from the sensitive runtime store by id', () => {
    const keep = buildGeneratedAccount({ serviceType: '넷플릭스', alias: { id: 101, email: 'keep@example.com' }, password: 'a12345678!', pin: '123456', memo: 'memo', now: '2026-04-29T12:00:00.000Z' });
    const remove = buildGeneratedAccount({ serviceType: '웨이브', alias: { id: 102, email: 'remove@example.com' }, password: 'a12345678!', pin: '123456', memo: 'memo', now: '2026-04-29T12:01:00.000Z' });
    const result = deleteGeneratedAccountFromStore({ [keep.id]: keep, [remove.id]: remove }, remove.id);
    expect(result.deleted?.email).toBe('remove@example.com');
    expect(Object.keys(result.store)).toEqual([keep.id]);
  });
});
