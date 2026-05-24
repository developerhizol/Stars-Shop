const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const dotenv = require('dotenv');
const jwt = require('jsonwebtoken');
const fs = require('fs');

dotenv.config();

// ==================== КОНФИГУРАЦИЯ ====================
const BOT_TOKEN = process.env.BOT_TOKEN;
const ADMIN_ID = parseInt(process.env.ADMIN_ID);
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD;
const STAR_PRICE_RUB = parseFloat(process.env.STAR_PRICE_RUB) || 1.30;
const WEBAPP_URL = process.env.WEBAPP_URL || 'https://starsshop.bothost.tech';
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_key_change_this';
const PORT = process.env.PORT || 9184;

// Премиум эмодзи ID (такие же как в Python версии)
const EMOJI = {
  WAVE: { id: "6041921818896372382", fallback: "👋" },
  DIAMOND: { id: "6037083366438737901", fallback: "💎" },
  STAR: { id: "5958376256788502078", fallback: "⭐" },
  GIFT: { id: "5291747463584062848", fallback: "🎁" },
  ROCKET: { id: "5983150113483134607", fallback: "🚀" },
  STAR_BTN: { id: "5321485469249198987", fallback: "⭐" }
};

function emoji(emojiData) {
  return `<tg-emoji emoji-id="${emojiData.id}">${emojiData.fallback}</tg-emoji>`;
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Создаем папки
if (!fs.existsSync('imgs')) fs.mkdirSync('imgs', { recursive: true });

// ==================== БАЗА ДАННЫХ ====================
const db = new sqlite3.Database('stars.db');

function hashPassword(password) {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(password).digest('hex');
}

db.serialize(() => {
  // Таблица пользователей
  db.run(`
    CREATE TABLE IF NOT EXISTS users (
      user_id INTEGER PRIMARY KEY,
      username TEXT,
      first_name TEXT,
      created_at TEXT
    )
  `);

  // Таблица администраторов
  db.run(`
    CREATE TABLE IF NOT EXISTS admins (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      admin_id INTEGER UNIQUE,
      username TEXT,
      password_hash TEXT,
      created_at TEXT
    )
  `);

  // Таблица заказов
  db.run(`
    CREATE TABLE IF NOT EXISTS orders (
      order_id TEXT PRIMARY KEY,
      user_id INTEGER,
      stars_amount INTEGER,
      price_rub REAL,
      promo_code TEXT,
      discount_rub REAL,
      total_rub REAL,
      payment_method TEXT,
      status TEXT,
      created_at TEXT,
      recipient TEXT,
      tx_hash TEXT
    )
  `);

  // Таблица промокодов
  db.run(`
    CREATE TABLE IF NOT EXISTS promo_codes (
      code TEXT PRIMARY KEY,
      discount_percent INTEGER,
      discount_rub REAL,
      uses INTEGER DEFAULT 0,
      max_uses INTEGER DEFAULT 999,
      created_at TEXT
    )
  `);

  // Таблица сессий админов
  db.run(`
    CREATE TABLE IF NOT EXISTS admin_sessions (
      token TEXT PRIMARY KEY,
      admin_id INTEGER,
      expires TEXT
    )
  `);

  // Добавляем админа
  const passwordHash = hashPassword(ADMIN_PASSWORD);
  db.run(`INSERT OR IGNORE INTO admins (admin_id, username, password_hash, created_at) VALUES (?, ?, ?, datetime('now'))`,
    [ADMIN_ID, "admin", passwordHash]);

  // Добавляем тестовые промокоды
  db.run(`INSERT OR IGNORE INTO promo_codes (code, discount_percent, max_uses, created_at) VALUES ('WELCOME10', 10, 100, datetime('now'))`);
  db.run(`INSERT OR IGNORE INTO promo_codes (code, discount_rub, max_uses, created_at) VALUES ('STARS100', 100, 50, datetime('now'))`);

  console.log('✅ База данных инициализирована');
});

// ==================== ФУНКЦИИ БАЗЫ ДАННЫХ ====================
function addUser(userId, username, firstName) {
  db.run(`INSERT OR IGNORE INTO users (user_id, username, first_name, created_at) VALUES (?, ?, ?, datetime('now'))`,
    [userId, username, firstName]);
}

function getUserCount() {
  return new Promise((resolve) => {
    db.get(`SELECT COUNT(*) as count FROM users`, (err, row) => {
      resolve(row ? row.count : 0);
    });
  });
}

function getAllUsers() {
  return new Promise((resolve) => {
    db.all(`SELECT user_id FROM users`, (err, rows) => {
      resolve(rows || []);
    });
  });
}

function getAllUsersWithDetails() {
  return new Promise((resolve) => {
    db.all(`SELECT user_id, username, first_name, created_at FROM users ORDER BY created_at DESC`, (err, rows) => {
      resolve(rows || []);
    });
  });
}

function getAllOrders(limit = 100, offset = 0) {
  return new Promise((resolve) => {
    db.all(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?`, [limit, offset], (err, rows) => {
      resolve(rows || []);
    });
  });
}

function getOrdersCount() {
  return new Promise((resolve) => {
    db.get(`SELECT COUNT(*) as count FROM orders`, (err, row) => {
      resolve(row ? row.count : 0);
    });
  });
}

function getOrdersByUser(userId) {
  return new Promise((resolve) => {
    db.all(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`, [userId], (err, rows) => {
      resolve(rows || []);
    });
  });
}

function getOrderById(orderId) {
  return new Promise((resolve) => {
    db.get(`SELECT * FROM orders WHERE order_id = ?`, [orderId], (err, row) => {
      resolve(row || null);
    });
  });
}

function createOrder(orderData) {
  return new Promise((resolve, reject) => {
    db.run(`INSERT INTO orders (order_id, user_id, stars_amount, price_rub, promo_code, discount_rub, total_rub, payment_method, status, created_at, recipient)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
      [orderData.order_id, orderData.user_id, orderData.stars_amount, orderData.price_rub,
       orderData.promo_code || null, orderData.discount_rub, orderData.total_rub,
       orderData.payment_method, 'pending', orderData.recipient],
      (err) => {
        if (err) reject(err);
        else resolve(orderData.order_id);
      });
  });
}

function updateOrderStatus(orderId, status, txHash = null) {
  return new Promise((resolve) => {
    if (txHash) {
      db.run(`UPDATE orders SET status = ?, tx_hash = ? WHERE order_id = ?`, [status, txHash, orderId], () => resolve());
    } else {
      db.run(`UPDATE orders SET status = ? WHERE order_id = ?`, [status, orderId], () => resolve());
    }
  });
}

function getTotalRevenue() {
  return new Promise((resolve) => {
    db.get(`SELECT SUM(total_rub) as total FROM orders WHERE status = 'completed'`, (err, row) => {
      resolve(row ? (row.total || 0) : 0);
    });
  });
}

function getTodayStats() {
  return new Promise((resolve) => {
    const today = new Date().toISOString().slice(0, 10);
    db.get(`SELECT COUNT(*) as orders_count, COALESCE(SUM(CASE WHEN status = 'completed' THEN total_rub ELSE 0 END), 0) as revenue 
            FROM orders WHERE date(created_at) = ?`, [today], (err, row) => {
      resolve({ orders: row ? row.orders_count : 0, revenue: row ? row.revenue : 0 });
    });
  });
}

function getPromoCodes() {
  return new Promise((resolve) => {
    db.all(`SELECT * FROM promo_codes ORDER BY created_at DESC`, (err, rows) => {
      resolve(rows || []);
    });
  });
}

function addPromoCode(code, discountPercent = null, discountRub = null, maxUses = 999) {
  return new Promise((resolve) => {
    db.run(`INSERT OR REPLACE INTO promo_codes (code, discount_percent, discount_rub, max_uses, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
      [code.toUpperCase(), discountPercent, discountRub, maxUses], () => resolve());
  });
}

function deletePromoCode(code) {
  return new Promise((resolve) => {
    db.run(`DELETE FROM promo_codes WHERE code = ?`, [code.toUpperCase()], () => resolve());
  });
}

function usePromoCode(code) {
  return new Promise((resolve) => {
    db.run(`UPDATE promo_codes SET uses = uses + 1 WHERE code = ? AND uses < max_uses`, [code.toUpperCase()], function(err) {
      resolve(this.changes > 0);
    });
  });
}

function checkAdminLogin(adminId, password) {
  return new Promise((resolve) => {
    const passwordHash = hashPassword(password);
    db.get(`SELECT id FROM admins WHERE admin_id = ? AND password_hash = ?`, [adminId, passwordHash], (err, row) => {
      resolve(!!row);
    });
  });
}

function saveAdminSession(token, adminId, expires) {
  db.run(`INSERT OR REPLACE INTO admin_sessions (token, admin_id, expires) VALUES (?, ?, ?)`, [token, adminId, expires]);
}

function getAdminSession(token) {
  return new Promise((resolve) => {
    db.get(`SELECT * FROM admin_sessions WHERE token = ? AND expires > datetime('now')`, [token], (err, row) => {
      resolve(row || null);
    });
  });
}

function deleteAdminSession(token) {
  db.run(`DELETE FROM admin_sessions WHERE token = ?`, [token]);
}

// ==================== ФУНКЦИИ БОТА ====================
function getPhotoOrNone(filename) {
  if (fs.existsSync(filename)) {
    return { source: filename };
  }
  return null;
}

async function getWelcomeText() {
  const WAVE = emoji(EMOJI.WAVE);
  const DIAMOND = emoji(EMOJI.DIAMOND);
  const GIFT = emoji(EMOJI.GIFT);
  const ROCKET = emoji(EMOJI.ROCKET);
  
  return `${WAVE} <b>Привет, Алексей!</b>\n\n` +
         `${DIAMOND} <b>Купи звезды по выгодной цене:</b> 1⭐ = ${STAR_PRICE_RUB}₽\n\n` +
         `${GIFT} <b>Минимальная сумма:</b> <u>50 звезд</u>\n` +
         `${ROCKET} <b>Моментальная доставка получателю</b>`;
}

async function getMainMenuKeyboard() {
  const STAR_BTN = emoji(EMOJI.STAR_BTN);
  return Markup.inlineKeyboard([
    [Markup.button.webApp(`${STAR_BTN} Купить звезды`, `${WEBAPP_URL}/index.html`)]
  ]);
}

// Команда /start
bot.start(async (ctx) => {
  const user = ctx.from;
  addUser(user.id, user.username, user.first_name);
  
  const text = await getWelcomeText();
  const photo = getPhotoOrNone('imgs/welcome.jpg');
  
  if (photo) {
    await ctx.replyWithPhoto(photo, {
      caption: text,
      parse_mode: 'HTML',
      ...await getMainMenuKeyboard()
    });
  } else {
    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...await getMainMenuKeyboard()
    });
  }
});

