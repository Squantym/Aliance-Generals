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
import type { User } from '../types';

const KEEP_LOGINS = 20;         // сколько последних входов помним
const KEEP_IPS = 30;            // сколько разных адресов помним

// ---------- Разбор строки браузера ----------
// Полный разбор User-Agent — отдельная наука, но для админки достаточно
// понять: телефон это или компьютер, какая система и какой браузер.
function parseDevice(ua: string): { kind: string; os: string; browser: string; label: string } {
  const s = String(ua || '');
  if (!s) return { kind: 'неизвестно', os: '—', browser: '—', label: 'неизвестное устройство' };

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

  return { kind, os, browser, label: `${kind}, ${os}, ${browser}` };
}

// ---------- Запись входа ----------
function recordLogin(user: any, ip: string, ua: string, kind?: string): void {
  if (!user) return;
  const now = Date.now();
  const dev = parseDevice(ua);
  const addr = String(ip || 'unknown');

  // Первый вход: запоминаем «паспорт» регистрации
  if (!user.access) user.access = {};
  const a = user.access;
  if (!a.regIp) {
    a.regIp = addr;
    a.regDevice = dev.label;
    a.regUa = String(ua || '').slice(0, 300);
    a.regAt = user.createdAt || now;
  }

  a.lastIp = addr;
  a.lastDevice = dev.label;
  a.lastUa = String(ua || '').slice(0, 300);
  a.lastAt = now;

  // История входов
  a.logins = a.logins || [];
  a.logins.unshift({ at: now, ip: addr, device: dev.label, kind: kind || 'вход' });
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

function touch(user: any, ip: string, ua: string): void {
  if (!user || !ip) return;
  const a = user.access || (user.access = {});
  const addr = String(ip);
  const dev = parseDevice(ua).label;
  const now = Date.now();

  const addrChanged = a.lastIp !== addr;
  const devChanged = a.lastDevice !== dev;
  const longAgo = !a.lastAt || (now - a.lastAt) > TOUCH_INTERVAL_MS;

  // Первый раз, смена адреса или устройства — полноценная запись
  if (!a.lastIp || addrChanged || devChanged) {
    recordLogin(user, addr, ua, !a.lastIp ? 'первый вход' : (addrChanged ? 'смена адреса' : 'смена устройства'));
    return;
  }
  if (longAgo) { recordLogin(user, addr, ua, 'сессия'); return; }

  // Ничего не изменилось — только освежаем время, без новой записи
  a.lastAt = now;
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
    },
    last: {
      at: a.lastAt || user.lastSeen || 0,
      ip: a.lastIp || '—',
      device: a.lastDevice || '—',
    },
    ips,
    logins: (a.logins || []).slice(0, KEEP_LOGINS),
  };
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
  for (const p of Object.values(allUsers)) {
    if (!p || (p as any).isBot) continue;
    for (const ip of Object.keys((((p as any).access) || {}).ips || {})) {
      if (ip === 'unknown') continue;
      (map[ip] = map[ip] || []).push({
        id: (p as any).id, name: (p as any).name, level: (p as any).level,
        account: accOf(p),
      });
    }
  }
  return Object.entries(map)
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
}

export = { recordLogin, touch, view, related, ipSummary, sameAccountChars, parseDevice, KEEP_LOGINS, TOUCH_INTERVAL_MS };
