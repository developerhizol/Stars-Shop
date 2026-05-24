const { Telegraf, Markup } = require('telegraf');
const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const fs = require('fs');

// ==================== КОНФИГУРАЦИЯ ====================
const BOT_TOKEN = process.env.BOT_TOKEN;  // Токен из переменной окружения
const ADMIN_ID = 7752488661;  // ВСТАВЬ СВОЙ TELEGRAM ID
const ADMIN_PASSWORD = 'admin123';
const STAR_PRICE_RUB = 1.30;
const JWT_SECRET = '8xKj9pQm2LvN5rT7wXzC4vB6nM1kL9pQ3rT5wX7zC9vB2nM4kL6pQ8rT0wX';
const PORT = process.env.PORT || 6285;

// Проверяем наличие токена
if (!BOT_TOKEN) {
    console.error('❌ BOT_TOKEN не указан! Добавь переменную окружения BOT_TOKEN');
    process.exit(1);
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================
const bot = new Telegraf(BOT_TOKEN);
const app = express();

app.use(cors());
app.use(express.json());
app.use(express.static('public'));

// Создаем папку для статики если её нет
if (!fs.existsSync('public')) {
    fs.mkdirSync('public');
}

// ==================== БАЗА ДАННЫХ ====================
const db = new sqlite3.Database('stars.db');

function hashPassword(password) {
    const crypto = require('crypto');
    return crypto.createHash('sha256').update(password).digest('hex');
}

db.serialize(() => {
    db.run(`CREATE TABLE IF NOT EXISTS users (
        user_id INTEGER PRIMARY KEY,
        username TEXT,
        first_name TEXT,
        created_at TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admins (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        admin_id INTEGER UNIQUE,
        username TEXT,
        password_hash TEXT,
        created_at TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS orders (
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
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS promo_codes (
        code TEXT PRIMARY KEY,
        discount_percent INTEGER,
        discount_rub REAL,
        uses INTEGER DEFAULT 0,
        max_uses INTEGER DEFAULT 999,
        created_at TEXT
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS admin_sessions (
        token TEXT PRIMARY KEY,
        admin_id INTEGER,
        expires TEXT
    )`);

    const passwordHash = hashPassword(ADMIN_PASSWORD);
    db.run(`INSERT OR IGNORE INTO admins (admin_id, username, password_hash, created_at) VALUES (?, ?, ?, datetime('now'))`,
        [ADMIN_ID, "admin", passwordHash]);

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
        db.get(`SELECT COUNT(*) as count FROM users`, (err, row) => resolve(row ? row.count : 0));
    });
}

function getAllUsers() {
    return new Promise((resolve) => {
        db.all(`SELECT user_id FROM users`, (err, rows) => resolve(rows || []));
    });
}

function getAllUsersWithDetails() {
    return new Promise((resolve) => {
        db.all(`SELECT user_id, username, first_name, created_at FROM users ORDER BY created_at DESC`, (err, rows) => resolve(rows || []));
    });
}

function getAllOrders(limit = 100, offset = 0) {
    return new Promise((resolve) => {
        db.all(`SELECT * FROM orders ORDER BY created_at DESC LIMIT ? OFFSET ?`, [limit, offset], (err, rows) => resolve(rows || []));
    });
}

function getOrdersCount() {
    return new Promise((resolve) => {
        db.get(`SELECT COUNT(*) as count FROM orders`, (err, row) => resolve(row ? row.count : 0));
    });
}

function getOrdersByUser(userId) {
    return new Promise((resolve) => {
        db.all(`SELECT * FROM orders WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`, [userId], (err, rows) => resolve(rows || []));
    });
}

function getOrderById(orderId) {
    return new Promise((resolve) => {
        db.get(`SELECT * FROM orders WHERE order_id = ?`, [orderId], (err, row) => resolve(row || null));
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
async function getWelcomeText() {
    return `👋 <b>Привет!</b>\n\n` +
           `💎 <b>Купи звезды по выгодной цене:</b> 1⭐ = ${STAR_PRICE_RUB}₽\n\n` +
           `🎁 <b>Минимальная сумма:</b> <u>50 звезд</u>\n` +
           `🚀 <b>Моментальная доставка получателю</b>`;
}

async function getMainMenuKeyboard() {
    return Markup.inlineKeyboard([
        [Markup.button.webApp('⭐ Купить звезды', `https://${process.env.HOSTNAME || 'localhost'}/index.html`)]
    ]);
}

// Команда /start
bot.start(async (ctx) => {
    const user = ctx.from;
    addUser(user.id, user.username, user.first_name);
    
    const text = await getWelcomeText();
    
    await ctx.reply(text, {
        parse_mode: 'HTML',
        ...await getMainMenuKeyboard()
    });
});

// Команда /admin
bot.command('admin', async (ctx) => {
    if (ctx.from.id !== ADMIN_ID) {
        await ctx.reply('❌ У вас нет доступа к админ панели');
        return;
    }
    
    const text = '<b>🔐 Админ панель</b>\n\nНажмите кнопку ниже чтобы войти';
    
    const keyboard = Markup.inlineKeyboard([
        [Markup.button.webApp('📊 Открыть админку', `https://${process.env.HOSTNAME || 'localhost'}/admin.html`)]
    ]);
    
    await ctx.reply(text, {
        parse_mode: 'HTML',
        ...keyboard
    });
});

// Команда /help
bot.command('help', async (ctx) => {
    await ctx.reply(
        '📖 <b>Помощь</b>\n\n' +
        '1. Нажмите "Купить звезды"\n' +
        '2. Введите username получателя\n' +
        '3. Выберите количество звезд\n' +
        '4. Оплатите и получите звезды моментально!\n\n' +
        '⭐ Минимальная покупка: 50 звезд\n' +
        '💬 Вопросы: @support',
        { parse_mode: 'HTML' }
    );
});

// Установка команд бота
bot.telegram.setMyCommands([
    { command: 'start', description: 'Главное меню' },
    { command: 'admin', description: 'Админ панель' },
    { command: 'help', description: 'Помощь' }
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

// Статические страницы
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
        today_revenue: parseFloat((await getTodayStats()).revenue.toFixed(2)),
        premium_users: 0
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
        console.log(`   Адрес: http://localhost:${PORT}`);
        console.log(`${'='.repeat(50)}\n`);
    });
    
    // Graceful stop
    process.once('SIGINT', () => bot.stop('SIGINT'));
    process.once('SIGTERM', () => bot.stop('SIGTERM'));
}

main();