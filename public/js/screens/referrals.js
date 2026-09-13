// ===================================================================
// public/js/screens/referrals.js — «Пригласить друга»
//
// Личная ссылка, QR-код к ней, список приглашённых и раздел «Задания»
// (включается владельцем из панели).
//
// QR рисуется ЗДЕСЬ, а не на сервере: картинка нужна только в этом
// экране, а гонять её по сети при каждом заходе незачем. Генератор свой,
// без библиотек — в проекте нет сборщика, и тянуть внешний скрипт ради
// одной картинки не хочется.
// ===================================================================

// ── Генератор QR ───────────────────────────────────────────────────
// Умеет ровно то, что нужно для ссылки: байтовый режим, уровень
// коррекции M, версии 1–6 (до 108 байт). Версии 7+ требуют отдельного
// блока с номером версии в углах — он не нужен и не реализован.
App.QR = (() => {
  // версия: [всего кодовых слов, слов коррекции на блок, размеры блоков данных]
  const EC_M = {
    1: [26, 10, [16]],
    2: [44, 16, [28]],
    3: [70, 26, [44]],
    4: [100, 18, [32, 32]],
    5: [134, 24, [43, 43]],
    6: [172, 16, [27, 27, 27, 27]],
  };
  // Центры выравнивающих квадратов по версиям
  const ALIGN = { 1: [], 2: [6, 18], 3: [6, 22], 4: [6, 26], 5: [6, 30], 6: [6, 34] };

  // Поле Галуа GF(256), примитивный многочлен 0x11D — как в стандарте
  const EXP = new Uint8Array(512), LOG = new Uint8Array(256);
  (() => {
    let x = 1;
    for (let i = 0; i < 255; i++) {
      EXP[i] = x; LOG[x] = i;
      x <<= 1;
      if (x & 0x100) x ^= 0x11d;
    }
    for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
  })();
  const mul = (a, b) => (a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]]);

  // Многочлен-генератор кода Рида — Соломона степени deg
  function generator(deg) {
    let g = [1];
    for (let i = 0; i < deg; i++) {
      const next = new Array(g.length + 1).fill(0);
      for (let j = 0; j < g.length; j++) {
        next[j] ^= mul(g[j], EXP[i]);
        next[j + 1] ^= g[j];
      }
      g = next;
    }
    // Собирали от младшей степени к старшей, а деление ниже ждёт
    // обратный порядок (первым — старший коэффициент)
    return g.reverse();
  }

  // Слова коррекции для одного блока данных
  function ecFor(data, ecLen) {
    const g = generator(ecLen);
    const rem = new Array(ecLen).fill(0);
    for (const byte of data) {
      const factor = byte ^ rem[0];
      rem.shift(); rem.push(0);
      for (let j = 0; j < ecLen; j++) rem[j] ^= mul(g[j + 1], factor);
    }
    return rem;
  }

  // Текст → поток кодовых слов (данные и коррекция уже перемешаны)
  function codewords(text) {
    const bytes = Array.from(new TextEncoder().encode(text));
    let version = 0;
    for (let v = 1; v <= 6; v++) {
      const [total, ecLen, blocks] = EC_M[v];
      const dataCap = total - ecLen * blocks.length;
      if (4 + 8 + bytes.length * 8 <= dataCap * 8) { version = v; break; }
    }
    if (!version) return null;   // длиннее 108 байт — не наш случай

    const [total, ecLen, blocks] = EC_M[version];
    const dataCap = total - ecLen * blocks.length;
    const bits = [];
    const push = (val, len) => { for (let i = len - 1; i >= 0; i--) bits.push((val >>> i) & 1); };
    push(0b0100, 4);            // байтовый режим
    push(bytes.length, 8);      // длина (для версий 1–9 — 8 бит)
    for (const b of bytes) push(b, 8);
    for (let i = 0; i < 4 && bits.length < dataCap * 8; i++) bits.push(0);
    while (bits.length % 8) bits.push(0);
    const words = [];
    for (let i = 0; i < bits.length; i += 8) {
      let v = 0;
      for (let j = 0; j < 8; j++) v = (v << 1) | bits[i + j];
      words.push(v);
    }
    // Добивка до ёмкости чередующимися 0xEC/0x11 — так велит стандарт
    for (let i = 0; words.length < dataCap; i++) words.push(i % 2 ? 0x11 : 0xec);

    // Разбиваем на блоки, считаем коррекцию, перемешиваем
    const dataBlocks = [], ecBlocks = [];
    let at = 0;
    for (const size of blocks) {
      const blk = words.slice(at, at + size); at += size;
      dataBlocks.push(blk);
      ecBlocks.push(ecFor(blk, ecLen));
    }
    const out = [];
    const maxData = Math.max.apply(null, blocks);
    for (let i = 0; i < maxData; i++) for (const b of dataBlocks) if (i < b.length) out.push(b[i]);
    for (let i = 0; i < ecLen; i++) for (const b of ecBlocks) out.push(b[i]);
    return { version, words: out };
  }

  // Каркас: поисковые квадраты, синхродорожки, выравнивание, тёмный модуль
  function skeleton(size, version) {
    const mods = [], fixed = [];
    for (let i = 0; i < size; i++) {
      mods.push(new Array(size).fill(false));
      fixed.push(new Array(size).fill(false));
    }
    const set = (r, c, v) => { mods[r][c] = v; fixed[r][c] = true; };
    const finder = (top, left) => {
      for (let r = -1; r <= 7; r++) for (let c = -1; c <= 7; c++) {
        const rr = top + r, cc = left + c;
        if (rr < 0 || cc < 0 || rr >= size || cc >= size) continue;
        const inner = r >= 0 && r <= 6 && c >= 0 && c <= 6
          && (r === 0 || r === 6 || c === 0 || c === 6 || (r >= 2 && r <= 4 && c >= 2 && c <= 4));
        set(rr, cc, inner);
      }
    };
    finder(0, 0); finder(0, size - 7); finder(size - 7, 0);
    for (let i = 8; i < size - 8; i++) { set(6, i, i % 2 === 0); set(i, 6, i % 2 === 0); }
    for (const r of ALIGN[version]) for (const c of ALIGN[version]) {
      // Углы заняты поисковыми квадратами — там выравнивание не рисуют
      if ((r <= 8 && c <= 8) || (r <= 8 && c >= size - 9) || (r >= size - 9 && c <= 8)) continue;
      for (let dr = -2; dr <= 2; dr++) for (let dc = -2; dc <= 2; dc++) {
        set(r + dr, c + dc, Math.max(Math.abs(dr), Math.abs(dc)) !== 1);
      }
    }
    // Места под сведения о маске: заполним потом, но данными занимать нельзя
    for (let i = 0; i <= 8; i++) { if (!fixed[8][i]) set(8, i, false); if (!fixed[i][8]) set(i, 8, false); }
    for (let i = 0; i < 8; i++) { if (!fixed[size - 1 - i][8]) set(size - 1 - i, 8, false); if (!fixed[8][size - 1 - i]) set(8, size - 1 - i, false); }
    set(size - 8, 8, true);   // всегда тёмный модуль
    return { mods, fixed };
  }

  // Кодовые слова → модули, «змейкой» справа снизу
  function placeData(mods, fixed, size, words) {
    const bits = [];
    for (const w of words) for (let i = 7; i >= 0; i--) bits.push((w >>> i) & 1);
    let idx = 0, up = true;
    for (let col = size - 1; col > 0; col -= 2) {
      if (col === 6) col--;      // вертикальную синхродорожку пропускаем
      for (let k = 0; k < size; k++) {
        const row = up ? size - 1 - k : k;
        for (let c = 0; c < 2; c++) {
          const cc = col - c;
          if (fixed[row][cc]) continue;
          mods[row][cc] = idx < bits.length ? !!bits[idx++] : false;
        }
      }
      up = !up;
    }
  }

  const MASKS = [
    (r, c) => (r + c) % 2 === 0,
    (r) => r % 2 === 0,
    (r, c) => c % 3 === 0,
    (r, c) => (r + c) % 3 === 0,
    (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
    (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
    (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
    (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
  ];

  // Сведения о маске: 15 бит с кодом БЧХ, в двух копиях
  function putFormat(mods, size, mask) {
    const data = mask;                       // уровень M — это нули в старших битах
    let rem = data;
    for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
    const bits = (((data << 10) | rem) ^ 0x5412) & 0x7fff;
    const bit = (i) => ((bits >>> i) & 1) === 1;
    // Первая копия — вокруг левого верхнего поискового квадрата
    for (let i = 0; i <= 5; i++) mods[i][8] = bit(i);
    mods[7][8] = bit(6);
    mods[8][8] = bit(7);
    mods[8][7] = bit(8);
    for (let i = 9; i < 15; i++) mods[8][14 - i] = bit(i);
    // Вторая копия — под правым верхним и справа от левого нижнего.
    // Тёмный модуль (size-8, 8) в неё не входит, он ставится в каркасе.
    for (let i = 0; i < 8; i++) mods[8][size - 1 - i] = bit(i);
    for (let i = 8; i < 15; i++) mods[size - 15 + i][8] = bit(i);
  }

  // Штраф за «нечитаемый» рисунок — по нему выбирается маска
  function penalty(mods, size) {
    let score = 0;
    const line = (get) => {
      for (let a = 0; a < size; a++) {
        let run = 1;
        for (let b = 1; b < size; b++) {
          if (get(a, b) === get(a, b - 1)) { run++; continue; }
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
        if (run >= 5) score += 3 + (run - 5);
      }
    };
    line((r, c) => mods[r][c]);
    line((c, r) => mods[r][c]);
    for (let r = 0; r < size - 1; r++) for (let c = 0; c < size - 1; c++) {
      const v = mods[r][c];
      if (v === mods[r][c + 1] && v === mods[r + 1][c] && v === mods[r + 1][c + 1]) score += 3;
    }
    const PAT = [true, false, true, true, true, false, true, false, false, false, false];
    const match = (get, a, b) => {
      for (let i = 0; i < PAT.length; i++) if (get(a, b + i) !== PAT[i]) return false;
      return true;
    };
    for (let a = 0; a < size; a++) for (let b = 0; b + PAT.length <= size; b++) {
      if (match((r, c) => mods[r][c], a, b)) score += 40;
      if (match((c, r) => mods[r][c], a, b)) score += 40;
    }
    let dark = 0;
    for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) if (mods[r][c]) dark++;
    score += Math.floor(Math.abs((dark * 100) / (size * size) - 50) / 5) * 10;
    return score;
  }

  // Текст → матрица модулей (true — тёмный). null, если текст не влез.
  function matrix(text) {
    const cw = codewords(String(text || ''));
    if (!cw) return null;
    const size = 17 + 4 * cw.version;
    let best = null, bestScore = Infinity;
    for (let mask = 0; mask < 8; mask++) {
      const { mods, fixed } = skeleton(size, cw.version);
      placeData(mods, fixed, size, cw.words);
      for (let r = 0; r < size; r++) for (let c = 0; c < size; c++) {
        if (!fixed[r][c] && MASKS[mask](r, c)) mods[r][c] = !mods[r][c];
      }
      putFormat(mods, size, mask);
      const s = penalty(mods, size);
      if (s < bestScore) { bestScore = s; best = mods; }
    }
    return { size, mods: best };
  }

  // Матрица → canvas. quiet — светлое поле по краям (стандарт требует 4).
  function canvas(text, px, quiet) {
    const m = matrix(text);
    if (!m) return null;
    const q = quiet == null ? 4 : quiet;
    const scale = px || 6;
    const side = (m.size + q * 2) * scale;
    const cv = document.createElement('canvas');
    cv.width = side; cv.height = side;
    const ctx = cv.getContext('2d');
    if (!ctx) return null;      // холста нет (старый браузер) — обойдёмся ссылкой
    ctx.fillStyle = '#ffffff';   // код читают камерой — фон всегда белый
    ctx.fillRect(0, 0, side, side);
    ctx.fillStyle = '#000000';
    for (let r = 0; r < m.size; r++) for (let c = 0; c < m.size; c++) {
      if (m.mods[r][c]) ctx.fillRect((c + q) * scale, (r + q) * scale, scale, scale);
    }
    return cv;
  }

  return { matrix, canvas };
})();

// ── Шкала заданий ──────────────────────────────────────────────────
// Во всю ширину: полоса на 10 баллов, под каждым баллом — иконка
// награды. Забрать можно только награду за уже набранный балл.
App._questScale = (b, title, note) => {
  const pct = Math.round((b.points / Math.max(1, b.steps.length)) * 100);
  const steps = b.steps.map((s) => `
    <div class="rq-step ${s.claimed ? 'is-claimed' : (s.reached ? 'is-ready' : '')}"
         data-step-info="${s.step}" title="${UI.esc(s.text)}">
      <div class="rq-ic">${s.icon}</div>
      <div class="rq-num">${s.step}</div>
      ${s.claimed ? '<div class="rq-tick">✓</div>' : ''}
    </div>`).join('');
  const ready = b.steps.filter((s) => s.reached && !s.claimed);
  return `
    <div class="card rq-card">
      <div class="name">${title}</div>
      ${note ? `<p class="muted small" style="margin:2px 0 8px">${note}</p>` : ''}
      <div class="rq-head"><b class="gold">${b.points}</b> из ${b.steps.length} баллов</div>
      <div class="rq-bar"><div class="rq-fill" style="width:${pct}%"></div></div>
      <div class="rq-steps">${steps}</div>
      <div id="rq-hint-${b.board}" class="muted small rq-hint">Нажмите на иконку, чтобы увидеть награду.</div>
      ${ready.map((s) => `
        <button class="btn btn-orange mt" data-claim-step="${s.step}" data-board="${b.board}" style="width:100%">
          🎁 Забрать за ${s.step}-й балл: ${UI.esc(s.text)}
        </button>`).join('')}
      <div class="rq-tasks">
        ${b.tasks.map((t) => `
          <div class="rq-task ${t.done ? 'is-done' : ''}">
            <div class="grow">
              <span class="${t.done ? 'gold' : ''}">${t.done ? '✅' : '▫️'} ${UI.esc(t.name)}</span>
              ${t.note ? `<br><span class="muted small">${UI.esc(t.note)}</span>` : ''}
            </div>
            <span class="muted small rq-prog">${UI.fmtNum(t.have)} / ${UI.fmtNum(t.need)}</span>
          </div>`).join('')}
      </div>
    </div>`;
};

// ── Экран «Пригласить друга» ───────────────────────────────────────
App.screens.referral = async (c) => {
  await App.refreshMe();
  const d = await API.get('/api/referral');
  let q = null;
  if (d.questsOn) { try { q = await API.get('/api/referral/quests'); } catch (e) {} }

  const invitedRows = (d.invited || []).map((x) => `
    <div class="list-row">
      <div class="grow">
        <span class="name">${UI.esc(x.name)}</span>
        ${x.reached50 ? '<span class="badge">50 ур. ✓</span>' : ''}
        ${x.active ? '' : '<span class="badge" style="opacity:.6">не заходит</span>'}
        <br><span class="muted small">${x.level} уровень · пришёл ${UI.fmtDate(x.joinedAt)}</span>
        ${x.goldFromHim ? `<br><span class="gold small">принёс вам <span class="ic-gold"></span> ${UI.fmtNum(x.goldFromHim)}</span>` : ''}
      </div>
    </div>`).join('');

  c.innerHTML = `
    <div class="title">🎁 Пригласить друга</div>
    <div class="card center">
      <p class="muted small">Отправьте другу ссылку или покажите QR-код. Код подставится сам — вводить ничего не нужно. Друг сразу получит <span class="ic-gold"></span> ${d.inviteeGold}, вы — награду за его 50 уровень и ${d.purchaseSharePct}% золотом со всех его покупок.</p>
      <div class="ref-link-box" style="margin:10px 0">
        <input type="text" id="ref-link" readonly value="${UI.esc(d.link)}" style="text-align:center">
      </div>
      <div class="btn-row">
        <button class="btn btn-orange" id="ref-copy-link" style="flex:1">🔗 Скопировать ссылку</button>
        <button class="btn" id="ref-share" style="flex:1">📤 Поделиться</button>
      </div>
      <p style="font-size:22px;letter-spacing:3px;font-weight:bold;margin:12px 0 4px" class="gold">${UI.esc(d.code)}</p>
      <button class="btn btn-inline" id="ref-copy">📋 Скопировать код</button>
    </div>

    <div class="card center">
      <div class="name">📱 QR-код приглашения</div>
      <p class="muted small">Друг наводит камеру — и попадает сразу в игру с вашим кодом.</p>
      <div id="ref-qr" style="display:flex;justify-content:center;margin:10px 0"></div>
      <button class="btn btn-inline" id="ref-qr-save">⬇️ Сохранить картинкой</button>
    </div>

    <div class="card">
      <div class="kv"><span class="k">Приглашено друзей</span><span class="v gold">${d.refCount}</span></div>
      <div class="kv"><span class="k">Заработано с покупок друзей</span><span class="v gold"><span class="ic-gold"></span> ${UI.fmtNum(d.refEarnings)}</span></div>
      <hr class="hr">
      <div class="kv"><span class="k">🎁 Другу за переход по ссылке</span><span class="v"><span class="ic-gold"></span> ${d.inviteeGold}</span></div>
      <div class="kv"><span class="k">🏅 Вам за 50 уровень друга</span><span class="v"><span class="ic-gold"></span> ${d.level50Reward} + <span class="ic-token"></span> ${d.level50Tokens}</span></div>
      <div class="kv"><span class="k">💰 Вам с покупок друга</span><span class="v">${d.purchaseSharePct}% золотом</span></div>
      <p class="muted small" style="margin:8px 0 0">Доля с покупок приходит письмом в почту с кнопкой «Забрать». Кто именно из друзей пополнил счёт — не показывается.</p>
    </div>

    <div class="card">
      <div class="name">👥 Кто пришёл по вашей ссылке</div>
      ${invitedRows || '<p class="muted center" style="margin:8px 0 0">Пока никто. Отправьте ссылку или QR-код — здесь появятся все, кто зашёл.</p>'}
    </div>

    ${q ? App._questScale(q.inviter, '🎯 Шкала вербовщика',
      'Каждое выполненное условие — 1 балл. Под каждым баллом своя награда.') : ''}
    ${q && q.newbie ? App._questScale(q.newbie, '🎖 Шкала новобранца',
      'Ваш собственный путь: за него награды получаете вы.') : ''}
    ${q && q.share ? `
      <div class="card">
        <div class="name">💰 Доля с покупок друзей</div>
        <p class="muted small">Сейчас вам идёт <b class="gold">${q.share.pct}%</b> с покупок золота приглашёнными. Доля растёт от числа друзей, дошедших до 50 уровня — сейчас таких ${q.share.friends50}.</p>
        <div class="rq-share">
          ${q.share.steps.map((s) => `
            <div class="rq-share-step ${s.reached ? 'is-ready' : ''}">
              <b>${s.pct}%</b><br><span class="muted small">${s.friends} друзей</span>
            </div>`).join('')}
        </div>
        ${q.share.next ? `<p class="muted small" style="margin:8px 0 0">До ${q.share.next.pct}% осталось пригласить ещё ${q.share.next.left}.</p>` : ''}
      </div>` : ''}

    ${d.canApply ? `
      <div class="card">
        <div class="name">Ввести чужой код</div>
        <p class="muted small">Если вас пригласили, а ссылку вы не открывали — введите код приглашающего (один раз, до 50 уровня).</p>
        <div class="field-row mt">
          <input type="text" id="ref-input" placeholder="Код друга" style="text-transform:uppercase">
          <button class="btn btn-orange btn-inline" id="ref-apply">Применить</button>
        </div>
      </div>` : (d.referredBy ? '<div class="card center muted">Вы уже использовали реферальный код.</div>' : '<div class="card center muted">Ввод кода доступен только до 50 уровня.</div>')}`;

  // QR рисуем после вставки разметки: холсту нужен готовый контейнер
  const qrBox = document.getElementById('ref-qr');
  const cv = App.QR.canvas(d.link, 6);
  if (cv) {
    cv.style.width = '200px';
    cv.style.height = '200px';
    cv.style.imageRendering = 'pixelated';   // иначе размытие ломает чтение
    cv.style.borderRadius = '8px';
    qrBox.appendChild(cv);
  } else {
    qrBox.innerHTML = '<p class="muted small">QR-код недоступен — пользуйтесь ссылкой.</p>';
  }

  document.getElementById('ref-qr-save').onclick = () => {
    if (!cv) { UI.toast('⛔ QR-код не создан'); return; }
    const a = document.createElement('a');
    a.href = cv.toDataURL('image/png');
    a.download = 'priglashenie-' + d.code + '.png';
    a.click();
    UI.toast('⬇️ Картинка сохранена');
  };

  const copy = (text, msg) => {
    if (navigator.clipboard) {
      navigator.clipboard.writeText(text).then(() => UI.toast(msg)).catch(() => UI.toast(text));
    } else UI.toast(text);
  };
  document.getElementById('ref-copy-link').onclick = () => copy(d.link, '🔗 Ссылка скопирована');
  document.getElementById('ref-copy').onclick = () => copy(d.code, '📋 Код скопирован');
  document.getElementById('ref-share').onclick = async () => {
    // На телефоне открывается родное окно «поделиться», на компьютере
    // его нет — там просто копируем ссылку
    if (navigator.share) {
      try {
        await navigator.share({ title: 'Альянс Генералов', text: 'Заходи в «Альянс Генералов» по моей ссылке', url: d.link });
        return;
      } catch (e) { if (e && e.name === 'AbortError') return; }
    }
    copy(d.link, '🔗 Ссылка скопирована');
  };

  // Шкалы: подсказка по иконке и получение награды
  c.querySelectorAll('[data-step-info]').forEach((el) => {
    el.onclick = () => {
      const board = el.closest('.rq-card').querySelector('.rq-hint');
      const n = Number(el.dataset.stepInfo);
      const all = [].concat(q ? q.inviter.steps : [], (q && q.newbie) ? q.newbie.steps : []);
      const info = all.find((s) => s.step === n && el.querySelector('.rq-ic').textContent.trim() === s.icon);
      if (board && info) board.textContent = `${n}-й балл: ${info.text}${info.claimed ? ' — забрано' : ''}`;
    };
  });
  c.querySelectorAll('[data-claim-step]').forEach((btn) => {
    btn.onclick = async () => {
      btn.disabled = true;
      try {
        await API.post('/api/referral/quests/claim', { board: btn.dataset.board, step: Number(btn.dataset.claimStep) });
        await App.refreshMe();
        App.rerender();
      } catch (e) { btn.disabled = false; UI.toast('⛔ ' + e.message); }
    };
  });

  const apply = document.getElementById('ref-apply');
  if (apply) apply.onclick = async () => {
    const code = document.getElementById('ref-input').value.trim();
    if (!code) { UI.toast('Введите код'); return; }
    try { await API.post('/api/referral/apply', { code }); await App.refreshMe(); App.rerender(); }
    catch (e) { UI.toast('⛔ ' + e.message); }
  };
};
