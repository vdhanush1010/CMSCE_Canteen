// Campus Canteen Manager Dashboard Logic

// 1. Supabase Client Configuration Credentials
const SUPABASE_URL = 'https://llbegpqowjvsadbundrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsYmVncHFvd2p2c2FkYnVuZHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3Njg4NzAsImV4cCI6MjEwMjM0NDg3MH0.SGoLEoE5PP_Ex0C7tOXrwvcol2vxxOvOFPoSGfD93VA';
var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 2. Global State Variables
let categories = [];
let products = [];
let orders = [];
let activeOrdersChannel = null;
let html5QrCode = null;
let currentScannerTarget = 'order'; // 'order' or 'product' or 'product_prefill'
let clockInterval = null;
let currentView = 'dashboard';
let selectedCategoryFilter = 'all';
let isCanteenOpen = true;

// Quick Sale (Spot POS) Mini Cart State
let posCart = {}; // { [productId]: { product, quantity } }
let posSearchQuery = '';
let posSelectedCategory = 'all';

// Dual-Mode Scanning Engine State
let scanBuffer = '';
let scanBufferTimer = null;
let inventoryScanModeActive = false;
let currentOrderInModal = null;   // { id, isDelivered } while modal is open
let enterDeliverListener = null;  // keyboard shortcut listener ref for cleanup



// Toast Helper
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  const icon = type === "success" ? "check-circle" : "alert-circle";
  toast.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4"></i> <span>${message}</span>`;
  
  container.appendChild(toast);
  lucide.createIcons();
  
  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

// Full-screen spinner
function showLoading(show) {
  const loader = document.getElementById("loading-overlay");
  if (loader) {
    if (show) loader.classList.remove("hidden");
    else loader.classList.add("hidden");
  }
}

// 3. Manager Login Authentication
const API_BASE = (typeof window !== 'undefined' && window.location && window.location.protocol.startsWith('http'))
  ? `${window.location.origin}/api`
  : 'http://localhost:5000/api';

async function handleManagerLogin(event) {
  event.preventDefault();
  const phone = document.getElementById("login-phone").value.trim();
  const otp = document.getElementById("login-otp").value.trim();

  showLoading(true);
  try {
    const res = await fetch(`${API_BASE}/manager/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ phone, otp })
    });
    const data = await res.json();
    showLoading(false);

    if (!res.ok) {
      showToast(data.error || "Login denied", "error");
      return;
    }

    sessionStorage.setItem("manager_auth", "true");
    showToast("Login successful!", "success");
    
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("dashboard-screen").classList.remove("hidden");
    
    initDashboard();
  } catch (err) {
    showLoading(false);
    console.error("Manager login error:", err);
    showToast("Server connection error during login", "error");
  }
}

function handleLogout() {
  sessionStorage.removeItem("manager_auth");
  if (activeOrdersChannel) {
    supabase.removeChannel(activeOrdersChannel);
    activeOrdersChannel = null;
  }
  if (clockInterval) {
    clearInterval(clockInterval);
    clockInterval = null;
  }
  document.getElementById("dashboard-screen").classList.add("hidden");
  document.getElementById("login-screen").classList.remove("hidden");
  document.getElementById("login-phone").value = "";
  document.getElementById("login-otp").value = "";
  showToast("Logged out successfully", "success");
}

// 4. Dashboard Initialization
async function initDashboard() {
  showLoading(true);
  await fetchCategories();
  await fetchProducts();
  await fetchOrders();
  await fetchCanteenStatus();
  showLoading(false);

  renderSalesSummary();
  renderInventoryTable();
  renderOrderQueue();
  populateCategorySelect();
  renderCategoriesList();
  renderPosCategories();
  renderPosMenu();
  renderPosCart();
  setupRealtimeOrdersListener();
  
  // Theme Mode restore
  const savedTheme = localStorage.getItem("manager-theme") || "dark";
  setThemeMode(savedTheme);

  // Live Clock setup
  if (clockInterval) clearInterval(clockInterval);
  clockInterval = setInterval(updateLiveClock, 1000);
  updateLiveClock();

  // Queue Ticker Interval (refreshes remaining cash payment minutes & purges expired orders from queue)
  if (window._managerQueueTimer) clearInterval(window._managerQueueTimer);
  window._managerQueueTimer = setInterval(() => {
    renderOrderQueue();
  }, 10000);

  // Initialize Quick-Scan / Token input auto-focus
  initQuickTokenScanner();
}

async function fetchCanteenStatus() {
  try {
    const res = await fetch(`${API_BASE}/canteen/status`);
    const data = await res.json();
    if (res.ok) {
      isCanteenOpen = data.is_open;
      updateCanteenStatusUI();
    }
  } catch (err) {
    console.error("Error fetching canteen status:", err);
  }
}

function updateCanteenStatusUI() {
  const btn = document.getElementById("canteen-status-toggle-btn");
  if (!btn) return;
  if (isCanteenOpen) {
    btn.innerText = "🟢 OPEN";
    btn.className = "px-3 py-1 rounded-lg text-xs font-bold transition-all bg-emerald-500/10 text-emerald-400 border border-emerald-500/20";
  } else {
    btn.innerText = "🔴 CLOSED";
    btn.className = "px-3 py-1 rounded-lg text-xs font-bold transition-all bg-rose-500/10 text-rose-400 border border-rose-500/20";
  }
}

async function toggleCanteenStatus() {
  const nextStatus = !isCanteenOpen;
  showLoading(true);
  try {
    const res = await fetch(`${API_BASE}/canteen/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_open: nextStatus })
    });
    const data = await res.json();
    showLoading(false);
    if (res.ok) {
      isCanteenOpen = data.is_open;
      updateCanteenStatusUI();
      showToast(`Canteen is now ${isCanteenOpen ? 'OPEN' : 'CLOSED'}!`, "success");
    }
  } catch (err) {
    showLoading(false);
    console.error("Toggle canteen error:", err);
    showToast("Error updating status", "error");
  }
}

// 5. DB Queries via REST API
async function fetchCategories() {
  try {
    const res = await fetch(`${API_BASE}/categories`);
    const data = await res.json();
    if (res.ok) {
      categories = data || [];
    } else {
      console.error('Fetch categories error:', data.error);
    }
  } catch (err) {
    console.error("Categories fetch API error:", err);
  }
}

async function fetchProducts() {
  try {
    const res = await fetch(`${API_BASE}/products`);
    const data = await res.json();
    if (res.ok) {
      products = data || [];
    } else {
      console.error('Fetch products error:', data.error);
    }
  } catch (err) {
    console.error("Products fetch API error:", err);
  }
}

async function fetchOrders() {
  try {
    const res = await fetch(`${API_BASE}/orders/live`);
    const data = await res.json();
    if (res.ok) {
      orders = (data || []).map(o => ({
        id: o.id,
        student_id: o.student_id,
        token_number: o.token_number,
        total_amount: parseFloat(o.total_amount),
        payment_method: o.payment_method,
        payment_status: o.payment_status,
        order_status: o.order_status,
        created_at: o.created_at,
        qr_code_data: o.qr_code_data,
        student: o.students ? o.students : { name: "Unknown Student", reg_no: "N/A" },
        items: (o.order_items || []).map(oi => ({
          id: oi.id,
          name: oi.products ? oi.products.name : "Unknown Product",
          quantity: oi.quantity,
          unit_price: parseFloat(oi.unit_price)
        }))
      }));
    } else {
      console.error('Fetch orders error:', data.error);
    }
  } catch (err) {
    console.error("Orders fetch API error:", err);
  }
}

// 6. Sales Analytics — Date-filtered via history API
// Helpers to format today's date as YYYY-MM-DD in local time
function todayDateString() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function yesterdayDateString() {
  const now = new Date();
  now.setDate(now.getDate() - 1);
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function setSalesDateToday() {
  const input = document.getElementById('sales-date-filter');
  if (input) input.value = todayDateString();
  applySalesDateFilter();
}

function setSalesDateYesterday() {
  const input = document.getElementById('sales-date-filter');
  if (input) input.value = yesterdayDateString();
  applySalesDateFilter();
}

function clearSalesDateFilter() {
  const input = document.getElementById('sales-date-filter');
  if (input) input.value = '';
  applySalesDateFilter();
}

async function applySalesDateFilter() {
  const input = document.getElementById('sales-date-filter');
  const date = input ? input.value : '';

  // Update badge label
  const labelEl = document.getElementById('sales-date-label');
  if (labelEl) {
    if (!date) labelEl.innerText = 'Lifetime';
    else if (date === todayDateString()) labelEl.innerText = 'Today';
    else if (date === yesterdayDateString()) labelEl.innerText = 'Yesterday';
    else labelEl.innerText = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  try {
    const url = date
      ? `${API_BASE}/manager/orders/history?date=${date}`
      : `${API_BASE}/manager/orders/history`;
    const res = await fetch(url);
    if (!res.ok) return;
    const { summary } = await res.json();

    const totalEl   = document.getElementById('sales-total');
    const cashEl    = document.getElementById('sales-cash');
    const onlineEl  = document.getElementById('sales-online');
    const countEl   = document.getElementById('sales-count');

    if (totalEl)  totalEl.innerText  = `₹${(summary.total_revenue  || 0).toFixed(2)}`;
    if (cashEl)   cashEl.innerText   = `₹${(summary.cash_revenue   || 0).toFixed(2)}`;
    if (onlineEl) onlineEl.innerText = `₹${((summary.upi_revenue !== undefined ? summary.upi_revenue : summary.online_revenue) || 0).toFixed(2)}`;
    if (countEl)  countEl.innerText  = summary.delivered_count || 0;

    // If date is today or blank, update the top live revenue cards
    if (!date || date === todayDateString()) {
      updateTopLiveMetricCards(summary);
    }
  } catch (err) {
    console.error('Sales filter error:', err);
  }
}

async function updateTopLiveMetricCards(summaryData = null) {
  try {
    let summary = summaryData;
    if (!summary) {
      const res = await fetch(`${API_BASE}/manager/orders/history?date=${todayDateString()}`);
      if (res.ok) {
        const json = await res.json();
        summary = json.summary;
      }
    }
    if (!summary) return;

    const totalEl  = document.getElementById('top-metric-total');
    const cashEl   = document.getElementById('top-metric-cash');
    const upiEl    = document.getElementById('top-metric-upi');
    const ordersEl = document.getElementById('top-metric-orders');

    const totalRev = summary.total_revenue || 0;
    const cashRev  = summary.cash_revenue || 0;
    const upiRev   = (summary.upi_revenue !== undefined ? summary.upi_revenue : summary.online_revenue) || 0;
    const count    = summary.delivered_count || 0;

    if (totalEl)  totalEl.innerText  = `₹${totalRev.toFixed(2)}`;
    if (cashEl)   cashEl.innerText   = `₹${cashRev.toFixed(2)}`;
    if (upiEl)    upiEl.innerText    = `₹${upiRev.toFixed(2)}`;
    if (ordersEl) ordersEl.innerText = `${count}`;
  } catch (err) {
    console.warn('Failed to update top live metric cards:', err);
  }
}

async function renderSalesSummary() {
  updateTopLiveMetricCards();

  // Set date picker to today and trigger filtered load
  const input = document.getElementById('sales-date-filter');
  if (input && !input.value) input.value = todayDateString();
  await applySalesDateFilter();

  // Load Hand Cash input amount from local storage
  const handCashValue = localStorage.getItem('hand_cash_amount') || '0.00';
  const handCashInput = document.getElementById('hand-cash-input');
  if (handCashInput) handCashInput.value = parseFloat(handCashValue) ? parseFloat(handCashValue) : '';
}


async function saveHandCash() {
  const value = parseFloat(document.getElementById("hand-cash-input").value) || 0;
  if (value <= 0) return;
  showLoading(true);
  try {
    const res = await fetch(`${API_BASE}/sales/offline`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: value })
    });
    showLoading(false);
    if (res.ok) {
      localStorage.setItem("hand_cash_amount", value.toFixed(2));
      showToast("Direct offline hand cash sales recorded in database!", "success");
      await initDashboard();
    } else {
      const data = await res.json();
      showToast(data.error || "Failed to record sale", "error");
    }
  } catch (err) {
    showLoading(false);
    console.error("Save hand cash API error:", err);
    showToast("Server connection error recording sale", "error");
  }
}

// 7. Right Panel Inventory Controls
function renderCategoryFilters() {
  const container = document.getElementById("inventory-filter-bar");
  if (!container) return;

  const allActive = selectedCategoryFilter === 'all' 
    ? 'bg-primary text-slate-900 shadow-md font-bold' 
    : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 font-semibold';

  let html = `
    <button onclick="setCategoryFilter('all')" class="px-3 py-1.5 rounded-lg text-xs transition-all ${allActive}">
      All Items
    </button>
  `;

  categories.forEach(c => {
    const isSelected = selectedCategoryFilter === c.id;
    const buttonClass = isSelected
      ? 'bg-primary text-slate-900 shadow-md font-bold'
      : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 font-semibold';
    html += `
      <button onclick="setCategoryFilter('${c.id}')" class="px-3 py-1.5 rounded-lg text-xs transition-all ${buttonClass}">
        <span>${c.icon_url || c.icon || '📦'}</span> <span>${c.name}</span>
      </button>
    `;
  });

  container.innerHTML = html;
}

function setCategoryFilter(catId) {
  selectedCategoryFilter = catId;
  renderCategoryFilters();
  filterInventory();
}

function filterInventory() {
  renderInventoryTable();
}