// Команда /admin
bot.command('admin', async (ctx) => {
  if (ctx.from.id !== ADMIN_ID) {
    await ctx.reply('❌ У вас нет доступа к админ панели');
    return;
  }
  
  const text = '<b>Нажмите кнопку ниже чтобы перейти в админ панель</b>';
  const photo = getPhotoOrNone('imgs/admin.jpg');
  
  const keyboard = Markup.inlineKeyboard([
    [Markup.button.webApp('🔐 Открыть админку', `${WEBAPP_URL}/admin.html`)]
  ]);
  
  if (photo) {
    await ctx.replyWithPhoto(photo, {
      caption: text,
      parse_mode: 'HTML',
      ...keyboard
    });
  } else {
    await ctx.reply(text, {
      parse_mode: 'HTML',
      ...keyboard
    });
  }
});

// Обработка callback данных
bot.action('my_orders', async (ctx) => {
  const orders = await getOrdersByUser(ctx.from.id);
  
  if (orders.length === 0) {
    await ctx.answerCbQuery();
    await ctx.reply('📭 У вас пока нет заказов');
    return;
  }
  
  let message = '📋 <b>Ваши заказы:</b>\n\n';
  for (const order of orders.slice(0, 10)) {
    const statusEmoji = order.status === 'completed' ? '✅' : '⏳';
    message += `${statusEmoji} <b>${order.order_id}</b>\n`;
    message += `   ⭐ ${order.stars_amount} звезд → @${order.recipient}\n`;
    message += `   💰 ${order.total_rub}₽\n`;
    message += `   📅 ${new Date(order.created_at).toLocaleString('ru')}\n\n`;
  }
  
  await ctx.answerCbQuery();
  await ctx.reply(message, { parse_mode: 'HTML' });
});

