// ═══════════════════════════════════════════════════════════════════
// src/services/access.ts — учёт входов: IP, устройства, история
//
// Зачем: без этих данных нельзя разобрать ни одну жалобу «меня взломали»
// и невозможно поймать мультоводов — человека с десятком аккаунтов с
// одного адреса.
//
// Что храним и сколько:
//   • адрес и устройство при регистрации — навсегда (это «паспорт» входа);
//   • последние 20 входов — для разбора недавних случаев;
//   • сводку по адресам: сколько раз и когда последний раз.
// Полную историю не копим: она разрастается и не нужна — старые записи
// теряют смысл, а базу раздувают.
//
// Данные видны только сотрудникам с правом «Игроки». Игрок своих
// адресов не видит: чужие тем более.
// ═══════════════════════════════════════════════════════════════════

import db = require('../core/db');
import u = require('../core/utils');
import type { User } from '../types';

const KEEP_LOGINS = 20;         // сколько последних входов помним
const KEEP_IPS = 30;            // сколько разных адресов помним

// ---------- Разбор строки браузера ----------
// Полный разбор User-Agent — отдельная наука, но для админки достаточно
// понять: телефон это или компьютер, какая система и какой браузер.
// Модель устройства из строки браузера.
// Android честно пишет модель: «Linux; Android 13; SM-A536E Build/...».
// Apple модель не сообщает принципиально — там определяем только тип.
const APPLE_NAMES: Record<string, string> = {
  iPhone: 'iPhone', iPad: 'iPad', iPod: 'iPod',
};
function parseModel(ua: string): string {
  const s = String(ua || '');
  // Android: модель идёт после версии системы, до «Build» или закрывающей скобки
  const m = /Android[^;)]*;\s*([^;)]+?)(?:\s+Build\/[^;)]*)?\)/i.exec(s);
  if (m) {
    let model = m[1].trim();
    // Отсекаем служебные пометки, которые не относятся к модели
    model = model.replace(/\s*(wv|Mobile|Tablet)\s*$/i, '').trim();
    if (model && !/^Android$/i.test(model) && model.length <= 40) return model;
  }
  for (const key of Object.keys(APPLE_NAMES)) if (s.includes(key)) return APPLE_NAMES[key];
  if (/Windows NT/i.test(s)) return 'ПК (Windows)';
  if (/Macintosh|Mac OS X/i.test(s)) return 'Mac';
  if (/CrOS/i.test(s)) return 'Chromebook';
  if (/Linux/i.test(s)) return 'ПК (Linux)';
  return '';
}

