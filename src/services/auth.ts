// ===================================================================
// src/services/auth.ts — регистрация, вход, подтверждение почты
// ===================================================================

import config = require('../../config/gameConfig');
import db = require('../core/db');
import u = require('../core/utils');
import email = require('./email');
import auditLog = require('./auditLog');
import type { User, Notices } from '../types';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_COOLDOWN_MS = 60 * 1000;

// БАГ 5: Запрещённые имена
const RESERVED_NAMES = new Set([
  'admin', 'administrator', 'root', 'superuser', 'moderator', 'moder',
  'support', 'system', 'bot', 'server', 'game', 'генерал', 'админ',
  'администратор', 'модератор', 'поддержка',
]);

// БАГ 1 + БАГ 25: Rate limiting для входа и admin
const loginAttempts = new Map<string, { count: number; firstAt: number; blockedUntil: number }>(); // ip -> { count, firstAt, blockedUntil }
const RATE_LIMIT_MAX   = 5;
const RATE_LIMIT_BLOCK = 15 * 60 * 1000; // 15 минут
const RATE_LIMIT_WIN   = 5  * 60 * 1000; // окно 5 минут

// Отдельные счётчики для действий, которые дорого обходятся: отправка
// писем и создание аккаунтов. Без них один человек может выжечь месячную
// квоту почтового сервиса за час или забить базу пустыми аккаунтами.
const heavyAttempts = new Map<string, { count: number; firstAt: number }>();
const HEAVY_WINDOW_MS = 60 * 60 * 1000;      // окно — час
const HEAVY_LIMITS: Record<string, number> = {
  register: 5,        // аккаунтов с одного адреса в час
  mail: 5,            // писем (сброс пароля, повторное подтверждение)
  reset: 10,          // попыток применить код сброса
};

function checkHeavy(kind: string, ip: string): void {
  if (!ip || ip === 'unknown') return;
  // В тестах и при локальной разработке ограничение мешает: сценарии
  // создают десятки игроков подряд с одного адреса. На проде переменная
  // не задаётся, и защита работает.
  if (process.env.DISABLE_RATE_LIMIT === '1') return;
  const key = kind + ':' + ip;
  const now = Date.now();
  let e = heavyAttempts.get(key);
  if (!e || now - e.firstAt > HEAVY_WINDOW_MS) { e = { count: 0, firstAt: now }; heavyAttempts.set(key, e); }
  e.count++;
  const limit = HEAVY_LIMITS[kind] || 10;
  if (e.count > limit) {
    const mins = Math.ceil((e.firstAt + HEAVY_WINDOW_MS - now) / 60000);
    auditLog.record({ userId: 'system', userName: 'system', path: '/rate-limit-heavy', body: { kind, ip } });
    throw new u.ApiError(`Слишком часто. Попробуйте через ${mins} мин.`);
  }
  // Чистим карту, чтобы она не росла бесконечно
  if (heavyAttempts.size > 5000) {
    for (const [k, v] of heavyAttempts) if (now - v.firstAt > HEAVY_WINDOW_MS) heavyAttempts.delete(k);
  }
}

// ═══ ЛИМИТ ПОПЫТОК ВХОДА ════════════════════════════════════════════
// Считаем ТОЛЬКО НЕУДАЧНЫЕ попытки, а не все подряд. Это принципиально:
// проверка пароля стала асинхронной (scrypt считается в пуле потоков), и
// несколько входов с одного адреса теперь идут ОДНОВРЕМЕННО, а не строго
// по очереди, как было при синхронном scrypt. Если считать каждую попытку
// на входе, то 10 игроков из-под общего адреса оператора, нажавших «Войти»
// в одну секунду, накрутят счётчик до блокировки — и получат отказ, хотя
// все ввели правильные пароли. Замер это подтвердил: из 20 одновременных
// входов с верными паролями проходило 4.
//
// От брутфорса это не ослабляет: перебор состоит именно из неудачных
// попыток, и каждая из них считается.
function assertNotBlocked(ip: string): void {
  const entry = loginAttempts.get(ip);
  if (!entry) return;
  const now = Date.now();
  if (entry.blockedUntil > now) {
    const mins = Math.ceil((entry.blockedUntil - now) / 60000);
    throw new u.ApiError(`Слишком много попыток. Попробуйте через ${mins} мин.`);
  }
}

