// ===================================================================
// src/routes.js — карта всех API-маршрутов
// Здесь URL связываются с функциями сервисов. Хелпер act() собирает
// уведомления (notices) и после каждого действия перепроверяет
// достижения — так награды никогда не теряются.
// ===================================================================

const config = require('../config/gameConfig');
const u = require('./core/utils');
const player = require('./services/player');
const auth = require('./services/auth');
const battle = require('./services/battle');
const missions = require('./services/missions');
const units = require('./services/units');
const buildings = require('./services/buildings');
const market = require('./services/market');
const production = require('./services/production');
const mines = require('./services/mines');
const silos = require('./services/silos');
const club = require('./services/club');
const groups = require('./services/groups');
const legion = require('./services/legion');
const social = require('./services/social');
const notifications = require('./services/notifications');
const ach = require('./services/achievements');
const trophies = require('./services/trophies');
const hospital = require('./services/hospital');
const passport = require('./services/passport');
const dailyQuests = require('./services/dailyQuests');
const tutorial = require('./services/tutorial');
const admin = require('./services/admin');

module.exports = function registerRoutes(app) {
  // Перед каждым авторизованным запросом игрок «освежается»:
  // регенерация, почасовой доход, чистка эффектов.
  app.setUserRefresher(player.refresh);

  // Обёртка для действий: собирает notices и догоняет достижения
  const act = (handler) => (req) => {
    const notices = [];
    const result = handler(req, notices) || {};
    ach.check(req.user, notices);
    return { ...result, notices };
  };

  // ---------- Авторизация (открытые маршруты) ----------
  app.add('GET', '/api/countries', () => ({ countries: config.COUNTRIES }), { open: true });
  app.add('POST', '/api/register', (req) =>
    auth.register(req.body.login, req.body.password, req.body.email, req.body.country, req.ip), { open: true });
  app.add('POST', '/api/login', (req) =>
    auth.login(req.body.login, req.body.password, req.ip), { open: true });
  app.add('POST', '/api/logout', (req) => { auth.logout(req.body.token || ''); return { ok: true }; }, { open: true });
  app.add('POST', '/api/verify-email', (req) => auth.verifyEmail(req.body.token), { open: true });
  app.add('POST', '/api/resend-verification', (req) => auth.resendVerification(req.body.login), { open: true });

  // ---------- Игрок ----------
  app.add('GET', '/api/me', (req) => ({
    ...player.mePayload(req.user),
    mailUnread: social.unread(req.user),
    notifUnread: notifications.unreadCount(req.user),
  }));
  app.add('POST', '/api/status', (req) => { player.setStatus(req.user, req.body.text); return { status: req.user.status }; });
  app.add('POST', '/api/ears/restore', act((req, n) => player.restoreEar(req.user, n)));
  app.add('POST', '/api/skill', act((req, notices) => {
    player.spendSkill(req.user, req.body.stat);
    // Сюжетное задание «Школа бойца» — единственный хук, который
    // вызывается из роутов (player не может зависеть от tutorial)
    tutorial.notify(req.user, 'skill_spent', notices);
    return { skills: req.user.skills, skillPoints: req.user.skillPoints };
  }));
  app.add('GET', '/api/profile/:id', (req) => {
    // Если ID начинается с "bot_" — отдаём профиль бота
    if (String(req.params.id).startsWith('bot_')) {
      return { profile: battle.botProfile(req.params.id, req.user) };
    }
    const target = player.users()[req.params.id];
    if (!target) throw new u.ApiError('Игрок не найден');
    player.refresh(target);
    return { profile: player.publicProfile(target, req.user) };
  });
  // Найти игрока по позывному (для выбора цели — например, ракетный удар)
  app.add('GET', '/api/find-player', (req) => {
    const found = player.findByName(req.query.name || '');
    if (!found) return { userId: null };
    return { userId: found.id, name: found.name };
  });

  // ---------- Война ----------
  app.add('GET', '/api/war/opponents', (req) => battle.opponents(req.user));
  app.add('POST', '/api/war/attack', act((req, n) => battle.attack(req.user, String(req.body.targetId || ''), n)));
  app.add('POST', '/api/war/fatality', act((req, n) => battle.fatality(req.user, req.body.choice, n)));

  // ---------- Миссии ----------
  app.add('GET',  '/api/missions',          (req) => missions.list(req.user));
  app.add('GET',  '/api/missions/:id',      (req) => missions.detail(req.user, req.params.id));
  app.add('POST', '/api/missions/start',    act((req, n) => missions.startStep(req.user, req.body.confId, u.toInt(req.body.opIdx, 0), u.toInt(req.body.stepIdx, 0), n)));
  app.add('POST', '/api/missions/boost',    act((req, n) => missions.boostStep(req.user, req.body.processId, n)));

  // ---------- Техника ----------
  app.add('GET', '/api/units', (req) => units.list(req.user));
  app.add('POST', '/api/units/buy', act((req, n) => units.buy(req.user, req.body.unitId, req.body.qty, n)));
  app.add('POST', '/api/units/sell', act((req) => units.sell(req.user, req.body.unitId, req.body.qty)));

  // ---------- Постройки ----------
  app.add('GET', '/api/buildings', (req) => buildings.list(req.user));
  app.add('POST', '/api/buildings/build', act((req, n) => buildings.build(req.user, req.body.buildingId, req.body.qty, n)));

  // ---------- Производство ----------
  app.add('GET', '/api/production', (req) => production.view(req.user));
  app.add('POST', '/api/production/workshop', act((req, n) => production.buyWorkshop(req.user, n)));
  app.add('POST', '/api/production/start',    act((req, n) => production.startModernization(req.user, req.body, n)));
  app.add('POST', '/api/production/boost',    act((req, n) => production.boostProcess(req.user, req.body.processId, n)));

  // ---------- Шахты ----------
  app.add('GET',  '/api/mines',              (req) => mines.view(req.user));
  app.add('POST', '/api/mines/build',        act((req, n) => mines.build(req.user, n)));
  app.add('POST', '/api/mines/descend',      act((req, n) => mines.descend(req.user, req.body.mineId, req.body.minutes, n)));
  app.add('POST', '/api/mines/fight',        act((req, n) => mines.fightTerrorists(req.user, req.body.mineId, n)));
  app.add('POST', '/api/mines/collect',      act((req, n) => mines.collectGold(req.user, req.body.mineId, n)));

  // ---------- Ракетные шахты ----------
  app.add('GET',  '/api/silos',              (req) => silos.view(req.user));
  app.add('POST', '/api/silos/build',        act((req, n) => silos.build(req.user, n)));
  app.add('POST', '/api/silos/boost',        act((req, n) => silos.boost(req.user, req.body.siloId, n)));
  app.add('POST', '/api/silos/fuel-ready',   act((req, n) => silos.fuelReady(req.user, req.body.siloId, req.body.amount, n)));
  app.add('POST', '/api/silos/fuel-power',   act((req, n) => silos.fuelPower(req.user, req.body.siloId, req.body.amount, n)));
  app.add('POST', '/api/silos/launch',       act((req, n) => silos.launch(req.user, req.body.siloId, req.body.targetId, n)));

  // ---------- Чёрный рынок ----------
  app.add('GET', '/api/market/items', () => market.itemsList());
  app.add('POST', '/api/market/buy', act((req, n) => market.buyItem(req.user, req.body.itemId, req.body.targetName, n)));
  app.add('GET', '/api/market/containers', (req) => market.containersView(req.user));
  app.add('POST', '/api/market/open', act((req, n) => market.openContainer(req.user, req.body.tier, n, req.body.qty)));
  app.add('GET', '/api/market/container-history', (req) => market.containerHistory(req.user));
  app.add('GET', '/api/market/auction', () => market.auctionView());
  app.add('POST', '/api/market/bid', act((req, n) => market.bid(req.user, req.body.lotId, req.body.amount, n)));

  // ---------- Клуб офицеров ----------
  app.add('GET', '/api/club', (req) => club.view(req.user));
  app.add('POST', '/api/club/riddle', act((req, n) => club.answerRiddle(req.user, req.body.answer, n)));
  app.add('POST', '/api/club/guess/start', act((req) => club.guessStart(req.user)));
  app.add('POST', '/api/club/guess', act((req, n) => club.guessTry(req.user, req.body.number, n)));
  app.add('POST', '/api/club/arm', act((req, n) => club.armWrestle(req.user, req.body.bet, n)));

  // ---------- Трофеи ----------
  app.add('GET', '/api/trophies', (req) => trophies.list(req.user));
  app.add('POST', '/api/trophies/start',   act((req, n) => trophies.startUpgrade(req.user, req.body.id, n)));
  app.add('POST', '/api/trophies/boost',   act((req, n) => trophies.boostUpgrade(req.user, req.body.id, n)));

  // ---------- Госпиталь ----------
  app.add('GET',  '/api/hospital',         (req) => hospital.view(req.user));
  app.add('POST', '/api/hospital/heal',    act((req, n) => hospital.heal(req.user, n)));

  // ---------- Паспорт (на чёрном рынке) ----------
  app.add('GET',  '/api/passport',         (req) => passport.view(req.user));
  app.add('POST', '/api/passport/name',    act((req, n) => passport.changeName(req.user, req.body.newName, n)));
  app.add('POST', '/api/passport/country', act((req, n) => passport.changeCountry(req.user, req.body.country, n)));

  // ---------- Ежедневные задания ----------
  app.add('GET',  '/api/daily',            (req) => dailyQuests.list(req.user));
  app.add('POST', '/api/daily/claim',      act((req, n) => dailyQuests.claim(req.user, req.body.questId, n)));
  app.add('POST', '/api/daily/bonus',      act((req, n) => dailyQuests.claimBonus(req.user, n)));

  // ---------- Банк ----------
  app.add('POST', '/api/bank', act((req) => {
    if (req.body.action === 'deposit') player.bankDeposit(req.user, req.body.amount);
    else if (req.body.action === 'withdraw') player.bankWithdraw(req.user, req.body.amount);
    else throw new u.ApiError('Неизвестная операция');
    return { dollars: req.user.dollars, bank: req.user.bank };
  }));
  app.add('POST', '/api/bank/reserve',         act((req, n) => player.reserveForLegion(req.user, req.body.dollars, n)));
  app.add('GET',  '/api/bank/gold-packages', (req) => ({ packages: player.goldPackages() }));
  app.add('POST', '/api/bank/buy-gold',      act((req) => player.buyGold(req.user, req.body.packId)));

  // ---------- Альянс ----------
  // ---------- Группы (альянс и легион работают через один API) ----------
  // :kind — 'alliance' или 'legion'
  app.add('GET',  '/api/group/:kind',         (req) => groups.view(req.user, req.params.kind));
  app.add('GET',  '/api/group/:kind/invites', (req) => ({ invites: groups.pendingInvites(req.user, req.params.kind) }));
  app.add('POST', '/api/group/:kind/create',  act((req, n) => groups.create(req.user, req.params.kind, req.body.name, n)));
  app.add('POST', '/api/group/:kind/apply',   act((req, n) => groups.apply(req.user, req.params.kind, req.body.groupId, n)));
  app.add('POST', '/api/group/:kind/decide',  act((req, n) => groups.decide(req.user, req.params.kind, req.body.userId, !!req.body.accept, n)));
  app.add('POST', '/api/group/:kind/invite',  act((req, n) => groups.invite(req.user, req.params.kind, req.body.userId, n)));
  app.add('POST', '/api/group/:kind/diplomat', act((req, n) => groups.hireDiplomat(req.user, req.params.kind, n)));
  app.add('POST', '/api/group/:kind/respond', act((req, n) => groups.respondInvite(req.user, req.params.kind, req.body.groupId, !!req.body.accept, n)));
  app.add('POST', '/api/group/:kind/kick',    act((req, n) => groups.kick(req.user, req.params.kind, req.body.userId, n)));
  app.add('POST', '/api/group/:kind/leave',   act((req, n) => groups.leave(req.user, req.params.kind, n)));

  // ---------- Легион: казна, постройки, кланвойны ----------
  app.add('GET',  '/api/legion',                   (req) => legion.view(req.user));
  app.add('GET',  '/api/legion/battle',             (req) => legion.battleState(req.user));
  app.add('POST', '/api/legion/deposit',           act((req, n) => legion.deposit(req.user, req.body.amount, n)));
  app.add('POST', '/api/legion/deposit-resources', act((req, n) => legion.depositResources(req.user, req.body.ears, req.body.tokens, n)));
  app.add('POST', '/api/legion/exchange',          act((req, n) => legion.exchangeToKmarks(req.user, req.body.dollars, n)));
  app.add('POST', '/api/legion/build',             act((req, n) => legion.build(req.user, req.body.buildingId, n)));
  app.add('POST', '/api/legion/build-battle',      act((req, n) => legion.buildBattle(req.user, req.body.buildingId, n)));
  app.add('POST', '/api/legion/tech/start',        act((req, n) => legion.startTech(req.user, req.body.techId, n)));
  app.add('POST', '/api/legion/shop/buy',          act((req, n) => legion.shopBuy(req.user, req.body.itemId, req.body.qty, n)));
  app.add('POST', '/api/legion/gear/pick',         act((req, n) => legion.gearPick(req.user, req.body.itemId, n)));
  app.add('POST', '/api/legion/challenge',         act((req, n) => legion.challengeLegion(req.user, req.body.enemyId, n)));
  app.add('POST', '/api/legion/challenge/accept',  act((req, n) => legion.acceptChallenge(req.user, n)));
  app.add('POST', '/api/legion/challenge/decline', act((req, n) => legion.declineChallenge(req.user, n)));
  app.add('POST', '/api/legion/war',               act((req, n) => legion.declareWar(req.user, req.body.enemyId, n)));
  app.add('POST', '/api/legion/rank',              act((req, n) => legion.setRank(req.user, req.body.targetId, req.body.rank, n)));
  app.add('GET',  '/api/legion/chat',              (req) => legion.chatGet(req.user));
  app.add('POST', '/api/legion/chat',              act((req, n) => legion.chatPost(req.user, req.body.text, n)));
  app.add('GET',  '/api/legion/public/:id',        (req) => legion.publicView(req.params.id));
  app.add('POST', '/api/legion/battle/join',       act((req, n) => legion.joinBattle(req.user, req.body.role, n)));
  app.add('POST', '/api/legion/battle/direction',  act((req, n) => legion.chooseDirection(req.user, req.body.direction, n)));
  app.add('POST', '/api/legion/battle/attack',     act((req, n) => legion.attack(req.user, req.body.targetId, n)));
  app.add('POST', '/api/legion/battle/heal',       act((req, n) => legion.heal(req.user, req.body.targetId, n)));
  app.add('POST', '/api/legion/battle/guard',      act((req, n) => legion.guard(req.user, req.body.targetId, n)));
  app.add('POST', '/api/legion/battle/item',       act((req, n) => legion.useItem(req.user, req.body.itemId, req.body.targetId, n)));

  // ---------- Чат, почта, зал славы, достижения ----------
  app.add('GET', '/api/chat', (req) => social.chatGet(req.query.after));
  app.add('POST', '/api/chat', act((req) => { social.chatPost(req.user, req.body.text); return { ok: true }; }));
  app.add('GET', '/api/mail', (req) => social.inbox(req.user));
  app.add('GET', '/api/mail/:id', (req) => social.readMail(req.user, req.params.id));
  app.add('POST', '/api/mail', act((req, n) => {
    social.sendMail(req.user, req.body.toName, req.body.subject, req.body.text);
    n.push('✉ Письмо отправлено.');
    return { ok: true };
  }));
  app.add('GET', '/api/fame', () => require('./services/fame').fame());

  // ---------- Уведомления (колокольчик) ----------
  app.add('GET',  '/api/notifications',           (req) => notifications.list(req.user));
  app.add('POST', '/api/notifications/:id/read',  act((req) => { notifications.markRead(req.user, req.params.id); return { ok: true }; }));
  app.add('POST', '/api/notifications/read-all',  act((req) => { notifications.markAllRead(req.user); return { ok: true }; }));
  app.add('GET', '/api/achievements', (req) => ach.list(req.user));

  // ---------- Администратор ----------
  app.add('GET', '/api/admin/players', (req) => admin.listPlayers(req.query.q), { admin: true });
  app.add('POST', '/api/admin/grant',      act((req, n) => admin.grant(req.user, req.body, n)),    { admin: true });
  app.add('POST', '/api/admin/grant-all',  act((req, n) => admin.grantAll(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/claim-gift', act((req, n) => { const r = admin.claimGift(req.user, req.body.giftId); n.push('OK'); return r; }));
  app.add('GET',  '/api/admin/discounts', () => admin.discountCategories(), { admin: true });
  app.add('POST', '/api/admin/discount',  act((req, n) => admin.setDiscount(req.user, req.body, n)), { admin: true });
  app.add('GET',  '/api/admin/global-buffs', () => admin.listGlobalBuffs(), { admin: true });
  app.add('POST', '/api/admin/global-buff',  act((req, n) => admin.setGlobalBuff(req.user, req.body, n)), { admin: true });
  app.add('GET',  '/api/admin/logs',      (req) => admin.listLogs(req.query), { admin: true });
};
