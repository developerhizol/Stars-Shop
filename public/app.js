const tg = window.Telegram?.WebApp;
let token = '';
let recipientData = null;
let discount = 0;

const API_URL = '';

if (tg) {
    tg.ready();
    tg.expand();
}

const userId = tg?.initDataUnsafe?.user?.id;
const myUsername = tg?.initDataUnsafe?.user?.username || '';

async function auth() {
    if (!userId) {
        document.body.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><div>Ошибка авторизации</div></div>';
        return;
    }
    
    const res = await fetch(`${API_URL}/auth`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ user_id: userId })
    });
    const data = await res.json();
    token = data.token;
    
    updatePrice();
}

function setStars(count) {
    document.getElementById('stars').value = count;
    toggleClearButton('stars', 'clear-stars');
    updatePrice();
}

function setMyself() {
    if (myUsername) {
        document.getElementById('recipient').value = myUsername;
        document.getElementById('recipient').dispatchEvent(new Event('input'));
    } else {
        tg?.showAlert('Username не найден');
    }
}

function clearRecipient() {
    document.getElementById('recipient').value = '';
    document.getElementById('recipient-preview').style.display = 'none';
    recipientData = null;
    toggleClearButton('recipient', 'clear-recipient');
}

function clearStars() {
    document.getElementById('stars').value = '50';
    toggleClearButton('stars', 'clear-stars');
    updatePrice();
}

function clearPromo() {
    document.getElementById('promo').value = '';
    discount = 0;
    document.getElementById('discount-row').style.display = 'none';
    toggleClearButton('promo', 'clear-promo');
    updatePrice();
}

function toggleClearButton(inputId, btnId) {
    const input = document.getElementById(inputId);
    const btn = document.getElementById(btnId);
    if (input && btn) {
        if (input.value.trim()) {
            btn.style.display = 'flex';
            btn.classList.add('visible');
        } else {
            btn.style.display = 'none';
            btn.classList.remove('visible');
        }
    }
}

let recipientTimeout;

document.getElementById('recipient')?.addEventListener('input', (e) => {
    const username = e.target.value.replace('@', '');
    toggleClearButton('recipient', 'clear-recipient');
    
    if (recipientTimeout) clearTimeout(recipientTimeout);
    
    if (username.length >= 3) {
        recipientTimeout = setTimeout(() => checkRecipient(username), 500);
    } else {
        document.getElementById('recipient-preview').style.display = 'none';
        recipientData = null;
    }
});

document.getElementById('stars')?.addEventListener('input', () => {
    toggleClearButton('stars', 'clear-stars');
    updatePrice();
});

async function checkRecipient(username) {
    try {
        const res = await fetch(`${API_URL}/api/check-recipient`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username })
        });
        const data = await res.json();
        
        if (data.valid) {
            recipientData = data;
            document.getElementById('recipient-name').textContent = data.name;
            document.getElementById('recipient-username').textContent = '@' + data.username;
            document.getElementById('recipient-preview').style.display = 'flex';
        } else {
            document.getElementById('recipient-preview').style.display = 'none';
            recipientData = null;
        }
    } catch (e) {
        console.error(e);
    }
}

async function updatePrice() {
    const stars = parseInt(document.getElementById('stars')?.value) || 50;
    const promo = document.getElementById('promo')?.value || '';
    
    const res = await fetch(`${API_URL}/api/price?stars=${stars}&promo_code=${promo}`);
    const data = await res.json();
    
    document.getElementById('total').innerHTML = `<i class="fas fa-ruble-sign"></i> ${data.total.toFixed(2)}`;
    
    if (data.discount > 0) {
        document.getElementById('discount').innerHTML = `<i class="fas fa-ruble-sign"></i> ${data.discount.toFixed(2)}`;
        document.getElementById('discount-row').style.display = 'flex';
        discount = data.discount;
    } else {
        document.getElementById('discount-row').style.display = 'none';
        discount = 0;
    }
}

async function applyPromo() {
    const promo = document.getElementById('promo')?.value;
    if (!promo) {
        tg?.showAlert('Введите промокод');
        return;
    }
    await updatePrice();
    tg?.showAlert('Промокод применен!');
}

function togglePromo() {
    const block = document.getElementById('promo-block');
    const arrow = document.getElementById('promo-arrow');
    const isVisible = block.style.display === 'block';
    block.style.display = isVisible ? 'none' : 'block';
    if (arrow) {
        if (isVisible) {
            arrow.classList.remove('rotated');
        } else {
            arrow.classList.add('rotated');
        }
    }
}

