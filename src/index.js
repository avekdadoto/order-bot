// Точка входа: читаем настройки, запускаем бота и ждём сообщений.
// Работает через long polling: спрашиваем у Telegram «есть новое?» в цикле.

const fs = require('fs');
const path = require('path');
const { Shop } = require('./shop');
const { createBot } = require('./bot');

// Читаем .env (BOT_TOKEN=..., ADMIN_ID=...) без сторонних библиотек
function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
    const match = line.match(/^\s*([A-Z_]+)\s*=\s*(.*)\s*$/);
    if (match && !process.env[match[1]]) process.env[match[1]] = match[2];
  }
}

const root = path.join(__dirname, '..');
loadEnv(path.join(root, '.env'));

const TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = process.env.ADMIN_ID;
if (!TOKEN) {
  console.error('Нет BOT_TOKEN. Создайте файл .env по примеру .env.example');
  process.exit(1);
}
if (!ADMIN_ID) {
  console.warn('ADMIN_ID не задан: заказы не будут приходить продавцу. Напишите боту /id, чтобы узнать свой id.');
}

// Вызов любого метода Telegram Bot API
async function api(method, params = {}) {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  });
  const data = await res.json();
  if (!data.ok) {
    // «message is not modified» — нажали ту же кнопку дважды, это не ошибка
    if (!String(data.description).includes('message is not modified')) {
      console.error(`Ошибка ${method}:`, data.description);
    }
    return null;
  }
  return data.result;
}

const catalog = JSON.parse(fs.readFileSync(path.join(root, 'catalog.json'), 'utf8'));
const shop = new Shop(catalog, path.join(root, 'data', 'orders.json'));
const handleUpdate = createBot({ api, shop, adminId: ADMIN_ID });

async function main() {
  const me = await api('getMe');
  if (!me) process.exit(1);
  console.log(`Бот @${me.username} запущен. Остановить: Ctrl+C`);

  let offset = 0;
  while (true) {
    try {
      // timeout: 30 — Telegram держит запрос до 30 с, пока не придёт что-то новое
      const updates = (await api('getUpdates', { offset, timeout: 30 })) || [];
      for (const update of updates) {
        offset = update.update_id + 1;
        try {
          await handleUpdate(update);
        } catch (err) {
          console.error('Ошибка при обработке:', err);
        }
      }
    } catch (err) {
      console.error('Нет связи с Telegram, пробую снова через 5 с:', err.message);
      await new Promise(r => setTimeout(r, 5000));
    }
  }
}

main();