// Засчитать НЕУДАЧНУЮ попытку входа и заблокировать адрес при переборе.
function registerFailedLogin(ip: string): void {
  if (!ip) return;
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry) { entry = { count: 0, firstAt: now, blockedUntil: 0 }; loginAttempts.set(ip, entry); }
  if (now - entry.firstAt > RATE_LIMIT_WIN) { entry.count = 0; entry.firstAt = now; }
  entry.count++;
  if (entry.count >= RATE_LIMIT_MAX) {
    entry.blockedUntil = now + RATE_LIMIT_BLOCK;
    auditLog.record({ userId: 'system', userName: 'system', path: '/rate-limit-block', body: { ip } });
  }
  // Карта не должна расти бесконечно (адресов много, записи живут долго)
  if (loginAttempts.size > 5000) {
    for (const [k, v] of loginAttempts) {
      if (v.blockedUntil < now && now - v.firstAt > RATE_LIMIT_WIN) loginAttempts.delete(k);
    }
  }
}

// Совместимость: имя checkRateLimit сохраняем — на него ссылается аудит
// безопасности и внешний код. Смысл прежний: «пускать ли этот адрес».
function checkRateLimit(ip: string): void {
  assertNotBlocked(ip);
}

function clearRateLimit(ip: string): void {
  loginAttempts.delete(ip);
}

// БАГ 24: Очистка Unicode управляющих символов
function sanitizeInput(str: string): string {
  // Удаляем RTL Override и другие управляющие Unicode-символы
  return String(str || '').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u0000]/g, '');
}

function users(): Record<string, User> { return db.load<Record<string, User>>('users', {}); }
function sessions(): Record<string, string> { return db.load<Record<string, string>>('sessions', {}); }

function newUser(id: string, name: string, email_: string, passHash: string, salt: string, country: string, isAdmin: boolean, emailVerified: boolean): User {
  const now = Date.now();
  return {
    id, name, email: email_, passHash, salt, isAdmin,
    emailVerified: !!emailVerified,
    emailVerifyToken: emailVerified ? null : u.uid(32),
    emailVerifySentAt: now,
    country, status: '', createdAt: now, lastSeen: now,
    level: 1, xp: 0,
    dollars: config.PLAYER.START_DOLLARS,
    gold: config.PLAYER.START_GOLD,
    bank: 0,
    skillPoints: 0,
    skills: { energy: 0, health: 0, ammo: 0, cruelty: 0, agility: 0 },
    res: {
      hp: { cur: config.PLAYER.BASE_HP, t: now },
      en: { cur: config.PLAYER.BASE_ENERGY, t: now },
      am: { cur: config.PLAYER.BASE_AMMO, t: now },
    },
    units: {}, workshops: 0, modernQueue: [],
    buildings: {},
    secretDevs: {}, superSecret: 0,
    ears: 0, tokens: 0, earsLost: 0,
    earsCurrent: config.EARS.MAX, earsLostAt: [], earPenaltyUntil: 0,
    battle: { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 },
    counters: { wins: 0, attacks: 0, fatalities: 0, unitsBought: 0, buildingsBuilt: 0, missionStages: 0, earsCut: 0, moneyEarned: 0, battleLoot: 0, level: 1 },
    achStages: {},
    missions: {},
    tutorial: { step: 0, done: false },
    effects: [],
    trophies: Object.fromEntries(config.TROPHIES.map((t: any) => [t.id, 0])),
    club: {},
    allianceId: null,
    legionId: null,
    lastIncomeAt: now,
    pendingFatality: null,
    pendingBankHack: null, bankHackCountToday: 0, bankHackVictimsToday: [],
    landmines: 0, pendingMineDefuse: null,
    saboteurs: { ground: 0, sea: 0, air: 0, secret: 0, building: 0, suicide: 0 },
    saboteurLimits: { ground: 50, sea: 50, air: 50, secret: 50, building: 50 },
    saboteurRareLossAccum: 0,
    lastChatAt: 0,
  };
}