// hints — подсказки браузера (Client Hints). Chrome с версии 110 прячет
// модель в обычной строке, подставляя «Android 10; K», и настоящее
// название приходит только отдельным заголовком. Если подсказка есть —
// она главнее разбора строки.
function parseDevice(ua: string, hints?: any): { kind: string; os: string; browser: string; model: string; label: string } {
  const s = String(ua || '');
  if (!s) return { kind: 'неизвестно', os: '—', browser: '—', model: '', label: 'неизвестное устройство' };

  const isTablet = /iPad|Tablet|PlayBook|Silk/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s));
  const isMobile = !isTablet && /Mobi|Android|iPhone|iPod|Windows Phone/i.test(s);
  const kind = isTablet ? 'планшет' : (isMobile ? 'телефон' : 'компьютер');

  let os = 'неизвестно';
  if (/Windows NT 10|Windows NT 11/i.test(s)) os = 'Windows 10/11';
  else if (/Windows NT/i.test(s)) os = 'Windows';
  else if (/iPhone|iPad|iPod|iOS/i.test(s)) os = 'iOS';
  else if (/Android[ /]?([\d.]+)?/i.test(s)) {
    const m = /Android[ /]?([\d.]+)/i.exec(s);
    os = m ? 'Android ' + m[1] : 'Android';
  } else if (/Mac OS X/i.test(s)) os = 'macOS';
  else if (/CrOS/i.test(s)) os = 'ChromeOS';
  else if (/Linux/i.test(s)) os = 'Linux';

  // Порядок важен: Edge и Opera представляются Chrome, Chrome — Safari
  let browser = 'неизвестен';
  if (/YaBrowser\/([\d.]+)/i.test(s)) browser = 'Яндекс';
  else if (/Edg\/([\d.]+)/i.test(s)) browser = 'Edge';
  else if (/OPR\/([\d.]+)|Opera/i.test(s)) browser = 'Opera';
  else if (/SamsungBrowser/i.test(s)) browser = 'Samsung';
  else if (/Firefox\/([\d.]+)/i.test(s)) browser = 'Firefox';
  else if (/Chrome\/([\d.]+)/i.test(s)) browser = 'Chrome';
  else if (/Safari\/([\d.]+)/i.test(s)) browser = 'Safari';

  // Модель: сначала подсказка, потом разбор строки. «K» — заглушка
  // Chrome, её показывать бессмысленно.
  const hinted = String((hints && hints.model) || '').trim();
  const parsed = parseModel(s);
  const model = hinted || (/^(K|Android)$/i.test(parsed) ? '' : parsed);
  // Модель ставим первой — по ней устройство узнаётся быстрее всего.
  // Тип («телефон») повторять незачем, если модель уже о нём говорит.
  // Версия системы из подсказки точнее: в строке Chrome пишет «Android 10»
  // всем подряд независимо от настоящей версии
  const hintedVer = String((hints && hints.platformVersion) || '').trim();
  const hintedPlat = String((hints && hints.platform) || '').trim();
  const osFinal = (hintedPlat && hintedVer) ? `${hintedPlat} ${hintedVer.split('.')[0]}` : os;
  const parts = model ? [model, osFinal, browser] : [kind, osFinal, browser];
  return { kind, os: osFinal, browser, model, label: parts.join(', ') };
}

// ═══ УСТРОЙСТВА ═══════════════════════════════════════════════════
// Опознание устройства строится на трёх вещах: разбор строки браузера
// (модель, система, браузер), отпечаток, который присылает сам клиент
// (экран, часовой пояс, язык, ядра — см. public/js/api.js), и метка
// браузера — случайная строка, которую игра хранит в памяти браузера.
//
// Почему одной строки браузера мало: у половины игроков там ровно
// «ПК (Windows), Windows 10/11, Chrome» — три разных человека выглядят
// одним устройством, и вопрос «кто ещё заходил с этой машины» теряет
// смысл. Отпечаток их различает: одинаковые экран, пояс и число ядер
// у случайных людей совпадают редко. А метка различает даже владельцев
// одинаковых телефонов — у них совпадает и отпечаток.
//
// Чем это НЕ является: ни отпечаток, ни метка не привязаны к человеку.
// Метка исчезает при очистке данных браузера, отпечаток — при смене
// браузера или экрана. Совпадение — повод посмотреть внимательнее, а не
// доказательство. Панель говорит об этом прямо.
const KEEP_DEVICES = 20;        // сколько разных устройств помним
const KEEP_SECURITY = 60;       // сколько событий безопасности помним
const KEEP_DIDS = 5;            // сколько меток браузера помним на устройство
const DID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function shortHash(s: string): string {
  // Короткий устойчивый ключ. Криптостойкость не нужна: это опознание
  // строки, а не защита, — поэтому обычный sha1 и первые 12 символов.
  return require('crypto').createHash('sha1').update(String(s)).digest('hex').slice(0, 12);
}

// Ключ устройства: разбор строки браузера + отпечаток клиента.
// Пустой отпечаток (старый клиент, запрос без него) не мешает —
// устройство просто опознаётся грубее, по одной строке браузера.
function deviceKey(ua: string, hints?: any, fp?: string): string {
  const d = parseDevice(ua, hints);
  return shortHash([d.kind, d.os, d.browser, d.model, String(fp || '')].join('~'));
}