function renderInventoryTable() {
  renderCategoryFilters();

  const tbody = document.getElementById("inventory-table-body");
  if (!tbody) return;

  document.getElementById("total-items-badge").innerText = products.length;

  const searchInput = document.getElementById("inventory-search");
  const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : '';

  let filtered = products;

  // 1. Filter by category
  if (selectedCategoryFilter !== 'all') {
    filtered = filtered.filter(p => p.category_id === selectedCategoryFilter);
  }

  // 2. Filter by search query
  if (searchQuery) {
    filtered = filtered.filter(p => p.name.toLowerCase().includes(searchQuery));
  }

  if (filtered.length === 0) {
    if (selectedCategoryFilter !== 'all') {
      tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-500">No items found in this category. Click <button onclick="openAddItemModal()" class="text-primary font-bold hover:underline bg-transparent border-0 cursor-pointer p-0 select-none inline">[+ Add Item]</button> to create one.</td></tr>`;
    } else {
      tbody.innerHTML = `<tr><td colspan="5" class="py-6 text-center text-slate-500">No products found.</td></tr>`;
    }
    return;
  }

  tbody.innerHTML = filtered.map(p => {
    const cat = categories.find(c => c.id === p.category_id);
    const catName = cat ? cat.name : "Uncategorized";
    const catEmoji = cat ? cat.icon_url : "📦";

    return `
      <tr class="border-b border-slate-800/40 hover:bg-slate-800/10">
        <td class="py-3 flex items-center gap-3">
          <img src="${p.image_url || 'https://images.unsplash.com/photo-1546273031-28b72a64353b?w=100'}" alt="${p.name}" class="w-8 h-8 rounded-lg object-cover flex-shrink-0 bg-slate-900 border border-slate-800">
          <span class="font-semibold text-slate-200 truncate max-w-[120px]">${p.name}</span>
        </td>
        <td class="py-3">
          <span class="inline-flex items-center gap-1 bg-slate-900 text-slate-300 px-2 py-0.5 rounded border border-slate-800 text-[10px]">
            <span>${catEmoji}</span> <span>${catName}</span>
          </span>
        </td>
        <td class="py-3 text-right font-bold text-slate-300">₹${p.price.toFixed(2)}</td>
        <td class="py-3">
          <div class="flex items-center justify-center gap-2">
            <button onclick="updateProductStock('${p.id}', ${p.stock_quantity - 1})" class="w-6 h-6 flex items-center justify-center bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 font-bold rounded">-</button>
            <span class="font-bold text-slate-200 text-xs w-6 text-center">${p.stock_quantity}</span>
            <button onclick="updateProductStock('${p.id}', ${p.stock_quantity + 1})" class="w-6 h-6 flex items-center justify-center bg-slate-900 border border-slate-800 hover:bg-slate-800 text-slate-300 font-bold rounded">+</button>
          </div>
        </td>
        <td class="py-3 text-right">
          <button onclick="openEditItemModal('${p.id}')" class="text-xs bg-slate-900 border border-slate-800 text-amber-400 hover:bg-amber-500 hover:text-slate-900 font-bold px-2 py-1 rounded transition-all mr-1">
            ✏️ Edit
          </button>
          <button onclick="deleteProduct('${p.id}')" class="text-xs bg-slate-900 border border-slate-800 text-rose-400 hover:bg-rose-500 hover:text-white font-bold px-2 py-1 rounded transition-all">
            🗑️ Delete
          </button>
        </td>
      </tr>
    `;
  }).join('');
}

async function updateProductStock(prodId, newStock) {
  if (newStock < 0) return;
  showLoading(true);
  try {
    const res = await fetch(`${API_BASE}/products/${prodId}/stock`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ stock_quantity: newStock })
    });
    const data = await res.json();
    showLoading(false);
    
    if (res.ok) {
      showToast("Stock quantity updated successfully!", "success");
      await initDashboard();
    } else {
      showToast(data.error || "Failed to update stock", "error");
    }
  } catch (err) {
    showLoading(false);
    console.error('Update stock API error:', err);
    showToast("Server connection error updating stock", "error");
  }
}

// 8. Sidebar & Scrolling Actions
function scrollToOrderDetails() {
  const container = document.getElementById("live-order-logs-container");
  if (container) {
    container.scrollIntoView({ behavior: 'smooth' });
    container.classList.add("border-primary");
    setTimeout(() => container.classList.remove("border-primary"), 2000);
  }
}

function renderOrderQueue() {
  const queue = document.getElementById("live-orders-list");
  if (!queue) return;

  const now = Date.now();
  const pending = orders.filter(o => {
    if (o.order_status !== 'PENDING_PICKUP') return false;
    const isCash = o.payment_method === 'CASH_AT_COUNTER';
    const isPaid = o.payment_status === 'PAID';
    if (isCash && !isPaid) {
      const orderCreatedAt = o.created_at ? new Date(o.created_at).getTime() : now;
      if (now - orderCreatedAt > 30 * 60 * 1000) {
        return false; // Auto-remove expired cash orders from active queue
      }
    }
    return true;
  });

  const queueCountEl = document.getElementById("tab-queue-count");
  if (queueCountEl) queueCountEl.innerText = pending.length;

  if (pending.length === 0) {
    queue.innerHTML = `<div class="text-center py-6 text-slate-500 text-xs">No pending orders in queue.</div>`;
    return;
  }

  queue.innerHTML = pending.map(o => {
    const timeStr = new Date(o.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    const isPaid = o.payment_status === 'PAID';
    const orderCreatedAt = o.created_at ? new Date(o.created_at).getTime() : now;
    const remMins = Math.max(1, Math.ceil((30 * 60 * 1000 - (now - orderCreatedAt)) / 60000));

    // Extract payment_mode ('CASH' vs 'UPI') and check guest status
    let paymentMode = 'CASH';
    let isGuest = false;
    let guestName = '';

    if (o.qr_code_data) {
      try {
        const qd = typeof o.qr_code_data === 'string' ? JSON.parse(o.qr_code_data) : o.qr_code_data;
        if (qd?.payment_mode) paymentMode = qd.payment_mode;
        else if (o.payment_method === 'ONLINE') paymentMode = 'UPI';

        if (qd?.order_type === 'GUEST_ORDER' || qd?.is_guest) {
          isGuest = true;
          guestName = qd.guest_name || 'Guest User';
        }
      } catch (e) {}
    } else if (o.payment_method === 'ONLINE') {
      paymentMode = 'UPI';
    }

    if (!isGuest && !o.student_id && o.order_type !== 'POS') {
      if (o.student && (o.student.reg_no === 'GUEST' || (o.student.name && o.student.name.startsWith('Guest')))) {
        isGuest = true;
        guestName = o.student.name;
      }
    }

    // High-visibility guest badge
    const guestBadge = isGuest ? `
      <span class="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-black bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm whitespace-nowrap">
        <i data-lucide="user-x" class="w-3 h-3 text-purple-400"></i> GUEST ORDER
      </span>
    ` : '';

    // High-visibility badge according to requirements:
    // If 'CASH': Show a green badge [ 💵 Expected: CASH ]
    // If 'UPI': Show a blue badge [ 📱 Expected: UPI QR ]
    let modeBadge = '';
    if (!isPaid) {
      if (paymentMode === 'CASH') {
        modeBadge = `
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 shadow-sm whitespace-nowrap">
            <span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            💵 Expected: CASH
          </span>
        `;
      } else {
        modeBadge = `
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-black bg-blue-500/15 text-blue-400 border border-blue-500/30 shadow-sm whitespace-nowrap">
            <span class="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span>
            📱 Expected: UPI QR
          </span>
        `;
      }
    } else {
      modeBadge = `
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-800 text-slate-300 border border-slate-700 whitespace-nowrap">
          <span class="w-2 h-2 rounded-full bg-emerald-400"></span>
          👨‍🍳 In Kitchen &bull; PAID (${paymentMode})
        </span>
      `;
    }

    // Action button:
    // Only [ ⚡ Verify & Deliver ] without duplicate payment button
    const actionBtn = `
      <div class="flex items-center gap-2">
        <button onclick="event.stopPropagation(); executeQuickVerify('${o.token_number || o.id}')"
          class="w-full sm:w-auto px-4 py-2 bg-primary hover:bg-primary-dark text-slate-950 font-black rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-95 whitespace-nowrap">
          <i data-lucide="zap" class="w-4 h-4"></i> ⚡ Verify & Deliver
        </button>
      </div>
    `;

    const customerDisplay = isGuest 
      ? `<span class="text-purple-300 font-bold">👤 ${guestName || 'Guest User'}</span> <span class="text-purple-400/80 text-[10px] font-semibold">(Table QR Guest)</span>`
      : (o.student ? o.student.name : 'Walk-in Customer');

    return `
      <div onclick="openOrderDetailModalByID('${o.id}')" class="p-4 bg-slate-900/80 rounded-2xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs cursor-pointer hover:bg-slate-800/80 hover:border-slate-700 transition-all shadow-md">
        <div class="space-y-1">
          <div class="flex items-center gap-2.5 flex-wrap">
            <span class="font-black text-primary tracking-wider text-base">${o.token_number}</span>
            ${guestBadge}
            ${modeBadge}
          </div>
          <p class="text-slate-300 font-semibold text-xs mt-1">${customerDisplay} &bull; <span class="text-slate-400 text-[10px]">${timeStr}</span></p>
          ${!isPaid ? `<p class="text-[10px] text-amber-400/80 font-medium">${remMins}m remaining in counter window</p>` : ''}
        </div>
        <div class="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-3">
          <span class="font-black text-slate-100 text-base">₹${o.total_amount.toFixed(2)}</span>
          ${actionBtn}
        </div>
      </div>
    `;
  }).join('');
  lucide.createIcons();
}

// ----------------------------------------------------
// 8b. Web Audio API Chime & Beep Generator
// ----------------------------------------------------
let _managerAudioCtx = null;
function getAudioContext() {
  if (!_managerAudioCtx) {
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (AudioCtx) _managerAudioCtx = new AudioCtx();
  }
  if (_managerAudioCtx && _managerAudioCtx.state === 'suspended') {
    _managerAudioCtx.resume();
  }
  return _managerAudioCtx;
}

function playBeep(type = 'success') {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    if (type === 'success') {
      // Crisp pleasant dual rising tone (D5 -> A5)
      const now = ctx.currentTime;
      const osc1 = ctx.createOscillator();
      const osc2 = ctx.createOscillator();
      const gain = ctx.createGain();

      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.18, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.28);

      osc1.type = 'sine';
      osc1.frequency.setValueAtTime(587.33, now); // D5
      osc1.connect(gain);
      osc1.start(now);
      osc1.stop(now + 0.1);

      osc2.type = 'sine';
      osc2.frequency.setValueAtTime(880.00, now + 0.08); // A5
      osc2.connect(gain);
      osc2.start(now + 0.08);
      osc2.stop(now + 0.28);
    } else {
      // Low warning buzzer
      const now = ctx.currentTime;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.24);

      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(190, now);
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.24);
    }
  } catch (e) {
    // Graceful fallback if audio is restricted by autoplay policies
  }
}

// ----------------------------------------------------
// 8c. Instant 1-Step Token Scan / Quick Verify Executor
// ----------------------------------------------------
async function executeQuickVerify(rawToken) {
  const token = (rawToken || '').trim();
  if (!token) return;

  const scannerInput = document.getElementById('quickTokenScanner');

  try {
    let result = null;
    try {
      const res = await fetch(`${API_BASE}/orders/quick-verify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token })
      });
      result = await res.json();
      if (!res.ok) {
        throw new Error(result.error || "Verification failed");
      }
    } catch (apiErr) {
      if (apiErr.message && (apiErr.message.includes('Already') || apiErr.message.includes('Cancelled') || apiErr.message.includes('Invalid') || apiErr.message.startsWith('❌'))) {
        throw apiErr;
      }
      console.warn("Backend /quick-verify failed, using direct Supabase atomic update fallback:", apiErr);

      // Fallback: Direct Supabase atomic resolution
      let cleanToken = token.replace(/^#/, '').trim();
      let candidates = [
        token,
        `#${cleanToken}`,
        cleanToken,
        cleanToken.startsWith('TK-') ? cleanToken : `TK-${cleanToken}`,
        `#TK-${cleanToken.replace(/^TK-?/i, '')}`
      ];
      candidates = [...new Set(candidates)];

      const { data: matched, error: sErr } = await supabase
        .from('orders')
        .select(`*, students(name, reg_no, department), order_items(*, products(name))`)
        .in('token_number', candidates);

      if (sErr || !matched || matched.length === 0) {
        throw new Error("❌ Token Invalid / Not Found");
      }

      let order = matched.find(o => o.order_status === 'PENDING_PICKUP') || matched[0];
      if (order.order_status === 'DELIVERED') {
        throw new Error(`❌ Token ${order.token_number} Already Delivered!`);
      }
      if (order.order_status === 'CANCELLED') {
        throw new Error(`❌ Order ${order.token_number} is Cancelled / Expired!`);
      }

      const nowIso = new Date().toISOString();
      let existingQr = {};
      if (order.qr_code_data) {
        existingQr = typeof order.qr_code_data === 'string' ? JSON.parse(order.qr_code_data) : order.qr_code_data;
      }
      const updatedQrData = {
        ...existingQr,
        payment_status: 'PAID',
        status: 'DELIVERED',
        order_status: 'DELIVERED',
        paid_at: existingQr.paid_at || nowIso,
        delivered_at: nowIso,
        completed_at: nowIso
      };

      const { data: updatedOrder, error: upErr } = await supabase
        .from('orders')
        .update({
          payment_status: 'PAID',
          order_status: 'DELIVERED',
          qr_code_data: updatedQrData
        })
        .eq('id', order.id)
        .select(`*, students(name, reg_no, department), order_items(*, products(name))`)
        .single();

      if (upErr) throw upErr;
      result = { success: true, order: updatedOrder };
    }

    if (result && result.success && result.order) {
      // 1. Play subtle success confirmation sound
      playBeep('success');

      const tokenNum = result.order.token_number || token;
      const totalAmount = parseFloat(result.order.total_amount || 0).toFixed(2);

      // 2. Quick green toast: ✅ Token #[XYZ] Settled & Delivered!
      showToast(`✅ Token ${tokenNum} Settled & Delivered! (₹${totalAmount})`, "success");

      // 3. Remove order immediately from local in-memory queue
      orders = orders.filter(o => o.id !== result.order.id);

      // 4. Update UI queue without full page refresh
      renderOrderQueue();

      // 5. Factor into manager daily collected cash/UPI totals immediately
      await renderSalesSummary();

      // If manager has history tab open, refresh history table
      if (currentView === 'history') {
        loadHistoryView();
      }

      // If order detail popup was open for this order, close it
      if (currentOrderInModal && currentOrderInModal.id === result.order.id) {
        closeOrderDetailModal();
      }

      // 6. Clear input field and keep focused for next customer in line
      if (scannerInput) {
        scannerInput.value = '';
        scannerInput.focus();
      }
    } else {
      throw new Error(result?.error || "❌ Token Verification Failed");
    }
  } catch (err) {
    playBeep('error');
    const errMsg = err.message.startsWith('❌') ? err.message : `❌ ${err.message}`;
    showToast(errMsg, "error");
    if (scannerInput) {
      scannerInput.select();
      scannerInput.focus();
    }
  }
}

