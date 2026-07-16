// ===================================================================
// src/services/push.ts — push-уведомления на телефон (Web Push)
//
// Работают, когда игра закрыта: «на вас напали», «бой легиона через
// 10 минут», «ставку перебили» и т.п. Подключены к общей системе
// уведомлений (notifications.push) — отдельного вызова не требуется,
// достаточно чтобы тип события был в PUSH_KINDS.
//
// Ключи VAPID: берутся из .env (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY),
// а если их там нет — генерируются один раз и сохраняются в БД, чтобы
// подписки не сломались при перезапуске.
//
// Android/десктоп — работает в браузере и в APK. iOS — только если игра
// добавлена на экран «Домой» (требование Apple, iOS 16.4+).
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');

const webpush = require('web-push');

interface Sub {
  endpoint: string;
  keys: { p256dh: string; auth: string };
  at: number;
}

// Типы событий, которые ДОСТОЙНЫ звонка на телефон. Рутину (постройки,
// улучшения технологий) сознательно не шлём, чтобы игру не выключили.
const PUSH_KINDS = new Set([
  'legion_challenge', 'legion_war', 'legion_battle_start', 'legion_battle_active', 'legion_battle_result',
  'attack_lost', 'attack_defended',
  'fatality_ear', 'fatality_escape', 'fatality_mercy',
  'rocket_incoming', 'rocket_hit', 'rocket_intercepted', 'rocket_shot_down', 'mine_terror',
  'auction_outbid', 'auction_won',
  'admin_gift', 'sanction_executed', 'debuff_applied',
  'alliance_invite', 'group_join_request', 'group_invite_accepted',
]);

// Куда вести игрока по клику на уведомление
const KIND_URL: Record<string, string> = {
  legion_challenge: '/#legion', legion_war: '/#legion', legion_battle_start: '/#legion',
  legion_battle_active: '/#legion', legion_battle_result: '/#legion',
  group_join_request: '/#legion', group_invite_accepted: '/#legion', alliance_invite: '/#alliance',
  attack_lost: '/#war', attack_defended: '/#war',
  fatality_ear: '/#war', fatality_escape: '/#war', fatality_mercy: '/#war',
  rocket_incoming: '/#war', rocket_hit: '/#war', rocket_intercepted: '/#war', rocket_shot_down: '/#war',
  mine_terror: '/#war', debuff_applied: '/#home', sanction_executed: '/#home',
  auction_outbid: '/#market', auction_won: '/#market', admin_gift: '/#home',
};

let ready = false;
let publicKey = '';

function subsStore(): Record<string, Sub[]> {
  return db.load<Record<string, Sub[]>>('pushsubs', {});
}

// ── Инициализация: ключи VAPID ────────────────────────────────────
function init(): void {
  if (ready) return;
  let pub = process.env.VAPID_PUBLIC_KEY || '';
  let priv = process.env.VAPID_PRIVATE_KEY || '';

  if (!pub || !priv) {
    // Ключей в .env нет — берём сохранённые ранее либо генерируем новые.
    // Хранение в БД важно: при смене ключей ВСЕ подписки становятся
    // недействительными, и игроки перестают получать уведомления.
    const cfg = db.load<any>('pushconfig', {});
    if (cfg.publicKey && cfg.privateKey) {
      pub = cfg.publicKey; priv = cfg.privateKey;
    } else {
      const gen = webpush.generateVAPIDKeys();
      pub = gen.publicKey; priv = gen.privateKey;
      cfg.publicKey = pub; cfg.privateKey = priv; cfg.createdAt = Date.now();
      db.save('pushconfig');
      console.log('🔔 Сгенерированы VAPID-ключи для push-уведомлений (сохранены в БД).');
    }
  }
  const contact = process.env.PUSH_CONTACT || 'mailto:admin@alliance-generals.game';
  webpush.setVapidDetails(contact, pub, priv);
  publicKey = pub;
  ready = true;
}