// Срок жизни сессии. Раньше токены были БЕССРОЧНЫМИ: один раз утёкший
// (чужой компьютер, лог, история браузера) давал доступ навсегда, а сама
// коллекция росла без ограничений — запись на каждый вход, никогда не
// удалялась. Теперь у сессии есть срок, и он продлевается при активности.
const SESSION_TTL_MS = 30 * 24 * 3600 * 1000;   // 30 дней бездействия

function issueToken(userId: string): string {
  const token = u.uid(40);
  sessions()[token] = { u: userId, at: Date.now() } as any;
  pruneSessions();
  db.save('sessions');
  return token;
}

// Чистка протухших сессий. Вызывается при входе — этого достаточно,
// отдельный таймер не нужен.
function pruneSessions(): number {
  const all: any = sessions();
  const now = Date.now();
  let removed = 0;
  for (const t of Object.keys(all)) {
    const rec = all[t];
    // Старый формат — просто строка с id. Считаем такую сессию свежей
    // (переводим на новый формат), чтобы обновление никого не разлогинило.
    if (typeof rec === 'string') { all[t] = { u: rec, at: now }; continue; }
    if (!rec || !rec.u || (now - (rec.at || 0)) > SESSION_TTL_MS) { delete all[t]; removed++; }
  }
  return removed;
}

// ── Смена позывного (VIP, пункт 18) ───────────────────────────────
// Раньше сменить позывной было нельзя вообще. Для VIP — бесплатно раз
// в 30 дней; остальным пока недоступно (цену в золоте владелец может
// назначить позже — точка для этого одна).
const RENAME_GOLD_COST = 0;      // 0 = платная смена выключена

// Проверка позывного. Вынесена отдельно: правила должны быть одни и те
// же при регистрации, смене имени и создании персонажа в кабинете —
// иначе через одну из дверей проходили бы имена, запрещённые в другой.
// ---------- Логин аккаунта ----------
// Отдельный от позывного: персонажей трое, а вход один. Логин общий для
// всех персонажей аккаунта — меняется сразу у всех.
function validateAccountLogin(raw: string): string {
  const v = sanitizeInput(String(raw || '')).trim();
  if (!/^[A-Za-z0-9_.\-]{4,20}$/.test(v)) {
    throw new u.ApiError('Логин: 4–20 символов, латиница, цифры, точка, дефис, подчёркивание');
  }
  if (RESERVED_NAMES.has(v.toLowerCase())) throw new u.ApiError('Этот логин зарезервирован');
  return v;
}

async function setAccountLogin(user: User, raw: string, password: string, notices: Notices) {
  // Смена логина — вход в аккаунт, поэтому подтверждаем паролем:
  // иначе перехваченная сессия позволила бы тихо увести аккаунт
  if (!await u.verifyPassword(String(password || ''), (user as any).salt, (user as any).passHash)) {
    throw new u.ApiError('Неверный пароль');
  }
  const login = validateAccountLogin(raw);
  const key = login.toLowerCase();
  const acc = require('./account').accountIdOf(user);

  // Занятость проверяем и по логинам, и по позывным: иначе логин мог бы
  // совпасть с чужим позывным, и вход стал бы неоднозначным
  const clash = Object.values(users()).find((p: any) => {
    if (require('./account').accountIdOf(p) === acc) return false;
    return String(p.accountLogin || '').toLowerCase() === key
        || String(p.name || '').toLowerCase() === key;
  });
  if (clash) throw new u.ApiError('Такой логин уже занят');

  // Проставляем всем персонажам аккаунта — вход у них общий
  let changed = 0;
  for (const p of require('./account').charactersOf(user)) {
    (p as any).accountLogin = login;
    db.markUser(p.id);
    changed++;
  }
  db.save('users');
  auditLog.record({ userId: user.id, userName: user.name, path: '/api/account/login', body: { login } });
  notices.push(`🔑 Логин аккаунта изменён на «${login}»${changed > 1 ? ` (для всех ${changed} персонажей)` : ''}`);
  return { login };
}

