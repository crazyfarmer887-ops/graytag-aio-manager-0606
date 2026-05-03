function jsonForScript(value: string): string {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026');
}

export function buildPartyAccessHtml(token: string): string {
  return `<!doctype html>
<html lang="ko">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
  <title>계정 정보 접근</title>
  <style>
    :root{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;color:#1e1b4b;background:#f8f6ff}
    *{box-sizing:border-box} body{margin:0;min-height:100vh;background:linear-gradient(180deg,#f8f6ff,#fff);padding:28px 16px 40px}
    button,a{font-family:inherit}.wrap{width:100%;max-width:460px;margin:0 auto}.card{background:#fff;border:1px solid #ede9fe;border-radius:24px;padding:20px;box-shadow:0 16px 50px rgba(124,58,237,.14)}
    .loading{min-height:100vh;margin:-28px -16px -40px;display:grid;place-items:center;color:#7c3aed;font-weight:900}.spin{width:24px;height:24px;border:3px solid #ddd6fe;border-top-color:#7c3aed;border-radius:999px;animation:spin 1s linear infinite;margin-right:8px;display:inline-block;vertical-align:middle}@keyframes spin{to{transform:rotate(360deg)}}
    .header{display:flex;align-items:center;gap:10px;margin-bottom:12px}.icon{width:42px;height:42px;border-radius:14px;background:#f5f3ff;display:grid;place-items:center}.title{font-size:18px;font-weight:900}.sub{font-size:12px;color:#9ca3af;font-weight:800}.info{background:#f8f6ff;border-radius:16px;padding:12px;margin-bottom:12px}.service{font-size:12px;color:#6b7280;font-weight:800}.period{font-size:11px;color:#9ca3af;margin-top:4px}.profile-box{background:#eef2ff;border:1.5px solid #c7d2fe;border-radius:16px;padding:13px 14px;margin-bottom:10px;text-align:center}.profile-label{font-size:11px;color:#4f46e5;font-weight:1000}.profile-name{font-size:24px;font-weight:1000;margin-top:4px}
    .rows{display:grid;gap:10px}.row{background:#fff;border:1.5px solid #ede9fe;border-radius:16px;padding:12px 14px}.row-top{display:flex;align-items:center;justify-content:space-between;gap:8px}.row-label{font-size:11px;color:#7c3aed;font-weight:900}.value{font-size:16px;font-weight:900;margin-top:6px;word-break:break-all}.pill{border:0;border-radius:999px;background:#f5f3ff;color:#7c3aed;font-size:11px;font-weight:900;padding:6px 10px;text-decoration:none;cursor:pointer}.pill.disabled{opacity:.55;cursor:not-allowed}.note{margin-top:14px;background:#fffbeb;border:1px solid #fde68a;border-radius:14px;padding:12px;color:#92400e;font-size:12px;line-height:1.55;font-weight:700}
    .blocked{min-height:100vh;margin:-28px -16px -40px;padding:32px 18px;display:grid;place-items:center}.blocked .card{text-align:center}.blocked h1{font-size:20px;margin:12px 0 6px}.blocked p{font-size:13px;color:#6b7280;line-height:1.6;margin:0}
    .consent{position:fixed;inset:0;z-index:100;background:linear-gradient(180deg,#f8f6ff,#fff);padding:28px 16px;display:grid;place-items:center}.consent-card{width:100%;max-width:460px;background:#fff;border:1.5px solid #ede9fe;border-radius:26px;padding:22px;box-shadow:0 20px 70px rgba(124,58,237,.18);text-align:center}.warn-title{font-size:18px;font-weight:1000;color:#ef4444;margin-bottom:14px}.assigned-label{font-size:13px;color:#6b7280;font-weight:800;margin-bottom:6px}.assigned-name{font-size:32px;font-weight:1000;line-height:1.15;margin-bottom:16px}.warning-text{font-size:13px;color:#4b5563;line-height:1.7;text-align:left;background:#fffbeb;border:1px solid #fde68a;border-radius:16px;padding:14px;font-weight:700}.highlight{display:block;margin:10px 0;padding:9px 10px;border-radius:10px;background:linear-gradient(transparent 32%,#fde047 32% 86%,transparent 86%);color:#92400e;font-size:15px;font-weight:1000;line-height:1.55}.emphasis{display:block;margin:10px 0;padding:9px 10px;border-radius:10px;background:#eef2ff;border:1px solid #c7d2fe;color:#3730a3;font-weight:1000}.consent-help{margin-top:16px;font-size:13px;color:#6b7280;font-weight:900}.input{width:100%;margin-top:10px;padding:13px 14px;border-radius:14px;border:1.5px solid #c4b5fd;font-size:18px;font-weight:900;text-align:center;color:#1e1b4b;outline:0}.primary{width:100%;margin-top:10px;padding:14px;border:0;border-radius:14px;background:#7c3aed;color:#fff;font-size:15px;font-weight:1000;cursor:pointer}.primary:disabled{background:#c4b5fd;cursor:not-allowed}
  </style>
</head>
<body>
  <div id="root"><div class="loading"><span><span class="spin"></span>계정 정보 확인 중...</span></div></div>
  <script>window.__PARTY_ACCESS_TOKEN__=${jsonForScript(token)};</script>
  <script>
    (function(){
      const token = window.__PARTY_ACCESS_TOKEN__ || '';
      const root = document.getElementById('root');
      const fmtDate = (value) => {
        if (!value) return '-';
        const s = String(value);
        const m = s.match(/(\d{4})[-./]?(\d{2})[-./]?(\d{2})/) || s.match(/(\d{2})\.\s*(\d{1,2})\.\s*(\d{1,2})/);
        if (!m) return s;
        if (m[1].length === 2) return '20' + m[1] + '.' + String(m[2]).padStart(2,'0') + '.' + String(m[3]).padStart(2,'0');
        return m[1] + '.' + String(m[2]).padStart(2,'0') + '.' + String(m[3]).padStart(2,'0');
      };
      const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
      const copy = async (value) => { if (!value) return; try { await navigator.clipboard.writeText(value); } catch (_) {} };
      const blocked = () => {
        root.innerHTML = '<div class="blocked"><div class="card"><div style="font-size:34px;color:#ef4444">🔒</div><h1>계정 정보 접근이 종료됐어요</h1><p>이용기간이 끝났거나 판매자가 접근을 막은 링크입니다. 문의가 필요하면 판매자에게 메시지 주세요.</p></div></div>';
      };
      const addCredentialRow = (parent, label, value, link) => {
        const row = el('div','row'); const top = el('div','row-top'); top.appendChild(el('div','row-label',label));
        if (link) { const a = el('a','pill','이메일 인증 열기'); a.href = value; a.target = '_blank'; a.rel = 'noreferrer'; top.appendChild(a); }
        else { const b = el('button','pill','복사'); b.type='button'; b.onclick = () => copy(value); top.appendChild(b); }
        row.appendChild(top); row.appendChild(el('div','value', link ? '이메일 인증/핀번호 확인 링크' : (value || '-'))); parent.appendChild(row);
      };
      const warningText = () => {
        const box = el('div','warning-text');
        box.append('프로필을 만드실 때(혹은 프로필을 만드셨을 경우) 해당 이름으로 꼭 만드신 뒤(혹은 변경하신 뒤) 사용하셔야 합니다. 그리고 반드시 위 프로필만 사용해주세요.');
        box.appendChild(document.createElement('br')); box.appendChild(document.createElement('br'));
        box.appendChild(el('span','highlight','일주일 단위로 해당 닉네임이 아닌 프로필은 삭제될 예정이니 꼭 주의 바랍니다!'));
        box.append('다른 프로필을 사용하거나 새 프로필을 추가하면 다른 이용자와 충돌이 생겨 이용이 제한될 수 있습니다.');
        box.appendChild(el('span','emphasis','이메일 인증 필요시, 동의 후 나오는 이메일 인증 열기를 눌러, 하단에 보이는 핀번호를 입력하면 접근 가능하니 참고 바랍니다.'));
        box.append('기타 문의 연락은 구매처에서 14:00 ~ 21:00 중으로 연락주시면 답변드리고 있으니 참고 바랍니다.');
        return box;
      };
      const renderConsent = (profileName) => {
        const overlay = el('div','consent'); const card = el('div','consent-card');
        card.appendChild(el('div','warn-title','⚠️ 1인 1프로필 원칙 안내 ⚠️'));
        card.appendChild(el('div','assigned-label','배정된 프로필 이름'));
        card.appendChild(el('div','assigned-name',profileName));
        card.appendChild(warningText());
        card.appendChild(el('div','consent-help','동의하신다면, 아래 입력 칸에 "' + profileName + '"을 입력해주세요.'));
        const input = el('input','input'); input.placeholder = profileName; input.autofocus = true;
        const button = el('button','primary','동의하고 계정 정보 보기'); button.disabled = true;
        const accept = () => { if (input.value.trim() !== profileName) return; try { localStorage.setItem('access-consent:' + token, profileName); } catch (_) {} overlay.remove(); };
        input.addEventListener('input', () => { button.disabled = input.value.trim() !== profileName; });
        input.addEventListener('keydown', (e) => { if (e.key === 'Enter') accept(); }); button.onclick = accept;
        card.appendChild(input); card.appendChild(button); overlay.appendChild(card); document.body.appendChild(overlay); setTimeout(() => input.focus(), 50);
      };
      const render = (payload) => {
        if (!payload || !payload.ok) return blocked();
        const c = payload.credentials || {}; const profileName = payload.profileName || payload.memberName || '(미확인)';
        root.innerHTML = ''; const wrap = el('div','wrap'); const card = el('div','card');
        const header = el('div','header'); header.appendChild(el('div','icon','🛡️')); const ht = el('div'); ht.appendChild(el('div','title','최신 ID · PW · PIN')); ht.appendChild(el('div','sub','이용기간 중에만 계정 정보를 확인할 수 있어요')); header.appendChild(ht); card.appendChild(header);
        const info = el('div','info'); info.appendChild(el('div','service',(payload.serviceType || '') + ' · ' + (payload.memberName || ''))); info.appendChild(el('div','period',fmtDate(payload.period && payload.period.startDateTime) + ' ~ ' + fmtDate(payload.period && payload.period.endDateTime))); card.appendChild(info);
        const profile = el('div','profile-box'); profile.appendChild(el('div','profile-label','구매자님이 만들어야 하는 프로필 이름')); profile.appendChild(el('div','profile-name',profileName)); card.appendChild(profile);
        const rows = el('div','rows'); addCredentialRow(rows,'ID',c.id || '',false); addCredentialRow(rows,'PW',c.password || '',false); addCredentialRow(rows,'EMAIL',payload.emailAccessUrl || '',Boolean(payload.emailAccessUrl)); addCredentialRow(rows,'이메일 접근 PIN번호',c.pin || '',false); card.appendChild(rows);
        card.appendChild(el('div','note','비밀번호가 갑자기 안 되면 판매자에게 바로 알려주세요. 링크는 이용 종료 후 자동으로 막힙니다.'));
        wrap.appendChild(card); root.appendChild(wrap);
        try { if (localStorage.getItem('access-consent:' + token) !== profileName) renderConsent(profileName); } catch (_) { renderConsent(profileName); }
      };
      fetch('/api/party-access/' + encodeURIComponent(token), { cache: 'no-store' })
        .then((res) => res.json().catch(() => ({})))
        .then(render)
        .catch(blocked);
    })();
  </script>
</body>
</html>`;
}