function rememberDid(d: any, did?: string): boolean {
  const v = String(did || '');
  if (!DID_RE.test(v)) return false;
  d.dids = Array.isArray(d.dids) ? d.dids : [];
  if (d.dids.indexOf(v) >= 0) return false;
  d.dids.push(v);
  while (d.dids.length > KEEP_DIDS) d.dids.shift();
  return true;
}

// ═══ ЖУРНАЛ БЕЗОПАСНОСТИ ══════════════════════════════════════════
// Отдельная лента по КАЖДОМУ аккаунту: смена пароля, смена почты, вход
// с нового устройства, включение 2FA, принудительный выброс из кабинета.
// Раньше это лежало вперемешку в общем журнале действий, где на одну
// смену пароля приходятся тысячи строк «купил технику», и собрать
// картину по одному игроку было нечем.
//
// Игрок свой журнал не видит и стереть его не может — это разбор
// спорных случаев, а не настройка профиля.
function securityEvent(user: any, kind: string, detail?: string, ip?: string, device?: string): void {
  if (!user) return;
  const a = user.access || (user.access = {});
  a.security = a.security || [];
  a.security.unshift({
    at: Date.now(),
    kind: String(kind || '').slice(0, 40),
    detail: String(detail || '').slice(0, 200),
    ip: String(ip || a.lastIp || '').slice(0, 60),
    device: String(device || a.lastDevice || '').slice(0, 120),
  });
  if (a.security.length > KEEP_SECURITY) a.security.length = KEEP_SECURITY;
  db.markUser(user.id);
}

// ---------- Запись входа ----------

// ── Годится ли адрес для опознания игрока ─────────────────────────
// Loopback и внутренние диапазоны не опознают никого: если прокси не
// передаёт настоящий адрес, сервер видит 127.0.0.1 у ВСЕХ. Раньше это
// попадало в сводку как «36 аккаунтов с одного адреса» — и выглядело
// как готовый список мультоводов. По такому «доказательству» можно
// забанить полсервера невиновных; проверка обязана молчать, когда ей
// нечего сказать.
function isIdentifyingIp(ip: string): boolean {
  // Правило одно на весь проект, см. core/utils.isPublicIp.
  return u.isPublicIp(ip);
}