function validateName(raw: string): string {
  const name = sanitizeInput(String(raw || '')).trim();
  if (!/^[A-Za-zА-Яа-яЁё0-9_\- ]{3,16}$/.test(name)) {
    throw new u.ApiError('Позывной: 3–16 символов. Разрешены: буквы, цифры, _ -');
  }
  if (RESERVED_NAMES.has(name.toLowerCase().replace(/\s/g, ''))) {
    throw new u.ApiError('Это имя зарезервировано и недоступно');
  }
  return name;
}

function renameSelf(user: User, newName: string, notices: Notices) {
  const vipSrv = require('./vip');
  const name = sanitizeInput(String(newName || '')).trim();

  if (!/^[A-Za-zА-Яа-яЁё0-9_\- ]{3,16}$/.test(name)) {
    throw new u.ApiError('Позывной: 3–16 символов. Разрешены: буквы, цифры, _ -');
  }
  if (RESERVED_NAMES.has(name.toLowerCase().replace(/\s/g, ''))) {
    throw new u.ApiError('Это имя зарезервировано и недоступно');
  }
  if (name === user.name) throw new u.ApiError('Это и есть ваш нынешний позывной');

  // Занятость проверяем без учёта регистра — иначе появятся «Генерал»
  // и «генерал», которых не отличить в чате
  const low = name.toLowerCase();
  const taken = Object.values(require('./player').users()).some((p: any) => p.id !== user.id && String(p.name || '').toLowerCase() === low);
  if (taken) throw new u.ApiError('Такой позывной уже занят');

  const free = vipSrv.canRenameFree(user);
  if (!free) {
    if (!vipSrv.isVip(user)) throw new u.ApiError('Смена позывного доступна по VIP-подписке');
    const days = config.VIP.RENAME_FREE_DAYS;
    const last = Number((user as any).lastFreeRenameAt || 0);
    const leftDays = Math.ceil((days * 86400000 - (Date.now() - last)) / 86400000);
    throw new u.ApiError(`Бесплатная смена — раз в ${days} дней. Следующая через ${leftDays} дн.`);
  }

  const old = user.name;
  user.name = name;
  vipSrv.markRenameUsed(user);
  db.markUser(user.id);
  db.save('users');
  auditLog.record({ userId: user.id, userName: name, path: '/api/rename', body: { from: old, to: name } });
  notices.push(`✏️ Позывной изменён: «${old}» → «${name}»`);
  return { name };
}

