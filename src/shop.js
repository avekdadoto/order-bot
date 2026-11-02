// Логика магазина: корзина, суммы, заказы.
// Тут НЕТ ничего про Telegram — поэтому этот файл легко тестировать.

const fs = require('fs');
const path = require('path');

class Shop {
  constructor(catalog, ordersFile) {
    this.catalog = catalog;
    this.ordersFile = ordersFile;
    this.carts = new Map(); // userId -> Map(productId -> количество)
    this.orders = this.loadOrders();
  }

  // ---------- Каталог ----------

  findProduct(id) {
    return this.catalog.products.find(p => p.id === id);
  }

  money(amount) {
    return `${amount} ${this.catalog.currency}`;
  }

  // ---------- Корзина ----------

  getCart(userId) {
    if (!this.carts.has(userId)) this.carts.set(userId, new Map());
    return this.carts.get(userId);
  }

  addToCart(userId, productId) {
    if (!this.findProduct(productId)) return false;
    const cart = this.getCart(userId);
    cart.set(productId, (cart.get(productId) || 0) + 1);
    return true;
  }

  removeOne(userId, productId) {
    const cart = this.getCart(userId);
    const qty = cart.get(productId) || 0;
    if (qty <= 1) cart.delete(productId);
    else cart.set(productId, qty - 1);
  }

  clearCart(userId) {
    this.carts.delete(userId);
  }

  // Список позиций: [{ product, qty, sum }]
  cartItems(userId) {
    const items = [];
    for (const [id, qty] of this.getCart(userId)) {
      const product = this.findProduct(id);
      if (product) items.push({ product, qty, sum: product.price * qty });
    }
    return items;
  }

  cartTotal(userId) {
    return this.cartItems(userId).reduce((total, item) => total + item.sum, 0);
  }

  cartText(userId) {
    const items = this.cartItems(userId);
    if (items.length === 0) return 'Корзина пустая.';
    const lines = items.map(i => `• ${i.product.name} × ${i.qty} = ${this.money(i.sum)}`);
    return `${lines.join('\n')}\n\nИтого: ${this.money(this.cartTotal(userId))}`;
  }

  // ---------- Заказы ----------

  // customer = { userId, name, phone, delivery }
  createOrder(customer) {
    const items = this.cartItems(customer.userId);
    if (items.length === 0) return null;

    const order = {
      id: this.orders.length + 1,
      ...customer,
      items: items.map(i => ({ name: i.product.name, qty: i.qty, sum: i.sum })),
      total: this.cartTotal(customer.userId),
      status: 'new', // new -> accepted / rejected
      createdAt: new Date().toISOString(),
    };

    this.orders.push(order);
    this.saveOrders();
    this.clearCart(customer.userId);
    return order;
  }

  findOrder(id) {
    return this.orders.find(o => o.id === id);
  }

  setStatus(id, status) {
    const order = this.findOrder(id);
    if (!order || order.status !== 'new') return null; // повторно менять нельзя
    order.status = status;
    this.saveOrders();
    return order;
  }

  orderText(order) {
    const lines = order.items.map(i => `• ${i.name} × ${i.qty} = ${this.money(i.sum)}`);
    return [
      `Заказ №${order.id}`,
      ...lines,
      `Итого: ${this.money(order.total)}`,
      '',
      `Имя: ${order.name}`,
      `Телефон: ${order.phone}`,
      `Получение: ${order.delivery}`,
    ].join('\n');
  }

  // ---------- Сохранение в файл ----------

  loadOrders() {
    try {
      return JSON.parse(fs.readFileSync(this.ordersFile, 'utf8'));
    } catch {
      return []; // файла ещё нет — начинаем с пустого списка
    }
  }

  saveOrders() {
    fs.mkdirSync(path.dirname(this.ordersFile), { recursive: true });
    fs.writeFileSync(this.ordersFile, JSON.stringify(this.orders, null, 2));
  }
}

module.exports = { Shop };