function recordLogin(user: any, ip: string, ua: string, kind?: string, hints?: any, fp?: string, did?: string): void {
  if (!user) return;
  const now = Date.now();
  const dev = parseDevice(ua, hints);
  const addr = String(ip || 'unknown');
  const key = deviceKey(ua, hints, fp);

  // Первый вход: запоминаем «паспорт» регистрации
  if (!user.access) user.access = {};
  const a = user.access;
  if (!a.regIp) {
    a.regIp = addr;
    a.regDevice = dev.label;
    a.regUa = String(ua || '').slice(0, 300);
    a.regAt = user.createdAt || now;
    a.regDeviceKey = key;
    a.regFp = String(fp || '').slice(0, 200);
  }

  a.lastIp = addr;
  a.lastDevice = dev.label;
  a.lastUa = String(ua || '').slice(0, 300);
  a.lastAt = now;
  if (did && DID_RE.test(String(did))) a.lastDid = String(did);

  // ── Сводка по устройствам ──────────────────────────────────────
  // Именно она отвечает на вопрос «с чего заходили в этот аккаунт»:
  // история входов держит последние 20 записей и у активного игрока
  // выметается за пару дней, а устройство должно помниться, даже если
  // человек заходил с него полгода назад.
  a.devices = a.devices || {};
  const wasKnown = !!a.devices[key];
  const d = a.devices[key] || {
    key, label: dev.label, kind: dev.kind, os: dev.os, browser: dev.browser,
    model: dev.model, fp: String(fp || '').slice(0, 200),
    count: 0, firstAt: now, lastAt: now, ips: {}, dids: [],
  };
  d.count += 1;
  d.lastAt = now;
  d.label = dev.label;                       // название могло уточниться подсказками
  if (fp && !d.fp) d.fp = String(fp).slice(0, 200);
  rememberDid(d, did);
  d.ips[addr] = (d.ips[addr] || 0) + 1;      // с каких адресов заходили именно с него
  a.devices[key] = d;
  const devKeys = Object.keys(a.devices);
  if (devKeys.length > KEEP_DEVICES) {
    // Устройство регистрации не вытесняем никогда — по нему связывают
    // аккаунт с его создателем.
    const removable = devKeys.filter((k) => k !== a.regDeviceKey);
    removable.sort((x, y) => a.devices[x].lastAt - a.devices[y].lastAt);
    for (const k of removable.slice(0, devKeys.length - KEEP_DEVICES)) delete a.devices[k];
  }

  // Вход с устройства, которого раньше не было, — событие безопасности.
  // Первый вход в жизни аккаунта таким событием не считаем: там и так
  // стоит «регистрация», и дублировать её незачем.
  if (!wasKnown && Object.keys(a.devices).length > 1) {
    securityEvent(user, 'new_device', dev.label, addr, dev.label);
  }

  // История входов
  a.logins = a.logins || [];
  a.logins.unshift({ at: now, ip: addr, device: dev.label, kind: kind || 'вход', deviceKey: key });
  if (a.logins.length > KEEP_LOGINS) a.logins.length = KEEP_LOGINS;

  // Сводка по адресам: сколько раз заходил с каждого
  a.ips = a.ips || {};
  const rec = a.ips[addr] || { count: 0, firstAt: now, lastAt: now };
  rec.count += 1;
  rec.lastAt = now;
  a.ips[addr] = rec;
  const keys = Object.keys(a.ips);
  if (keys.length > KEEP_IPS) {
    // Выбрасываем самые старые по последнему входу, но АДРЕС РЕГИСТРАЦИИ
    // не трогаем никогда: именно он связывает аккаунт с его создателем и
    // по нему ищут мультоводов. Без этой защиты активный игрок за месяц
    // вытеснял свой же «паспорт» обычными входами.
    const removable = keys.filter((k) => k !== a.regIp);
    removable.sort((x, y) => a.ips[x].lastAt - a.ips[y].lastAt);
    const excess = keys.length - KEEP_IPS;
    for (const k of removable.slice(0, excess)) delete a.ips[k];
  }

  db.markUser(user.id);
}

// ---------- Отметка активности ----------
// Вызывается на КАЖДОМ запросе игрока. Полноценную запись делаем только
// когда есть что записать: сменился адрес, сменилось устройство или
// прошёл час. Иначе история из 20 входов забивалась бы за минуту одним
// и тем же, а база — лишними записями.
const TOUCH_INTERVAL_MS = 60 * 60 * 1000;

function touch(user: any, ip: string, ua: string, hints?: any, fp?: string, did?: string): void {
  if (!user || !ip) return;
  const a = user.access || (user.access = {});
  const addr = String(ip);
  const dev = parseDevice(ua, hints).label;
  const now = Date.now();

  const addrChanged = a.lastIp !== addr;
  const devChanged = a.lastDevice !== dev;
  // Устройство с ТАКИМ ЖЕ названием, но другим отпечатком — это другое
  // устройство. Без этой проверки два разных компьютера с одинаковым
  // «Chrome на Windows 10» сливались бы в одну запись.
  const key = fp ? deviceKey(ua, hints, fp) : '';
  const newFingerprint = !!fp && !((a.devices || {})[key]);
  const longAgo = !a.lastAt || (now - a.lastAt) > TOUCH_INTERVAL_MS;

  // Первый раз, смена адреса или устройства — полноценная запись
  if (!a.lastIp || addrChanged || devChanged || newFingerprint) {
    recordLogin(user, addr, ua,
      !a.lastIp ? 'первый вход' : (addrChanged ? 'смена адреса' : 'смена устройства'), hints, fp, did);
    return;
  }
  if (longAgo) { recordLogin(user, addr, ua, 'сессия', hints, fp, did); return; }

  // Ничего не изменилось — только освежаем время, без новой записи.
  // Метку браузера дописываем сразу: у игроков, вошедших до её
  // появления, иначе она попала бы в устройство только через час.
  a.lastAt = now;
  const known = key ? (a.devices || {})[key] : null;
  if (known && rememberDid(known, did)) {
    a.lastDid = String(did);
    db.markUser(user.id);
  }
}