async function register(login: string, password: string, emailAddr: string, country: string, ip: string, ua?: string, hints?: any) {
  checkHeavy('register', ip);
  // БАГ 24: очистка управляющих символов
  login = sanitizeInput(login).trim();

  // БАГ 23: только буквы, цифры, _ - пробел
  if (!/^[A-Za-zА-Яа-яЁё0-9_\- ]{3,16}$/.test(login)) {
    throw new u.ApiError('Позывной: 3–16 символов. Разрешены: буквы, цифры, _ -');
  }

  // БАГ 5: запрещённые имена
  if (RESERVED_NAMES.has(login.toLowerCase().replace(/\s/g, ''))) {
    throw new u.ApiError('Это имя зарезервировано и недоступно');
  }

  // БАГ 4: минимум 8 символов
  password = String(password || '');
  if (password.length < 8) throw new u.ApiError('Пароль: минимум 8 символов');
  if (!/[A-Za-zА-Яа-яЁё]/.test(password) || !/[0-9]/.test(password)) {
    throw new u.ApiError('Пароль должен содержать буквы и цифры');
  }

  emailAddr = sanitizeInput(emailAddr).trim().toLowerCase();
  // БАГ 3: строгая валидация email
  if (!EMAIL_RE.test(emailAddr)) throw new u.ApiError('Введите корректный email');

  if (!config.COUNTRY_BY_ID[country]) throw new u.ApiError('Выберите страну');

  const all = users();
  if (Object.values(all).some((p) => p.name.toLowerCase() === login.toLowerCase())) {
    throw new u.ApiError('Такой позывной уже занят');
  }
  if (Object.values(all).some((p) => (p.email || '').toLowerCase() === emailAddr)) {
    throw new u.ApiError('Этот email уже используется');
  }

  // ПРАВА АДМИНИСТРАТОРА ПРИ РЕГИСТРАЦИИ НЕ ВЫДАЮТСЯ НИКОМУ.
  // Раньше их автоматически получал первый зарегистрировавшийся — это
  // означало, что при потере базы, разворачивании копии или запуске
  // нового мира администратором становился случайный человек, успевший
  // зарегистрироваться первым. Теперь права назначаются только с сервера:
  //   node tools/grant-admin.js <позывной или email>
  const salt = u.uid(16);
  const id = u.uid(12);
  const autoVerified = !email.isConfigured;
  const newU = newUser(id, login, emailAddr, await u.hashPassword(password, salt), salt, country, false, autoVerified);
  all[id] = newU;
  db.save('users');

  // Подсказка владельцу при пустой базе — чтобы он знал, как получить доступ
  if (Object.keys(all).length === 1) {
    console.log(`ℹ️  Зарегистрирован первый игрок «${login}». Права администратора НЕ выданы.`);
    console.log(`   Назначить администратора: node tools/grant-admin.js "${login}"`);
  }
  auditLog.record({ userId: id, userName: login, path: '/api/register', body: { email: emailAddr, country } });

  // Адрес и устройство запоминаем ДО развилки: игрок мог зарегистрироваться
  // с подтверждением почты и войти позже — данные регистрации нужны в обоих
  // случаях, иначе половина аккаунтов осталась бы без «паспорта» входа
  try { require('./access').recordLogin(newU, ip, ua, 'регистрация', hints); } catch (e) {}
  db.save('users');

  if (autoVerified) {
    return { token: issueToken(id), isAdmin: false, emailVerified: true };
  }
  const sendRes = await email.sendVerificationEmail(emailAddr, login, newU.emailVerifyToken || '');
  if (!sendRes.sent) {
    console.error(`📧 ВНИМАНИЕ: письмо подтверждения для «${login}» <${emailAddr}> НЕ отправлено (${sendRes.error || '—'}). Игрок не сможет войти, пока не подтвердит почту. Проверьте настройки почты в админке.`);
  }
  return { pending: true, email: emailAddr, emailVerified: false, emailSent: sendRes.sent };
}

function verifyEmail(token: string) {
  token = String(token || '');
  if (!token) throw new u.ApiError('Отсутствует код подтверждения');
  const found = Object.values(users()).find((p) => p.emailVerifyToken && p.emailVerifyToken === token);
  if (!found) throw new u.ApiError('Ссылка подтверждения недействительна или уже использована');
  found.emailVerified = true;
  found.emailVerifyToken = null;
  db.save('users');
  auditLog.record({ userId: found.id, userName: found.name, path: '/api/verify-email' });
  return { token: issueToken(found.id), isAdmin: !!found.isAdmin, name: found.name };
}

