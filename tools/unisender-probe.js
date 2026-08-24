// ═══════════════════════════════════════════════════════════════════
// tools/unisender-probe.js — на какой площадке живёт ваш ключ Unisender
//
// Зачем нужен. Unisender Go — это несколько независимых площадок с
// одинаковым API, но РАЗНЫМИ базами пользователей: go1, go2 и т.д.
// Ключ, выданный на одной площадке, на другой не опознаётся: сервер
// разбирает ключ, достаёт из него внутренний номер пользователя и не
// находит такого у себя. Наружу это выглядит как «User with id ... not
// found» — то есть как поломка аккаунта, хотя аккаунт цел, просто мы
// стучимся не в ту дверь.
//
// Скрипт НИЧЕГО НЕ ОТПРАВЛЯЕТ и не тратит лимит писем: он вызывает
// справочный метод «список доменов», который только читает.
//
// Запуск (из папки с игрой, ключ берётся из .env):
//   node tools/unisender-probe.js
// ═══════════════════════════════════════════════════════════════════
const fs = require('fs');
const path = require('path');

// Тот же загрузчик .env, что и в server.ts: при прямом запуске файла
// process.env пуст, ключ иначе не подхватится.
(function loadDotEnv() {
  try {
    const envPath = path.join(process.cwd(), '.env');
    if (!fs.existsSync(envPath)) return;
    for (const raw of fs.readFileSync(envPath, 'utf8').split('\n')) {
      const line = raw.trim();
      if (!line || line.startsWith('#')) continue;
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      let val = line.slice(eq + 1).trim();
      if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
        val = val.slice(1, -1);
      }
      if (key && process.env[key] === undefined) process.env[key] = val;
    }
  } catch (e) { /* нет .env — скажем об этом ниже */ }
})();

const KEY = (process.env.UNISENDER_API_KEY || '').trim();
if (!KEY) {
  console.error('\nВ .env нет строки UNISENDER_API_KEY — проверять нечего.');
  console.error('Запускать надо из папки с игрой: cd ~/Aliance-Generals\n');
  process.exit(2);
}

// Проверяем сам ключ на «мусор от копирования»: лишние пробелы, кавычки,
// перенос строки. Такое не видно глазом в nano, а ломает заголовок.
const clean = /^[A-Za-z0-9]+$/.test(KEY);
console.log(`\nКлюч: ${KEY.slice(0, 5)}…${KEY.slice(-3)} (длина ${KEY.length})`);
if (!clean) {
  console.log('⚠️  В ключе есть посторонние символы (пробел, кавычка, перенос).');
  console.log('    Обычно ключ Unisender — только латиница и цифры.');
}

// Площадки Unisender Go. Одна из них — «наша», на остальных нашего
// пользователя просто нет.
// UNISENDER_PROBE_HOSTS через запятую — только для самопроверки скрипта
// тестом (test/unisender.test.js). В работе не задаётся.
const HOSTS = (process.env.UNISENDER_PROBE_HOSTS || '')
  ? process.env.UNISENDER_PROBE_HOSTS.split(',').map((s) => s.trim()).filter(Boolean)
  : [
    // Универсальный адрес первым: он работает при любой площадке
    'https://goapi.unisender.ru',
    'https://go1.unisender.ru',
    'https://go2.unisender.ru',
  ];
const ANY = 'https://goapi.unisender.ru';
// Справочные методы: только читают, лимит писем не тратят. Пробуем
// несколько — если один метод у сервиса переименован, останутся другие,
// и мы не спутаем «нет такого метода» с «нет такого пользователя».
const METHODS = [
  '/ru/transactional/api/v1/domain/list.json',
  '/ru/transactional/api/v1/template/list.json',
];

async function call(host, method) {
  try {
    const res = await fetch(host + method, {
      method: 'POST',
      headers: { 'X-API-KEY': KEY, 'Content-Type': 'application/json' },
      body: JSON.stringify({ limit: 50, offset: 0 }),
    });
    const text = await res.text().catch(() => '');
    let parsed = null;
    try { parsed = JSON.parse(text); } catch (e) {}
    return { status: res.status, text, parsed };
  } catch (e) {
    return { status: 0, text: '', parsed: null, netError: e.message };
  }
}

