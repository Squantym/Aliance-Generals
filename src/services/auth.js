// ===================================================================
// src/services/auth.js — регистрация, вход, подтверждение почты
// Пароли хранятся как scrypt-хэш с солью. Токен сессии кладётся
// в коллекцию sessions. Первый зарегистрированный игрок автоматически
// получает права администратора.
//
// Подтверждение почты:
//   - При регистрации игроку отправляется письмо со ссылкой
//     #verify/<токен> (через src/services/email.js).
//   - Войти в игру можно только после подтверждения.
//   - Если отправка почты не настроена (нет RESEND_API_KEY) — почта
//     считается подтверждённой автоматически (режим разработки), а
//     ссылка для подтверждения выводится в консоль сервера.
// ===================================================================

const config = require('../../config/gameConfig');
const db = require('../core/db');
const u = require('../core/utils');
const email = require('./email');
const auditLog = require('./auditLog');

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const RESEND_COOLDOWN_MS = 60 * 1000; // не чаще раза в минуту

function users() { return db.load('users', {}); }
function sessions() { return db.load('sessions', {}); }

// Заготовка нового игрока со всеми полями состояния
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
    // user.units[unitId] = { 0: count_mk0, 1: count_mk1, 2: count_mk2 }
    units: {}, workshops: 0, modernQueue: [],
    buildings: {},
    secretDevs: {}, superSecret: 0,
    ears: 0, tokens: 0, earsLost: 0,
    // Собственные уши игрока: 0-2. earsLostAt — массив времён потери
    // каждого уха (для расчёта регенерации). penaltyUntil — до какого
    // момента действует штраф -10% атаки/защиты (когда оба уха отрезаны).
    earsCurrent: config.EARS.MAX, earsLostAt: [], earPenaltyUntil: 0,
    battle: { attacks: 0, wins: 0, losses: 0, defWins: 0, defLosses: 0, fatalities: 0 },
    counters: { wins: 0, attacks: 0, fatalities: 0, unitsBought: 0, buildingsBuilt: 0, missionStages: 0, earsCut: 0, moneyEarned: 0, level: 1 },
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

// ---------- Регистрация ----------
// Возвращает либо { token, isAdmin } (если почта подтверждена сразу —
// режим разработки без настроенной почты), либо
// { pending: true, email } (нужно подтвердить почту по ссылке из письма).
async function register(login, password, emailAddr, country) {
  login = String(login || '').trim();
  if (!/^[A-Za-zА-Яа-яЁё0-9_\- ]{3,16}$/.test(login)) {
    throw new u.ApiError('Позывной: 3–16 символов (буквы, цифры, _ - пробел)');
  }
  if (String(password || '').length < 4) throw new u.ApiError('Пароль: минимум 4 символа');

  emailAddr = String(emailAddr || '').trim().toLowerCase();
  if (!EMAIL_RE.test(emailAddr)) throw new u.ApiError('Введите корректный email');

  if (!config.COUNTRY_BY_ID[country]) throw new u.ApiError('Выберите страну');

  const all = users();
  const nameExists = Object.values(all).some((p) => p.name.toLowerCase() === login.toLowerCase());
  if (nameExists) throw new u.ApiError('Такой позывной уже занят');
  const emailExists = Object.values(all).some((p) => (p.email || '').toLowerCase() === emailAddr);
  if (emailExists) throw new u.ApiError('Этот email уже используется другим аккаунтом');

  const isFirst = Object.keys(all).length === 0;
  const salt = u.uid(16);
  const id = u.uid(12);

  // Если почта не настроена (нет RESEND_API_KEY) — считаем подтверждённой
  // сразу, чтобы локальная разработка и дымовой тест работали без письма.
  const autoVerified = !email.isConfigured;
  const newU = newUser(id, login, emailAddr, u.hashPassword(password, salt), salt, country, isFirst, autoVerified);
  all[id] = newU;
  db.save('users');

  if (isFirst) {
    console.log(`👑 Игрок «${login}» зарегистрирован первым и получил права администратора.`);
  }

  auditLog.record({ userId: id, userName: login, path: '/api/register', body: { email: emailAddr, country } });

  if (autoVerified) {
    return { token: issueToken(id), isAdmin: isFirst, emailVerified: true };
  }

  // Отправляем письмо со ссылкой подтверждения (асинхронно)
  await email.sendVerificationEmail(emailAddr, login, newU.emailVerifyToken);
  return { pending: true, email: emailAddr, emailVerified: false };
}

// ---------- Подтверждение почты по ссылке из письма ----------
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

// ---------- Повторная отправка письма подтверждения ----------
async function resendVerification(loginName) {
  const found = Object.values(users()).find(
    (p) => p.name.toLowerCase() === String(loginName || '').trim().toLowerCase()
  );
  if (!found) throw new u.ApiError('Боец с таким позывным не найден');
  if (found.emailVerified) throw new u.ApiError('Почта уже подтверждена — можно входить');
  if (Date.now() - (found.emailVerifySentAt || 0) < RESEND_COOLDOWN_MS) {
    throw new u.ApiError('Письмо уже отправлено недавно — подождите минуту');
  }
  if (!found.emailVerifyToken) found.emailVerifyToken = u.uid(32);
  found.emailVerifySentAt = Date.now();
  db.save('users');

  const result = await email.sendVerificationEmail(found.email, found.name, found.emailVerifyToken);
  if (!result.sent && !email.isConfigured) {
    // Почта не настроена вообще — подтверждаем автоматически (dev-режим)
    found.emailVerified = true;
    db.save('users');
    return { autoVerified: true, message: 'Почта подтверждена автоматически (режим разработки)' };
  }
  return { message: `Письмо повторно отправлено на ${found.email}` };
}

// ---------- Вход ----------
function login(loginName, password) {
  const found = Object.values(users()).find(
    (p) => p.name.toLowerCase() === String(loginName || '').trim().toLowerCase()
  );
  if (!found) throw new u.ApiError('Боец с таким позывным не найден');
  if (u.hashPassword(password, found.salt) !== found.passHash) {
    throw new u.ApiError('Неверный пароль');
  }
  if (!found.emailVerified) {
    throw new u.ApiError(`Подтвердите почту (${found.email}) — письмо со ссылкой отправлено при регистрации. Не пришло? Нажмите «Отправить повторно».`);
  }
  auditLog.record({ userId: found.id, userName: found.name, path: '/api/login' });
  return { token: issueToken(found.id), isAdmin: !!found.isAdmin };
}

function logout(token) {
  delete sessions()[token];
  db.save('sessions');
}

module.exports = { register, login, logout, verifyEmail, resendVerification };
