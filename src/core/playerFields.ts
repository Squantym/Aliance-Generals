// ═══════════════════════════════════════════════════════════════════
// РЕЕСТР ПОЛЕЙ ИГРОКА
//
// Зачем он существует: недельные поручения когда-то повесили на поле
// `weekly`, уже занятое недельным СЕЗОНОМ. Два модуля пересоздавали
// объект друг друга, и у активных игроков обнулился сезонный счёт.
// Восстановить не удалось — значения жили только в затираемом поле.
//
// Правило теперь такое: любое поле на объекте игрока обязано быть
// перечислено здесь с указанием, КТО его владелец. Тест
// test/fields-registry.test.js падает, если в коде появилось поле,
// которого нет в реестре, — то есть коллизия будет обнаружена до
// деплоя, а не по жалобам игроков.
//
// Как добавить новое поле:
//   1) убедиться, что имени ещё нет в этом файле (это и есть проверка
//      на занятость — раньше её не было);
//   2) дописать строку с владельцем и коротким описанием;
//   3) прогнать тесты.
// ═══════════════════════════════════════════════════════════════════

type FieldOwner = {
  owner: string;   // какой модуль владеет полем
  note: string;    // что в нём лежит
};

const PLAYER_FIELDS: Record<string, FieldOwner> = {
  // ── Идентификация и аккаунт ────────────────────────────────────
  id:                 { owner: 'auth',       note: 'идентификатор игрока' },
  name:               { owner: 'auth',       note: 'позывной' },
  email:              { owner: 'auth',       note: 'почта' },
  passHash:           { owner: 'auth',       note: 'хэш пароля — НИКОГДА не отдавать в API' },
  salt:               { owner: 'auth',       note: 'соль пароля — НИКОГДА не отдавать в API' },
  emailVerified:      { owner: 'auth',       note: 'почта подтверждена' },
  emailVerifyToken:   { owner: 'auth',       note: 'токен подтверждения почты' },
  emailVerifySentAt:  { owner: 'auth',       note: 'когда отправлено письмо подтверждения' },
  resetToken:         { owner: 'auth',       note: 'токен сброса пароля' },
  resetTokenExp:      { owner: 'auth',       note: 'срок действия токена сброса' },
  country:            { owner: 'auth',       note: 'флаг/страна' },
  createdAt:          { owner: 'auth',       note: 'дата регистрации' },
  lastSeen:           { owner: 'player',     note: 'последняя активность' },
  isAdmin:            { owner: 'auth',       note: 'права администратора (наследие; ведущее поле — role)' },
  role:               { owner: 'roles',      note: 'роль: owner / arbiter / admin / commissar / moderator' },
  vipUntil:           { owner: 'vip',        note: 'до какого времени действует VIP-подписка' },
  stats:              { owner: 'stats',      note: 'расширенная статистика: время, деньги, золото, техника' },
  access:             { owner: 'access',     note: 'учёт входов: адреса, устройства, история' },
  accountId:          { owner: 'account',    note: 'общий аккаунт нескольких персонажей (кабинет)' },
  accountLogin:       { owner: 'auth',       note: 'логин входа — общий для всех персонажей аккаунта' },
  alive:              { owner: 'arena',      note: 'жив ли боец на арене (поле бойца, не игрока)' },
  place:              { owner: 'arena',      note: 'место в бою на арене — от него зависит штраф рейтинга' },
  guardedUntil:       { owner: 'groupBattle', note: 'до какого времени боец прикрыт защитником' },
  guardedBy:          { owner: 'groupBattle', note: 'кто прикрывает бойца в групповом бою' },
  killedBy:           { owner: 'groupBattle', note: 'кто добил бойца — показывается павшему' },
  killedById:         { owner: 'groupBattle', note: 'идентификатор добившего' },
  battlePoints:       { owner: 'groupBattle', note: 'боевые очки — валюта групповых боёв, тратится на улучшения' },
  gbUpgrades:         { owner: 'groupBattle', note: 'уровни улучшений групповых боёв' },
  gbBuffs:            { owner: 'groupBattle', note: 'временные усиления из базы снабжения' },
  atkBonus:           { owner: 'groupBattle', note: 'прибавка к урону от усиления (поле бойца)' },
  st:                 { owner: 'groupBattle', note: 'характеристики бойца с улучшениями (поле боя)' },
  vipDaily:           { owner: 'vip',        note: 'суточные счётчики VIP: лечение, иммунитет, замены' },
  lastFreeRenameAt:   { owner: 'vip',        note: 'когда была бесплатная смена позывного' },
  spiedBy:            { owner: 'vip',        note: 'кто разведал игрока за сутки (пункт 10)' },
  chatBan:            { owner: 'roles',      note: 'блокировка чата: срок, причина, кто выдал' },
  forumBan:           { owner: 'forum',      note: 'ограничения на форуме: комментарии, темы, доступ' },
  lastForumTopicAt:   { owner: 'forum',      note: 'антифлуд создания тем' },
  lastForumCommentAt: { owner: 'forum',      note: 'антифлуд комментариев' },
  banned:             { owner: 'admin',      note: 'блокировка' },
  banReason:          { owner: 'admin',      note: 'причина блокировки' },
  bannedAt:           { owner: 'admin',      note: 'когда заблокирован' },
  banUntil:           { owner: 'admin',      note: 'до какого времени бан (0 — бессрочно)' },
  banByName:          { owner: 'roles',      note: 'кто выдал блокировку аккаунта — для плашки в профиле' },
  refCode:            { owner: 'referrals',  note: 'личный код-приглашение' },
  referredBy:         { owner: 'referrals',  note: 'кто пригласил' },
  isBot:              { owner: 'battle',     note: 'признак бота' },
  behavior:           { owner: 'battle',     note: 'поведение бота' },

  // ── Прогресс и ресурсы ─────────────────────────────────────────
  level:              { owner: 'player',     note: 'уровень' },
  xp:                 { owner: 'player',     note: 'опыт' },
  skillPoints:        { owner: 'player',     note: 'нераспределённые очки навыков' },
  skills:             { owner: 'player',     note: 'навыки' },
  res:                { owner: 'player',     note: 'HP / энергия / боеприпасы' },
  dollars:            { owner: 'player',     note: 'наличные' },
  bank:               { owner: 'player',     note: 'вклад в банке' },
  gold:               { owner: 'player',     note: 'золото (премиум-валюта)' },
  tokens:             { owner: 'player',     note: 'жетоны милосердия' },
  ears:               { owner: 'battle',     note: 'собранные уши (трофеи)' },
  status:             { owner: 'player',     note: 'статус/титул' },
  counters:           { owner: 'player',     note: 'накопительные счётчики' },
  battle:             { owner: 'battle',     note: 'боевая статистика' },
  lastIncomeAt:       { owner: 'economy',    note: 'последнее начисление дохода' },

  // ── Армия, постройки, производство ─────────────────────────────
  units:              { owner: 'units',      note: 'техника по типам и модификациям' },
  buildings:          { owner: 'buildings',  note: 'постройки' },
  workshops:          { owner: 'production', note: 'цеха' },
  modernQueue:        { owner: 'production', note: 'очередь модернизации' },
  secretDevs:         { owner: 'secret',     note: 'секретные разработки' },
  superSecret:        { owner: 'secret',     note: 'сверхсекретная разработка' },
  landmines:          { owner: 'features',   note: 'мины на подступах' },
  saboteurs:          { owner: 'saboteurs',  note: 'диверсанты' },
  saboteurLimits:     { owner: 'saboteurs',  note: 'дневные лимиты диверсий' },
  saboteurRareLossAccum: { owner: 'saboteurs', note: 'накопитель редких потерь' },
  trophies:           { owner: 'trophies',   note: 'трофеи и их ступени' },
  effects:            { owner: 'effects',    note: 'активные эффекты (допинг, наёмник)' },

  // ── Уши: состояние собственных ушей игрока ─────────────────────
  earsCurrent:        { owner: 'battle',     note: 'сколько ушей на месте (0..2)' },
  earsLost:           { owner: 'battle',     note: 'сколько потеряно' },
  earsLostAt:         { owner: 'battle',     note: 'когда потеряны (для отрастания)' },
  earCutters:         { owner: 'battle',     note: 'кто отрезал — для санкций' },
  earMessage:         { owner: 'battle',     note: 'сообщение от обидчика' },
  earPenaltyUntil:    { owner: 'battle',     note: 'штраф за потерю ушей' },
  vsRecord:           { owner: 'battle',     note: 'личные счёты с игроками' },

  // ── Группы ─────────────────────────────────────────────────────
  allianceId:         { owner: 'groups',     note: 'клан/альянс' },
  legionId:           { owner: 'groups',     note: 'легион' },
  allianceRoster:     { owner: 'personalAlliance', note: 'личный альянс (состав)' },
  allianceMembers:    { owner: 'personalAlliance', note: 'число участников — влияет на вместимость армии' },

  // ── Задания, сезон, награды ────────────────────────────────────
  daily:              { owner: 'dailyQuests', note: 'ДНЕВНЫЕ поручения: день, счётчики, принятые, полученные' },
  weeklyQuests:       { owner: 'dailyQuests', note: 'НЕДЕЛЬНЫЕ ПОРУЧЕНИЯ. Раньше жили в weekly и стирали сезон' },
  weekly:             { owner: 'seasons',    note: 'НЕДЕЛЬНЫЙ СЕЗОН: weekId и метрики рейтинга. Только seasons.ts!' },
  missions:           { owner: 'missions',   note: 'спецоперации' },
  achStages:          { owner: 'achievements', note: 'ступени достижений' },
  pendingAchievements: { owner: 'achievements', note: 'очередь окон достижений' },
  club:               { owner: 'club',       note: 'клуб (партии, ставки)' },
  tutorial:           { owner: 'tutorial',   note: 'обучение' },
  loginStreak:        { owner: 'features',   note: 'серия ежедневных входов' },
  lastLoginDay:       { owner: 'features',   note: 'день последнего входа (для серии)' },
  pendingLoginReward: { owner: 'features',   note: 'награда за вход ждёт получения в окне' },
  pendingGifts:       { owner: 'admin',      note: 'подарки от администрации' },
  offlineWar:         { owner: 'warReport',  note: 'сводка «пока вас не было»: нападавшие, ущерб, ракеты, санкции' },

  // ── Незавершённые действия (модальные окна) ────────────────────
  pendingFatality:    { owner: 'battle',     note: 'решение судьбы поверженного' },
  pendingBankHack:    { owner: 'battle',     note: 'взлом сейфа в процессе' },
  pendingMineDefuse:  { owner: 'battle',     note: 'разминирование в процессе' },
  pendingRocketHits:  { owner: 'lasers',     note: 'входящие ракетные удары' },
  bankHackCountToday: { owner: 'battle',     note: 'сколько сейфов вскрыто за день' },
  bankHackVictimsToday: { owner: 'battle',   note: 'по кому уже был взлом сегодня' },

  // ── Прочее ─────────────────────────────────────────────────────
  lastChatAt:         { owner: 'social',     note: 'антифлуд в чате' },
  lastAttackAt:       { owner: 'battle',     note: 'антифлуд атак' },
  recentAttacks:      { owner: 'battle',     note: 'частота атак по цели' },
  notifications:      { owner: 'notifications', note: 'уведомления (колокольчик)' },
  pushSubs:           { owner: 'notifications', note: 'подписки на push' },
  titles:             { owner: 'titles',     note: 'полученные звания' },
  activeTitle:        { owner: 'titles',     note: 'надетое звание' },
  spyReports:         { owner: 'features',   note: 'данные разведки по целям' },
  lasers:             { owner: 'lasers',     note: 'лазерные установки' },
  rockets:            { owner: 'lasers',     note: 'ракеты' },
  fame:               { owner: 'fame',       note: 'слава' },
  market:             { owner: 'market',     note: 'состояние рынка у игрока' },
  auctionWatch:       { owner: 'market',     note: 'отслеживание лотов' },
  production:         { owner: 'production', note: 'производство' },
  quests:             { owner: 'missions',   note: 'квесты' },
  contracts:          { owner: 'contracts',  note: 'контракты' },
  reserves:           { owner: 'legion',     note: 'резервы легиона у игрока' },
  // ── Дополнено после сверки реестра с реальным кодом ────────────
  // Первая версия реестра содержала только поля НОВОГО игрока, а многие
  // появляются по ходу игры. Из-за этого сезонные seasonId/seasonRating
  // оставались незарегистрированными — то есть дыра, из-за которой
  // пострадал недельный сезон, была закрыта не полностью.
  rating:             { owner: 'player',     note: 'накопительный рейтинг (победы/уши/жетоны)' },
  seasonId:           { owner: 'seasons',    note: 'идентификатор сезона у игрока' },
  seasonRating:       { owner: 'seasons',    note: 'рейтинг в текущем сезоне' },
  updatedAt:          { owner: 'db',         note: 'метка последнего изменения' },

  // Профиль и косметика
  avatar:             { owner: 'cosmetics',  note: 'аватар' },
  profileBg:          { owner: 'cosmetics',  note: 'фон профиля' },
  profileFrame:       { owner: 'cosmetics',  note: 'рамка профиля' },
  ownedCosmetics:     { owner: 'cosmetics',  note: 'купленная косметика' },
  emoji:              { owner: 'cosmetics',  note: 'эмодзи-статус' },
  tag:                { owner: 'cosmetics',  note: 'тег/приписка к позывному' },
  title:              { owner: 'titles',     note: 'звание (строкой)' },
  passport:           { owner: 'player',     note: 'паспорт/анкета игрока' },
  pinned:             { owner: 'player',     note: 'закреплённое на профиле' },

  // Постройки и вооружение
  silos:              { owner: 'lasers',     note: 'шахты' },
  silosBuiltTotal:    { owner: 'lasers',     note: 'всего построено шахт' },
  lasersBuiltTotal:   { owner: 'lasers',     note: 'всего построено лазеров' },
  mines:              { owner: 'features',   note: 'мины' },
  minesBuiltTotal:    { owner: 'features',   note: 'всего заложено мин' },
  minesSchemaV:       { owner: 'features',   note: 'версия схемы мин (миграции)' },
  reinforcements:     { owner: 'legion',     note: 'подкрепления' },
  reinforceSent:      { owner: 'legion',     note: 'отправленные подкрепления' },

  // Счётчики и метки времени
  lastBankHackDay:    { owner: 'battle',     note: 'день последнего взлома сейфа' },
  lastHospitalHeal:   { owner: 'player',     note: 'последнее лечение в лазарете' },
  lastSpyDay:         { owner: 'features',   note: 'день последней разведки' },
  spyCount:           { owner: 'features',   note: 'счётчик разведок за день' },
  skillResets:        { owner: 'player',     note: 'сколько раз сбрасывал навыки' },
  containerHistory:   { owner: 'market',     note: 'история открытых контейнеров' },
  contractsDay:       { owner: 'contracts',  note: 'день активных контрактов' },
  missionProgress:    { owner: 'missions',   note: 'прогресс по спецоперациям' },
  missionQueue:       { owner: 'missions',   note: 'очередь шагов спецоперации' },
  trophyQueue:        { owner: 'trophies',   note: 'очередь окон трофеев' },
  firstReward:        { owner: 'features',   note: 'награда за первый вход выдана' },

  // Альянс, рефералы, админские выдачи
  allianceDiplomats:  { owner: 'personalAlliance', note: 'дипломаты альянса' },
  allianceInviteLog:  { owner: 'personalAlliance', note: 'журнал приглашений' },
  blocks:             { owner: 'social',     note: 'чёрный список игрока' },
  refRewarded:        { owner: 'referrals',  note: 'награда за приглашение выдана' },
  refLevel50Paid:     { owner: 'referrals',  note: 'выплата за 50-й уровень приглашённого' },
  adminEars:          { owner: 'admin',      note: 'уши, выданные администрацией' },
  adminTokens:        { owner: 'admin',      note: 'жетоны, выданные администрацией' },

  // Поля, которые встречаются на объектах БОТОВ и во временных структурах
  // боя (бот — не запись в базе, но проходит по тем же путям кода)
  hp:                 { owner: 'battle',     note: 'HP бота во временной структуре боя' },
  loot:               { owner: 'battle',     note: 'добыча бота' },
  hitsLanded:         { owner: 'battle',     note: 'сколько раз по боту попали' },
  ops:                { owner: 'battle',     note: 'служебное поле операций' },
};

// Поля, которые НИКОГДА не должны попадать в ответы API
const SECRET_FIELDS = ['passHash', 'salt', 'resetToken', 'emailVerifyToken'];

// Поле занято? Используется тестом и может вызываться из кода перед
// добавлением новой сущности.
function isFieldTaken(name: string): boolean {
  return Object.prototype.hasOwnProperty.call(PLAYER_FIELDS, name);
}

function ownerOf(name: string): string | null {
  return isFieldTaken(name) ? PLAYER_FIELDS[name].owner : null;
}

// Проверка объекта игрока на незарегистрированные поля
function unknownFields(user: any): string[] {
  return Object.keys(user || {}).filter((k) => !isFieldTaken(k));
}

export = { PLAYER_FIELDS, SECRET_FIELDS, isFieldTaken, ownerOf, unknownFields };
