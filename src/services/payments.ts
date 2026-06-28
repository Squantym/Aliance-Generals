// ===================================================================
// src/services/payments.ts — ЗАГОТОВКА платёжной системы.
// Здесь подготовлена структура для будущей интеграции с платёжным
// провайдером (ЮKassa, Stripe, CloudPayments и т.п.).
//
// СЕЙЧАС: только каталог пакетов и история заказов в статусе 'pending'.
// Реальное списание/зачисление НЕ происходит — это появится после
// подключения провайдера (создание платежа, webhook подтверждения).
//
// Хранение: коллекция 'payments' = { [orderId]: PaymentOrder }
// ===================================================================

import db = require('../core/db');
import u = require('../core/utils');
import type { User, Notices } from '../types';

// Каталог пакетов золота (цены в рублях — пример, настроить под провайдера)
const PACKAGES = [
  { id: 'gold_100',  gold: 100,  priceRub: 99,   label: '100 золота' },
  { id: 'gold_550',  gold: 550,  priceRub: 490,  label: '550 золота', bonus: '+10%' },
  { id: 'gold_1200', gold: 1200, priceRub: 990,  label: '1200 золота', bonus: '+20%' },
  { id: 'gold_3300', gold: 3300, priceRub: 2490, label: '3300 золота', bonus: '+30%' },
];

interface PaymentOrder {
  id: string;
  userId: string;
  packageId: string;
  gold: number;
  priceRub: number;
  status: 'pending' | 'paid' | 'failed' | 'cancelled';
  createdAt: number;
  paidAt?: number;
  provider?: string;       // имя провайдера после интеграции
  providerRef?: string;    // id платежа у провайдера
}

function store(): Record<string, PaymentOrder> {
  return db.load<Record<string, PaymentOrder>>('payments', {});
}

// Каталог пакетов (для витрины)
function packages() {
  return { packages: PACKAGES, enabled: false, note: 'Платёжная система скоро будет доступна.' };
}

// Создать заказ (заготовка). Реальная оплата появится после интеграции —
// сейчас заказ создаётся в статусе pending и НЕ зачисляет золото.
function createOrder(user: User, packageId: string, notices: Notices) {
  const pkg = PACKAGES.find((p) => p.id === packageId);
  if (!pkg) throw new u.ApiError('Пакет не найден');

  const order: PaymentOrder = {
    id: u.uid(16),
    userId: user.id,
    packageId: pkg.id,
    gold: pkg.gold,
    priceRub: pkg.priceRub,
    status: 'pending',
    createdAt: Date.now(),
  };
  const all = store();
  all[order.id] = order;
  db.save('payments');

  // ЗАГОТОВКА: здесь будет вызов провайдера для создания платежа и
  // возврат ссылки на оплату. Пока возвращаем заглушку.
  notices.push('🛒 Заказ создан. Онлайн-оплата появится после подключения платёжной системы.');
  return { orderId: order.id, status: order.status, payUrl: null };
}

// История заказов игрока
function myOrders(user: User) {
  const all = store();
  const list = Object.values(all)
    .filter((o) => o.userId === user.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((o) => ({
      id: o.id, gold: o.gold, priceRub: o.priceRub,
      status: o.status, createdAt: o.createdAt, paidAt: o.paidAt || null,
    }));
  return { orders: list };
}

// ── ЗАГОТОВКА: подтверждение оплаты (вызовется из webhook провайдера) ──
// Когда провайдер подтвердит платёж — эта функция зачислит золото.
// Сейчас не вызывается ниоткуда (нет webhook-маршрута).
function confirmPayment(orderId: string): { ok: boolean } {
  const all = store();
  const order = all[orderId];
  if (!order || order.status !== 'pending') return { ok: false };
  const players: Record<string, User> = require('./player').users();
  const user = players[order.userId];
  if (!user) return { ok: false };

  require('./player').addGold(user, order.gold);
  order.status = 'paid';
  order.paidAt = Date.now();
  db.save('payments');
  db.save('users');
  try {
    require('./notifications').push(order.userId, 'payment_done',
      `💎 Покупка успешна! Зачислено 🪙 ${order.gold}.`, { orderId });
  } catch (e) {}
  return { ok: true };
}

export = { packages, createOrder, myOrders, confirmPayment };
