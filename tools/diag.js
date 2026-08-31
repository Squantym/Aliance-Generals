#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
// tools/diag.js — «что тут вообще происходит»
//
// Один запуск — и видно всё, что обычно выясняется десятью вопросами:
// какая версия кода, свежая ли сборка, какая база, что в режиме
// обслуживания, настроена ли почта, открыта ли регистрация.
//
// Появился после нескольких суток переписки, в которых окно обновления
// висело у владельца над работающей игрой, а причину искали вслепую.
// Каждый отдельный факт добывался отдельным вопросом, ответы приходили
// с задержкой, и половина выводов строилась на догадках. Инструмент,
// печатающий всё разом, стоил бы двадцати минут — и сэкономил бы их
// все.
//
// ЗНАЧЕНИЙ КЛЮЧЕЙ НЕ ПЕЧАТАЕТ. Только имена и длину: вывод этой команды
// принято пересылать, а ключ почты и пароль базы пересылать нельзя.
// Ровно так они уже утекали в переписку.
//
// Запуск в папке игры:
//   node tools/diag.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = process.cwd();
const line = (s = '') => console.log(s);
const head = (s) => { line(); line('═══ ' + s + ' ' + '═'.repeat(Math.max(0, 58 - s.length))); };
const row = (k, v) => line('  ' + String(k).padEnd(26) + ' ' + v);
const OK = '✅'; const BAD = '⛔'; const WARN = '⚠ ';

// .env читаем сами, тем же способом, что и сервер: нас интересует, что
// увидит ОН, а не что лежит в файле.
function readEnvFile() {
  const out = {};
  const dup = {};
  try {
    const raw = fs.readFileSync(path.join(ROOT, '.env'), 'utf8');
    for (const l of raw.split('\n')) {
      const s = l.trim();
      if (!s || s.startsWith('#')) continue;
      const eq = s.indexOf('=');
      if (eq === -1) continue;
      const k = s.slice(0, eq).trim();
      let v = s.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
      if (out[k] !== undefined) dup[k] = (dup[k] || 1) + 1;
      out[k] = v;
    }
  } catch (e) { return null; }
  out.__dup = dup;
  return out;
}