// Установка команд бота
bot.telegram.setMyCommands([
  { command: 'start', description: 'Главное меню' },
  { command: 'admin', description: 'Админ панель' }
]);

// ==================== JWT ФУНКЦИИ ====================
function createJwtToken(userId) {
  return jwt.sign({ user_id: userId, exp: Math.floor(Date.now() / 1000) + 86400 }, JWT_SECRET);
}

function verifyJwtToken(token) {
  try {
    return jwt.verify(token, JWT_SECRET);
  } catch (e) {
    return null;
  }
}

// ==================== API ЭНДПОИНТЫ ====================

// Главные страницы
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/index.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/payment/:order_hash', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'payment.html'));
});

// API для админки
app.post('/admin/login', async (req, res) => {
  const { admin_id, password } = req.body;
  
  if (!admin_id || !password) {
    return res.json({ success: false, error: 'Missing credentials' });
  }
  
  const isValid = await checkAdminLogin(parseInt(admin_id), password);
  
  if (isValid) {
    const crypto = require('crypto');
    const token = crypto.createHash('sha256').update(`${admin_id}${password}${Date.now()}`).digest('hex');
    const expires = new Date(Date.now() + 8 * 3600000).toISOString();
    saveAdminSession(token, parseInt(admin_id), expires);
    return res.json({ success: true, token });
  }
  
  res.json({ success: false, error: 'Invalid credentials' });
});