function handleQuickTokenScanTrigger() {
  const scannerInput = document.getElementById('quickTokenScanner');
  if (scannerInput) {
    const val = scannerInput.value.trim();
    if (val) executeQuickVerify(val);
    else scannerInput.focus();
  }
}

function initQuickTokenScanner() {
  const scannerInput = document.getElementById('quickTokenScanner');
  if (!scannerInput) return;

  // Catch barcode / QR scanner Enter event or keyboard submission
  scannerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = scannerInput.value.trim();
      if (val) executeQuickVerify(val);
    }
  });

  // Auto-focus input
  setTimeout(() => scannerInput.focus(), 250);
}

async function confirmOrderPayment(orderId) {
  if (!orderId) return;
  showLoading(true);
  try {
    let success = false;
    try {
      const res = await fetch(`${API_BASE}/orders/${orderId}/confirm-payment`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' }
      });
      if (res.ok) success = true;
    } catch (e) {
      console.warn("Backend confirm-payment failed, trying direct Supabase:", e);
    }

    if (!success) {
      const { data: orderData } = await supabase
        .from('orders')
        .select('qr_code_data')
        .eq('id', orderId)
        .single();

      let currentQr = {};
      if (orderData && orderData.qr_code_data) {
        currentQr = typeof orderData.qr_code_data === 'string'
          ? JSON.parse(orderData.qr_code_data)
          : orderData.qr_code_data;
      }

      const { error } = await supabase
        .from('orders')
        .update({
          payment_status: 'PAID',
          qr_code_data: { ...currentQr, payment_status: 'PAID', paid_at: new Date().toISOString() }
        })
        .eq('id', orderId);

      if (error) throw error;
    }

    showLoading(false);
    showToast("✅ Payment Confirmed! Order marked as PAID and pushed to Kitchen Queue.", "success");
    await fetchOrders();
    renderSalesSummary();
    renderOrderQueue();
    if (currentView === 'history') {
      loadHistoryView();
    }
  } catch (err) {
    showLoading(false);
    console.error("Confirm payment error:", err);
    showToast("Failed to confirm payment: " + err.message, "error");
  }
}

// Real-time Postgres subscriptions
function setupRealtimeOrdersListener() {
  if (activeOrdersChannel) {
    supabase.removeChannel(activeOrdersChannel);
    activeOrdersChannel = null;
  }

  activeOrdersChannel = supabase
    .channel('orders_realtime_stream')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders' },
      async (payload) => {
        console.log('[Manager Realtime] New order received (INSERT):', payload.new);
        
        // Play audio alert ping for new orders
        playBeep('success');
        
        showToast(`🔔 New Order Received: ${payload.new?.token_number || 'Token'}!`, 'success');

        await fetchOrders();
        renderOrderQueue();
        await updateTopLiveMetricCards();
        if (currentView === 'sales') {
          renderSalesSummary();
        }
        if (currentView === 'history') {
          loadHistoryView();
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders' },
      async (payload) => {
        console.log('[Manager Realtime] Order updated (UPDATE):', payload.new);
        const updated = payload.new;

        const idx = orders.findIndex(o => o.id === updated.id);
        if (idx !== -1) {
          orders[idx] = { ...orders[idx], ...updated };
        }

        renderOrderQueue();
        await updateTopLiveMetricCards();
        if (currentView === 'sales') {
          renderSalesSummary();
        }
        if (currentView === 'history') {
          loadHistoryView();
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'orders' },
      async (payload) => {
        console.log('[Manager Realtime] Order deleted (DELETE):', payload.old);
        orders = orders.filter(o => o.id !== payload.old?.id);
        renderOrderQueue();
        await updateTopLiveMetricCards();
      }
    )
    .subscribe((status) => {
      console.log('[Manager Realtime] Subscription status:', status);
    });
}

// Window unload cleanup to prevent memory leaks
window.addEventListener('beforeunload', () => {
  if (activeOrdersChannel) {
    supabase.removeChannel(activeOrdersChannel);
    activeOrdersChannel = null;
  }
});

function populateCategorySelect() {
  ['new-prod-category', 'edit-prod-category'].forEach(id => {
    const select = document.getElementById(id);
    if (select) {
      select.innerHTML = categories.map(c => `<option value="${c.id}">${c.icon_url || c.icon || '📦'} ${c.name}</option>`).join('');
    }
  });
}

function openAddItemModal() {
  document.getElementById("add-item-modal").classList.remove("hidden");
  populateCategorySelect();
  if (selectedCategoryFilter && selectedCategoryFilter !== 'all') {
    const catSelect = document.getElementById("new-prod-category");
    if (catSelect) catSelect.value = selectedCategoryFilter;
  }
  lucide.createIcons();
}

function closeAddItemModal() {
  document.getElementById("add-item-modal").classList.add("hidden");
  document.getElementById("add-item-form").reset();
}

async function loadCategories() {
  try {
    const res = await fetch(`${API_BASE}/categories`);
    const data = await res.json();
    if (res.ok) {
      categories = data || [];
      populateCategorySelect();
      renderCategoriesList();
    }
  } catch (err) {
    console.error("loadCategories error:", err);
  }
}

async function handleProductAdd(event) {
  event.preventDefault();
  const name = document.getElementById("new-prod-name").value.trim();
  const catId = document.getElementById("new-prod-category").value;
  const stock = parseInt(document.getElementById("new-prod-stock").value);
  const price = parseFloat(document.getElementById("new-prod-price").value);
  const fileInput = document.getElementById("new-prod-file");
  const urlInput = document.getElementById("new-prod-image-url").value.trim();
  const barcodeInput = document.getElementById("new-prod-barcode").value.trim();

  showLoading(true);

  // Determine image source
  let imgUrl = 'https://images.unsplash.com/photo-1546273031-28b72a64353b?w=300';
  if (urlInput) {
    imgUrl = urlInput;
  } else if (fileInput.files && fileInput.files[0]) {
    const reader = new FileReader();
    const filePromise = new Promise((resolve) => {
      reader.onload = function(e) {
        resolve(e.target.result);
      };
      reader.readAsDataURL(fileInput.files[0]);
    });
    imgUrl = await filePromise;
  }

  // Generate or use barcode ID format
  const barcode = barcodeInput || ("BC-MAN-" + Math.floor(1000 + Math.random() * 9000));

  try {
    const res = await fetch(`${API_BASE}/products`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        category_id: catId,
        price,
        stock_quantity: stock,
        image_url: imgUrl,
        barcode_id: barcode
      })
    });
    const data = await res.json();
    showLoading(false);
    
    if (res.ok) {
      showToast("Product item added successfully!", "success");
      document.getElementById("add-item-form").reset();
      closeAddItemModal();
      await fetchProducts();
      renderInventoryTable();
    } else {
      showToast(data.error || "Failed to save product", "error");
    }
  } catch (err) {
    showLoading(false);
    console.error('Add product API error:', err);
    showToast("Server connection error adding product", "error");
  }
}

function openEditItemModal(prodId) {
  populateCategorySelect();

  const prod = products.find(p => p.id === prodId);
  if (!prod) return;

  document.getElementById("edit-prod-id").value = prod.id;
  document.getElementById("edit-prod-name").value = prod.name;
  document.getElementById("edit-prod-category").value = prod.category_id;
  document.getElementById("edit-prod-stock").value = prod.stock_quantity;
  document.getElementById("edit-prod-price").value = prod.price;
  document.getElementById("edit-prod-image-url").value = prod.image_url || '';
  const barcodeEl = document.getElementById("edit-prod-barcode");
  if (barcodeEl) barcodeEl.value = prod.barcode_id || '';

  document.getElementById("edit-item-modal").classList.remove("hidden");
  lucide.createIcons();
}

function closeEditItemModal() {
  document.getElementById("edit-item-modal").classList.add("hidden");
  document.getElementById("edit-item-form").reset();
}