// ---------- Сведения для админки ----------
function view(user: any) {
  const a = (user && user.access) || {};
  const ips = Object.entries(a.ips || {})
    .map(([ip, v]: any) => ({ ip, count: v.count, firstAt: v.firstAt, lastAt: v.lastAt }))
    .sort((x, y) => y.lastAt - x.lastAt);
  return {
    email: user.email || '',
    emailVerified: !!user.emailVerified,
    registered: {
      at: a.regAt || user.createdAt || 0,
      ip: a.regIp || '—',
      device: a.regDevice || '—',
      deviceKey: a.regDeviceKey || '',
    },
    last: {
      at: a.lastAt || user.lastSeen || 0,
      ip: a.lastIp || '—',
      device: a.lastDevice || '—',
    },
    ips,
    logins: (a.logins || []).slice(0, KEEP_LOGINS),
    // Устройства — свежие сверху. Адреса внутри каждого тоже отдаём:
    // вопрос «с какого устройства и с какого адреса заходили» без этой
    // связки не отвечается — сводка адресов и сводка устройств по
    // отдельности не говорят, что с чем сочеталось.
    devices: Object.values(a.devices || {})
      .map((d: any) => ({
        key: d.key, label: d.label, kind: d.kind, os: d.os, browser: d.browser,
        model: d.model || '', count: d.count, firstAt: d.firstAt, lastAt: d.lastAt,
        isReg: d.key === a.regDeviceKey,
        fp: d.fp || '',
        dids: Array.isArray(d.dids) ? d.dids : [],
        // Бан по устройству без отпечатка и метки задел бы всех с таким же браузером
        canBan: !!(d.fp || (Array.isArray(d.dids) && d.dids.length)),
        ips: Object.entries(d.ips || {})
          .map(([ip, n]: any) => ({ ip, count: n }))
          .sort((x, y) => y.count - x.count),
      }))
      .sort((x: any, y: any) => y.lastAt - x.lastAt),
    security: (a.security || []).slice(0, KEEP_SECURITY),
  };
}

// ── Кто ещё заходил с этого устройства ────────────────────────────
// Сигнал сильнее совпадения адреса: за одним адресом сидит весь дом
// или целый мобильный оператор, а за одним устройством с точностью до
// экрана, пояса и числа ядер — как правило, один человек. «Как
// правило» — не «всегда»: общий компьютер в семье или интернет-клуб
// дают то же совпадение честно.
function byDevice(key: string, allUsers: Record<string, any>) {
  const k = String(key || '');
  if (!k) return [];
  const out: any[] = [];
  for (const p of Object.values(allUsers || {})) {
    if (!p || (p as any).isBot) continue;
    const d = (((p as any).access || {}).devices || {})[k];
    if (!d) continue;
    out.push({
      id: (p as any).id, name: (p as any).name, level: (p as any).level || 1,
      email: (p as any).email || '',
      count: d.count, firstAt: d.firstAt, lastAt: d.lastAt,
      isReg: ((p as any).access || {}).regDeviceKey === k,
      ips: Object.keys(d.ips || {}),
    });
  }
  return out.sort((x, y) => y.lastAt - x.lastAt);
}