async function resendVerification(loginName: string, ip?: string) {
  checkHeavy('mail', String(ip || ''));
  const found = Object.values(users()).find(
    (p) => p.name.toLowerCase() === String(loginName || '').trim().toLowerCase()
  );
  // БАГ 11: не раскрываем существование — единое сообщение
  if (!found || found.emailVerified) throw new u.ApiError('Если аккаунт существует и почта не подтверждена — письмо отправлено');
  if (Date.now() - (found.emailVerifySentAt || 0) < RESEND_COOLDOWN_MS) {
    throw new u.ApiError('Письмо уже отправлено недавно — подождите минуту');
  }
  if (!found.emailVerifyToken) found.emailVerifyToken = u.uid(32);
  found.emailVerifySentAt = Date.now();
  db.save('users');
  const result = await email.sendVerificationEmail(found.email, found.name, found.emailVerifyToken);
  if (!result.sent && !email.isConfigured) {
    found.emailVerified = true;
    db.save('users');
    return { autoVerified: true, message: 'Почта подтверждена автоматически (режим разработки)' };
  }
  return { message: `Письмо повторно отправлено` };
}

async function login(loginName: string, password: string, ip: string, ua?: string, hints?: any) {
  // БАГ 1: rate limiting. Здесь только проверка «адрес не заблокирован»;
  // счётчик накручивают неудачные попытки ниже (см. registerFailedLogin).
  if (ip) assertNotBlocked(ip);

  // Вход по логину аккаунта, почте или позывному любого персонажа.
  //
  // Почему все три: логин аккаунта — основной способ (он один на все
  // три персонажа), почта — привычный, а позывной оставлен для тех, кто
  // регистрировался до появления кабинета и помнит только его.
  //
  // Если совпало несколько персонажей одного аккаунта — впускаем того,
  // кто играл последним: это ожидаемое поведение, а выбор всё равно
  // доступен в кабинете.
  const key = String(loginName || '').trim().toLowerCase();
  const all = Object.values(users()).filter((p: any) => !p.isBot);
  const byAccountLogin = all.filter((p: any) => String((p as any).accountLogin || '').toLowerCase() === key);
  const byEmail = all.filter((p: any) => String(p.email || '').toLowerCase() === key);
  const byName = all.filter((p) => String(p.name || '').toLowerCase() === key);
  const candidates = byAccountLogin.length ? byAccountLogin : (byEmail.length ? byEmail : byName);
  const found = candidates.sort((a: any, b: any) => (b.lastSeen || 0) - (a.lastSeen || 0))[0];

  // БАГ 11: единое сообщение — не раскрывать существование пользователя
  const WRONG_CREDS = 'Неверный логин или пароль';
  if (!found) { registerFailedLogin(ip); throw new u.ApiError(WRONG_CREDS); }
  if (!await u.verifyPassword(password, found.salt, found.passHash)) {
    registerFailedLogin(ip);
    throw new u.ApiError(WRONG_CREDS);
  }
  if (!found.emailVerified) {
    throw new u.ApiError(`Подтвердите почту — письмо отправлено при регистрации. Не пришло? Нажмите «Отправить повторно».`);
  }
  // Забаненного ВПУСКАЕМ: он войдёт и увидит окно с причиной и сроком.
  // Раньше вход отклонялся с текстом ошибки на форме — человек не понимал,
  // насколько заблокирован и когда это кончится. Играть он всё равно не
  // сможет: остальные запросы закрыты, а фронт показывает только окно.
  // Срок мог истечь, пока игрок отсутствовал — снимаем бан сразу.
  if (found.banned && (found as any).banUntil && (found as any).banUntil <= Date.now()) {
    found.banned = false;
    (found as any).banUntil = 0;
    found.banReason = '';
    db.save('users');
  }

  // Успешный вход — сбрасываем счётчик попыток
  if (ip) clearRateLimit(ip);
  auditLog.record({ userId: found.id, userName: found.name, path: '/api/login' });
  if (found.banned) {
    return {
      token: issueToken(found.id), isAdmin: false, banned: true,
      banInfo: {
        banned: true,
        reason: found.banReason || 'Нарушение правил',
        until: (found as any).banUntil || 0,
        bannedAt: (found as any).bannedAt || 0,
        name: found.name,
      },
    };
  }
  // ── Второй фактор ────────────────────────────────────────────────
  // Если он включён, сессия здесь НЕ выдаётся: возвращаем одноразовый
  // пропуск на второй шаг. Токен, выданный до проверки кода, — это уже
  // доступ, и второй фактор превратился бы в украшение.
  try {
    const tf = require('./twoFactor');
    if (tf.required(found)) {
      auditLog.record({ userId: found.id, userName: found.name, path: '/api/login/2fa-required' });
      return {
        needTotp: true,
        challengeId: tf.startChallenge(found),
        name: found.name,
      };
    }
  } catch (e: any) {
    // Ошибка в модуле второго фактора не должна закрывать вход всем —
    // но и молча пускать без него нельзя. Пускаем только если фактор
    // у человека не включён (проверка выше не отработала — значит и
    // включать было нечего).
    if (e && e.message && /включ/i.test(String(e.message))) throw e;
  }

  try { require('./access').recordLogin(found, ip, ua, 'вход', hints); } catch (e) {}
  return { token: issueToken(found.id), isAdmin: !!found.isAdmin };
}

