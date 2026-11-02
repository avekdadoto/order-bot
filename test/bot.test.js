// Тесты без интернета: вместо Telegram подставляем заглушку, которая запоминает вызовы.
// Запуск: npm test

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Shop } = require('../src/shop');
const { createBot } = require('../src/bot');

const catalog = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'catalog.json'), 'utf8'));
const ADMIN = 999;
const USER = 111;

function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'bot-')), 'orders.json');
  const shop = new Shop(catalog, file);
  const calls = [];
  const api = async (method, params) => { calls.push({ method, ...params }); return {}; };
  const bot = createBot({ api, shop, adminId: ADMIN });

  let updateId = 0;
  const say = (text, extra = {}) =>
    bot({ update_id: ++updateId, message: { chat: { id: USER }, from: { id: USER }, text, ...extra } });
  const press = (data, from = USER) =>
    bot({ update_id: ++updateId, callback_query: { id: 'q', data, from: { id: from }, message: { chat: { id: from }, message_id: 1 } } });
  const last = () => calls[calls.length - 1];

  return { shop, calls, say, press, last, file };
}

test('корзина считает сумму', () => {
  const { shop } = setup();
  shop.addToCart(USER, 'cappuccino');
  shop.addToCart(USER, 'cappuccino');
  shop.addToCart(USER, 'croissant');
  assert.strictEqual(shop.cartTotal(USER), 14 * 2 + 8);
  shop.removeOne(USER, 'cappuccino');
  assert.strictEqual(shop.cartTotal(USER), 14 + 8);
  assert.strictEqual(shop.addToCart(USER, 'nope'), false);
});

test('полный заказ с доставкой доходит до продавца', async () => {
  const { shop, calls, say, press, last, file } = setup();

  await say('/start');
  assert.match(last().text, /Добро пожаловать/);

  await press('add:flatwhite');
  await press('add:cheesecake');
  await press('cart');
  assert.match(last().text, /Итого: 34 zł/);

  await press('checkout');
  await say('Аня');
  await say('123'); // плохой номер
  assert.match(last().text, /не номер/);
  await say('', { contact: { phone_number: '+48600100200' } });
  await press('deliv:courier');
  await say('Puławska 12/4');
  assert.match(last().text, /Проверьте заказ/);
  await press('confirm');

  const toAdmin = calls.find(c => c.chat_id === ADMIN);
  assert.ok(toAdmin, 'продавец получил заказ');
  assert.match(toAdmin.text, /Заказ №1[\s\S]*Puławska 12\/4/);
  assert.strictEqual(shop.cartItems(USER).length, 0, 'корзина очищена');
  assert.strictEqual(JSON.parse(fs.readFileSync(file, 'utf8')).length, 1, 'заказ сохранён в файл');

  await press('adm:accept:1', ADMIN);
  const toUser = calls.filter(c => c.chat_id === USER).pop();
  assert.match(toUser.text, /подтверждён/);

  // повторное нажатие не меняет статус
  await press('adm:reject:1', ADMIN);
  assert.match(last().text, /уже обработан/);
  assert.strictEqual(shop.findOrder(1).status, 'accepted');
});

test('чужой человек не может принять заказ', async () => {
  const { shop, say, press, last } = setup();
  await press('add:espresso');
  await press('checkout');
  await say('Петя');
  await say('+48 511 222 333');
  await press('deliv:pickup');
  await press('confirm');

  await press('adm:accept:1', USER);
  assert.match(last().text, /для продавца/);
  assert.strictEqual(shop.findOrder(1).status, 'new');
});

test('нельзя оформить пустую корзину', async () => {
  const { press, last } = setup();
  await press('checkout');
  assert.match(last().text, /Корзина пустая/);
});