// ---------- Поиск связанных аккаунтов ----------
// Главное, ради чего это всё: увидеть, кто ещё заходит с тех же адресов.
// Совпадение адреса не доказывает мультовода — за одним домашним
// роутером может сидеть семья, а мобильные операторы выдают общий адрес
// сотням абонентов. Поэтому показываем факты, а вывод делает человек.
function related(user: any, allUsers: Record<string, any>) {
  const mine = Object.keys(((user && user.access) || {}).ips || {});
  if (!mine.length) return [];
  const out: any[] = [];
  const acc = (() => { try { return require('./account'); } catch (e) { return null; } })();
  for (const p of Object.values(allUsers)) {
    if (!p || p.id === user.id || (p as any).isBot) continue;
    // Свои же персонажи показываются отдельным списком — здесь они
    // только зашумляли бы выдачу
    if (acc && acc.sameAccount(user, p)) continue;
    const theirs = Object.keys((((p as any).access) || {}).ips || {});
    const shared = mine.filter((ip) => theirs.includes(ip) && ip !== 'unknown');
    if (!shared.length) continue;
    out.push({
      id: (p as any).id,
      name: (p as any).name,
      level: (p as any).level,
      email: (p as any).email || '',
      sharedIps: shared,
      lastSeen: (p as any).lastSeen || 0,
    });
  }
  return out.sort((a, b) => b.sharedIps.length - a.sharedIps.length).slice(0, 50);
}

// Связанные персонажи одного аккаунта (кабинет). Это законная связь —
// игра сама разрешает три персонажа. Показываем отдельно от совпадений
// по адресу, чтобы администратор не путал разрешённое с подозрительным.
function sameAccountChars(user: any, allUsers: Record<string, any>) {
  try {
    const acc = require('./account');
    return acc.charactersOf(user)
      .filter((p: any) => p.id !== user.id)
      .map((p: any) => ({
        id: p.id, name: p.name, level: p.level,
        lastSeen: p.lastSeen || 0, banned: !!p.banned,
      }));
  } catch (e) { return []; }
}

// Сколько аккаунтов сидит на одном адресе — сводка по всей игре
function ipSummary(allUsers: Record<string, any>, minAccounts?: number) {
  const min = Math.max(2, minAccounts || 2);
  const accOf = (p: any) => { try { return require('./account').accountIdOf(p); } catch (e) { return p.id; } };
  const map: Record<string, any[]> = {};
  // Считаем, скольким игрокам сервер записал непригодный адрес: по этому
  // числу видно, что прокси настроен неверно, — и панель скажет об этом
  // прямо, вместо того чтобы показать список «подозреваемых».
  let blindPlayers = 0, seenPlayers = 0;
  for (const p of Object.values(allUsers)) {
    if (!p || (p as any).isBot) continue;
    seenPlayers++;
    const ips = Object.keys((((p as any).access) || {}).ips || {});
    if (ips.length && !ips.some(isIdentifyingIp)) blindPlayers++;
    for (const ip of ips) {
      // Пропускаем не только 'unknown', но и любой адрес, который никого
      // не опознаёт. Раньше сюда проваливался 127.0.0.1 от прокси.
      if (!isIdentifyingIp(ip)) continue;
      (map[ip] = map[ip] || []).push({
        id: (p as any).id, name: (p as any).name, level: (p as any).level,
        account: accOf(p),
      });
    }
  }
  const groups = Object.entries(map)
    .map(([ip, list]) => {
      // Считаем РАЗНЫЕ аккаунты, а не персонажей: три своих персонажа с
      // одного адреса — это разрешённый кабинет, а не мультоводство.
      // Без этого различия список забило бы законными записями.
      const accounts = new Set(list.map((x: any) => x.account));
      return { ip, count: accounts.size, chars: list.length, accounts: accounts.size, players: list };
    })
    .filter((g) => g.accounts >= min)
    .sort((a, b) => b.accounts - a.accounts)
    .slice(0, 100);

  return {
    groups,
    // Прокси не передаёт адреса: у большинства игроков записан только
    // внутренний адрес сервера. Проверка на мультоводов в таком виде
    // бессмысленна, и панель обязана сказать это, а не молчать.
    blind: blindPlayers,
    players: seenPlayers,
    proxyBroken: seenPlayers > 0 && blindPlayers >= Math.max(3, Math.round(seenPlayers * 0.5)),
  };
}

