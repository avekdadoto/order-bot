// Обработка сообщений и кнопок Telegram.
// api(method, params) — функция, которая вызывает Telegram Bot API.
// Её передают снаружи, поэтому в тестах вместо Telegram можно подставить заглушку.

function createBot({ api, shop, adminId }) {
  // Где пользователь находится в оформлении заказа: userId -> { step, data }
  const checkout = new Map();

  // ---------- Клавиатуры (кнопки под сообщением) ----------

  const button = (text, data) => ({ text, callback_data: data });
  const inline = rows => ({ inline_keyboard: rows });

  const mainMenu = () => inline([
    [button('🛍 Каталог', 'catalog')],
    [button('🧺 Корзина', 'cart')],
    [button('ℹ️ О нас', 'about')],
  ]);

  const catalogMenu = () => inline([
    ...shop.catalog.products.map(p => [button(`${p.name} — ${shop.money(p.price)}`, `p:${p.id}`)]),
    [button('🧺 Корзина', 'cart'), button('⬅️ Меню', 'menu')],
  ]);

  const productMenu = id => inline([
    [button('➕ В корзину', `add:${id}`)],
    [button('⬅️ Каталог', 'catalog'), button('🧺 Корзина', 'cart')],
  ]);

  const cartMenu = userId => {
    const rows = shop.cartItems(userId).map(i => [
      button('➖', `minus:${i.product.id}`),
      button(`${i.product.name} × ${i.qty}`, `p:${i.product.id}`),
      button('➕', `plus:${i.product.id}`),
    ]);
    if (rows.length > 0) {
      rows.push([button('✅ Оформить заказ', 'checkout')]);
      rows.push([button('🗑 Очистить', 'clear')]);
    }
    rows.push([button('🛍 Каталог', 'catalog'), button('⬅️ Меню', 'menu')]);
    return inline(rows);
  };

  // Обычная клавиатура с кнопкой «отправить номер»
  const phoneKeyboard = {
    keyboard: [[{ text: '📱 Отправить мой номер', request_contact: true }]],
    resize_keyboard: true,
    one_time_keyboard: true,
  };
  const removeKeyboard = { remove_keyboard: true };

  // ---------- Отправка ----------

  const send = (chatId, text, markup) =>
    api('sendMessage', { chat_id: chatId, text, reply_markup: markup });

  // Если нажали кнопку — редактируем то же сообщение, чтобы чат не засорялся
  const show = (chatId, text, markup, messageId) =>
    messageId
      ? api('editMessageText', { chat_id: chatId, message_id: messageId, text, reply_markup: markup })
      : send(chatId, text, markup);

  // ---------- Экраны ----------

  const screens = {
    menu: (chatId, msgId) =>
      show(chatId, `Добро пожаловать в ${shop.catalog.shopName}! ☕\n\n🧪 Это демо-бот из портфолио avekda.\nПопробуйте оформить заказ — всё работает как в настоящем боте.\n\nВыберите, что сделать:`, mainMenu(), msgId),

    about: (chatId, msgId) =>
      show(chatId, shop.catalog.about, inline([[button('⬅️ Меню', 'menu')]]), msgId),

    catalog: (chatId, msgId) =>
      show(chatId, 'Каталог. Нажмите на товар:', catalogMenu(), msgId),

    product: (chatId, msgId, id) => {
      const p = shop.findProduct(id);
      if (!p) return screens.catalog(chatId, msgId);
      return show(chatId, `${p.name}\n${p.description}\n\nЦена: ${shop.money(p.price)}`, productMenu(id), msgId);
    },

    cart: (chatId, msgId, userId) =>
      show(chatId, `🧺 Ваша корзина\n\n${shop.cartText(userId)}`, cartMenu(userId), msgId),
  };

  // ---------- Оформление заказа (по шагам) ----------

  async function startCheckout(chatId, userId) {
    if (shop.cartItems(userId).length === 0) return send(chatId, 'Корзина пустая, сначала добавьте товары.', mainMenu());
    checkout.set(userId, { step: 'name', data: {} });
    return send(chatId, 'Как вас зовут?');
  }

  async function checkoutStep(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const state = checkout.get(userId);
    const text = (msg.text || '').trim();

    if (state.step === 'name') {
      if (text.length < 2) return send(chatId, 'Напишите имя текстом.');
      state.data.name = text;
      state.step = 'phone';
      return send(chatId, 'Ваш номер телефона? Нажмите кнопку или напишите вручную.', phoneKeyboard);
    }

    if (state.step === 'phone') {
      const phone = msg.contact ? msg.contact.phone_number : text;
      if (phone.replace(/\D/g, '').length < 9) return send(chatId, 'Похоже, это не номер. Пример: +48 600 100 200', phoneKeyboard);
      state.data.phone = phone;
      state.step = 'delivery';
      await send(chatId, 'Номер записал 👍', removeKeyboard);
      return send(chatId, 'Как получить заказ?', inline([
        [button('🏃 Самовывоз', 'deliv:pickup')],
        [button('🚲 Доставка', 'deliv:courier')],
      ]));
    }

    if (state.step === 'address') {
      if (text.length < 5) return send(chatId, 'Напишите адрес полностью: улица, дом, квартира.');
      state.data.delivery = `Доставка: ${text}`;
      return askConfirm(chatId, userId);
    }

    return send(chatId, 'Выберите вариант кнопкой выше.');
  }

  function askConfirm(chatId, userId) {
    const state = checkout.get(userId);
    state.step = 'confirm';
    const d = state.data;
    const text = [
      'Проверьте заказ:',
      '',
      shop.cartText(userId),
      '',
      `Имя: ${d.name}`,
      `Телефон: ${d.phone}`,
      `Получение: ${d.delivery}`,
    ].join('\n');
    return send(chatId, text, inline([
      [button('✅ Подтвердить', 'confirm')],
      [button('❌ Отменить', 'cancel')],
    ]));
  }

  async function confirmOrder(chatId, userId, msgId) {
    const state = checkout.get(userId);
    if (!state || state.step !== 'confirm') return;
    const order = shop.createOrder({ userId, chatId, ...state.data });
    checkout.delete(userId);
    if (!order) return show(chatId, 'Корзина пустая, заказ не создан.', mainMenu(), msgId);

    await show(chatId, `Спасибо! Заказ №${order.id} принят и передан в кофейню. Мы напишем, когда его подтвердят.`, mainMenu(), msgId);

    if (adminId) {
      await send(adminId, `🆕 Новый ${shop.orderText(order)}`, inline([
        [button('✅ Принять', `adm:accept:${order.id}`), button('❌ Отклонить', `adm:reject:${order.id}`)],
      ]));
    }
  }

  // ---------- Кнопки продавца ----------

  async function adminAction(query, action, orderId) {
    if (String(query.from.id) !== String(adminId)) {
      return api('answerCallbackQuery', { callback_query_id: query.id, text: 'Это кнопка для продавца.' });
    }
    const status = action === 'accept' ? 'accepted' : 'rejected';
    const order = shop.setStatus(Number(orderId), status);
    if (!order) {
      return api('answerCallbackQuery', { callback_query_id: query.id, text: 'Заказ уже обработан.' });
    }
    const label = status === 'accepted' ? '✅ Принят' : '❌ Отклонён';
    await api('editMessageText', {
      chat_id: query.message.chat.id,
      message_id: query.message.message_id,
      text: `${shop.orderText(order)}\n\nСтатус: ${label}`,
    });
    const toCustomer = status === 'accepted'
      ? `Ваш заказ №${order.id} подтверждён и уже готовится ☕`
      : `К сожалению, заказ №${order.id} не можем выполнить. Позвоните нам, и мы всё уладим.`;
    return send(order.chatId, toCustomer);
  }

  // ---------- Главный обработчик ----------

  async function handleMessage(msg) {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = (msg.text || '').trim();

    if (text === '/start' || text === '/menu') {
      checkout.delete(userId);
      return screens.menu(chatId);
    }
    if (text === '/id') return send(chatId, `Ваш chat id: ${chatId}`);
    if (text === '/cancel') {
      checkout.delete(userId);
      return send(chatId, 'Оформление отменено.', mainMenu());
    }
    if (checkout.has(userId)) return checkoutStep(msg);

    return send(chatId, 'Не понял 🤔 Нажмите кнопку в меню.', mainMenu());
  }

  async function handleCallback(query) {
    const chatId = query.message.chat.id;
    const msgId = query.message.message_id;
    const userId = query.from.id;
    const [action, arg, arg2] = query.data.split(':');

    // Убираем «часики» на кнопке. Ответ продавцу даём внутри adminAction.
    if (action !== 'adm') await api('answerCallbackQuery', { callback_query_id: query.id });

    switch (action) {
      case 'menu': return screens.menu(chatId, msgId);
      case 'about': return screens.about(chatId, msgId);
      case 'catalog': return screens.catalog(chatId, msgId);
      case 'p': return screens.product(chatId, msgId, arg);
      case 'cart': return screens.cart(chatId, msgId, userId);
      case 'add':
        shop.addToCart(userId, arg);
        return api('sendMessage', { chat_id: chatId, text: `Добавил в корзину: ${shop.findProduct(arg)?.name}` });
      case 'plus':
        shop.addToCart(userId, arg);
        return screens.cart(chatId, msgId, userId);
      case 'minus':
        shop.removeOne(userId, arg);
        return screens.cart(chatId, msgId, userId);
      case 'clear':
        shop.clearCart(userId);
        return screens.cart(chatId, msgId, userId);
      case 'checkout': return startCheckout(chatId, userId);
      case 'deliv': {
        const state = checkout.get(userId);
        if (!state || state.step !== 'delivery') return;
        if (arg === 'pickup') {
          state.data.delivery = 'Самовывоз';
          return askConfirm(chatId, userId);
        }
        state.step = 'address';
        return send(chatId, 'Напишите адрес доставки: улица, дом, квартира.');
      }
      case 'confirm': return confirmOrder(chatId, userId, msgId);
      case 'cancel':
        checkout.delete(userId);
        return show(chatId, 'Заказ отменён. Корзина сохранена.', mainMenu(), msgId);
      case 'adm': return adminAction(query, arg, arg2);
    }
  }

  // Telegram присылает «update»: это либо сообщение, либо нажатие кнопки
  return async function handleUpdate(update) {
    if (update.message) return handleMessage(update.message);
    if (update.callback_query) return handleCallback(update.callback_query);
  };
}

module.exports = { createBot };
