// ===================================================================
// src/services/auth.js — регистрация, вход, подтверждение почты
// ===================================================================

const config = require('../../config/gameConfig');
const db = require('../core/db');
const u = require('../core/utils');
const email = require('./email');
const auditLog = require('./auditLog');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const RESEND_COOLDOWN_MS = 60 * 1000;

// БАГ 5: Запрещённые имена
const RESERVED_NAMES = new Set([
  'admin', 'administrator', 'root', 'superuser', 'moderator', 'moder',
  'support', 'system', 'bot', 'server', 'game', 'генерал', 'админ',
  'администратор', 'модератор', 'поддержка',
]);

// БАГ 1 + БАГ 25: Rate limiting для входа и admin
const loginAttempts = new Map(); // ip -> { count, firstAt, blockedUntil }
const RATE_LIMIT_MAX   = 5;
const RATE_LIMIT_BLOCK = 15 * 60 * 1000; // 15 минут
const RATE_LIMIT_WIN   = 5  * 60 * 1000; // окно 5 минут

function checkRateLimit(ip) {
  const now = Date.now();
  let entry = loginAttempts.get(ip);
  if (!entry) { entry = { count: 0, firstAt: now, blockedUntil: 0 }; loginAttempts.set(ip, entry); }
  if (entry.blockedUntil > now) {
    const mins = Math.ceil((entry.blockedUntil - now) / 60000);
    throw new u.ApiError(`Слишком много попыток. Попробуйте через ${mins} мин.`);
  }
  if (now - entry.firstAt > RATE_LIMIT_WIN) { entry.count = 0; entry.firstAt = now; }
  entry.count++;
  if (entry.count >= RATE_LIMIT_MAX) {
    entry.blockedUntil = now + RATE_LIMIT_BLOCK;
    auditLog.record({ userId: 'system', userName: 'system', path: '/rate-limit-block', body: { ip } });
    throw new u.ApiError(`Слишком много попыток. Аккаунт временно заблокирован на 15 минут.`);
  }
}

function clearRateLimit(ip) {
  loginAttempts.delete(ip);
}

// БАГ 24: Очистка Unicode управляющих символов
function sanitizeInput(str) {
  // Удаляем RTL Override и другие управляющие Unicode-символы
  return String(str || '').replace(/[\u200B-\u200F\u202A-\u202E\u2066-\u2069\u0000]/g, '');
}

function users() { return db.load('users', {}); }
function sessions() { return db.load('sessions', {}); }

function newUser(id, name, email_, passHash, salt, country, isAdmin, emailVerified) {
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
    trophies: Object.fromEntries(config.TROPHIES.map((t) => [t.id, 0])),
    club: {},
    allianceId: null,
    legionId: null,
    lastIncomeAt: now,
    pendingFatality: null,
    lastChatAt: 0,
  };
}

function issueToken(userId) {
  const token = u.uid(40);
  sessions()[token] = userId;
  db.save('sessions');
  return token;
}

async function register(login, password, emailAddr, country, ip) {
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

  const isFirst = Object.keys(all).length === 0;
  const salt = u.uid(16);
  const id = u.uid(12);
  const autoVerified = !email.isConfigured;
  const newU = newUser(id, login, emailAddr, u.hashPassword(password, salt), salt, country, isFirst, autoVerified);
  all[id] = newU;
  db.save('users');

  if (isFirst) console.log(`👑 Игрок «${login}» зарегистрирован первым и получил права администратора.`);
  auditLog.record({ userId: id, userName: login, path: '/api/register', body: { email: emailAddr, country } });

  if (autoVerified) {
    return { token: issueToken(id), isAdmin: isFirst, emailVerified: true };
  }
  await email.sendVerificationEmail(emailAddr, login, newU.emailVerifyToken);
  return { pending: true, email: emailAddr, emailVerified: false };
}

function verifyEmail(token) {
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

async function resendVerification(loginName) {
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

function login(loginName, password, ip) {
  // БАГ 1: rate limiting
  if (ip) checkRateLimit(ip);

  const found = Object.values(users()).find(
    (p) => p.name.toLowerCase() === String(loginName || '').trim().toLowerCase()
  );

  // БАГ 11: единое сообщение — не раскрывать существование пользователя
  const WRONG_CREDS = 'Неверный позывной или пароль';
  if (!found) throw new u.ApiError(WRONG_CREDS);
  if (u.hashPassword(password, found.salt) !== found.passHash) throw new u.ApiError(WRONG_CREDS);
  if (!found.emailVerified) {
    throw new u.ApiError(`Подтвердите почту — письмо отправлено при регистрации. Не пришло? Нажмите «Отправить повторно».`);
  }

  // Успешный вход — сбрасываем счётчик попыток
  if (ip) clearRateLimit(ip);
  auditLog.record({ userId: found.id, userName: found.name, path: '/api/login' });
  return { token: issueToken(found.id), isAdmin: !!found.isAdmin };
}

function logout(token) {
  delete sessions()[token];
  db.save('sessions');
}

module.exports = { register, login, logout, verifyEmail, resendVerification, checkRateLimit };