function getPublicKey(): string {
  init();
  return publicKey;
}

// ── Подписка/отписка устройства ───────────────────────────────────
function subscribe(user: any, sub: any) {
  init();
  if (!sub || !sub.endpoint || !sub.keys || !sub.keys.p256dh || !sub.keys.auth) {
    throw new u.ApiError('Некорректная подписка');
  }
  const all = subsStore();
  const list = all[user.id] || (all[user.id] = []);
  // Один и тот же браузер может переподписаться — обновляем, не плодим дубли
  const idx = list.findIndex((s) => s.endpoint === sub.endpoint);
  const rec: Sub = { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth }, at: Date.now() };
  if (idx >= 0) list[idx] = rec; else list.push(rec);
  if (list.length > 10) list.splice(0, list.length - 10);   // разумный предел устройств
  db.save('pushsubs');
  return { ok: true, devices: list.length };
}

function unsubscribe(user: any, endpoint: string) {
  const all = subsStore();
  const list = all[user.id] || [];
  const before = list.length;
  all[user.id] = list.filter((s) => s.endpoint !== endpoint);
  db.save('pushsubs');
  return { ok: true, removed: before - all[user.id].length };
}

function deviceCount(user: any): number {
  return (subsStore()[user.id] || []).length;
}

// ── Отправка ──────────────────────────────────────────────────────
// Не бросает исключений: уведомление не должно ломать игровое действие.
async function sendToUser(userId: string, payload: { title: string; body: string; url?: string; tag?: string }): Promise<number> {
  init();
  const all = subsStore();
  const list = all[userId] || [];
  if (!list.length) return 0;

  const data = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url: payload.url || '/',
    tag: payload.tag || 'ag',
  });

  let sent = 0;
  const dead: string[] = [];
  await Promise.all(list.map(async (s) => {
    try {
      await webpush.sendNotification({ endpoint: s.endpoint, keys: s.keys }, data, { TTL: 3600 });
      sent++;
    } catch (e: any) {
      // 404/410 — подписка мертва (игрок удалил игру/почистил браузер)
      const code = e && e.statusCode;
      if (code === 404 || code === 410) dead.push(s.endpoint);
    }
  }));

  if (dead.length) {
    all[userId] = list.filter((s) => !dead.includes(s.endpoint));
    db.save('pushsubs');
  }
  return sent;
}

// Вызывается из notifications.push() — решает, слать ли на телефон
function onNotification(userId: string, kind: string, title: string, payload: any): void {
  if (!PUSH_KINDS.has(kind)) return;
  const body = (payload && (payload.text || payload.enemyName)) ? String(payload.text || '') : '';
  // fire-and-forget: сеть до push-сервиса не должна тормозить игру
  sendToUser(userId, {
    title: title || 'Альянс Генералов',
    body: body || '',
    url: KIND_URL[kind] || '/',
    tag: kind,
  }).catch(() => {});
}

// Админская рассылка всем подписанным
async function broadcast(adminUser: any, title: string, body: string, notices: any) {
  if (!adminUser || !adminUser.isAdmin) throw new u.ApiError('Только для администратора');
  const t = String(title || '').trim().slice(0, 80);
  const b = String(body || '').trim().slice(0, 200);
  if (!t) throw new u.ApiError('Укажите заголовок');
  const all = subsStore();
  let sent = 0;
  for (const userId of Object.keys(all)) {
    sent += await sendToUser(userId, { title: t, body: b, url: '/', tag: 'admin' });
  }
  notices.push(`🔔 Уведомление отправлено на ${sent} устройств.`);
  return { sent };
}

function adminStats() {
  const all = subsStore();
  const users = Object.keys(all).filter((k) => (all[k] || []).length > 0);
  const devices = users.reduce((s, k) => s + all[k].length, 0);
  return { users: users.length, devices };
}

export = { init, getPublicKey, subscribe, unsubscribe, deviceCount, sendToUser, onNotification, broadcast, adminStats, PUSH_KINDS };