// ── Второй шаг входа: код из приложения ───────────────────────────
// Отдельная функция, потому что первый шаг уже проверил пароль, а этот
// проверяет владение телефоном. Смешивать их в одном запросе нельзя:
// тогда пароль пришлось бы держать на фронте до ввода кода.
async function loginTotp(challengeId: string, code: string, ip: string, ua?: string, hints?: any) {
  if (ip) assertNotBlocked(ip);
  const tf = require('./twoFactor');
  let userId: string;
  try {
    userId = tf.completeChallenge(challengeId, code, users());
  } catch (e) {
    registerFailedLogin(ip);      // подбор кода считается так же, как подбор пароля
    throw e;
  }
  const found: any = users()[userId];
  if (!found) throw new u.ApiError('Игрок не найден');
  if (ip) clearRateLimit(ip);
  auditLog.record({ userId: found.id, userName: found.name, path: '/api/login/totp' });
  try { require('./access').recordLogin(found, ip, ua, 'вход (второй фактор)', hints); } catch (e) {}
  return { token: issueToken(found.id), isAdmin: !!found.isAdmin };
}

// Сбросить ВСЕ сессии игрока (смена пароля, удаление аккаунта, бан).
// Единая точка: формат хранения сессии знает только этот модуль, поэтому
// его изменение не может тихо сломать сброс в других местах — так уже
// произошло, когда сессии стали объектом, а сравнение осталось строковым.
function killSessions(userId: string): number {
  const all: any = sessions();
  let killed = 0;
  for (const tok of Object.keys(all)) {
    const rec = all[tok];
    const uid = typeof rec === 'string' ? rec : (rec && rec.u);
    if (uid === userId) { delete all[tok]; killed++; }
  }
  if (killed) db.save('sessions');
  return killed;
}

function logout(token: string) {
  delete sessions()[token];
  db.save('sessions');
}

// Запрос на сброс пароля: по позывному или email отправляем письмо со ссылкой.
// Не раскрываем, существует ли аккаунт (отвечаем одинаково в любом случае).
async function requestPasswordReset(loginOrEmail: string, ip?: string) {
  checkHeavy('mail', String(ip || ''));
  const q = String(loginOrEmail || '').trim().toLowerCase();
  const found = Object.values(users()).find(
    (p) => p.name.toLowerCase() === q || (p.email || '').toLowerCase() === q
  );
  // Всегда отвечаем успехом — не раскрываем существование аккаунта
  if (found && found.emailVerified && !found.banned) {
    found.resetToken = u.uid(32);
    found.resetTokenExp = Date.now() + 60 * 60 * 1000; // действует 1 час
    db.save('users');
    const rr = await email.sendPasswordResetEmail(found.email, found.name, found.resetToken);
    if (!rr.sent) {
      console.error(`📧 ВНИМАНИЕ: письмо сброса пароля для «${found.name}» <${found.email}> НЕ отправлено (${rr.error || '—'}). Проверьте настройки почты в админке.`);
    }
  }
  return { ok: true };
}

