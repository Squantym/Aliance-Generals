// ===================================================================
// src/services/passport.ts — раздел «Паспорт» на чёрном рынке
// Три услуги: смена позывного, страны (и её бонуса) и пола.
// Цена растёт с каждой следующей покупкой того же типа.
// ===================================================================

import config = require('../../config/gameConfig');
import u = require('../core/utils');
import db = require('../core/db');
import type { User, Notices } from '../types';

const BASE_PRICE_GOLD = 100;
const NAME_RE = /^[A-Za-zА-Яа-яЁё0-9_\- ]{3,16}$/;

// Сколько раз игрок уже менял имя/страну (для удвоения цены)
function nameChanges(user: User): number { return ((user as any).passport && (user as any).passport.nameChanges) || 0; }
function countryChanges(user: User): number { return ((user as any).passport && (user as any).passport.countryChanges) || 0; }
function genderChanges(user: User): number { return ((user as any).passport && (user as any).passport.genderChanges) || 0; }
function ensurePassport(user: User): void {
  if (!(user as any).passport) (user as any).passport = { nameChanges: 0, countryChanges: 0, genderChanges: 0 };
}

function namePrice(user: User): number { return BASE_PRICE_GOLD * Math.pow(2, nameChanges(user)); }
function countryPrice(user: User): number { return BASE_PRICE_GOLD * Math.pow(2, countryChanges(user)); }
// Пол дорожает ЛИНЕЙНО (50, 100, 150…), а не удвоением как позывной.
// Позывной удваивают, чтобы им не мельтешили: под новым именем легко
// уйти от репутации. Пол ни от чего не прячет — он меняет сцены и
// обращение, — и запирать эту дверь ценой в тысячи не за что.
function genderPrice(user: User): number {
  return config.GENDER_CHANGE_BASE_GOLD + config.GENDER_CHANGE_STEP_GOLD * genderChanges(user);
}

// Список услуг для UI
function view(user: User) {
  return {
    namePrice: namePrice(user),
    countryPrice: countryPrice(user),
    currentName: user.name,
    currentCountry: user.country,
    countries: config.COUNTRIES,
    nameChanges: nameChanges(user),
    countryChanges: countryChanges(user),
    genderPrice: genderPrice(user),
    genderChanges: genderChanges(user),
    currentGender: String((user as any).gender || 'm'),
    genders: config.GENDERS,
  };
}

// Смена позывного
function changeName(user: User, newName: string, notices: Notices) {
  newName = String(newName || '').trim();
  if (!NAME_RE.test(newName)) {
    throw new u.ApiError('Позывной: 3–16 символов (буквы, цифры, _ - пробел)');
  }
  if (newName.toLowerCase() === user.name.toLowerCase()) {
    throw new u.ApiError('Это и так ваш текущий позывной');
  }
  // Уникальность позывного
  const users = db.load<Record<string, User>>('users', {});
  const taken = Object.values(users).some(
    (p) => p.id !== user.id && p.name.toLowerCase() === newName.toLowerCase()
  );
  if (taken) throw new u.ApiError('Этот позывной уже занят');

  const price = namePrice(user);
  if (user.gold < price) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${price})`);
  require('./player').spendGold(user, price, 'passport');
  const oldName = user.name;
  user.name = newName;
  ensurePassport(user);
  (user as any).passport.nameChanges++;
  notices.push(`📛 Имя сменено: «${oldName}» → «${newName}». Следующая смена обойдётся в 🪙 ${namePrice(user)}.`);
  return { oldName, newName, nextPrice: namePrice(user) };
}

// Смена гражданства (страна и её бонусы)
function changeCountry(user: User, newCountry: string, notices: Notices) {
  newCountry = String(newCountry || '').trim();
  const country = config.COUNTRY_BY_ID[newCountry];
  if (!country) throw new u.ApiError('Такой страны нет');
  if (newCountry === user.country) throw new u.ApiError('Это и так ваше текущее гражданство');

  const price = countryPrice(user);
  if (user.gold < price) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${price})`);
  require('./player').spendGold(user, price, 'passport');
  const oldCountry = user.country;
  user.country = newCountry;
  ensurePassport(user);
  (user as any).passport.countryChanges++;
  notices.push(`🌍 Гражданство сменено: ${oldCountry.toUpperCase()} → ${newCountry.toUpperCase()}. Новый бонус: ${country.desc}`);
  return { oldCountry, newCountry, nextPrice: countryPrice(user) };
}

// Смена пола. Влияет на сцены проникновения в штаб и на обращение.
function changeGender(user: User, newGender: string, notices: Notices) {
  const g = String(newGender || '').trim();
  const info = config.GENDER_BY_ID[g];
  if (!info) throw new u.ApiError('Такого варианта нет');
  const current = String((user as any).gender || 'm');
  if (g === current) throw new u.ApiError('Это и так ваш текущий выбор');

  const price = genderPrice(user);
  if (user.gold < price) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${price})`);
  require('./player').spendGold(user, price, 'passport');
  (user as any).gender = g;
  // Портрет — по полу, и после смены старый остаётся чужим. Снимаем его
  // молча: заставлять игрока лезть искать, почему «портрет не для вашего
  // пола», ради одного клика незачем.
  const mine: string[] = g === 'f' ? config.AVATARS.female : config.AVATARS.male;
  const had = (user as any).avatar;
  if (had && !mine.includes(had)) {
    (user as any).avatar = undefined;
    notices.push('📷 Прежний портрет снят — выберите новый в личном деле.');
  }
  ensurePassport(user);
  (user as any).passport.genderChanges = genderChanges(user) + 1;
  db.markUser(user.id);
  notices.push(`${info.icon} Личное дело переписано: теперь к вам обращаются «${info.title}». `
    + `Следующая смена — 🪙 ${genderPrice(user)}.`);
  return { gender: g, title: info.title, nextPrice: genderPrice(user) };
}

export = { view, changeName, changeCountry, changeGender };