(function main() {
  line();
  line('╔══════════════════════════════════════════════════════════════╗');
  line('║  ДИАГНОСТИКА «АЛЬЯНС ГЕНЕРАЛОВ»                              ║');
  line('╚══════════════════════════════════════════════════════════════╝');
  row('папка', ROOT);
  row('время', new Date().toISOString());

  // ── Версия и свежесть сборки ─────────────────────────────────────
  head('КОД');
  try {
    const g = (c) => execSync(c, { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    row('коммит', g('git rev-parse --short HEAD') + ' · ' + g('git log -1 --format=%s').slice(0, 50));
    row('ветка', g('git rev-parse --abbrev-ref HEAD'));
    const dirty = g('git status --porcelain');
    row('незакоммиченные правки', dirty ? WARN + dirty.split('\n').length + ' файлов' : OK + ' нет');
  } catch (e) { row('git', WARN + 'недоступен'); }

  // Свежесть сборки. Самая частая причина «я же выкатил, а не
  // изменилось»: dist старше исходников, потому что сборка упала или её
  // забыли.
  try {
    const newest = (dir, ext) => {
      let t = 0;
      const walk = (d) => {
        for (const f of fs.readdirSync(d, { withFileTypes: true })) {
          if (f.name === 'node_modules' || f.name.startsWith('.')) continue;
          const p = path.join(d, f.name);
          if (f.isDirectory()) walk(p);
          else if (f.name.endsWith(ext)) t = Math.max(t, fs.statSync(p).mtimeMs);
        }
      };
      try { walk(dir); } catch (e) {}
      return t;
    };
    const src = Math.max(newest(path.join(ROOT, 'src'), '.ts'), newest(path.join(ROOT, 'public'), '.js'));
    const dist = newest(path.join(ROOT, 'dist'), '.js');
    if (!dist) row('сборка dist/', BAD + ' НЕТ ВООБЩЕ — сервер не запустится');
    // Запас в минуту: сборка идёт не мгновенно, и файлы, тронутые
    // секунда в секунду, — это норма, а не отставание. Без запаса
    // предупреждение горело бы всегда и его перестали бы читать.
    else if (dist < src - 60000) {
      row('сборка dist/', BAD + ' СТАРШЕ исходников на '
        + Math.round((src - dist) / 60000) + ' мин — выполните npm run build');
    } else row('сборка dist/', OK + ' свежая');
  } catch (e) {}

  // ── Окружение ────────────────────────────────────────────────────
  head('НАСТРОЙКИ (.env и окружение процесса)');
  const envFile = readEnvFile();
  if (!envFile) row('.env', BAD + ' файла нет');
  else {
    const dups = Object.keys(envFile.__dup || {});
    if (dups.length) row('дубли строк в .env', WARN + dups.join(', ') + ' — сервер возьмёт ПЕРВУЮ');
    for (const k of ['SMTPBZ_API_KEY', 'EMAIL_FROM', 'APP_URL', 'PORT', 'TEST_WORLD',
      'DB_DRIVER', 'OWNER_NAME', 'ALLOW_UNVERIFIED_EMAIL', 'STAFF_2FA_REQUIRED']) {
      if (!(k in envFile)) continue;
      const v = envFile[k];
      const secret = /KEY|PASS|SECRET|URI|TOKEN/i.test(k);
      row('.env ' + k, v === ''
        ? BAD + ' ПУСТО — строка есть, значения нет'
        : (secret ? OK + ' задан, длина ' + v.length : OK + ' ' + v));
    }
    if (!('SMTPBZ_API_KEY' in envFile)) row('.env SMTPBZ_API_KEY', BAD + ' строки нет вовсе');
  }

  // ── База и режим обслуживания ────────────────────────────────────
  head('БАЗА И РЕЖИМ ОБСЛУЖИВАНИЯ');
  let db = null;
  try {
    // Сервер сам решает, какая база: повторяем его выбор, а не гадаем.
    if (envFile) for (const k of Object.keys(envFile)) {
      if (k !== '__dup' && process.env[k] === undefined) process.env[k] = envFile[k];
    }
    db = require(path.join(ROOT, 'dist/src/core/db.js'));
  } catch (e) { row('модуль базы', BAD + ' не загрузился: ' + e.message); }

  if (db) {
    (async () => {
      try { await db.init(); } catch (e) { row('открытие базы', BAD + ' ' + e.message); }
      row('режим базы', db.mode);
      const players = Object.keys(db.load('users', {})).length;
      row('игроков', players);

      // Сырое состояние, а не через view(): нам нужно то, что ЛЕЖИТ, а
      // не то, что показывают.
      const m = db.load('maintenance', {});
      const has = Object.keys(m).length > 0;
      row('запись обслуживания', has ? 'есть' : WARN + 'пустая (значения по умолчанию)');
      row('  on', String(m.on));
      row('  startAt', m.startAt ? new Date(m.startAt).toISOString() : '0');
      row('  until', m.until ? new Date(m.until).toISOString() : '0');
      row('  at', m.at ? new Date(m.at).toISOString() : '0');
      row('  reason', JSON.stringify(String(m.reason || '').slice(0, 60)));
      row('  by', JSON.stringify(String(m.by || '')));

      let maint = null;
      try {
        maint = require(path.join(ROOT, 'dist/src/services/maintenance.js'));
        const on = maint.isOn();
        row('ИТОГО игра закрыта?', on ? BAD + ' ДА — игроки видят окно обновления' : OK + ' нет, открыта');
        if (on) {
          line();
          line('  Снять: панель → «Обновление» → «Открыть игру для игроков»');
          line('  Или из консоли:  node tools/diag.js --open');
        }
      } catch (e) { row('модуль обслуживания', BAD + ' ' + e.message); }

      // ── Почта и регистрация ────────────────────────────────────────
      head('ПОЧТА И РЕГИСТРАЦИЯ');
      try {
        const email = require(path.join(ROOT, 'dist/src/services/email.js'));
        row('почта настроена', email.isConfigured ? OK + ' да' : BAD + ' НЕТ');
        row('отправитель', email.EMAIL_FROM);
        const w = email.bootWarning ? email.bootWarning() : '';
        if (w) line('  ' + w);
        const blocked = email.registrationBlocked ? email.registrationBlocked() : '';
        row('регистрация', blocked ? BAD + ' ЗАКРЫТА' : OK + ' открыта');
        if (blocked) line('  причина: ' + blocked);
      } catch (e) { row('модуль почты', BAD + ' не загрузился: ' + e.message); }

      try {
        const tw = require(path.join(ROOT, 'dist/src/services/testWorld.js'));
        row('тестовый мир', tw.isOn() ? 'ДА (' + (tw.view().name || '') + ')' : 'нет, это боевой');
      } catch (e) {}

      // ── Снять режим по просьбе ─────────────────────────────────────
      if (process.argv.includes('--open') && maint) {
        head('СНИМАЮ РЕЖИМ ОБСЛУЖИВАНИЯ');
        try {
          maint.turnOff('консоль (tools/diag.js)');
          await db.flushAllNow();
          line('  ' + OK + ' Игра открыта. Перезапустите сервер, если он работает:');
          line('     pm2 restart generals-game');
        } catch (e) { line('  ' + WARN + e.message); }
      }

      head('ЧТО ДЕЛАТЬ ДАЛЬШЕ');
      line('  Скопируйте весь вывод целиком — в нём нет ни одного секрета,');
      line('  только имена настроек и длины значений.');
      line();
      process.exit(0);
    })();
  }
})();