async function handleProductEdit(event) {
  event.preventDefault();
  const id = document.getElementById("edit-prod-id").value;
  const name = document.getElementById("edit-prod-name").value.trim();
  const category_id = document.getElementById("edit-prod-category").value;
  const stock_quantity = parseInt(document.getElementById("edit-prod-stock").value);
  const price = parseFloat(document.getElementById("edit-prod-price").value);
  const image_url = document.getElementById("edit-prod-image-url").value.trim();
  const barcode_id = document.getElementById("edit-prod-barcode") ? document.getElementById("edit-prod-barcode").value.trim() : null;

  showLoading(true);
  try {
    const res = await fetch(`${API_BASE}/products/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        category_id,
        price,
        stock_quantity,
        image_url,
        barcode_id: barcode_id || null
      })
    });
    const data = await res.json();
    showLoading(false);

    if (res.ok) {
      showToast("Product updated successfully!", "success");
      closeEditItemModal();
      await fetchProducts();
      renderInventoryTable();
    } else {
      showToast(data.error || "Failed to update product", "error");
    }
  } catch (err) {
    showLoading(false);
    console.error('Update product API error:', err);
    showToast("Server connection error updating product", "error");
  }
}

async function deleteProduct(prodId) {
  if (!confirm("Are you sure you want to delete this item?")) return;
  showLoading(true);
  try {
    const res = await fetch(`${API_BASE}/products/${prodId}`, {
      method: 'DELETE'
    });
    showLoading(false);

    if (res.ok) {
      products = products.filter(p => p.id !== prodId);
      renderInventoryTable();
      showToast("Product deleted successfully!", "success");
      // Fetch fresh products to stay in sync
      fetchProducts().then(() => renderInventoryTable());
    } else {
      const data = await res.json();
      showToast(data.error || "Failed to delete product", "error");
    }
  } catch (err) {
    showLoading(false);
    console.error('Delete product API error:', err);
    showToast("Server connection error deleting product", "error");
  }
}

// 10. Navigation Bar View Toggling & Clock & Themes

function updateLiveClock() {
  const clockEl = document.getElementById("live-clock");
  if (!clockEl) return;
  const now = new Date();
  clockEl.innerText = now.toLocaleTimeString('en-US', { hour12: true });
}

// Sidebar Navigation Drawer Controls
function openSidebarDrawer() {
  const drawer = document.getElementById("sidebar-drawer");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (drawer) {
    drawer.classList.remove("-translate-x-full");
    drawer.classList.add("translate-x-0");
  }
  if (backdrop) {
    backdrop.classList.remove("opacity-0", "pointer-events-none");
    backdrop.classList.add("opacity-100", "pointer-events-auto");
  }
}

function closeSidebarDrawer() {
  const drawer = document.getElementById("sidebar-drawer");
  const backdrop = document.getElementById("sidebar-backdrop");
  if (drawer) {
    drawer.classList.remove("translate-x-0");
    drawer.classList.add("-translate-x-full");
  }
  if (backdrop) {
    backdrop.classList.remove("opacity-100", "pointer-events-auto");
    backdrop.classList.add("opacity-0", "pointer-events-none");
  }
}

function toggleSidebarDrawer() {
  const drawer = document.getElementById("sidebar-drawer");
  if (drawer && drawer.classList.contains("translate-x-0")) {
    closeSidebarDrawer();
  } else {
    openSidebarDrawer();
  }
}

function navigateToView(viewId) {
  showManagerView(viewId);
  closeSidebarDrawer();
}

function showManagerView(viewId) {
  currentView = viewId;
  const views = {
    'dashboard':  'manager-dashboard-view',
    'pos':        'pos-view',
    'sales':      'sales-view',
    'inventory':  'inventory-view',
    'categories': 'categories-view',
    'history':    'history-view',
    'settings':   'settings-view',
    'notice':     'notices-view'
  };

  // Hide all views
  Object.values(views).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  // Show active view
  const activeEl = document.getElementById(views[viewId]);
  if (activeEl) activeEl.classList.remove('hidden');

  // Reset all nav buttons to inactive style
  ['dashboard', 'pos', 'sales', 'inventory', 'categories', 'history', 'settings', 'notice'].forEach(name => {
    const btn = document.getElementById(`nav-btn-${name}`);
    if (btn) btn.className = 'w-full px-4 py-3 rounded-xl text-xs font-bold text-slate-300 hover:bg-slate-800 transition-all flex items-center gap-3 text-left';
  });

  // Highlight the active button
  const activeBtn = document.getElementById(`nav-btn-${viewId}`);
  if (activeBtn) activeBtn.className = 'w-full px-4 py-3 rounded-xl text-xs font-bold bg-primary text-slate-900 transition-all flex items-center gap-3 shadow-lg text-left';

  // Specific data refreshes on view navigation
  if (viewId === 'history') {
    loadHistoryView();
  } else if (viewId === 'sales') {
    renderSalesSummary();
  } else if (viewId === 'pos') {
    renderPosCategories();
    renderPosMenu();
    renderPosCart();
  } else if (viewId === 'inventory') {
    renderInventoryTable();
    renderCategoryFilters();
  } else if (viewId === 'categories') {
    renderCategoriesList();
  } else if (viewId === 'dashboard') {
    setTimeout(() => {
      const scanner = document.getElementById('quickTokenScanner');
      if (scanner) scanner.focus();
    }, 100);
  }

  lucide.createIcons();
}


function setThemeMode(mode) {
  localStorage.setItem("manager-theme", mode);
  
  // Clean classes
  document.body.classList.remove("theme-dark", "theme-light", "theme-reading");
  
  // Set selected
  if (mode === "light") {
    document.body.classList.add("theme-light");
  } else if (mode === "reading") {
    document.body.classList.add("theme-reading");
  } else {
    document.body.classList.add("theme-dark");
  }

  // Update button visual styles
  const btnDark = document.getElementById("theme-btn-dark");
  const btnLight = document.getElementById("theme-btn-light");
  const btnReading = document.getElementById("theme-btn-reading");

  [btnDark, btnLight, btnReading].forEach(btn => {
    if (btn) {
      btn.classList.remove("border-primary", "text-primary");
      btn.classList.add("border-slate-800", "text-slate-300");
    }
  });

  const activeBtn = document.getElementById(`theme-btn-${mode}`);
  if (activeBtn) {
    activeBtn.classList.remove("border-slate-800", "text-slate-300");
    activeBtn.classList.add("border-primary", "text-primary");
  }
}

// 11. Category Management CRUD
async function handleCategorySubmit(event) {
  event.preventDefault();
  const name = document.getElementById("category-name-input").value.trim();
  const icon = document.getElementById("category-icon-input").value.trim();
  const editId = document.getElementById("edit-category-id").value;

  showLoading(true);
  try {
    const res = await fetch(`${API_BASE}/categories`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: editId || undefined, name, icon })
    });
    const data = await res.json();
    showLoading(false);

    if (res.ok) {
      showToast(editId ? "Category updated successfully!" : "Category added successfully!", "success");
      document.getElementById("category-name-input").value = "";
      document.getElementById("category-icon-input").value = "";
      document.getElementById("edit-category-id").value = "";
      document.getElementById("category-form-title").innerText = "Add New Category";
      const cancelBtn = document.getElementById("category-cancel-btn");
      if (cancelBtn) cancelBtn.classList.add("hidden");
      await fetchCategories();
      renderCategoriesList();
      populateCategorySelect();
      renderCategoryFilters();
      await fetchProducts();
      renderInventoryTable();
    } else {
      showToast(data.error || "Error saving category", "error");
    }
  } catch (err) {
    showLoading(false);
    console.error("Category save API error:", err);
    showToast("Server connection error saving category", "error");
  }
}

function startEditCategory(id, name, icon) {
  document.getElementById("edit-category-id").value = id;
  document.getElementById("category-name-input").value = name;
  document.getElementById("category-icon-input").value = icon;
  document.getElementById("category-form-title").innerText = "Edit Category";
  document.getElementById("category-cancel-btn").classList.remove("hidden");
}

function cancelCategoryEdit() {
  document.getElementById("category-form").reset();
  document.getElementById("edit-category-id").value = "";
  document.getElementById("category-form-title").innerText = "Add New Category";
  document.getElementById("category-cancel-btn").classList.add("hidden");
}

async function deleteCategory(id) {
  if (!confirm("Are you sure you want to delete this category? All products under it will also be deleted.")) return;
  showLoading(true);
  try {
    const res = await fetch(`${API_BASE}/categories/${id}`, {
      method: 'DELETE'
    });
    const data = await res.json();
    showLoading(false);

    if (res.ok) {
      showToast("Category deleted successfully!", "success");
      await fetchCategories();
      renderCategoriesList();
      populateCategorySelect();
      renderCategoryFilters();
      await fetchProducts();
      renderInventoryTable();
    } else {
      showToast(data.error || "Failed to delete category", "error");
    }
  } catch (err) {
    showLoading(false);
    console.error("Delete category API error:", err);
    showToast("Server connection error deleting category", "error");
  }
}

function renderCategoriesList() {
  const tbody = document.getElementById("category-list-body");
  if (!tbody) return;

  if (!categories || categories.length === 0) {
    tbody.innerHTML = `<tr><td colspan="4" class="py-6 text-center text-slate-500 font-semibold">No categories found. Use the form on the left to add one.</td></tr>`;
    return;
  }

  tbody.innerHTML = categories.map(c => {
    const itemCount = (products || []).filter(p => p.category_id === c.id).length;
    return `
      <tr class="border-b border-slate-800/40 hover:bg-slate-800/20 transition-colors">
        <td class="py-3 pr-2 font-semibold text-xl text-slate-200">${c.icon_url || c.icon || '📦'}</td>
        <td class="py-3 pr-4 font-bold text-slate-100">${c.name}</td>
        <td class="py-3 pr-4 text-center">
          <span class="bg-primary/10 text-primary border border-primary/20 text-[10px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap">
            ${itemCount} ${itemCount === 1 ? 'item' : 'items'}
          </span>
        </td>
        <td class="py-3 text-right whitespace-nowrap">
          <button onclick="startEditCategory('${c.id}', '${c.name}', '${c.icon_url || c.icon || ''}')" class="text-xs bg-slate-900 border border-slate-800 text-primary hover:bg-primary hover:text-slate-900 font-bold px-2.5 py-1 rounded-lg transition-all mr-1.5 shadow-sm">
            Edit
          </button>
          <button onclick="deleteCategory('${c.id}')" class="text-xs bg-slate-900 border border-slate-800 text-rose-400 hover:bg-rose-500 hover:text-white font-bold px-2.5 py-1 rounded-lg transition-all shadow-sm">
            Delete
          </button>
        </td>
      </tr>
    `;
  }).join('');
  lucide.createIcons();
}

// 12. Post Notice Broadcast logic
async function handlePostNotice(event) {
  event.preventDefault();
  const title = document.getElementById("notice-title-input").value.trim();
  const message = document.getElementById("notice-message-input").value.trim();

  showLoading(true);
  try {
    const res = await fetch(`${API_BASE}/notices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, message })
    });
    const data = await res.json();
    showLoading(false);

    if (res.ok) {
      showToast("Notice broadcasted successfully!", "success");
      document.getElementById("post-notice-form").reset();
      showManagerView('dashboard');
    } else {
      showToast(data.error || "Broadcast failed", "error");
    }
  } catch (err) {
    showLoading(false);
    console.error("Post notice API error:", err);
    showToast("Server connection error broadcasting notice", "error");
  }
}

// 13. Screen ④: Scanner & Dispensation Details
let currentScannerMode = 'camera'; // 'camera' or 'upload'

async function stopActiveScanner() {
  if (html5QrCode) {
    try {
      if (html5QrCode.isScanning) {
        await html5QrCode.stop();
      }
    } catch (e) {
      console.warn("Scanner stop error:", e);
    }
    try {
      await html5QrCode.clear();
    } catch (e) {
      console.warn("Scanner clear error:", e);
    }
    html5QrCode = null;
  }
}

async function switchScannerTab(mode) {
  currentScannerMode = mode;
  const cameraTabBtn = document.getElementById("scanner-tab-camera");
  const uploadTabBtn = document.getElementById("scanner-tab-upload");
  const cameraView = document.getElementById("scanner-camera-view");
  const uploadView = document.getElementById("scanner-upload-view");

  if (mode === 'camera') {
    if (cameraTabBtn) {
      cameraTabBtn.className = "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold bg-primary text-slate-900 transition-all shadow";
    }
    if (uploadTabBtn) {
      uploadTabBtn.className = "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold text-slate-400 hover:text-white transition-all";
    }
    if (cameraView) cameraView.classList.remove("hidden");
    if (uploadView) uploadView.classList.add("hidden");

    await startCameraFeed();
  } else {
    if (uploadTabBtn) {
      uploadTabBtn.className = "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold bg-primary text-slate-900 transition-all shadow";
    }
    if (cameraTabBtn) {
      cameraTabBtn.className = "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold text-slate-400 hover:text-white transition-all";
    }
    if (cameraView) cameraView.classList.add("hidden");
    if (uploadView) uploadView.classList.remove("hidden");

    // Immediately stop live camera stream to release device hardware
    await stopActiveScanner();
  }
  lucide.createIcons();
}

async function startCameraFeed() {
  const modal = document.getElementById("scanner-modal");
  const readerContainer = document.getElementById("qr-reader");

  // Render clean loading placeholder inside viewfinder
  if (readerContainer) {
    readerContainer.innerHTML = `
      <div id="camera-loading-box" class="w-full h-full flex flex-col items-center justify-center gap-3 text-slate-400 bg-slate-900">
        <div class="w-9 h-9 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <p class="text-xs font-semibold text-slate-300">Initializing camera...</p>
      </div>
    `;
  }

  // Stop any existing camera instance
  await stopActiveScanner();

  // Defer camera startup to allow browser paint/layout cycle
  setTimeout(async () => {
    // If modal was closed or tab was switched to upload during timeout, exit cleanly
    if (!modal || modal.classList.contains("hidden") || currentScannerMode !== 'camera') return;

    try {
      if (typeof Html5Qrcode === "undefined") {
        throw new Error("Html5Qrcode library is not loaded.");
      }

      html5QrCode = new Html5Qrcode("qr-reader");

      const qrConfig = {
        fps: 15,
        qrbox: (viewfinderWidth, viewfinderHeight) => {
          const minDim = Math.min(viewfinderWidth, viewfinderHeight);
          const size = Math.floor(minDim * 0.75);
          return { width: Math.max(180, size), height: Math.max(180, size) };
        },
        aspectRatio: 1.0
      };

      // Try environment / back camera first; if not available, fallback to default camera
      try {
        await html5QrCode.start(
          { facingMode: "environment" },
          qrConfig,
          onScanSuccess,
          onScanError
        );
      } catch (backCamErr) {
        console.warn("Back camera unavailable, trying default camera:", backCamErr);
        await html5QrCode.start(
          true,
          qrConfig,
          onScanSuccess,
          onScanError
        );
      }

      // Remove loading indicator once camera stream is active
      const loader = document.getElementById("camera-loading-box");
      if (loader) loader.remove();

    } catch (err) {
      console.error("Camera startup failed:", err);
      if (readerContainer) {
        const isPermission = err.name === 'NotAllowedError' || (err.message && err.message.toLowerCase().includes('permission'));
        readerContainer.innerHTML = `
          <div class="w-full h-full flex flex-col items-center justify-center p-6 text-center gap-3 text-slate-400 bg-slate-900">
            <i data-lucide="camera-off" class="w-10 h-10 text-rose-400"></i>
            <p class="text-xs font-bold text-slate-200">Unable to access camera</p>
            <p class="text-[10px] text-slate-400 max-w-[220px]">
              ${isPermission ? 'Camera permission was denied. Please allow camera access in your browser settings.' : 'Camera is unavailable or in use by another application.'}
            </p>
            <button onclick="startCameraFeed()" class="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-primary font-bold rounded-lg text-xs transition-all flex items-center gap-1.5 mt-1">
              <i data-lucide="refresh-cw" class="w-3.5 h-3.5"></i> Retry Camera
            </button>
          </div>
        `;
        lucide.createIcons();
      }
      showToast("Camera access failed. Check browser permissions or use Upload tab.", "error");
    }
  }, 100);
}

async function openScannerModal(target = 'order') {
  currentScannerTarget = target;
  const modal = document.getElementById("scanner-modal");
  const titleEl = document.getElementById("scanner-modal-title");
  const manualSection = document.getElementById("scanner-manual-section");

  if (titleEl) {
    if (target.startsWith('product')) {
      titleEl.innerText = "Scan Product Barcode";
    } else {
      titleEl.innerText = "Scan Student QR Code";
    }
  }

  // Context-aware footer: Show manual token input for order verification; hide for inventory/product scanning
  if (manualSection) {
    if (target.startsWith('product')) {
      manualSection.classList.add('hidden');
    } else {
      manualSection.classList.remove('hidden');
    }
  }

  // Reset manual input
  const manualInput = document.getElementById("scanner-manual-input");
  if (manualInput) manualInput.value = '';

  // 1. Unhide modal in the DOM first so dimensions are non-zero
  modal.classList.remove("hidden");

  // 2. Default to Live Camera tab
  await switchScannerTab('camera');
}

// 14. Image File Upload & Drop Scanning Logic
async function handleQrFileUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;
  await processUploadedQrImage(file);
}

async function handleQrFileDrop(event) {
  event.preventDefault();
  const dropzone = document.getElementById("scanner-upload-view");
  if (dropzone) dropzone.classList.remove('border-primary');

  const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
  if (!file) return;
  await processUploadedQrImage(file);
}

