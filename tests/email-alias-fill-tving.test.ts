import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, test } from 'vitest';
import { resolveEmailAliasFill } from '../src/api/email-alias-fill';

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
        { id: 100, email: 'wavve-old@example.com', enabled: true },
        { id: 90210, email: 'tving7.example@aleeas.com', enabled: true },
      ],
    });

    expect(result.ok).toBe(true);
    expect(result.emailId).toBe(90210);
    expect(result.pin).toBe('123456');
    expect(result.memo).toContain('https://email-verify.xyz/email/mail/90210');
    expect(result.memo).toContain('핀번호는 : 123456입니다!');
  });
});
