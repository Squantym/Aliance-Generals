// ===================================================================
// src/services/auth.js — регистрация и вход
// Пароли хранятся как scrypt-хэш с солью. Токен сессии кладётся
// в коллекцию sessions. Первый зарегистрированный игрок автоматически
// получает права администратора.
// ===================================================================

const config = require('../../config/gameConfig');
const db = require('../core/db');
const u = require('../core/utils');

function users() { return db.load('users', {}); }
function sessions() { return db.load('sessions', {}); }

// Заготовка нового игрока со всеми полями состояния
function newUser(id, name, passHash, salt, country, isAdmin) {
  const now = Date.now();
  return {
    id, name, passHash, salt, isAdmin,
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
    // Новый формат: user.units[unitId] = { 0: count_mk0, 1: count_mk1, 2: count_mk2 }
    // user.modernQueue — массив активных процессов модернизации в цехах
    units: {}, workshops: 0, modernQueue: [],
    buildings: {},
    secretDevs: {}, superSecret: 0,
    ears: 0, tokens: 0, earsLost: 0,
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

function register(login, password, country) {
  login = String(login || '').trim();
  if (!/^[A-Za-zА-Яа-яЁё0-9_\- ]{3,16}$/.test(login)) {
    throw new u.ApiError('Позывной: 3–16 символов (буквы, цифры, _ - пробел)');
  }
  if (String(password || '').length < 4) throw new u.ApiError('Пароль: минимум 4 символа');
  if (!config.COUNTRY_BY_ID[country]) throw new u.ApiError('Выберите страну');

  const all = users();
  const exists = Object.values(all).some((p) => p.name.toLowerCase() === login.toLowerCase());
  if (exists) throw new u.ApiError('Такой позывной уже занят');

  const isFirst = Object.keys(all).length === 0;
  const salt = u.uid(16);
  const id = u.uid(12);
  all[id] = newUser(id, login, u.hashPassword(password, salt), salt, country, isFirst);
  db.save('users');

  if (isFirst) {
    console.log(`👑 Игрок «${login}» зарегистрирован первым и получил права администратора.`);
  }
  return { token: issueToken(id), isAdmin: isFirst };
}

function login(loginName, password) {
  const found = Object.values(users()).find(
    (p) => p.name.toLowerCase() === String(loginName || '').trim().toLowerCase()
  );
  if (!found) throw new u.ApiError('Боец с таким позывным не найден');
  if (u.hashPassword(password, found.salt) !== found.passHash) {
    throw new u.ApiError('Неверный пароль');
  }
  return { token: issueToken(found.id), isAdmin: !!found.isAdmin };
}

function logout(token) {
  delete sessions()[token];
  db.save('sessions');
}

module.exports = { register, login, logout };