async function processUploadedQrImage(file) {
  if (!file.type.startsWith('image/')) {
    showToast("Please upload a valid image file (PNG, JPG, WebP).", "error");
    return;
  }

  showToast("🔍 Processing image for QR / Barcode...", "success");
  showLoading(true);

  let scannerInstance = null;
  try {
    // Ensure any live camera is stopped
    await stopActiveScanner();

    scannerInstance = new Html5Qrcode("qr-reader");
    const decodedText = await scannerInstance.scanFile(file, true);

    showLoading(false);
    try {
      await scannerInstance.clear();
    } catch (e) {}

    await onScanSuccess(decodedText);

  } catch (err) {
    showLoading(false);
    console.warn("File QR decode error:", err);
    try {
      if (scannerInstance) await scannerInstance.clear();
    } catch (e) {}
    
    showToast("No valid QR / Barcode found in this image. Please try another photo.", "error");
    
    const fileInput = document.getElementById("qr-file-input");
    if (fileInput) fileInput.value = '';
  }
}

// 15. Manual and Scan order lookup logic
async function closeScannerModal() {
  const modal = document.getElementById("scanner-modal");
  if (modal) modal.classList.add("hidden");
  await stopActiveScanner();
  const readerContainer = document.getElementById("qr-reader");
  if (readerContainer) readerContainer.innerHTML = '';
  const fileInput = document.getElementById("qr-file-input");
  if (fileInput) fileInput.value = '';
}

async function onScanSuccess(decodedText) {
  const target = currentScannerTarget;
  await closeScannerModal();
  // Route strictly to inventory if scanner was opened for product operations
  if (target && target.startsWith('product')) {
    await handleInventoryScan(decodedText, target);
  } else {
    await handleScan(decodedText);
  }
}

function onScanError(e) {
  // Silent frame-by-frame decode failure
}

// ======================================================
// DUAL-MODE SCANNING ENGINE
// ======================================================

/**
 * Unified scan dispatcher. Called by hardware wedge (Enter key) AND webcam.
 * Parses the raw data, routes to order verification or inventory handling.
 */
async function handleScan(rawData) {
  const cleaned = (rawData || '').trim();
  if (!cleaned) return;

  // Check if Add or Edit modal is currently active
  const addModalEl = document.getElementById('add-item-modal');
  const editModalEl = document.getElementById('edit-item-modal');
  const isAddModalOpen = addModalEl && !addModalEl.classList.contains('hidden');
  const isEditModalOpen = editModalEl && !editModalEl.classList.contains('hidden');

  // If user is currently on POS view, check if scanned string matches a product barcode
  if (currentView === 'pos') {
    const cleanLower = cleaned.toLowerCase();
    const posMatch = products.find(p =>
      (p.barcode_id && p.barcode_id.toLowerCase() === cleanLower) ||
      p.id === cleaned
    );
    if (posMatch) {
      showToast(`⚡ POS Scanned: ${posMatch.name}`, 'success');
      addToPosCart(posMatch.id);
      return;
    }
  }

  let parsed = null;
  try {
    parsed = JSON.parse(cleaned);
  } catch (e) {
    // Not JSON — treat as plain token/barcode/uuid string
  }

  // 1. Explicit JSON routing
  if (parsed && typeof parsed === 'object') {
    // JSON with barcode_id or product_id → strictly route to inventory
    if (parsed.barcode_id || parsed.product_id) {
      showToast('🔍 Scanning Barcode...', 'success');
      await handleInventoryScan(parsed.barcode_id || parsed.product_id);
      return;
    }

    const orderId = parsed.order_id || parsed.orderId || parsed.id || null;
    const token = parsed.token_number || parsed.token || null;

    if (orderId || token) {
      // If user is in Inventory Scan Mode or has Add/Edit modal open, handle as inventory barcode
      if (inventoryScanModeActive || isAddModalOpen || isEditModalOpen) {
        showToast('🔍 Scanning Barcode...', 'success');
        await handleInventoryScan(parsed.barcode_id || parsed.order_id || parsed.token || cleaned);
        return;
      }
      showToast('🔍 Verifying Order...', 'success');
      await verifyOrderLookup(orderId || token, token);
      return;
    }
  }

  // 2. Direct inventory contexts: Scan Mode active OR Add/Edit Item modal open
  if (inventoryScanModeActive || isAddModalOpen || isEditModalOpen) {
    showToast('🔍 Scanning Barcode...', 'success');
    await handleInventoryScan(cleaned);
    return;
  }

  // 3. Check if scanned string matches a product barcode in inventory
  const cleanLower = cleaned.toLowerCase();
  const productMatch = products.find(p =>
    (p.barcode_id && p.barcode_id.toLowerCase() === cleanLower) ||
    p.id === cleaned
  );

  if (productMatch || cleaned.startsWith('BC-') || cleaned.startsWith('BARCODE-') || cleaned.startsWith('PROD-')) {
    showToast('🔍 Scanning Barcode...', 'success');
    await handleInventoryScan(cleaned);
    return;
  }

  // 4. Default: Hardware/QR scanner locates order and automatically triggers Order Verification modal
  showToast('🔍 Verifying Order...', 'success');
  await verifyOrderLookup(cleaned);
}

/**
 * Inventory scan mode handler.
 * Looks up a product by barcode_id; if found → opens edit modal,
 * if not found → pre-fills barcode in the Add Item modal.
 */