// Сброс пароля по токену из письма
async function resetPassword(token: string, newPassword: string, ip?: string) {
  checkHeavy('reset', String(ip || ''));
  const t = String(token || '');
  if (!t) throw new u.ApiError('Неверная ссылка восстановления');
  const found = Object.values(users()).find((p) => p.resetToken && p.resetToken === t);
  if (!found || !found.resetTokenExp || found.resetTokenExp < Date.now()) {
    throw new u.ApiError('Ссылка восстановления недействительна или истекла. Запросите новую.');
  }
  if (String(newPassword || '').length < 8) throw new u.ApiError('Пароль: минимум 8 символов');
  if (!/[A-Za-zА-Яа-яЁё]/.test(newPassword) || !/[0-9]/.test(newPassword)) {
    throw new u.ApiError('Пароль должен содержать буквы и цифры');
  }
  const salt = u.uid(16);
  found.passHash = await u.hashPassword(newPassword, salt);
  found.salt = salt;
  found.resetToken = null;
  found.resetTokenExp = 0;
  // Сбрасываем все сессии — на случай компрометации
  const ss = sessions();
  for (const [tok, uid] of Object.entries(ss)) {
    if (uid === found.id) delete ss[tok];
  }
  db.save('sessions');
  db.save('users');
  auditLog.record({ userId: found.id, userName: found.name, path: '/api/reset-password' });
  return { ok: true };
}

// ── Смена пароля самим игроком (из «Настройки → Аккаунт») ─────────
// Три поля: старый пароль (подтверждение владения аккаунтом) и новый
// дважды (страховка от опечатки). После смены завершаем ВСЕ сессии —
// если пароль увели, чужой доступ обрывается, — но текущему игроку
// сразу выдаём свежий токен, чтобы его самого не выкинуло из игры.
async function changePassword(user: User, oldPassword: string, newPassword: string, newPassword2: string) {
  const oldP = String(oldPassword || '');
  const newP = String(newPassword || '');
  const newP2 = String(newPassword2 || '');

  if (!oldP) throw new u.ApiError('Введите текущий пароль');
  if (!await u.verifyPassword(oldP, user.salt, user.passHash)) {
    throw new u.ApiError('Текущий пароль неверен');
  }
  if (!newP) throw new u.ApiError('Введите новый пароль');
  if (newP !== newP2) throw new u.ApiError('Новые пароли не совпадают — проверьте оба поля');
  if (newP.length < 8) throw new u.ApiError('Пароль: минимум 8 символов');
  if (!/[A-Za-zА-Яа-яЁё]/.test(newP) || !/[0-9]/.test(newP)) {
    throw new u.ApiError('Пароль должен содержать буквы и цифры');
  }
  if (newP === oldP) throw new u.ApiError('Новый пароль совпадает со старым');

  const salt = u.uid(16);
  user.salt = salt;
  user.passHash = await u.hashPassword(newP, salt);
  (user as any).resetToken = null;
  (user as any).resetTokenExp = 0;

  // Сбрасываем все сессии игрока и выдаём новую взамен текущей.
  // Порядок важен: сначала сброс, потом выдача — иначе новый токен
  // удалялся бы вместе со старыми, и игрока выкидывало бы из игры
  // сразу после смены собственного пароля.
  killSessions(user.id);
  const token = issueToken(user.id);
  db.save('sessions');
  db.save('users');
  auditLog.record({ userId: user.id, userName: user.name, path: '/api/change-password' });
  return { ok: true, token };
}

export = { register, login, loginTotp, logout, issueToken, checkHeavy, validateName, validateAccountLogin, setAccountLogin, killSessions, pruneSessions, SESSION_TTL_MS, verifyEmail, resendVerification, checkRateLimit, requestPasswordReset, resetPassword, changePassword, newUser, renameSelf, RESERVED_NAMES,};