// Главный признак «это не наша площадка» — сервис разобрал ключ, достал
// из него номер пользователя и не нашёл такого у себя.
function isUserNotFound(r) {
  const msg = String((r.parsed && (r.parsed.message || r.parsed.error)) || r.text || '');
  return /user with id/i.test(msg) && /not found/i.test(msg);
}

async function probe(host) {
  let last = null;
  for (const m of METHODS) {
    const r = await call(host, m);
    last = r;
    if (r.netError) return { host, ...r };
    // Ключ опознан — дальше пробовать нечего
    if (r.status === 200) return { host, ...r, recognized: true };
    // Пользователь не найден — тоже окончательный ответ для этой площадки
    if (isUserNotFound(r)) return { host, ...r, recognized: false };
    // Иначе (нет такого метода, нет прав на метод) — пробуем следующий
  }
  return { host, ...last, recognized: null };
}

(async () => {
  const working = [];

  for (const host of HOSTS) {
    const r = await probe(host);
    console.log(`\n── ${host} ──`);
    if (r.netError) {
      console.log('   ⛔ сеть недоступна:', r.netError);
      continue;
    }
    console.log('   HTTP', r.status);

    const p = r.parsed || {};
    if (r.recognized === true) {
      working.push(host);
      console.log('   ✅ КЛЮЧ РАБОТАЕТ на этом адресе.');
      if (Array.isArray(p.domains)) {
        console.log(`   Доменов в аккаунте: ${p.domains.length}`);
        for (const d of p.domains) {
          const good = d.domain_verified || d.verified;
          console.log(`     • ${d.domain || d.name || '?'}${good ? ' — подтверждён' : ' — НЕ подтверждён'}`);
        }
      }
      continue;
    }

    const msg = p.message || p.error || r.text.slice(0, 200) || '(пустой ответ)';
    if (r.recognized === false) {
      console.log('   ⛔ этой площадке ключ не принадлежит:', msg);
    } else {
      // Ни успеха, ни «user not found» — причина другая, показываем как есть
      console.log('   ⚠️  непонятный отказ:', msg);
    }
  }

  // Что советовать: адрес по умолчанию, если он работает; иначе
  // универсальный — он переживёт переезд аккаунта между площадками;
  // иначе любой рабочий.
  const winner = working.includes(HOSTS[0]) ? HOSTS[0]
    : (working.includes(ANY) ? ANY : (working[0] || null));

  console.log('\n' + '─'.repeat(56));
  if (winner) {
    console.log(`Рабочий адрес: ${winner}`);
    const others = working.filter((h) => h !== ANY);
    if (winner !== HOSTS[0]) {
      console.log('\nИгра стучится не туда. Допишите в .env:');
      console.log(`UNISENDER_URL=${winner}/ru/transactional/api/v1/email/send.json`);
      console.log('и перезапустите: pm2 restart generals-game');
      if (winner === ANY && others.length) {
        console.log(`(ваш аккаунт живёт на ${others.join(', ')}, но универсальный адрес надёжнее)`);
      }
    } else {
      console.log('Это адрес по умолчанию — менять в .env ничего не нужно.');
      console.log('Если письма всё равно не уходят, причина не в адресе сервиса.');
    }
  } else {
    console.log('Ключ не опознан НИ НА ОДНОМ адресе.');
    console.log('Значит дело не в адресе, а в самом ключе или аккаунте:');
    console.log('  • ключ скопирован не целиком или с лишним символом;');
    console.log('  • ключ отозван либо создан в другом аккаунте;');
    console.log('  • у ключа выключен доступ к API.');
    console.log('Создайте в панели Unisender новый ключ и впишите его в .env.');
  }
  console.log('─'.repeat(56) + '\n');
  process.exit(winner ? 0 : 1);
})().catch((e) => { console.error('Ошибка проверки:', e.message); process.exit(2); });