async function handleInventoryScan(rawBarcode, targetHint = null) {
  const cleanBarcode = (rawBarcode || '').trim().replace(/^['"]|['"]$/g, '');
  if (!cleanBarcode) return;

  // Make sure products list is up to date
  if (!products || products.length === 0) {
    await fetchProducts();
  }

  // If user clicked camera icon specifically inside the Edit modal to update barcode
  if (targetHint === 'product_edit_prefill') {
    const editBarcodeInput = document.getElementById("edit-prod-barcode");
    if (editBarcodeInput) editBarcodeInput.value = cleanBarcode;
    showToast(`Barcode ${cleanBarcode} filled in edit form`, 'success');
    return;
  }

  // Find if matching product already exists (by barcode_id or id)
  const match = products.find(p =>
    (p.barcode_id && p.barcode_id.toLowerCase() === cleanBarcode.toLowerCase()) ||
    p.id === cleanBarcode
  );

  if (match) {
    showToast(`📦 Item Found: ${match.name} (₹${match.price.toFixed(2)})`, 'success');
    closeAddItemModal();
    openEditItemModal(match.id);
  } else {
    showToast(`🔍 New barcode: ${cleanBarcode} — Enter details to add new item`, 'success');
    closeEditItemModal();
    openAddItemModal();
    const barcodeInput = document.getElementById('new-prod-barcode');
    if (barcodeInput) barcodeInput.value = cleanBarcode;

    // Reset price for manager input
    const priceInput = document.getElementById('new-prod-price');
    if (priceInput) priceInput.value = '';

    const nameInput = document.getElementById('new-prod-name');
    const urlInput = document.getElementById('new-prod-image-url');
    if (nameInput) {
      nameInput.value = '';
      nameInput.placeholder = 'Fetching product name...';
    }

    // Auto-fetch product name from Open Food Facts API
    try {
      fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(cleanBarcode)}.json`)
        .then(res => res.ok ? res.json() : null)
        .then(data => {
          if (data && data.product) {
            const fetchedName = data.product.product_name ||
                                data.product.product_name_en ||
                                data.product.generic_name ||
                                data.product.brands || '';
            if (fetchedName && nameInput && (!nameInput.value || nameInput.value === '')) {
              nameInput.value = fetchedName;
              showToast(`✨ Auto-detected: ${fetchedName}`, 'success');
            }
            if (urlInput && !urlInput.value) {
              const fetchedImg = data.product.image_url || data.product.image_front_url || '';
              if (fetchedImg) urlInput.value = fetchedImg;
            }
          }
        })
        .catch(() => {
          // Graceful fallback for network or lookup errors
        })
        .finally(() => {
          if (nameInput) {
            nameInput.placeholder = 'e.g. Samosa';
            nameInput.focus();
          }
        });
    } catch (e) {
      if (nameInput) {
        nameInput.placeholder = 'e.g. Samosa';
        nameInput.focus();
      }
    }
  }
}

/**
 * Toggle Inventory Scan Mode on/off.
 * When active, all hardware wedge / camera scans route to handleInventoryScan().
 */
function toggleInventoryScanMode() {
  inventoryScanModeActive = !inventoryScanModeActive;

  const btn = document.getElementById('inventory-scan-mode-btn');
  const banner = document.getElementById('inventory-scan-mode-banner');

  if (inventoryScanModeActive) {
    showToast('📡 Inventory Scan Mode: ON — scan any product barcode', 'success');
    if (btn) {
      btn.innerHTML = `<i data-lucide="scan-line" class="w-3.5 h-3.5"></i> Scan Mode: ON`;
      btn.classList.remove('bg-slate-900', 'text-slate-300', 'border-slate-700');
      btn.classList.add('bg-primary/20', 'text-primary', 'border-primary/40');
    }
    if (banner) banner.classList.remove('hidden');
  } else {
    showToast('Inventory Scan Mode: OFF', 'success');
    if (btn) {
      btn.innerHTML = `<i data-lucide="scan-line" class="w-3.5 h-3.5"></i> Scan Mode: OFF`;
      btn.classList.add('bg-slate-900', 'text-slate-300', 'border-slate-700');
      btn.classList.remove('bg-primary/20', 'text-primary', 'border-primary/40');
    }
    if (banner) banner.classList.add('hidden');
  }
  lucide.createIcons();
}

/**
 * Robust order lookup by UUID ID or Token Number.
 * Queries /api/orders/:id and populates Order Details Modal.
 */
async function verifyOrderLookup(identifier, secondaryIdentifier = null) {
  if (!identifier) {
    showLoading(false);
    showToast("Invalid QR code: No order identifier found.", "error");
    return;
  }

  const cleanId = String(identifier).trim().replace(/^['"]|['"]$/g, '');
  if (!cleanId) {
    showLoading(false);
    showToast("Empty or invalid order identifier.", "error");
    return;
  }

  showLoading(true);

  try {
    // 1. Try primary lookup via GET /api/orders/:id
    let res = await fetch(`${API_BASE}/orders/${encodeURIComponent(cleanId)}`);
    let data = null;

    if (res.ok) {
      data = await res.json();
    } else if (secondaryIdentifier) {
      // 2. If primary failed, try secondary identifier (e.g. token_number)
      const cleanSec = String(secondaryIdentifier).trim().replace(/^['"]|['"]$/g, '');
      if (cleanSec && cleanSec !== cleanId) {
        const secRes = await fetch(`${API_BASE}/orders/${encodeURIComponent(cleanSec)}`);
        if (secRes.ok) {
          data = await secRes.json();
        }
      }
    }

    // 3. Fallback: try querying /api/orders?token_number=...
    if (!data) {
      const tokenQueryRes = await fetch(`${API_BASE}/orders?token_number=${encodeURIComponent(cleanId)}`);
      if (tokenQueryRes.ok) {
        const tokenData = await tokenQueryRes.json();
        if (tokenData && (tokenData.id || tokenData.token_number)) {
          data = tokenData;
        }
      }
    }

    showLoading(false);

    if (!data || (!data.id && !data.token_number)) {
      showToast("Order not found or already completed.", "error");
      return;
    }

    // Check if the order is expired (30-minute cash window passed or marked cancelled)
    const isCash = data.payment_method === 'CASH_AT_COUNTER';
    const isPaid = data.payment_status === 'PAID' || data.payment_method === 'ONLINE';
    const orderCreatedAt = data.created_at ? new Date(data.created_at).getTime() : Date.now();
    const isPast30Min = (Date.now() - orderCreatedAt) > (30 * 60 * 1000);
    const isExpired = data.order_status === 'CANCELLED' || (!isPaid && isCash && isPast30Min);

    if (isExpired) {
      showToast("Order Expired: 30-minute cash payment window passed.", "error");
      await closeScannerModal();
      return;
    }

    // Normalize order items
    const rawItems = data.order_items || data.items || [];
    const itemsList = rawItems.map(oi => ({
      name: oi.products ? oi.products.name : (oi.name || 'Canteen Item'),
      quantity: parseInt(oi.quantity) || 1,
      unit_price: parseFloat(oi.unit_price || (oi.products ? oi.products.price : 0) || 0)
    }));

    // Normalize student profile
    const studentInfo = data.students || data.student || {
      name: data.student_name || 'Student',
      reg_no: data.student_reg || 'N/A',
      department: data.student_dept || ''
    };

    const normalizedOrder = {
      ...data,
      id: data.id,
      token_number: data.token_number || data.token || cleanId,
      total_amount: parseFloat(data.total_amount || 0),
      payment_method: data.payment_method || 'ONLINE',
      payment_status: data.payment_status || 'PAID',
      order_status: data.order_status || 'PENDING_PICKUP',
      students: studentInfo,
      items: itemsList
    };

    showToast(`✅ Order Verified: ${normalizedOrder.token_number}`, "success");
    await closeScannerModal();
    openOrderDetailModal(normalizedOrder);

  } catch (err) {
    showLoading(false);
    console.error("verifyOrderLookup exception:", err);
    showToast("Order not found or already completed.", "error");
  }
}

// Backward compatibility helpers
async function verifyOrderById(orderId) {
  return verifyOrderLookup(orderId);
}

async function verifyAndOpenDispensation(tokenInput) {
  return verifyOrderLookup(tokenInput);
}

function handleManualTokenSubmit() {
  const token = document.getElementById("scanner-manual-input").value.trim().toUpperCase();
  if (!token) return;
  closeScannerModal();
  executeQuickVerify(token);
}

function openOrderDetailModal(order) {
  const modal = document.getElementById("order-detail-modal");
  const body = document.getElementById("order-detail-modal-body");

  const tokenNumber = order.token_number || order.token || 'N/A';
  const orderId = order.id && order.id !== "undefined" ? order.id : null;
  const studentName = order.students ? order.students.name : (order.student_name || (order.student ? order.student.name : 'Student'));
  const regNo = order.students ? order.students.reg_no : (order.student_reg || (order.student ? order.student.reg_no : 'N/A'));
  const dept = order.students ? order.students.department : (order.student_dept || (order.student ? order.student.department : 'N/A'));
  const totalAmountFormatted = parseFloat(order.total_amount || 0).toFixed(2);

  const isCash = order.payment_method === 'CASH_AT_COUNTER';
  const isPaid = order.payment_status === 'PAID';
  const orderCreatedAt = order.created_at ? new Date(order.created_at).getTime() : Date.now();
  const isPast30Min = (Date.now() - orderCreatedAt) > (30 * 60 * 1000);
  const isExpired = order.order_status === 'CANCELLED' || (!isPaid && isPast30Min);
  const isDelivered = order.order_status === 'DELIVERED';

  const orderItemsList = order.order_items || order.items || [];
  const itemsHTML = orderItemsList.map(i => {
    const itemName = i.products ? i.products.name : (i.name || 'Unknown Product');
    return `<div class="flex justify-between text-xs py-0.5"><span>${i.quantity}x ${itemName}</span><span>₹${(parseFloat(i.unit_price || 0) * i.quantity).toFixed(2)}</span></div>`;
  }).join('');

  // Extract payment transaction reference
  let txnRef = '';
  if (order.qr_code_data) {
    if (typeof order.qr_code_data === 'object') {
      txnRef = order.qr_code_data.txn_ref || order.qr_code_data.payment_id || '';
    } else if (typeof order.qr_code_data === 'string') {
      try {
        const parsed = JSON.parse(order.qr_code_data);
        txnRef = parsed.txn_ref || parsed.payment_id || '';
      } catch (e) {}
    }
  }

  let paymentMode = 'CASH';
  let isGuest = false;
  let guestName = '';

  if (order.qr_code_data) {
    try {
      const qd = typeof order.qr_code_data === 'string' ? JSON.parse(order.qr_code_data) : order.qr_code_data;
      if (qd?.payment_mode) paymentMode = qd.payment_mode;
      else if (order.payment_method === 'ONLINE') paymentMode = 'UPI';

      if (qd?.order_type === 'GUEST_ORDER' || qd?.is_guest) {
        isGuest = true;
        guestName = qd.guest_name || 'Guest User';
      }
    } catch(e) {}
  } else if (order.payment_method === 'ONLINE') {
    paymentMode = 'UPI';
  }

  if (!isGuest && !order.student_id && order.order_type !== 'POS') {
    if (order.students && (order.students.reg_no === 'GUEST' || (order.students.name && order.students.name.startsWith('Guest')))) {
      isGuest = true;
      guestName = order.students.name;
    }
  }

  const guestModalBadge = isGuest ? `
    <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm whitespace-nowrap">
      <i data-lucide="user-x" class="w-3 h-3 text-purple-400"></i> GUEST ORDER
    </span>
  ` : '';

  let paymentBadge = '';
  if (isExpired) {
    paymentBadge = `<span class="bg-red-500/15 text-red-400 border border-red-500/30 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5"><span class="w-1.5 h-1.5 bg-red-400 rounded-full"></span> EXPIRED</span>`;
  } else if (isPaid) {
    paymentBadge = `<span class="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs font-bold px-2.5 py-1 rounded-full flex items-center gap-1.5"><span class="w-1.5 h-1.5 bg-emerald-400 rounded-full"></span> ✅ PAID (${paymentMode})</span>`;
  } else {
    if (paymentMode === 'CASH') {
      paymentBadge = `<span class="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-xs font-black px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm"><span class="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span> 💵 Expected: CASH</span>`;
    } else {
      paymentBadge = `<span class="bg-blue-500/15 text-blue-400 border border-blue-500/30 text-xs font-black px-3 py-1 rounded-full flex items-center gap-1.5 shadow-sm"><span class="w-2 h-2 rounded-full bg-blue-400 animate-pulse"></span> 📱 Expected: UPI QR</span>`;
    }
  }

  body.innerHTML = `
    <div class="space-y-4 text-xs text-slate-300">
      <div class="flex justify-between items-start">
        <div>
          <span class="text-xl font-black text-primary tracking-wider">${tokenNumber}</span>
          <p class="text-[10px] text-slate-400 mt-0.5">Order ID: ${orderId || 'N/A'}</p>
        </div>
        <div class="text-right flex flex-col items-end gap-1.5">
          <div class="flex items-center gap-1.5 flex-wrap justify-end">
            ${guestModalBadge}
            ${paymentBadge}
          </div>
          <span class="font-extrabold text-sm text-slate-200">₹${totalAmountFormatted}</span>
        </div>
      </div>

      ${txnRef ? `
        <div class="bg-emerald-950/40 border border-emerald-500/30 p-2.5 rounded-xl flex items-center justify-between text-xs">
          <span class="text-emerald-300 font-semibold flex items-center gap-1.5">
            <i data-lucide="shield-check" class="w-3.5 h-3.5 text-emerald-400"></i> Gateway Ref
          </span>
          <span class="font-mono text-emerald-400 font-bold text-[11px]">${txnRef}</span>
        </div>
      ` : ''}

      ${isExpired ? `
        <div class="p-3 bg-red-500/10 border border-red-500/30 rounded-xl text-red-400 font-bold text-xs flex items-center gap-2">
          <i data-lucide="alert-octagon" class="w-4 h-4 text-red-400 flex-shrink-0"></i>
          <span>Order Expired: 30-minute counter payment window passed.</span>
        </div>
      ` : ''}

      <div class="bg-slate-900 border border-slate-800 p-3 rounded-lg space-y-1">
        <p class="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Customer Information</p>
        <p class="text-xs font-semibold text-slate-200">
          ${isGuest 
            ? `👤 ${guestName || 'Guest User'} &bull; <span class="text-purple-400 font-bold">Instant Guest Mode (Table QR Scan)</span>` 
            : `${studentName} (Reg No: ${regNo}${dept && dept !== 'N/A' ? `, Dept: ${dept}` : ''})`}
        </p>
      </div>

      <div class="bg-slate-900 border border-slate-800 p-3 rounded-lg space-y-1">
        <p class="text-[9px] uppercase font-bold text-slate-400 tracking-wider mb-1.5">Ordered Items List</p>
        ${itemsHTML}
      </div>

      <div class="pt-4 flex gap-3">
        <button onclick="closeOrderDetailModal()" class="flex-1 border border-slate-700 hover:bg-slate-800 text-slate-300 font-bold py-2.5 rounded-xl text-xs transition-all">
          Close
        </button>
        ${isExpired ? `
          <button disabled class="flex-1 bg-red-900/30 text-red-400 border border-red-500/20 font-bold py-2.5 rounded-xl text-xs cursor-not-allowed">
            Order Expired
          </button>
        ` : isDelivered ? `
          <button disabled class="flex-1 bg-slate-800 text-slate-500 font-bold py-2.5 rounded-xl text-xs cursor-not-allowed">
            Dispatched
          </button>
        ` : `
          <button id="btn-modal-verify-deliver" onclick="executeQuickVerify('${tokenNumber || orderId}'); closeOrderDetailModal();" class="flex-1 bg-primary hover:bg-primary-dark text-slate-950 font-black py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-lg active:scale-95">
            <i data-lucide="zap" class="w-4 h-4"></i> ⚡ Verify & Deliver
          </button>
        `}
      </div>
    </div>
  `;

  // Track current order for Enter-key shortcut
  currentOrderInModal = { id: orderId, token: tokenNumber, isDelivered: isDelivered || isExpired };

  // Show / hide the Enter-to-deliver keyboard hint
  const enterHint = document.getElementById('enter-deliver-hint');
  if (enterHint) {
    if (!isDelivered && !isExpired) enterHint.classList.remove('hidden');
    else enterHint.classList.add('hidden');
  }

  if (!isDelivered && !isExpired) {
    // Enter-key shortcut: press Enter anywhere when modal is open to deliver instantly
    if (enterDeliverListener) {
      document.removeEventListener('keydown', enterDeliverListener);
    }
    enterDeliverListener = (e) => {
      if (e.key === 'Enter' && currentOrderInModal && !currentOrderInModal.isDelivered) {
        const modal = document.getElementById('order-detail-modal');
        if (modal && !modal.classList.contains('hidden')) {
          e.preventDefault();
          executeQuickVerify(currentOrderInModal.token || currentOrderInModal.id);
          closeOrderDetailModal();
        }
      }
    };
    document.addEventListener('keydown', enterDeliverListener);
  }

  modal.classList.remove("hidden");
  lucide.createIcons();
}

async function deliverOrderDirectly(orderId) {
  if (!orderId || orderId === "undefined") {
    console.error("Delivery API prevented: orderId is undefined.");
    showToast("Invalid order ID provided", "error");
    return;
  }
  showLoading(true);
  try {
    const res = await fetch(`${API_BASE}/orders/${orderId}/deliver`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' }
    });
    const data = await res.json();
    showLoading(false);

    if (res.ok) {
      showToast("Order status updated: Status : Deliver!", "success");
      await initDashboard();
    } else {
      showToast(data.error || "Failed to deliver order", "error");
    }
  } catch (err) {
    showLoading(false);
    console.error("Deliver order API error:", err);
    showToast("Server connection error delivering order", "error");
  }
}

function openOrderDetailModalByID(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (order) openOrderDetailModal(order);
}

function closeOrderDetailModal() {
  document.getElementById("order-detail-modal").classList.add("hidden");
  currentOrderInModal = null;
  // Hide the keyboard hint
  const enterHint = document.getElementById('enter-deliver-hint');
  if (enterHint) enterHint.classList.add('hidden');
  // Remove the Enter-to-deliver keyboard shortcut
  if (enterDeliverListener) {
    document.removeEventListener('keydown', enterDeliverListener);
    enterDeliverListener = null;
  }
}

// ======================================================
// 13. Order History View — Date-filtered delivered orders
// ======================================================

// In-memory cache of the last loaded history records (for client-side search & filtering)
let historyOrders = [];
let currentHistoryPreset = 'all';

function formatOrderTimestamp(isoString) {
  if (!isoString) return 'N/A';
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return 'N/A';
  const day = String(d.getDate()).padStart(2, '0');
  const month = String(d.getMonth() + 1).padStart(2, '0');
  const year = d.getFullYear();
  let hours = d.getHours();
  const minutes = String(d.getMinutes()).padStart(2, '0');
  const ampm = hours >= 12 ? 'PM' : 'AM';
  hours = hours % 12;
  hours = hours ? String(hours).padStart(2, '0') : '12';
  return `${day}/${month}/${year}, ${hours}:${minutes} ${ampm}`;
}

function setHistoryFilter(preset) {
  currentHistoryPreset = preset;

  // Update button highlight classes
  ['all', 'today', 'week', 'yesterday'].forEach(p => {
    const btn = document.getElementById(`history-btn-${p}`);
    if (btn) {
      if (p === preset) {
        btn.className = 'text-xs font-bold px-3 py-1.5 rounded-xl bg-primary text-slate-900 shadow transition-all';
      } else {
        btn.className = 'text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-900 text-slate-300 border border-slate-700 hover:bg-slate-800 transition-all';
      }
    }
  });

  // Clear custom inputs if selecting a preset
  if (preset !== 'custom') {
    const sInput = document.getElementById('history-date-start');
    const eInput = document.getElementById('history-date-end');
    if (sInput) sInput.value = '';
    if (eInput) eInput.value = '';
  }

  loadHistoryView();
}

// Backward-compatible wrappers
function setHistoryDateToday() { setHistoryFilter('today'); }
function setHistoryDateYesterday() { setHistoryFilter('yesterday'); }
function clearHistoryDateFilter() { setHistoryFilter('all'); }

function handleHistoryCustomDateChange() {
  const sInput = document.getElementById('history-date-start');
  const eInput = document.getElementById('history-date-end');
  if (sInput && sInput.value) {
    currentHistoryPreset = 'custom';
    ['all', 'today', 'week', 'yesterday'].forEach(p => {
      const btn = document.getElementById(`history-btn-${p}`);
      if (btn) {
        btn.className = 'text-xs font-bold px-3 py-1.5 rounded-xl bg-slate-900 text-slate-300 border border-slate-700 hover:bg-slate-800 transition-all';
      }
    });
    loadHistoryView();
  }
}