// ═══ СРАВНЕНИЕ ИГРОКОВ ═════════════════════════════════════════════
// «Это один человек?» — главный вопрос разбора мультоводства. Отвечаем
// фактами по силе: общая метка браузера или устройство — почти наверняка
// одна машина; общий отпечаток — похожее железо; общий адрес — возможно,
// одна сеть. Решение принимает сотрудник, а не функция.
function netOf(p: any) {
  const a = (p && p.access) || {};
  let staff = false;
  try { staff = !!require('./roles').roleOf(p); } catch (e) { staff = false; }
  return {
    id: p.id, name: p.name, level: p.level || 1, staff,
    ips: Object.entries(a.ips || {})
      .map(([ip, v]: any) => ({ ip, count: v.count, lastAt: v.lastAt, identifying: isIdentifyingIp(ip) }))
      .sort((x, y) => y.lastAt - x.lastAt),
    devices: Object.values(a.devices || {})
      .map((d: any) => ({
        key: d.key, label: d.label, fp: d.fp || '', dids: Array.isArray(d.dids) ? d.dids : [],
        count: d.count, lastAt: d.lastAt,
        canBan: !!(d.fp || (Array.isArray(d.dids) && d.dids.length)),
      }))
      .sort((x: any, y: any) => y.lastAt - x.lastAt),
  };
}

function compare(list: any[]) {
  const nets = list.map(netOf);
  const push = (map: Record<string, any>, k: string, n: any, extra: any) => {
    if (!k) return;
    const box = map[k] || (map[k] = { who: new Map() });
    if (!box.who.has(n.id)) box.who.set(n.id, Object.assign({ id: n.id, name: n.name }, extra));
  };
  const ipMap: Record<string, any> = {}, didMap: Record<string, any> = {}, keyMap: Record<string, any> = {}, fpMap: Record<string, any> = {};
  for (const n of nets) {
    for (const x of n.ips) if (x.identifying) push(ipMap, x.ip, n, { count: x.count, lastAt: x.lastAt });
    for (const d of n.devices) {
      for (const did of d.dids) push(didMap, did, n, { key: d.key, label: d.label, canBan: d.canBan });
      // Ключ без отпечатка — это одна лишь строка браузера: совпадает у
      // тысяч людей и уликой не является
      if (d.fp) push(keyMap, d.key, n, { key: d.key, label: d.label, canBan: d.canBan });
      if (d.fp) push(fpMap, d.fp, n, { key: d.key, label: d.label, canBan: d.canBan });
    }
  }
  const shared = (map: Record<string, any>) => Object.entries(map)
    .map(([k, v]: any) => ({ k, who: Array.from(v.who.values()) }))
    .filter((x: any) => x.who.length >= 2);

  const sharedIps = shared(ipMap).map((x: any) => ({ ip: x.k, who: x.who }));
  const sharedDevices = [
    ...shared(didMap).map((x: any) => ({ by: 'did', title: 'Общая метка браузера', who: x.who })),
    ...shared(keyMap).map((x: any) => ({ by: 'key', title: 'Общее устройство', who: x.who })),
    ...shared(fpMap).map((x: any) => ({ by: 'fp', title: 'Общий отпечаток (экран, пояс, ядра)', who: x.who })),
  ];

  const has = (items: any[], a: string, b: string) => items.filter((x: any) =>
    x.who.some((w: any) => w.id === a) && x.who.some((w: any) => w.id === b)).length;
  const pairs: any[] = [];
  for (let i = 0; i < nets.length; i++) {
    for (let j = i + 1; j < nets.length; j++) {
      const A = nets[i].id, B = nets[j].id;
      const ips = has(sharedIps, A, B);
      const dids = has(sharedDevices.filter((x) => x.by === 'did'), A, B);
      const keys = has(sharedDevices.filter((x) => x.by === 'key'), A, B);
      const fps = has(sharedDevices.filter((x) => x.by === 'fp'), A, B);
      let level = 'none', verdict = 'Пересечений нет';
      if (dids || keys) { level = 'high'; verdict = 'Общее устройство — почти наверняка один человек (или общий компьютер в семье)'; }
      else if (fps) { level = 'mid'; verdict = 'Совпало железо: экран, пояс, ядра. Бывает у одинаковых моделей телефонов'; }
      else if (ips) { level = 'low'; verdict = 'Только общий адрес — возможно, одна сеть: дом, работа, мобильный оператор'; }
      pairs.push({ a: nets[i].name, b: nets[j].name, ips, dids, keys, fps, level, verdict });
    }
  }
  return { players: nets, sharedIps, sharedDevices, pairs };
}