app.post('/admin/logout', async (req, res) => {
  const { token } = req.body;
  if (token) deleteAdminSession(token);
  res.json({ success: true });
});

app.get('/admin/stats', async (req, res) => {
  const { token } = req.query;
  if (!await getAdminSession(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.json({
    total_users: await getUserCount(),
    total_orders: await getOrdersCount(),
    total_revenue: parseFloat((await getTotalRevenue()).toFixed(2)),
    today_orders: (await getTodayStats()).orders,
    today_revenue: parseFloat((await getTodayStats()).revenue.toFixed(2))
  });
});

app.get('/admin/orders', async (req, res) => {
  const { token, page = 1, limit = 50 } = req.query;
  if (!await getAdminSession(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const offset = (parseInt(page) - 1) * parseInt(limit);
  const orders = await getAllOrders(parseInt(limit), offset);
  const total = await getOrdersCount();
  
  res.json({
    orders,
    total,
    page: parseInt(page),
    limit: parseInt(limit),
    total_pages: Math.ceil(total / parseInt(limit))
  });
});

app.get('/admin/users', async (req, res) => {
  const { token } = req.query;
  if (!await getAdminSession(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.json({ users: await getAllUsersWithDetails() });
});

app.get('/admin/promocodes', async (req, res) => {
  const { token } = req.query;
  if (!await getAdminSession(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  res.json({ promocodes: await getPromoCodes() });
});

app.post('/admin/promocodes', async (req, res) => {
  const { token, code, discount_percent, discount_rub, max_uses } = req.body;
  if (!await getAdminSession(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!code) {
    return res.status(400).json({ error: 'Code required' });
  }
  
  await addPromoCode(code, discount_percent, discount_rub, max_uses || 999);
  res.json({ success: true });
});

app.delete('/admin/promocodes/:code', async (req, res) => {
  const { token } = req.query;
  const { code } = req.params;
  
  if (!await getAdminSession(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  await deletePromoCode(code);
  res.json({ success: true });
});

app.post('/admin/broadcast', async (req, res) => {
  const { token, message } = req.body;
  if (!await getAdminSession(token)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (!message) {
    return res.status(400).json({ error: 'Message required' });
  }
  
  // Запускаем рассылку в фоне
  (async () => {
    const users = await getAllUsers();
    let success = 0;
    for (const user of users) {
      try {
        await bot.telegram.sendMessage(user.user_id, message, { parse_mode: 'HTML' });
        success++;
        await new Promise(r => setTimeout(r, 50));
      } catch (e) {}
    }
    console.log(`✅ Broadcast sent to ${success}/${users.length} users`);
  })();
  
  res.json({ success: true });
});

// API для клиента
app.post('/auth', async (req, res) => {
  const { user_id } = req.body;
  if (!user_id) {
    return res.status(400).json({ error: 'User ID required' });
  }
  res.json({ token: createJwtToken(user_id) });
});

app.get('/api/price', async (req, res) => {
  const stars = parseInt(req.query.stars) || 50;
  const promoCode = req.query.promo_code;
  
  const basePrice = stars * STAR_PRICE_RUB;
  let discount = 0;
  
  if (promoCode) {
    const promos = await getPromoCodes();
    const promo = promos.find(p => p.code === promoCode.toUpperCase() && p.uses < p.max_uses);
    if (promo) {
      if (promo.discount_rub) {
        discount = Math.min(promo.discount_rub, basePrice);
      } else if (promo.discount_percent) {
        discount = basePrice * promo.discount_percent / 100;
      }
    }
  }
  
  res.json({
    base_price: parseFloat(basePrice.toFixed(2)),
    discount: parseFloat(discount.toFixed(2)),
    total: parseFloat((basePrice - discount).toFixed(2))
  });
});

app.post('/api/create-order', async (req, res) => {
  const { user_id, stars, recipient, promo_code, payment_method = 'crypto' } = req.body;
  
  if (!user_id || !stars || !recipient) {
    return res.status(400).json({ error: 'Missing required fields' });
  }
  
  if (stars < 50 || stars > 4999) {
    return res.status(400).json({ error: 'Stars must be between 50 and 4999' });
  }
  
  const basePrice = stars * STAR_PRICE_RUB;
  let discount = 0;
  
  if (promo_code) {
    const promos = await getPromoCodes();
    const promo = promos.find(p => p.code === promo_code.toUpperCase() && p.uses < p.max_uses);
    if (promo) {
      if (promo.discount_rub) {
        discount = Math.min(promo.discount_rub, basePrice);
      } else if (promo.discount_percent) {
        discount = basePrice * promo.discount_percent / 100;
      }
      await usePromoCode(promo_code);
    }
  }
  
  const total = basePrice - discount;
  const crypto = require('crypto');
  const orderId = crypto.createHash('sha256').update(`${user_id}${stars}${Date.now()}`).digest('hex').slice(0, 16);
  
  await createOrder({
    order_id: orderId,
    user_id: user_id,
    stars_amount: stars,
    price_rub: parseFloat(basePrice.toFixed(2)),
    promo_code: promo_code || null,
    discount_rub: parseFloat(discount.toFixed(2)),
    total_rub: parseFloat(total.toFixed(2)),
    payment_method: payment_method,
    recipient: recipient
  });
  
  res.json({
    order_hash: orderId,
    payment_url: `/payment/${orderId}`,
    total: parseFloat(total.toFixed(2))
  });
});

app.get('/api/order/:order_hash', async (req, res) => {
  const order = await getOrderById(req.params.order_hash);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  res.json(order);
});

app.get('/api/orders', async (req, res) => {
  const authHeader = req.headers.authorization;
  if (!authHeader) {
    return res.status(401).json({ error: 'No token' });
  }
  
  const token = authHeader.split(' ')[1];
  const payload = verifyJwtToken(token);
  if (!payload) {
    return res.status(401).json({ error: 'Invalid token' });
  }
  
  const orders = await getOrdersByUser(payload.user_id);
  res.json({ orders });
});

app.post('/api/check-recipient', async (req, res) => {
  const username = req.body.username?.replace('@', '') || '';
  res.json({ valid: true, username, name: username, photo: null });
});

app.get('/api/order-status/:order_hash', async (req, res) => {
  const order = await getOrderById(req.params.order_hash);
  if (!order) {
    return res.status(404).json({ error: 'Order not found' });
  }
  res.json({
    order_id: order.order_id,
    stars: order.stars_amount,
    total: order.total_rub,
    status: order.status,
    created_at: order.created_at,
    recipient: order.recipient,
    payment_method: order.payment_method
  });
});

// ==================== ЗАПУСК ====================
async function main() {
  // Запускаем бота
  bot.launch().then(() => {
    console.log('🤖 Бот запущен!');
  });
  
  // Запускаем сервер
  app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n${'='.repeat(50)}`);
    console.log('💎 Stars Shop API запущен');
    console.log(`   Mini App: ${WEBAPP_URL}`);
    console.log(`   Admin panel: ${WEBAPP_URL}/admin.html`);
    console.log(`${'='.repeat(50)}\n`);
  });
  
  // Graceful stop
  process.once('SIGINT', () => bot.stop('SIGINT'));
  process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main();