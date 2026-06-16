// ===================================================================
// src/services/passport.js — раздел «Паспорт» на чёрном рынке
// Две услуги: смена позывного и смена страны (и её бонуса).
// Цена удваивается с каждой следующей покупкой того же типа.
// ===================================================================

const config = require('../../config/gameConfig');
const u = require('../core/utils');
const db = require('../core/db');

const BASE_PRICE_GOLD = 100;
const NAME_RE = /^[A-Za-zА-Яа-яЁё0-9_\- ]{3,16}$/;

// Сколько раз игрок уже менял имя/страну (для удвоения цены)
function nameChanges(user) { return (user.passport && user.passport.nameChanges) || 0; }
function countryChanges(user) { return (user.passport && user.passport.countryChanges) || 0; }
function ensurePassport(user) {
  if (!user.passport) user.passport = { nameChanges: 0, countryChanges: 0 };
}

function namePrice(user) { return BASE_PRICE_GOLD * Math.pow(2, nameChanges(user)); }
function countryPrice(user) { return BASE_PRICE_GOLD * Math.pow(2, countryChanges(user)); }

// Список услуг для UI
function view(user) {
  return {
    namePrice: namePrice(user),
    countryPrice: countryPrice(user),
    currentName: user.name,
    currentCountry: user.country,
    countries: config.COUNTRIES,
    nameChanges: nameChanges(user),
    countryChanges: countryChanges(user),
  };
}

// Смена позывного
function changeName(user, newName, notices) {
  newName = String(newName || '').trim();
  if (!NAME_RE.test(newName)) {
    throw new u.ApiError('Позывной: 3–16 символов (буквы, цифры, _ - пробел)');
  }
  if (newName.toLowerCase() === user.name.toLowerCase()) {
    throw new u.ApiError('Это и так ваш текущий позывной');
  }
  // Уникальность позывного
  const users = db.load('users', {});
  const taken = Object.values(users).some(
    (p) => p.id !== user.id && p.name.toLowerCase() === newName.toLowerCase()
  );
  if (taken) throw new u.ApiError('Этот позывной уже занят');

  const price = namePrice(user);
  if (user.gold < price) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${price})`);
  user.gold -= price;
  const oldName = user.name;
  user.name = newName;
  ensurePassport(user);
  user.passport.nameChanges++;
  notices.push(`📛 Имя сменено: «${oldName}» → «${newName}». Следующая смена обойдётся в 🪙 ${namePrice(user)}.`);
  return { oldName, newName, nextPrice: namePrice(user) };
}

// Смена гражданства (страна и её бонусы)
function changeCountry(user, newCountry, notices) {
  newCountry = String(newCountry || '').trim();
  const country = config.COUNTRY_BY_ID[newCountry];
  if (!country) throw new u.ApiError('Такой страны нет');
  if (newCountry === user.country) throw new u.ApiError('Это и так ваше текущее гражданство');

  const price = countryPrice(user);
  if (user.gold < price) throw new u.ApiError(`Не хватает золота (нужно 🪙 ${price})`);
  user.gold -= price;
  const oldCountry = user.country;
  user.country = newCountry;
  ensurePassport(user);
  user.passport.countryChanges++;
  notices.push(`🌍 Гражданство сменено: ${oldCountry.toUpperCase()} → ${newCountry.toUpperCase()}. Новый бонус: ${country.desc}`);
  return { oldCountry, newCountry, nextPrice: countryPrice(user) };
}

module.exports = { view, changeName, changeCountry };