async function handleBuy() {
    if (!recipientData) {
        tg?.showAlert('Введите корректный username получателя');
        return;
    }
    
    const stars = parseInt(document.getElementById('stars')?.value);
    if (stars < 50 || stars > 4999) {
        tg?.showAlert('Количество звезд от 50 до 4999');
        return;
    }
    
    const promo = document.getElementById('promo')?.value || '';
    
    const btn = document.querySelector('.buy-btn');
    const originalHtml = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Создание заказа...';
    btn.disabled = true;
    
    const res = await fetch(`${API_URL}/api/create-order`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            user_id: userId,
            stars: stars,
            recipient: recipientData.username,
            promo_code: promo
        })
    });
    
    const data = await res.json();
    
    btn.innerHTML = originalHtml;
    btn.disabled = false;
    
    if (data.payment_url) {
        window.location.href = data.payment_url;
    } else {
        tg?.showAlert('Ошибка создания заказа');
    }
}

function switchTab(tab) {
    document.getElementById('buy-tab').style.display = tab === 'buy' ? 'block' : 'none';
    document.getElementById('transactions-tab').style.display = tab === 'transactions' ? 'block' : 'none';
    document.getElementById('order-detail-tab').style.display = tab === 'order-detail' ? 'block' : 'none';
    
    document.querySelectorAll('.tab-item').forEach((el, i) => {
        el.classList.toggle('active', (i === 0 && tab === 'buy') || (i === 1 && tab === 'transactions'));
    });
    
    if (tab === 'transactions') loadTransactions();
}

async function loadTransactions() {
    const list = document.getElementById('transactions-list');
    list.innerHTML = '<div class="loading-state"><i class="fas fa-spinner fa-pulse"></i> Загрузка...</div>';
    
    try {
        const res = await fetch(`${API_URL}/api/orders`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const data = await res.json();
        
        if (!data.orders || data.orders.length === 0) {
            list.innerHTML = '<div class="empty-state"><i class="fas fa-inbox"></i><div>Нет транзакций</div></div>';
            return;
        }
        
        list.innerHTML = data.orders.map(order => `
            <div class="transaction-item" onclick="showOrderDetail('${order.order_id}')">
                <div class="transaction-header">
                    <span><i class="fas fa-star" style="color: #fbbf24;"></i> ${order.stars_amount} звезд</span>
                    <span class="transaction-status ${order.status}">
                        ${order.status === 'completed' ? '<i class="fas fa-check-circle"></i> Завершено' : '<i class="fas fa-clock"></i> Ожидание'}
                    </span>
                </div>
                <div class="transaction-details">
                    <div><i class="fas fa-user"></i> @${order.recipient}</div>
                    <div><i class="fas fa-ruble-sign"></i> ${order.total_rub}</div>
                    <div><i class="fas fa-calendar"></i> ${new Date(order.created_at).toLocaleString('ru')}</div>
                </div>
            </div>
        `).join('');
    } catch (e) {
        console.error(e);
        list.innerHTML = '<div class="empty-state"><i class="fas fa-exclamation-triangle"></i><div>Ошибка загрузки</div></div>';
    }
}

async function showOrderDetail(orderId) {
    try {
        const res = await fetch(`${API_URL}/api/order/${orderId}`);
        const order = await res.json();
        
        const statusIcon = order.status === 'completed' ? '<i class="fas fa-check-circle"></i>' : '<i class="fas fa-hourglass-half"></i>';
        const statusText = order.status === 'completed' ? 'Завершено' : 'Ожидание оплаты';
        const statusClass = order.status === 'completed' ? 'completed' : 'pending';
        
        const detailHtml = `
            <div class="order-card">
                <div class="order-status ${statusClass}">
                    ${statusIcon} ${statusText}
                </div>
                <div class="order-info-row">
                    <span><i class="fas fa-hashtag"></i> Заказ:</span>
                    <span>${order.order_id}</span>
                </div>
                <div class="order-info-row">
                    <span><i class="fas fa-star" style="color: #fbbf24;"></i> Звезды:</span>
                    <span>${order.stars_amount}</span>
                </div>
                <div class="order-info-row">
                    <span><i class="fas fa-user"></i> Получатель:</span>
                    <span>@${order.recipient}</span>
                </div>
                <div class="order-info-row">
                    <span><i class="fas fa-ruble-sign"></i> Сумма:</span>
                    <span>${order.total_rub}₽</span>
                </div>
                <div class="order-info-row">
                    <span><i class="fas fa-calendar"></i> Дата:</span>
                    <span>${new Date(order.created_at).toLocaleString('ru')}</span>
                </div>
            </div>
        `;
        
        document.getElementById('order-detail').innerHTML = detailHtml;
        switchTab('order-detail');
    } catch (e) {
        console.error(e);
        tg?.showAlert('Ошибка загрузки заказа');
    }
}

auth();