// ===================================================================
// src/routes.ts — карта всех API-маршрутов
// Здесь URL связываются с функциями сервисов. Хелпер act() собирает
// уведомления (notices) и после каждого действия перепроверяет
// достижения — так награды никогда не теряются.
// ===================================================================

import config = require('../config/gameConfig');
import u = require('./core/utils');
import player = require('./services/player');
import auth = require('./services/auth');
import battle = require('./services/battle');
import sanctions = require('./services/sanctions');
import missions = require('./services/missions');
import units = require('./services/units');
import buildings = require('./services/buildings');
import market = require('./services/market');
import production = require('./services/production');
import mines = require('./services/mines');
import silos = require('./services/silos');
import club = require('./services/club');
import groups = require('./services/groups');
import legion = require('./services/legion');
import social = require('./services/social');
import notifications = require('./services/notifications');
import ach = require('./services/achievements');
import trophies = require('./services/trophies');
import hospital = require('./services/hospital');
import passport = require('./services/passport');
import dailyQuests = require('./services/dailyQuests');
import tutorial = require('./services/tutorial');
import admin = require('./services/admin');
import support = require('./services/support');
import payments = require('./services/payments');

function registerRoutes(app: any) {
  // Перед каждым авторизованным запросом игрок «освежается»:
  // регенерация, почасовой доход, чистка эффектов.
  app.setUserRefresher(player.refresh);

  // Обёртка для действий: собирает notices и догоняет достижения
  const act = (handler: any) => (req: any) => {
    const notices: string[] = [];
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
    supportUnread: support.myTickets(req.user).open.filter((t: any) => t.status === 'answered' || t.lastFrom === 'admin').length,
  }));
  app.add('POST', '/api/status', (req) => { player.setStatus(req.user, req.body.text); return { status: req.user.status }; });
  app.add('POST', '/api/verify-human', (req) => require('./services/antibot').passVerification(req.user));
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
  app.add('GET',  '/api/sanctions', (req) => sanctions.list(req.user));
  app.add('POST', '/api/sanctions/declare', act((req, n) => sanctions.declare(req.user, String(req.body.targetId || ''), req.body.amount, n)));
  app.add('POST', '/api/war/fatality', act((req, n) => battle.fatality(req.user, req.body.choice, n)));
  app.add('POST', '/api/war/ear-message', act((req, n) => battle.leaveEarMessage(req.user, String(req.body.victimId || ''), String(req.body.text || ''), n)));

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
  app.add('POST', '/api/mines/rebuild',      act((req, n) => mines.rebuild(req.user, req.body.mineId, n)));
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
  // 1. Военный преферанс
  app.add('POST', '/api/club/pref/start', act((req) => club.prefStart(req.user)));
  app.add('POST', '/api/club/pref/hit',   act((req, n) => club.prefHit(req.user, n)));
  app.add('POST', '/api/club/pref/stand', act((req, n) => club.prefStand(req.user, n)));
  // 2. Сейф штаба
  app.add('POST', '/api/club/safe/start', act((req) => club.safeStart(req.user)));
  app.add('POST', '/api/club/safe/try',   act((req, n) => club.safeTry(req.user, req.body.guess, n)));
  // 3. Минное поле
  app.add('POST', '/api/club/mine/start',   act((req) => club.mineStart(req.user)));
  app.add('POST', '/api/club/mine/open',    act((req, n) => club.mineOpen(req.user, req.body.cell, n)));
  app.add('POST', '/api/club/mine/cashout', act((req, n) => club.mineCashout(req.user, n)));
  // 4. Полоса препятствий
  app.add('POST', '/api/club/run/start',   act((req) => club.runStart(req.user)));
  app.add('POST', '/api/club/run/step',    act((req, n) => club.runStep(req.user, req.body.level, n)));
  app.add('POST', '/api/club/run/cashout', act((req, n) => club.runCashout(req.user, n)));
  // 5. Штабная партия
  app.add('POST', '/api/club/duel/start', act((req) => club.duelStart(req.user)));
  app.add('POST', '/api/club/duel/move',  act((req, n) => club.duelMove(req.user, req.body.unit, n)));

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
  app.add('POST', '/api/legion/deposit-resources', act((req, n) => legion.depositResources(req.user, req.body.ears, req.body.tokens, req.body.useAdmin, n)));
  app.add('POST', '/api/legion/exchange',          act((req, n) => legion.exchangeToReserves(req.user, req.body.dollars, n)));
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
  app.add('POST', '/api/legion/battle/ready',      act((req, n) => legion.setReady(req.user, req.body.ready, n)));
  app.add('POST', '/api/legion/battle/direction',  act((req, n) => legion.chooseDirection(req.user, req.body.direction, n)));
  app.add('POST', '/api/legion/battle/attack',     act((req, n) => legion.attack(req.user, req.body.targetId, n)));
  app.add('POST', '/api/legion/battle/heal',       act((req, n) => legion.heal(req.user, req.body.targetId, n)));
  app.add('POST', '/api/legion/battle/chat',       act((req, n) => legion.sendChat(req.user, String(req.body.scope||'team'), String(req.body.text||''), n)));
  app.add('POST', '/api/legion/battle/guard',      act((req, n) => legion.guard(req.user, req.body.targetId, n)));
  app.add('POST', '/api/legion/battle/item',       act((req, n) => legion.useItem(req.user, req.body.itemId, req.body.targetId, n)));
  app.add('POST', '/api/legion/battle/leave',      act((req, n) => legion.leaveBattle(req.user, n)));

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
  // Принудительный сброс снапшота «за сегодня» (только для администратора)
  app.add('POST', '/api/admin/fame/reset-snapshot', (req) => {
    require('./services/fame').forceResetSnapshot();
    return { ok: true, message: 'Снапшот сброшен. При следующем запросе /api/fame создастся новый.' };
  }, { admin: true });

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
  // Бан и обнуление аккаунтов
  app.add('POST', '/api/admin/ban',   act((req, n) => admin.setBan(req.user, req.body, n)), { admin: true });
  app.add('POST', '/api/admin/reset', act((req, n) => admin.resetAccount(req.user, req.body, n)), { admin: true });
  // Служба поддержки — пользователь
  app.add('GET',  '/api/support',        (req) => support.myTickets(req.user));
  app.add('POST', '/api/support/create', act((req, n) => support.createTicket(req.user, req.body.subject, req.body.text, n)));
  app.add('POST', '/api/support/reply',  act((req, n) => support.replyTicket(req.user, req.body.ticketId, req.body.text, n)));
  // Служба поддержки — администратор
  app.add('GET',  '/api/admin/support',       (req) => support.adminList(req.query), { admin: true });
  app.add('POST', '/api/admin/support/reply', act((req, n) => support.adminReply(req.user, req.body.ticketId, req.body.text, !!req.body.close, n)), { admin: true });
  // Платёжная система (заготовка)
  app.add('GET',  '/api/payments/packages', (req) => payments.packages());
  app.add('GET',  '/api/payments/orders',   (req) => payments.myOrders(req.user));
  app.add('POST', '/api/payments/create',   act((req, n) => payments.createOrder(req.user, req.body.packageId, n)));
};

export = registerRoutes;
