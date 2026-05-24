let adminToken = '';

async function adminLogin() {
    const password = document.getElementById('admin-password').value;
    const adminId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
    
    const res = await fetch('/admin/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ admin_id: adminId, password })
    });
    
    const data = await res.json();
    
    if (data.success) {
        adminToken = data.token;
        localStorage.setItem('adminToken', adminToken);
        document.getElementById('login-screen').style.display = 'none';
        document.getElementById('admin-content').style.display = 'block';
        loadDashboard();
    } else {
        alert('Неверный пароль');
    }
}

async function adminLogout() {
    await fetch('/admin/logout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: adminToken })
    });
    localStorage.removeItem('adminToken');
    adminToken = '';
    document.getElementById('login-screen').style.display = 'flex';
    document.getElementById('admin-content').style.display = 'none';
}

async function loadDashboard() {
    const res = await fetch(`/admin/stats?token=${adminToken}`);
    const stats = await res.json();
    
    document.getElementById('total-users').innerHTML = stats.total_users;
    document.getElementById('total-orders').innerHTML = stats.total_orders;
    document.getElementById('total-revenue').innerHTML = stats.total_revenue.toFixed(2) + '₽';
    document.getElementById('today-orders').innerHTML = stats.today_orders;
    document.getElementById('today-revenue').innerHTML = stats.today_revenue.toFixed(2) + '₽';
    document.getElementById('premium-users').innerHTML = stats.premium_users || 0;
    
    loadOrders();
}

async function loadOrders(page = 1) {
    const res = await fetch(`/admin/orders?token=${adminToken}&page=${page}`);
    const data = await res.json();
    
    const tbody = document.getElementById('orders-table-body');
    tbody.innerHTML = data.orders.map(order => `
        <tr>
            <td><code class="admin-code">${order.order_id}</code></td>
            <td>${order.user_id}</td>
            <td><i class="fas fa-star" style="color: #fbbf24;"></i> ${order.stars_amount}</td>
            <td><i class="fas fa-ruble-sign"></i> ${order.total_rub}</td>
            <td><span class="status-badge status-${order.status}"><i class="fas ${order.status === 'completed' ? 'fa-check-circle' : 'fa-hourglass-half'}"></i> ${order.status === 'completed' ? 'Завершён' : 'Ожидание'}</span></td>
            <td><i class="fas fa-at"></i> ${order.recipient}</td>
            <td><i class="fas fa-calendar"></i> ${new Date(order.created_at).toLocaleString('ru')}</td>
        </tr>
    `).join('');
}

async function loadUsers() {
    const search = document.getElementById('search-users')?.value || '';
    const res = await fetch(`/admin/users?token=${adminToken}&search=${search}`);
    const data = await res.json();
    
    const tbody = document.getElementById('users-table-body');
    tbody.innerHTML = data.users.map(user => `
        <tr>
            <td><i class="fas fa-id-card"></i> ${user.user_id}</td>
            <td><i class="fas fa-at"></i> ${user.username || '-'}</td>
            <td><i class="fas fa-user"></i> ${user.first_name || '-'}</td>
            <td><i class="fas fa-calendar"></i> ${new Date(user.created_at).toLocaleString('ru')}</td>
        </tr>
    `).join('');
}

async function loadPromoCodes() {
    const res = await fetch(`/admin/promocodes?token=${adminToken}`);
    const data = await res.json();
    
    const tbody = document.getElementById('promocodes-table-body');
    tbody.innerHTML = (data.promocodes || []).map(code => `
        <tr>
            <td><code class="admin-code"><i class="fas fa-ticket-alt"></i> ${code.code}</code></td>
            <td>${code.discount_percent ? code.discount_percent + '%' : '<i class="fas fa-ruble-sign"></i> ' + code.discount_rub}</td>
            <td>${code.uses}/${code.max_uses}</td>
            <td>
                <button class="admin-btn-small admin-btn-danger" onclick="deletePromoCode('${code.code}')">
                    <i class="fas fa-trash-alt"></i> Удалить
                </button>
            </td>
        </tr>
    `).join('');
}

async function createPromoCode() {
    const code = document.getElementById('new-code').value.toUpperCase();
    const discountType = document.getElementById('discount-type').value;
    const discountValue = parseInt(document.getElementById('discount-value').value);
    const maxUses = parseInt(document.getElementById('max-uses').value) || 999;
    
    if (!code || !discountValue) {
        alert('Заполните все поля');
        return;
    }
    
    const data = {
        token: adminToken,
        code: code,
        max_uses: maxUses
    };
    
    if (discountType === 'percent') {
        data.discount_percent = discountValue;
    } else {
        data.discount_rub = discountValue;
    }
    
    await fetch('/admin/promocodes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data)
    });
    
    document.getElementById('new-code').value = '';
    document.getElementById('discount-value').value = '';
    loadPromoCodes();
}

async function deletePromoCode(code) {
    if (confirm(`Удалить промокод ${code}?`)) {
        await fetch(`/admin/promocodes/${code}?token=${adminToken}`, { method: 'DELETE' });
        loadPromoCodes();
    }
}

async function sendBroadcast() {
    const message = document.getElementById('broadcast-message').value;
    if (!message) {
        alert('Введите сообщение для рассылки');
        return;
    }
    
    const btn = document.querySelector('#tab-broadcast .admin-btn');
    const originalText = btn.innerHTML;
    btn.innerHTML = '<i class="fas fa-spinner fa-pulse"></i> Отправка...';
    btn.disabled = true;
    
    await fetch('/admin/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: adminToken, message })
    });
    
    btn.innerHTML = originalText;
    btn.disabled = false;
    
    alert('Рассылка запущена!');
    document.getElementById('broadcast-message').value = '';
}

function switchAdminTab(tab) {
    document.querySelectorAll('.admin-tab-content').forEach(el => el.classList.remove('active'));
    document.querySelectorAll('.admin-tab').forEach(el => el.classList.remove('active'));
    
    document.getElementById(`tab-${tab}`).classList.add('active');
    document.querySelector(`[data-tab="${tab}"]`).classList.add('active');
    
    if (tab === 'users') loadUsers();
    if (tab === 'promocodes') loadPromoCodes();
    if (tab === 'dashboard') loadDashboard();
    if (tab === 'orders') loadOrders();
}

const savedToken = localStorage.getItem('adminToken');
if (savedToken) {
    adminToken = savedToken;
    document.getElementById('login-screen').style.display = 'none';
    document.getElementById('admin-content').style.display = 'block';
    loadDashboard();
}