// Сравнение по строке из панели: «позывной, позывной, id»
function compareByQuery(whoRaw: string, allUsers: Record<string, any>) {
  const tokens = String(whoRaw || '').split(/[,;\n]+/).map((s) => s.trim()).filter(Boolean).slice(0, 6);
  const all = Object.values(allUsers || {}).filter((p: any) => p && !p.isBot);
  const found: any[] = [];
  const notFound: string[] = [];
  for (const t of tokens) {
    const low = t.toLowerCase();
    const p: any = (allUsers || {})[t] || all.find((x: any) => String(x.name || '').toLowerCase() === low);
    if (p && !p.isBot) { if (!found.some((x) => x.id === p.id)) found.push(p); }
    else notFound.push(t);
  }
  if (found.length < 2) {
    throw new u.ApiError('Укажите хотя бы двух игроков — позывные через запятую'
      + (notFound.length ? `. Не найдены: ${notFound.join(', ')}` : ''));
  }
  return Object.assign(compare(found), { notFound });
}

// Устройства, с которых заходят РАЗНЫЕ аккаунты — сводка по всей игре.
// Свои персонажи одного кабинета не считаются: это разрешено.
function deviceGroups(allUsers: Record<string, any>, minAccounts?: number) {
  const min = Math.max(2, minAccounts || 2);
  const accOf = (p: any) => { try { return require('./account').accountIdOf(p); } catch (e) { return p.id; } };
  const byDid: Record<string, any> = {}, byKey: Record<string, any> = {};
  const add = (map: Record<string, any>, k: string, p: any, d: any) => {
    const g = map[k] || (map[k] = { label: d.label, players: new Map(), accounts: new Set() });
    if (!g.players.has(p.id)) g.players.set(p.id, { id: p.id, name: p.name, level: p.level || 1, key: d.key, canBan: !!(d.fp || (d.dids || []).length) });
    g.accounts.add(accOf(p));
  };
  for (const p of Object.values(allUsers || {})) {
    if (!p || (p as any).isBot) continue;
    for (const d of Object.values((((p as any).access) || {}).devices || {}) as any[]) {
      for (const did of (Array.isArray(d.dids) ? d.dids : [])) add(byDid, did, p, d);
      if (d.fp) add(byKey, d.key, p, d);
    }
  }
  const seen = new Set<string>();
  const out: any[] = [];
  for (const [by, map] of [['did', byDid], ['key', byKey]] as Array<[string, Record<string, any>]>) {
    for (const g of Object.values(map)) {
      if (g.accounts.size < min) continue;
      const players = Array.from(g.players.values());
      // Та же компания, найденная и по метке, и по устройству, — одна строка
      const sig = players.map((x: any) => x.id).sort().join(',');
      if (seen.has(sig)) continue;
      seen.add(sig);
      out.push({ by, label: g.label, accounts: g.accounts.size, players });
    }
  }
  return { groups: out.sort((a, b) => b.accounts - a.accounts).slice(0, 100) };
}

export = {
  recordLogin, touch, view, related, ipSummary, isIdentifyingIp, sameAccountChars,
  parseDevice, parseModel, deviceKey, byDevice, securityEvent,
  compare, compareByQuery, deviceGroups,
  KEEP_LOGINS, KEEP_DEVICES, KEEP_SECURITY, TOUCH_INTERVAL_MS,
};