async function loadHistoryView() {
  const loadingEl = document.getElementById('history-loading-state');
  const emptyEl   = document.getElementById('history-empty-state');
  const wrapperEl = document.getElementById('history-table-wrapper');
  const rangeLabel = document.getElementById('history-active-range-label');
  const statusSelect = document.getElementById('history-status-filter');
  const statusVal = statusSelect ? statusSelect.value : 'ALL';

  if (loadingEl)  { loadingEl.classList.remove('hidden'); }
  if (emptyEl)    { emptyEl.classList.add('hidden'); }
  if (wrapperEl)  { wrapperEl.classList.add('hidden'); }

  let startIso = null;
  let endIso = null;
  let labelText = 'All Time';

  const now = new Date();

  // Calculate local timezone date boundaries converted to exact ISO UTC
  if (currentHistoryPreset === 'today') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    startIso = start.toISOString();
    endIso = end.toISOString();
    labelText = 'Today (' + start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ')';
  } else if (currentHistoryPreset === 'yesterday') {
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1, 23, 59, 59, 999);
    startIso = start.toISOString();
    endIso = end.toISOString();
    labelText = 'Yesterday (' + start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ')';
  } else if (currentHistoryPreset === 'week') {
    const day = now.getDay();
    const diffToMonday = (day === 0 ? -6 : 1) - day;
    const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() + diffToMonday, 0, 0, 0, 0);
    const end = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
    startIso = start.toISOString();
    endIso = end.toISOString();
    labelText = 'This Week (' + start.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ' - ' + end.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' }) + ')';
  } else if (currentHistoryPreset === 'custom') {
    const sVal = document.getElementById('history-date-start')?.value;
    const eVal = document.getElementById('history-date-end')?.value || sVal;
    if (sVal) {
      const [sy, sm, sd] = sVal.split('-').map(Number);
      const start = new Date(sy, sm - 1, sd, 0, 0, 0, 0);
      const [ey, em, ed] = eVal.split('-').map(Number);
      const end = new Date(ey, em - 1, ed, 23, 59, 59, 999);
      startIso = start.toISOString();
      endIso = end.toISOString();
      labelText = `${sVal} to ${eVal}`;
    }
  } else {
    // 'all': Remove all date boundary filters entirely to pull every single database record
    labelText = 'All Time (Full Database)';
  }

  if (rangeLabel) rangeLabel.innerText = labelText;

  try {
    const params = new URLSearchParams();
    if (startIso && endIso) {
      params.set('start_date', startIso);
      params.set('end_date', endIso);
    }
    if (statusVal && statusVal !== 'ALL') {
      params.set('status', statusVal);
    }

    const queryString = params.toString();
    const url = queryString
      ? `${API_BASE}/manager/orders/history?${queryString}`
      : `${API_BASE}/manager/orders/history`;

    const res = await fetch(url);
    if (!res.ok) throw new Error(`API error: ${res.status}`);
    const { orders: data, summary } = await res.json();

    historyOrders = (data || []).map(o => {
      let isPos = false;
      let orderType = 'ONLINE';
      let pMode = 'CASH';

      if (o.qr_code_data) {
        try {
          const qd = typeof o.qr_code_data === 'string' ? JSON.parse(o.qr_code_data) : o.qr_code_data;
          if (qd && qd.order_type === 'WALK_IN_POS') {
            isPos = true;
            orderType = 'POS';
          }
          if (qd?.payment_mode) {
            pMode = qd.payment_mode;
          } else if (o.payment_method === 'ONLINE') {
            pMode = 'UPI';
          }
        } catch (e) {}
      } else if (o.payment_method === 'ONLINE') {
        pMode = 'UPI';
      }

      if (!o.student_id) {
        isPos = true;
        orderType = 'POS';
      }

      return {
        id:             o.id,
        token_number:   o.token_number || '#TK-' + (o.id ? o.id.slice(0, 4) : 'N/A'),
        is_pos:         isPos,
        order_type:     orderType,
        order_status:   o.order_status || 'DELIVERED',
        payment_status: o.payment_status || 'PAID',
        payment_method: o.payment_method || 'CASH_AT_COUNTER',
        payment_mode:   pMode,
        student:        o.students || (isPos ? { name: 'Walk-in Customer', reg_no: 'Counter Sale' } : { name: 'Student', reg_no: 'N/A' }),
        items:          (o.order_items || []).map(oi => ({
          name:       oi.products ? oi.products.name : (oi.name || 'Canteen Item'),
          quantity:   parseInt(oi.quantity) || 1,
          unit_price: parseFloat(oi.unit_price || 0)
        })),
        total_amount:   parseFloat(o.total_amount || 0),
        created_at:     o.created_at
      };
    });

    // Update summary stats
    const fmt = v => `₹${(parseFloat(v) || 0).toFixed(2)}`;
    const el = id => document.getElementById(id);

    if (el('history-stat-total')) el('history-stat-total').innerText = fmt(summary.total_revenue);
    if (el('history-stat-count')) el('history-stat-count').innerText = summary.total_orders || historyOrders.length;
    if (el('history-stat-delivered-count')) el('history-stat-delivered-count').innerText = summary.delivered_count || 0;
    if (el('history-stat-cancelled-count')) el('history-stat-cancelled-count').innerText = summary.cancelled_count || 0;

    if (el('history-stat-online')) el('history-stat-online').innerText = fmt(summary.online_revenue);
    if (el('history-stat-online-count')) el('history-stat-online-count').innerText = summary.online_count || 0;

    if (el('history-stat-pos')) el('history-stat-pos').innerText = fmt(summary.pos_revenue);
    if (el('history-stat-pos-count')) el('history-stat-pos-count').innerText = summary.pos_count || 0;

    filterHistoryTable();
  } catch (err) {
    console.error('Load history error:', err);
    showToast('Failed to load order history', 'error');
    if (loadingEl) loadingEl.classList.add('hidden');
  }
}

function renderHistoryTable(records) {
  const loadingEl = document.getElementById('history-loading-state');
  const emptyEl   = document.getElementById('history-empty-state');
  const wrapperEl = document.getElementById('history-table-wrapper');
  const tbody     = document.getElementById('history-table-body');

  if (loadingEl) loadingEl.classList.add('hidden');

  if (!records || records.length === 0) {
    if (emptyEl)   emptyEl.classList.remove('hidden');
    if (wrapperEl) wrapperEl.classList.add('hidden');
    return;
  }

  if (emptyEl)   emptyEl.classList.add('hidden');
  if (wrapperEl) wrapperEl.classList.remove('hidden');

  tbody.innerHTML = records.map(o => {
    // Payment badge
    let paymentBadge = '';
    const isPaid = o.payment_status === 'PAID';
    const isUpi = o.payment_mode === 'UPI' || o.payment_method === 'ONLINE';

    if (isPaid) {
      if (isUpi) {
        paymentBadge = `<span class="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full whitespace-nowrap">📲 UPI &bull; PAID</span>`;
      } else {
        paymentBadge = `<span class="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-500/15 text-amber-400 border border-amber-500/30 px-2 py-0.5 rounded-full whitespace-nowrap">💵 Cash &bull; PAID</span>`;
      }
    } else {
      if (isUpi) {
        paymentBadge = `<span class="inline-flex items-center gap-1 text-[10px] font-bold bg-blue-500/15 text-blue-400 border border-blue-500/30 px-2 py-0.5 rounded-full whitespace-nowrap">📱 Expected: UPI QR</span>`;
      } else {
        paymentBadge = `<span class="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 px-2 py-0.5 rounded-full whitespace-nowrap">💵 Expected: CASH</span>`;
      }
    }

    // Order type badge
    const typeBadge = o.is_pos
      ? `<span class="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full whitespace-nowrap"><i data-lucide="zap" class="w-3 h-3"></i> Walk-in POS</span>`
      : `<span class="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full whitespace-nowrap"><i data-lucide="smartphone" class="w-3 h-3"></i> Online App</span>`;

    // Order status badge
    let statusBadge = '';
    if (o.order_status === 'DELIVERED') {
      statusBadge = `<span class="inline-flex items-center gap-1 text-[10px] font-bold bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 px-2 py-0.5 rounded-full whitespace-nowrap">✅ Delivered</span>`;
    } else if (o.order_status === 'CANCELLED') {
      statusBadge = `<span class="inline-flex items-center gap-1 text-[10px] font-bold bg-rose-500/10 text-rose-400 border border-rose-500/20 px-2 py-0.5 rounded-full whitespace-nowrap">❌ Cancelled</span>`;
    } else {
      statusBadge = `<span class="inline-flex items-center gap-1 text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full whitespace-nowrap">⏳ Pending</span>`;
    }

    // Itemized breakdown
    const itemsText = o.items && o.items.length > 0
      ? o.items.map(i => `<span class="inline-block bg-slate-900 border border-slate-800 rounded px-1.5 py-0.5 text-[10px] text-slate-300 mr-1 mb-0.5">${i.quantity}× ${i.name}</span>`).join('')
      : '<span class="text-slate-500 text-[10px]">No items logged</span>';

    // Standard readable timestamp format (DD/MM/YYYY, hh:mm A)
    const formattedTimestamp = formatOrderTimestamp(o.created_at);

    const customerName = o.student ? o.student.name : (o.is_pos ? 'Walk-in Customer' : 'Student');
    const customerSub = o.student && o.student.reg_no && o.student.reg_no !== 'N/A' && o.student.reg_no !== 'Counter Sale'
      ? `<p class="text-[10px] text-slate-500 font-mono">${o.student.reg_no}</p>`
      : (o.is_pos ? `<p class="text-[10px] text-amber-400/80 font-mono">Counter Sale</p>` : '');

    return `
      <tr class="hover:bg-slate-800/40 transition-colors">
        <td class="py-3 pr-4 font-black text-primary whitespace-nowrap">${o.token_number}</td>
        <td class="py-3 pr-4 whitespace-nowrap">${typeBadge}</td>
        <td class="py-3 pr-4">
          <p class="font-semibold text-slate-200 leading-tight">${customerName}</p>
          ${customerSub}
        </td>
        <td class="py-3 pr-4 max-w-[260px]">
          <div class="flex flex-wrap items-center">${itemsText}</div>
        </td>
        <td class="py-3 pr-4 text-center whitespace-nowrap">${paymentBadge}</td>
        <td class="py-3 pr-4 text-right font-black text-slate-100 whitespace-nowrap">₹${o.total_amount.toFixed(2)}</td>
        <td class="py-3 pr-4 text-center text-[10px] text-slate-400 whitespace-nowrap font-mono">${formattedTimestamp}</td>
        <td class="py-3 text-center whitespace-nowrap">${statusBadge}</td>
      </tr>
    `;
  }).join('');

  lucide.createIcons();
}

function filterHistoryTable() {
  const query = (document.getElementById('history-search')?.value || '').trim().toLowerCase();
  const typeFilter = document.getElementById('history-type-filter')?.value || 'ALL';

  let filtered = historyOrders;

  // Filter by order type (Online App vs Walk-in POS)
  if (typeFilter === 'ONLINE') {
    filtered = filtered.filter(o => o.order_type === 'ONLINE');
  } else if (typeFilter === 'POS') {
    filtered = filtered.filter(o => o.order_type === 'POS');
  }

  // Filter by search term
  if (query) {
    filtered = filtered.filter(o => {
      const matchToken = (o.token_number || '').toLowerCase().includes(query);
      const matchName = (o.student?.name || '').toLowerCase().includes(query);
      const matchReg = (o.student?.reg_no || '').toLowerCase().includes(query);
      const matchItems = (o.items || []).some(i => (i.name || '').toLowerCase().includes(query));
      return matchToken || matchName || matchReg || matchItems;
    });
  }

  renderHistoryTable(filtered);
}

// ======================================================
// 13b. Quick Sale (Spot POS) Cart & Billing Logic
// ======================================================

function renderPosCategories() {
  const container = document.getElementById('pos-category-chips');
  if (!container) return;

  const allActive = posSelectedCategory === 'all'
    ? 'bg-primary text-slate-900 font-bold shadow-md'
    : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800';

  let html = `
    <button type="button" onclick="setPosCategoryFilter('all')" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all ${allActive}">
      All Items
    </button>
  `;

  categories.forEach(c => {
    const isSelected = posSelectedCategory === c.id;
    const btnClass = isSelected
      ? 'bg-primary text-slate-900 font-bold shadow-md'
      : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800';
    html += `
      <button type="button" onclick="setPosCategoryFilter('${c.id}')" class="px-3 py-1.5 rounded-lg text-xs font-semibold transition-all flex items-center gap-1.5 ${btnClass}">
        <span>${c.icon_url || c.icon || '📦'}</span>
        <span>${c.name}</span>
      </button>
    `;
  });

  container.innerHTML = html;
}

function setPosCategoryFilter(catId) {
  posSelectedCategory = catId;
  renderPosCategories();
  renderPosMenu();
}

function handlePosSearch(val) {
  posSearchQuery = (val || '').trim().toLowerCase();
  const clearBtn = document.getElementById('pos-search-clear-btn');
  if (clearBtn) {
    if (posSearchQuery) clearBtn.classList.remove('hidden');
    else clearBtn.classList.add('hidden');
  }
  renderPosMenu();
}

function clearPosSearch() {
  const input = document.getElementById('posSearch');
  if (input) input.value = '';
  posSearchQuery = '';
  const clearBtn = document.getElementById('pos-search-clear-btn');
  if (clearBtn) clearBtn.classList.add('hidden');
  renderPosMenu();
  if (input) input.focus();
}

