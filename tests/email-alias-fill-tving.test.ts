import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { resolveEmailAliasFill, updateEmailAliasPin, verifyEmailAliasPinUpdate } from '../src/api/email-alias-fill';

const originalPinStorePath = process.env.EMAIL_ALIAS_PIN_STORE_PATH;

afterEach(() => {
  if (originalPinStorePath === undefined) delete process.env.EMAIL_ALIAS_PIN_STORE_PATH;
  else process.env.EMAIL_ALIAS_PIN_STORE_PATH = originalPinStorePath;
});

describe('resolveEmailAliasFill tving aliases', () => {
  test('treats Graytag 티방/Tving account labels as 티빙 and fills email/PIN memo from tving alias', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alias-pins-'));
    const pinPath = join(dir, 'alias-pins.json');
    writeFileSync(pinPath, JSON.stringify({ 90210: { pin: '123456' } }));
    process.env.EMAIL_ALIAS_PIN_STORE_PATH = pinPath;

    const result = await resolveEmailAliasFill({
      accountEmail: 'gtwalve4',
      serviceType: '티방',
      aliases: [
        { id: 100, email: 'tving-old@example.com', enabled: true },
        { id: 90210, email: 'wavve7.example@aleeas.com', enabled: true },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.emailId).toBe(90210);
    expect(result.pin).toBe('123456');
    expect(result.memo).toContain('https://email-verify.xyz/email/mail/90210');
    expect(result.memo).toContain('핀번호는 : 123456입니다!');
  });

  test('verifies the selected email dashboard alias PIN really changed after update', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alias-pins-'));
    const pinPath = join(dir, 'alias-pins.json');
    writeFileSync(pinPath, JSON.stringify({ 90210: { pin: '111111', updatedAt: 'old' } }));
    process.env.EMAIL_ALIAS_PIN_STORE_PATH = pinPath;

    await updateEmailAliasPin({
      accountEmail: 'gtwalve4',
      serviceType: '티방',
      pin: '987654',
      aliases: [{ id: 90210, email: 'wavve7.example@aleeas.com', enabled: true }],
    }, '2026-04-28T00:00:00.000Z');

    expect(verifyEmailAliasPinUpdate(90210, '987654')).toMatchObject({ ok: true, pin: '987654' });
    expect(verifyEmailAliasPinUpdate(90210, '111111')).toMatchObject({ ok: false });
  });

  test('updates the selected email dashboard alias PIN with a six digit value', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'alias-pins-'));
    const pinPath = join(dir, 'alias-pins.json');
    writeFileSync(pinPath, JSON.stringify({ 90210: { pin: '111111', updatedAt: 'old' } }));
    process.env.EMAIL_ALIAS_PIN_STORE_PATH = pinPath;

    const result = await updateEmailAliasPin({
      accountEmail: 'gtwalve4',
      serviceType: '티방',
      pin: '987654',
      aliases: [
        { id: 90210, email: 'wavve7.example@aleeas.com', enabled: true },
      ],
    }, '2026-04-28T00:00:00.000Z');

    expect(result.ok).toBe(true);
    expect(result.emailId).toBe(90210);
    expect(result.pin).toBe('987654');
    const store = JSON.parse(readFileSync(pinPath, 'utf8'));
    expect(store['90210']).toMatchObject({ pin: '987654', updatedAt: '2026-04-28T00:00:00.000Z' });
  });
});