function renderPosMenu() {
  const grid = document.getElementById('pos-items-grid');
  const countBadge = document.getElementById('pos-items-count');
  if (!grid) return;

  let filtered = products;

  // Filter by category
  if (posSelectedCategory !== 'all') {
    filtered = filtered.filter(p => p.category_id === posSelectedCategory);
  }

  // Filter by search query
  if (posSearchQuery) {
    filtered = filtered.filter(p =>
      (p.name && p.name.toLowerCase().includes(posSearchQuery)) ||
      (p.barcode_id && p.barcode_id.toLowerCase().includes(posSearchQuery))
    );
  }

  if (countBadge) {
    countBadge.innerText = `${filtered.length} item${filtered.length === 1 ? '' : 's'}`;
  }

  if (filtered.length === 0) {
    grid.innerHTML = `
      <div class="col-span-full text-center py-12 space-y-3">
        <i data-lucide="search-x" class="w-10 h-10 text-slate-600 mx-auto"></i>
        <p class="text-xs font-semibold text-slate-400">No items match "${posSearchQuery || 'selected category'}"</p>
        <button type="button" onclick="clearPosSearch(); setPosCategoryFilter('all')" class="text-xs text-primary font-bold hover:underline">
          Reset search & filters
        </button>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const price = parseFloat(p.price || 0);
    const stock = parseInt(p.stock_quantity) || 0;
    const isOutOfStock = stock <= 0;
    const inCartQty = posCart[p.id] ? posCart[p.id].quantity : 0;

    // Stock status badge
    let stockBadge = '';
    if (isOutOfStock) {
      stockBadge = `<span class="bg-rose-500/15 text-rose-400 border border-rose-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full">Out of Stock</span>`;
    } else if (stock <= 5) {
      stockBadge = `<span class="bg-amber-500/15 text-amber-400 border border-amber-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full">Low: ${stock} left</span>`;
    } else {
      stockBadge = `<span class="bg-emerald-500/15 text-emerald-400 border border-emerald-500/30 text-[10px] font-bold px-2 py-0.5 rounded-full">${stock} in stock</span>`;
    }

    const cardBorder = inCartQty > 0
      ? 'border-primary shadow-lg bg-primary/[0.04]'
      : 'border-slate-800 hover:border-primary/50 bg-slate-900/60';

    const cursorStyle = isOutOfStock
      ? 'opacity-40 cursor-not-allowed'
      : 'cursor-pointer active:scale-[0.98]';

    return `
      <div 
        onclick="${isOutOfStock ? '' : `addToPosCart('${p.id}')`}" 
        class="card-dark p-3.5 flex flex-col justify-between gap-2.5 rounded-xl border-2 transition-all select-none ${cardBorder} ${cursorStyle}"
        title="${p.name} - ₹${price.toFixed(2)}"
      >
        <div class="space-y-1.5">
          <div class="flex items-start justify-between gap-1.5">
            <h4 class="font-bold text-xs text-slate-100 line-clamp-2 leading-tight">${p.name}</h4>
            ${inCartQty > 0 ? `
              <span class="bg-primary text-slate-950 font-black text-[10px] px-1.5 py-0.5 rounded-md flex-shrink-0 shadow">
                ${inCartQty} in cart
              </span>
            ` : ''}
          </div>
          <div>${stockBadge}</div>
        </div>

        <div class="flex items-center justify-between pt-2 border-t border-slate-800/80">
          <span class="font-black text-sm text-primary">₹${price.toFixed(2)}</span>
          <button 
            type="button" 
            onclick="${isOutOfStock ? '' : `event.stopPropagation(); addToPosCart('${p.id}')`}" 
            ${isOutOfStock ? 'disabled' : ''} 
            class="w-7 h-7 rounded-lg flex items-center justify-center font-bold text-xs transition-all ${
              isOutOfStock 
                ? 'bg-slate-800 text-slate-600 cursor-not-allowed' 
                : 'bg-primary hover:bg-primary-dark text-slate-900 shadow active:scale-90'
            }"
            title="Add 1 to cart"
          >
            <i data-lucide="plus" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

function addToPosCart(productId) {
  const prod = products.find(p => p.id === productId);
  if (!prod) return;

  const currentStock = parseInt(prod.stock_quantity) || 0;
  if (currentStock <= 0) {
    showToast(`"${prod.name}" is out of stock.`, 'error');
    return;
  }

  const existing = posCart[productId];
  const currentQty = existing ? existing.quantity : 0;

  if (currentQty >= currentStock) {
    showToast(`Max available stock reached for "${prod.name}" (${currentStock} available).`, 'error');
    return;
  }

  posCart[productId] = {
    product: prod,
    quantity: currentQty + 1
  };

  renderPosCart();
  renderPosMenu();
}

function updatePosCartQty(productId, delta) {
  const item = posCart[productId];
  if (!item) return;

  const currentStock = parseInt(item.product.stock_quantity) || 0;
  const newQty = item.quantity + delta;

  if (newQty <= 0) {
    delete posCart[productId];
  } else if (newQty > currentStock) {
    showToast(`Cannot exceed available stock (${currentStock} available).`, 'error');
    return;
  } else {
    item.quantity = newQty;
  }

  renderPosCart();
  renderPosMenu();
}

function clearPosCart() {
  if (Object.keys(posCart).length === 0) return;
  posCart = {};
  renderPosCart();
  renderPosMenu();
  showToast('POS Cart cleared', 'success');
}

function renderPosCart() {
  const listEl = document.getElementById('pos-cart-items-list');
  const qtyBadge = document.getElementById('pos-cart-items-qty');
  const subtotalEl = document.getElementById('pos-cart-subtotal');
  const grandTotalEl = document.getElementById('pos-cart-grand-total');
  const btnCash = document.getElementById('pos-btn-cash');
  const btnUpi = document.getElementById('pos-btn-upi');

  const cartKeys = Object.keys(posCart);
  let totalQty = 0;
  let grandTotal = 0;

  cartKeys.forEach(id => {
    const it = posCart[id];
    totalQty += it.quantity;
    grandTotal += (parseFloat(it.product.price) || 0) * it.quantity;
  });

  if (qtyBadge) qtyBadge.innerText = totalQty;
  if (subtotalEl) subtotalEl.innerText = `₹${grandTotal.toFixed(2)}`;
  if (grandTotalEl) grandTotalEl.innerText = `₹${grandTotal.toFixed(2)}`;

  if (btnCash) {
    btnCash.disabled = totalQty === 0;
    btnCash.innerHTML = `<i data-lucide="banknote" class="w-4 h-4"></i> 💵 Cash Collected (₹${grandTotal.toFixed(2)})`;
  }
  if (btnUpi) {
    btnUpi.disabled = totalQty === 0;
    btnUpi.innerHTML = `<i data-lucide="smartphone" class="w-4 h-4"></i> 📱 UPI Paid (₹${grandTotal.toFixed(2)})`;
  }

  if (!listEl) return;

  if (cartKeys.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-12 space-y-2 text-slate-500">
        <i data-lucide="shopping-bag" class="w-8 h-8 mx-auto opacity-30 text-slate-400"></i>
        <p class="text-xs font-semibold text-slate-400">Cart is empty</p>
        <p class="text-[10px] text-slate-500">Tap items from the menu catalog to add.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  listEl.innerHTML = cartKeys.map(id => {
    const it = posCart[id];
    const unitPrice = parseFloat(it.product.price || 0);
    const lineTotal = unitPrice * it.quantity;

    return `
      <div class="py-2.5 flex items-center justify-between gap-2.5 text-xs">
        <div class="flex-1 min-w-0">
          <p class="font-bold text-slate-200 truncate leading-tight">${it.product.name}</p>
          <p class="text-[10px] text-slate-400 mt-0.5">₹${unitPrice.toFixed(2)} each</p>
        </div>

        <div class="flex items-center gap-1.5 bg-slate-900 border border-slate-800 rounded-lg p-1 flex-shrink-0">
          <button 
            type="button" 
            onclick="updatePosCartQty('${id}', -1)" 
            class="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs transition-all active:scale-90"
            title="Decrease quantity"
          >
            -
          </button>
          <span class="font-black text-slate-100 min-w-[18px] text-center text-xs">${it.quantity}</span>
          <button 
            type="button" 
            onclick="updatePosCartQty('${id}', 1)" 
            class="w-5 h-5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 flex items-center justify-center font-bold text-xs transition-all active:scale-90"
            title="Increase quantity"
          >
            +
          </button>
        </div>

        <div class="text-right min-w-[65px] flex-shrink-0">
          <span class="font-black text-slate-100 text-xs">₹${lineTotal.toFixed(2)}</span>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

async function handlePosCheckout(paymentMode) {
  const cartKeys = Object.keys(posCart);
  if (cartKeys.length === 0) {
    showToast('Cannot checkout: POS Cart is empty.', 'error');
    return;
  }

  const items = cartKeys.map(id => {
    const it = posCart[id];
    return {
      product_id: it.product.id,
      name: it.product.name,
      quantity: it.quantity,
      unit_price: parseFloat(it.product.price || 0)
    };
  });

  const totalAmount = items.reduce((sum, it) => sum + (it.unit_price * it.quantity), 0);
  const mode = paymentMode === 'UPI' ? 'UPI' : 'CASH';
  const paymentMethod = mode === 'UPI' ? 'ONLINE' : 'CASH_AT_COUNTER';

  showLoading(true);

  try {
    let orderSuccess = false;
    let finalOrderData = null;

    // 1. Primary: Call backend Express endpoint /api/pos/sale
    try {
      const res = await fetch(`${API_BASE}/pos/sale`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          items: items,
          payment_mode: mode,
          total_amount: totalAmount
        })
      });

      const data = await res.json();
      if (res.ok) {
        orderSuccess = true;
        finalOrderData = data.order;
      } else {
        // If it was a stock validation error from server, abort and show error
        if (data.error && (data.error.includes('stock') || data.error.includes('Stock') || data.error.includes('Insufficient'))) {
          showLoading(false);
          showToast(data.error, 'error');
          await fetchProducts();
          renderPosMenu();
          return;
        }
        console.warn('Backend /api/pos/sale returned error, attempting direct Supabase fallback:', data.error);
      }
    } catch (apiErr) {
      console.warn('Backend API unreachable, using direct Supabase fallback:', apiErr);
    }

    // 2. Resilient Fallback: Direct Supabase atomic checkout if backend API was unavailable
    if (!orderSuccess) {
      // 2a. Validate current stock directly in Supabase
      const productIds = items.map(it => it.product_id);
      const { data: dbProds, error: pErr } = await supabase
        .from('products')
        .select('id, name, stock_quantity')
        .in('id', productIds);

      if (pErr) throw pErr;

      for (const item of items) {
        const prod = (dbProds || []).find(p => p.id === item.product_id);
        if (!prod || prod.stock_quantity < item.quantity) {
          showLoading(false);
          showToast(`Insufficient stock for "${prod ? prod.name : item.name}". Available: ${prod ? prod.stock_quantity : 0}.`, 'error');
          await fetchProducts();
          renderPosMenu();
          return;
        }
      }

      // 2b. Insert into orders table
      const { data: order, error: oErr } = await supabase
        .from('orders')
        .insert([{
          student_id: null,
          total_amount: totalAmount,
          payment_method: paymentMethod,
          payment_status: 'PAID',
          order_status: 'DELIVERED',
          qr_code_data: {
            order_type: 'WALK_IN_POS',
            status: 'COMPLETED',
            payment_status: 'PAID',
            payment_mode: mode,
            items: items,
            total_amount: totalAmount,
            timestamp: new Date().toISOString()
          }
        }])
        .select()
        .single();

      if (oErr) throw oErr;

      // 2c. Insert into order_items (Triggers Supabase Postgres trigger_update_stock)
      const orderItems = items.map(item => ({
        order_id: order.id,
        product_id: item.product_id,
        quantity: item.quantity,
        unit_price: item.unit_price
      }));

      const { error: itemsErr } = await supabase
        .from('order_items')
        .insert(orderItems);

      if (itemsErr) throw itemsErr;

      finalOrderData = order;
      orderSuccess = true;
    }

    // 3. Reset State & Refresh UI
    posCart = {};
    clearPosSearch();

    // Re-fetch fresh products (stock will reflect decrements immediately)
    await fetchProducts();
    await fetchOrders();

    // Update Daily Sales Metrics immediately
    await renderSalesSummary();

    // Update POS and Inventory interfaces in real time
    renderPosMenu();
    renderPosCart();
    renderInventoryTable();

    showLoading(false);
    showToast(`✅ Sale recorded: ₹${totalAmount.toFixed(2)} (${mode})`, 'success');

  } catch (err) {
    showLoading(false);
    console.error('POS Checkout error:', err);
    showToast(`Checkout failed: ${err.message || 'Unknown error'}`, 'error');
  }
}

// 14. Startup bindings
window.addEventListener("DOMContentLoaded", () => {
  loadCategories();
  const isAuth = sessionStorage.getItem("manager_auth");
  if (isAuth === "true") {
    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("dashboard-screen").classList.remove("hidden");
    initDashboard();
  } else {
    document.getElementById("login-screen").classList.remove("hidden");
    document.getElementById("dashboard-screen").classList.add("hidden");
  }
  lucide.createIcons();

  // ── Hardware / USB Keyboard Wedge Scanner Listener ──────────────────────
  // USB scanners act as keyboards: they stream characters rapidly and fire
  // Enter when done. We buffer here and flush on Enter, ignoring normal
  // text field input so the manager can still type freely.
  document.addEventListener('keydown', (e) => {
    // Ignore keystrokes inside input fields / textareas / modals with focus
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === 'Enter') {
      const buffered = scanBuffer.trim();
      scanBuffer = '';
      clearTimeout(scanBufferTimer);

      if (buffered.length > 3) {
        // Long enough to be a real scan (not just a stray Enter)
        handleScan(buffered);
      }

      // Update wedge indicator
      const indicator = document.getElementById('wedge-indicator');
      if (indicator) {
        indicator.classList.remove('bg-amber-500/20', 'text-amber-400', 'border-amber-500/30');
        indicator.classList.add('bg-primary/10', 'text-primary', 'border-primary/20');
      }
    } else if (e.key.length === 1) {
      // Printable character — accumulate into buffer
      scanBuffer += e.key;
      clearTimeout(scanBufferTimer);

      // Pulse the wedge indicator amber to show live input
      const indicator = document.getElementById('wedge-indicator');
      if (indicator) {
        indicator.classList.add('bg-amber-500/20', 'text-amber-400', 'border-amber-500/30');
        indicator.classList.remove('bg-primary/10', 'text-primary', 'border-primary/20');
      }

      // Safety auto-flush: if no new char arrives in 150ms, discard buffer
      scanBufferTimer = setTimeout(() => {
        scanBuffer = '';
        const indicator = document.getElementById('wedge-indicator');
        if (indicator) {
          indicator.classList.remove('bg-amber-500/20', 'text-amber-400', 'border-amber-500/30');
          indicator.classList.add('bg-primary/10', 'text-primary', 'border-primary/20');
        }
      }, 150);
    }
  });
});
