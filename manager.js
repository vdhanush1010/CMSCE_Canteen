// Campus Canteen Manager Dashboard Logic (Full Supabase Integration)

// 1. Supabase Client Configuration Credentials
const SUPABASE_URL = 'https://llbegpqowjvsadbundrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsYmVncHFvd2p2c2FkYnVuZHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3Njg4NzAsImV4cCI6MjEwMjM0NDg3MH0.SGoLEoE5PP_Ex0C7tOXrwvcol2vxxOvOFPoSGfD93VA';
var supabase = (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) 
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) 
  : null;

// 2. Global State Variables
let categories = [];
let products = [];
let orders = [];
let activeOrdersChannel = null;
let html5QrCode = null;
let currentScannerTarget = 'order'; // 'order' or 'product' or 'product_prefill'
let currentScannerMode = 'camera'; // 'camera' or 'upload'
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

// History view state
let currentHistoryPreset = 'all';

// Toast Helper
function showToast(message, type = "success") {
  const container = document.getElementById("toast-container");
  if (!container) return;
  const toast = document.createElement("div");
  toast.className = `toast toast-${type}`;
  
  const icon = type === "success" ? "check-circle" : (type === "warning" ? "alert-triangle" : "alert-circle");
  toast.innerHTML = `<i data-lucide="${icon}" class="w-4 h-4"></i> <span>${message}</span>`;
  
  container.appendChild(toast);
  if (window.lucide) lucide.createIcons();
  
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
async function handleManagerLogin(event) {
  event.preventDefault();
  const phone = document.getElementById("login-phone").value.trim();
  const otp = document.getElementById("login-otp").value.trim();

  showLoading(true);
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'manager-login', phone, otp })
    });
    const result = await res.json();
    showLoading(false);

    if (!res.ok || !result.success) {
      showToast(result.error || "Authentication failed", "error");
      return;
    }

    sessionStorage.setItem("manager_auth", "true");
    showToast("Login successful!", "success");

    document.getElementById("login-screen").classList.add("hidden");
    document.getElementById("dashboard-screen").classList.remove("hidden");

    initDashboard();
  } catch (err) {
    showLoading(false);
    console.error("Login request error:", err);
    showToast("Network error during login", "error");
  }
}

function handleLogout() {
  sessionStorage.removeItem("manager_auth");
  if (activeOrdersChannel && supabase) {
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
  try {
    await fetchCategories();
    await fetchProducts();
    await fetchOrders();
    await fetchCanteenStatus();
  } catch (e) {
    console.warn("Init fetch warning:", e);
  } finally {
    showLoading(false);
  }

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
  if (window.lucide) lucide.createIcons();
}

// 5. Canteen Status
async function fetchCanteenStatus() {
  try {
    const res = await fetch('/api/canteen-status');
    const result = await res.json();
    if (result.success && result.data) {
      isCanteenOpen = Boolean(result.data.is_open);
    } else {
      const storedStatus = localStorage.getItem("canteen_is_open");
      isCanteenOpen = storedStatus === null ? true : storedStatus === "true";
    }
    updateCanteenStatusUI(isCanteenOpen);
  } catch (e) {
    isCanteenOpen = true;
    updateCanteenStatusUI(true);
  }
}

function updateCanteenStatusUI(isOpen = isCanteenOpen) {
  if (typeof isOpen === 'boolean') {
    isCanteenOpen = isOpen;
  } else if (isOpen && typeof isOpen === 'object' && isOpen.is_open !== undefined) {
    isCanteenOpen = Boolean(isOpen.is_open);
  }
  
  const btn = document.getElementById("canteen-status-toggle-btn");
  if (!btn) return;

  if (isCanteenOpen) {
    btn.innerText = "🟢 OPEN";
    btn.className = "px-2.5 py-0.5 rounded-lg text-xs font-bold transition-all bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 hover:bg-emerald-500/20";
  } else {
    btn.innerText = "🔴 CLOSED";
    btn.className = "px-2.5 py-0.5 rounded-lg text-xs font-bold transition-all bg-rose-500/10 text-rose-400 border border-rose-500/20 hover:bg-rose-500/20";
  }
}

async function toggleCanteenStatus() {
  const newStatus = !isCanteenOpen;
  try {
    const res = await fetch('/api/canteen-status', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ is_open: newStatus })
    });
    const result = await res.json();
    if (result.success) {
      isCanteenOpen = result.data.is_open;
    } else {
      isCanteenOpen = newStatus;
    }
  } catch (e) {
    isCanteenOpen = newStatus;
  }
  localStorage.setItem("canteen_is_open", isCanteenOpen ? "true" : "false");
  updateCanteenStatusUI(isCanteenOpen);
  showToast(`Canteen is now ${isCanteenOpen ? 'OPEN 🟢' : 'CLOSED 🔴'}`, 'success');
}

// 6. DB Queries via /api/menu & /api/orders
async function fetchCategories() {
  try {
    const res = await fetch('/api/menu?type=categories');
    const result = await res.json();
    if (result.success) {
      categories = result.data || [];
    } else {
      throw new Error(result.error);
    }
  } catch (err) {
    console.error("Categories fetch error:", err);
    categories = [];
  }
}

async function loadCategories() {
  await fetchCategories();
  populateCategorySelect();
  renderCategoriesList();
  renderCategoryFilters();
  renderPosCategories();
}

async function fetchProducts() {
  try {
    const res = await fetch('/api/menu?type=products');
    const result = await res.json();
    if (result.success) {
      products = result.data || [];
    } else {
      throw new Error(result.error);
    }
  } catch (err) {
    console.error("Products fetch error:", err);
    products = [];
  }
}

async function fetchOrders() {
  try {
    const res = await fetch('/api/orders?type=all');
    const result = await res.json();
    if (result.success) {
      orders = result.data || [];
    } else {
      throw new Error(result.error);
    }
  } catch (err) {
    console.error("Orders fetch error:", err);
    orders = [];
  }
}

// 7. MODULE 1: Dashboard Analytics & Dynamic Calculations
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

async function renderSalesSummary() {
  await applySalesDateFilter();
}

async function applySalesDateFilter() {
  const dateInput = document.getElementById('sales-date-filter');
  const date = dateInput ? dateInput.value : '';

  const labelEl = document.getElementById('sales-date-label');
  if (labelEl) {
    if (!date) labelEl.innerText = 'Lifetime';
    else if (date === todayDateString()) labelEl.innerText = 'Today';
    else if (date === yesterdayDateString()) labelEl.innerText = 'Yesterday';
    else labelEl.innerText = new Date(date + 'T00:00:00').toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
  }

  const filtered = orders.filter(o => {
    if (!o.created_at) return false;
    const orderDate = o.created_at.split('T')[0];
    return !date || orderDate === date;
  });

  const delivered = filtered.filter(o => o.order_status === 'DELIVERED');
  const cashOrders = delivered.filter(o => o.payment_method === 'CASH_AT_COUNTER' || (o.qr_code_data && o.qr_code_data.payment_mode === 'CASH'));
  const upiOrders = delivered.filter(o => o.payment_method === 'ONLINE' || (o.qr_code_data && o.qr_code_data.payment_mode === 'UPI'));

  const totalRev = delivered.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
  const cashRev = cashOrders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
  const upiRev = upiOrders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);

  const totalEl  = document.getElementById('sales-total');
  const cashEl   = document.getElementById('sales-cash');
  const onlineEl = document.getElementById('sales-online');
  const countEl  = document.getElementById('sales-count');

  if (totalEl)  totalEl.innerText  = `₹${totalRev.toFixed(2)}`;
  if (cashEl)   cashEl.innerText   = `₹${cashRev.toFixed(2)}`;
  if (onlineEl) onlineEl.innerText = `₹${upiRev.toFixed(2)}`;
  if (countEl)  countEl.innerText  = delivered.length;

  if (!date || date === todayDateString()) {
    updateTopLiveMetricCards({
      total_revenue: totalRev,
      cash_revenue: cashRev,
      upi_revenue: upiRev,
      delivered_count: delivered.length
    });
  }
}

function updateTopLiveMetricCards(summaryData = null) {
  let summary = summaryData;
  if (!summary) {
    const today = todayDateString();
    const todayOrders = orders.filter(o => o.created_at && o.created_at.split('T')[0] === today && o.order_status === 'DELIVERED');
    const cashOrders = todayOrders.filter(o => o.payment_method === 'CASH_AT_COUNTER' || (o.qr_code_data && o.qr_code_data.payment_mode === 'CASH'));
    const upiOrders = todayOrders.filter(o => o.payment_method === 'ONLINE' || (o.qr_code_data && o.qr_code_data.payment_mode === 'UPI'));

    summary = {
      total_revenue: todayOrders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0),
      cash_revenue: cashOrders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0),
      upi_revenue: upiOrders.reduce((s, o) => s + (parseFloat(o.total_amount) || 0), 0),
      delivered_count: todayOrders.length
    };
  }

  const totalEl  = document.getElementById('top-metric-total');
  const cashEl   = document.getElementById('top-metric-cash');
  const upiEl    = document.getElementById('top-metric-upi');
  const ordersEl = document.getElementById('top-metric-orders');

  if (totalEl)  totalEl.innerText  = `₹${(summary.total_revenue || 0).toFixed(2)}`;
  if (cashEl)   cashEl.innerText   = `₹${(summary.cash_revenue || 0).toFixed(2)}`;
  if (upiEl)    upiEl.innerText    = `₹${((summary.upi_revenue !== undefined ? summary.upi_revenue : summary.online_revenue) || 0).toFixed(2)}`;
  if (ordersEl) ordersEl.innerText = `${summary.delivered_count || 0}`;
}

async function saveHandCash() {
  const value = parseFloat(document.getElementById("hand-cash-input").value) || 0;
  if (value <= 0) return;
  localStorage.setItem("hand_cash_amount", value.toFixed(2));
  showToast(`Hand Cash entry saved: ₹${value.toFixed(2)}`, "success");
}

// 8. MODULE 3: Inventory Management (Products CRUD)
async function updateProductStock(prodId, newStock) {
  if (newStock < 0 || isNaN(newStock)) {
    showToast("Invalid stock quantity", "error");
    return;
  }
  showLoading(true);
  try {
    const res = await fetch('/api/menu', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: prodId, stock_quantity: newStock })
    });
    const result = await res.json();
    showLoading(false);

    if (!res.ok || !result.success) throw new Error(result.error);

    showToast("Stock updated successfully", "success");
    await fetchProducts();
    renderInventoryTable();
    renderPosMenu();
  } catch (err) {
    showLoading(false);
    console.error("Stock update error:", err);
    showToast("Error updating stock", "error");
  }
}

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

  const badgeEl = document.getElementById("total-items-badge");
  if (badgeEl) badgeEl.innerText = products.length;

  const searchInput = document.getElementById("inventory-search");
  const searchQuery = searchInput ? searchInput.value.toLowerCase().trim() : '';

  let filtered = products;

  if (selectedCategoryFilter !== 'all') {
    filtered = filtered.filter(p => p.category_id === selectedCategoryFilter);
  }

  if (searchQuery) {
    filtered = filtered.filter(p => p.name.toLowerCase().includes(searchQuery) || (p.barcode_id && p.barcode_id.toLowerCase().includes(searchQuery)));
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
    const catEmoji = cat ? (cat.icon_url || cat.icon || '📦') : "📦";

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
  if (window.lucide) lucide.createIcons();
}

function openAddItemModal() {
  document.getElementById("add-item-modal").classList.remove("hidden");
  populateCategorySelect();
  if (selectedCategoryFilter && selectedCategoryFilter !== 'all') {
    const catSelect = document.getElementById("new-prod-category");
    if (catSelect) catSelect.value = selectedCategoryFilter;
  }
  if (window.lucide) lucide.createIcons();
}

function closeAddItemModal() {
  document.getElementById("add-item-modal").classList.add("hidden");
  document.getElementById("add-item-form").reset();
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
  if (window.lucide) lucide.createIcons();
}

function closeEditItemModal() {
  document.getElementById("edit-item-modal").classList.add("hidden");
  document.getElementById("edit-item-form").reset();
}

function populateCategorySelect() {
  ['new-prod-category', 'edit-prod-category'].forEach(id => {
    const select = document.getElementById(id);
    if (select) {
      select.innerHTML = categories.map(c => `<option value="${c.id}">${c.icon_url || c.icon || '📦'} ${c.name}</option>`).join('');
    }
  });
}

async function handleProductAdd(event) {
  event.preventDefault();
  const name = document.getElementById("new-prod-name").value.trim();
  const category_id = document.getElementById("new-prod-category").value;
  const price = parseFloat(document.getElementById("new-prod-price").value);
  const stock_quantity = parseInt(document.getElementById("new-prod-stock").value);
  const barcode_id = document.getElementById("new-prod-barcode").value.trim() || ("BC-MAN-" + Math.floor(1000 + Math.random() * 9000));
  let image_url = document.getElementById("new-prod-image-url").value.trim() || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c';

  const fileInput = document.getElementById("new-prod-file");
  if (fileInput && fileInput.files && fileInput.files[0]) {
    const reader = new FileReader();
    reader.onload = async function(e) {
      await insertProduct(name, category_id, price, stock_quantity, e.target.result, barcode_id);
    };
    reader.readAsDataURL(fileInput.files[0]);
    return;
  }

  await insertProduct(name, category_id, price, stock_quantity, image_url, barcode_id);
}

async function insertProduct(name, category_id, price, stock_quantity, image_url, barcode_id) {
  showLoading(true);
  try {
    const res = await fetch('/api/menu', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name,
        category_id,
        price,
        stock_quantity,
        image_url,
        barcode_id
      })
    });
    const result = await res.json();
    showLoading(false);

    if (!res.ok || !result.success) throw new Error(result.error);

    showToast("Item added successfully!", "success");
    closeAddItemModal();
    await fetchProducts();
    renderInventoryTable();
    renderPosMenu();
  } catch (err) {
    showLoading(false);
    console.error("Product add error:", err);
    showToast("Failed to add product: " + err.message, "error");
  }
}

async function handleProductEdit(event) {
  event.preventDefault();
  const id = document.getElementById("edit-prod-id").value;
  const name = document.getElementById("edit-prod-name").value.trim();
  const category_id = document.getElementById("edit-prod-category").value;
  const price = parseFloat(document.getElementById("edit-prod-price").value);
  const stock_quantity = parseInt(document.getElementById("edit-prod-stock").value);
  const barcode_id = document.getElementById("edit-prod-barcode").value.trim() || null;
  const image_url = document.getElementById("edit-prod-image-url").value.trim() || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c';

  showLoading(true);
  try {
    const res = await fetch('/api/menu', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id,
        name,
        category_id,
        price,
        stock_quantity,
        barcode_id,
        image_url
      })
    });
    const result = await res.json();
    showLoading(false);

    if (!res.ok || !result.success) throw new Error(result.error);

    showToast("Item updated successfully!", "success");
    closeEditItemModal();
    await fetchProducts();
    renderInventoryTable();
    renderPosMenu();
  } catch (err) {
    showLoading(false);
    console.error("Product edit error:", err);
    showToast("Failed to update product: " + err.message, "error");
  }
}

async function deleteProduct(id) {
  if (!confirm("Are you sure you want to delete this product?")) return;
  showLoading(true);
  try {
    const res = await fetch(`/api/menu?id=${id}&type=product`, {
      method: 'DELETE'
    });
    const result = await res.json();
    showLoading(false);

    if (!res.ok || !result.success) throw new Error(result.error);

    showToast("Product deleted successfully", "success");
    await fetchProducts();
    renderInventoryTable();
    renderPosMenu();
  } catch (err) {
    showLoading(false);
    console.error("Delete product error:", err);
    showToast("Failed to delete product: " + err.message, "error");
  }
}

// 9. MODULE 4: Category Management
async function handleCategorySubmit(event) {
  event.preventDefault();
  const name = document.getElementById("category-name-input").value.trim();
  const icon = document.getElementById("category-icon-input").value.trim();
  const editId = document.getElementById("edit-category-id")?.value;

  showLoading(true);
  try {
    let res;
    if (editId) {
      res = await fetch('/api/menu', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'category', id: editId, name, icon_url: icon })
      });
    } else {
      res = await fetch('/api/menu', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'category', name, icon_url: icon })
      });
    }

    const result = await res.json();
    showLoading(false);

    if (!res.ok || !result.success) throw new Error(result.error);

    showToast(editId ? "Category updated!" : "Category created!", "success");
    cancelCategoryEdit();
    await fetchCategories();
    populateCategorySelect();
    renderCategoriesList();
    renderCategoryFilters();
    renderPosCategories();
  } catch (err) {
    showLoading(false);
    console.error("Category save error:", err);
    showToast("Failed to save category: " + err.message, "error");
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
    const res = await fetch(`/api/menu?id=${id}&type=category`, {
      method: 'DELETE'
    });
    const result = await res.json();
    showLoading(false);

    if (!res.ok || !result.success) throw new Error(result.error);

    showToast("Category deleted successfully", "success");
    await fetchCategories();
    populateCategorySelect();
    renderCategoriesList();
    renderCategoryFilters();
    renderPosCategories();
  } catch (err) {
    showLoading(false);
    console.error("Delete category error:", err);
    showToast("Failed to delete category: " + err.message, "error");
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
  if (window.lucide) lucide.createIcons();
}

// 10. Notices Broadcast
async function handlePostNotice(event) {
  event.preventDefault();
  const title = document.getElementById("notice-title-input").value.trim();
  const message = document.getElementById("notice-message-input").value.trim();

  showLoading(true);
  try {
    const res = await fetch('/api/notices', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title, message })
    });
    const result = await res.json();
    showLoading(false);

    if (!res.ok || !result.success) throw new Error(result.error);

    showToast("📢 Notice broadcasted to students!", "success");
    document.getElementById("post-notice-form").reset();
    showManagerView('dashboard');
  } catch (err) {
    showLoading(false);
    console.error("Notice broadcast error:", err);
    showToast("Failed to broadcast notice: " + err.message, "error");
  }
}

// 11. Navigation Drawer & Views
function updateLiveClock() {
  const clockEl = document.getElementById("live-clock");
  if (!clockEl) return;
  const now = new Date();
  clockEl.innerText = now.toLocaleTimeString('en-US', { hour12: true });
}

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

  Object.values(views).forEach(id => {
    const el = document.getElementById(id);
    if (el) el.classList.add('hidden');
  });

  const activeEl = document.getElementById(views[viewId]);
  if (activeEl) activeEl.classList.remove('hidden');

  ['dashboard', 'pos', 'sales', 'inventory', 'categories', 'history', 'settings', 'notice'].forEach(name => {
    const btn = document.getElementById(`nav-btn-${name}`);
    if (btn) btn.className = 'w-full px-4 py-3 rounded-xl text-xs font-bold text-slate-300 hover:bg-slate-800 transition-all flex items-center gap-3 text-left';
  });

  const activeBtn = document.getElementById(`nav-btn-${viewId}`);
  if (activeBtn) activeBtn.className = 'w-full px-4 py-3 rounded-xl text-xs font-bold bg-primary text-slate-900 transition-all flex items-center gap-3 shadow-lg text-left';

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
    renderOrderQueue();
    setTimeout(() => {
      const scanner = document.getElementById('quickTokenScanner');
      if (scanner) scanner.focus();
    }, 100);
  }

  if (window.lucide) lucide.createIcons();
}

function setThemeMode(mode) {
  localStorage.setItem("manager-theme", mode);
  
  document.body.classList.remove("theme-dark", "theme-light", "theme-reading");
  
  if (mode === "light") {
    document.body.classList.add("theme-light");
  } else if (mode === "reading") {
    document.body.classList.add("theme-reading");
  } else {
    document.body.classList.add("theme-dark");
  }

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

// 12. Audio Alerts & Beeps
let audioCtx = null;
function getAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
  return audioCtx;
}

function playBeep(type = 'success') {
  try {
    const ctx = getAudioContext();
    if (!ctx) return;

    const now = ctx.currentTime;

    if (type === 'success') {
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
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();

      gain.connect(ctx.destination);
      gain.gain.setValueAtTime(0.2, now);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.3);

      osc.type = 'square';
      osc.frequency.setValueAtTime(220, now); // A3
      osc.frequency.setValueAtTime(164.81, now + 0.1); // E3
      osc.connect(gain);
      osc.start(now);
      osc.stop(now + 0.3);
    }
  } catch (e) {
    console.warn("Audio alert failed:", e);
  }
}

// 13. Order Verification & Token Scanner
function initQuickTokenScanner() {
  const scannerInput = document.getElementById('quickTokenScanner');
  if (!scannerInput) return;

  scannerInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const val = scannerInput.value.trim();
      if (val) executeQuickVerify(val);
    }
  });

  setTimeout(() => scannerInput.focus(), 250);
}

function handleQuickTokenScanTrigger() {
  const scannerInput = document.getElementById('quickTokenScanner');
  if (!scannerInput) return;
  const val = scannerInput.value.trim();
  if (val) {
    executeQuickVerify(val);
  } else {
    showToast("Please enter a token number or scan QR code", "info");
    scannerInput.focus();
  }
}

function handleManualTokenSubmit() {
  const input = document.getElementById("scanner-manual-input");
  if (input && input.value.trim()) {
    const val = input.value.trim();
    closeScannerModal();
    executeQuickVerify(val);
  }
}

async function executeQuickVerify(rawToken) {
  const token = (rawToken || '').trim();
  if (!token) return;

  const scannerInput = document.getElementById('quickTokenScanner');
  showLoading(true);

  try {
    const res = await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, action: 'verify_and_deliver' })
    });
    const result = await res.json();
    showLoading(false);

    if (!res.ok || !result.success) {
      playBeep('error');
      showToast(result.error || `Token ${token} not found`, 'error');
      return;
    }

    const updated = result.data;
    playBeep('success');
    const tokenNum = updated.token_number || token;
    const totalAmount = parseFloat(updated.total_amount || 0).toFixed(2);
    showToast(`✅ Token ${tokenNum} Settled & Delivered! (₹${totalAmount})`, "success");

    const idx = orders.findIndex(o => o.id === updated.id);
    if (idx !== -1) orders[idx] = updated;
    else orders.unshift(updated);

    renderOrderQueue();
    await renderSalesSummary();
    if (currentView === 'history') loadHistoryView();

    if (currentOrderInModal && currentOrderInModal.id === updated.id) {
      closeOrderDetailModal();
    }

    if (scannerInput) {
      scannerInput.value = '';
      scannerInput.focus();
    }
  } catch (err) {
    showLoading(false);
    console.error("Quick verify error:", err);
    showToast("Failed to verify token: " + err.message, "error");
  }
}

async function confirmOrderPayment(orderId) {
  if (!orderId) return;
  showLoading(true);
  try {
    const res = await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: orderId, action: 'mark_paid' })
    });
    const result = await res.json();
    showLoading(false);

    if (!res.ok || !result.success) throw new Error(result.error);

    const updated = result.data;
    playBeep('success');
    showToast(`✅ Order ${updated.token_number || ''} marked as PAID!`, "success");
    
    const idx = orders.findIndex(o => o.id === orderId);
    if (idx !== -1) orders[idx] = updated;
    else await fetchOrders();

    renderOrderQueue();
    await renderSalesSummary();
    if (currentView === 'history') loadHistoryView();
  } catch (err) {
    showLoading(false);
    console.error("Confirm payment error:", err);
    showToast("Failed to confirm payment", "error");
  }
}

async function deliverOrderDirectly(orderId) {
  if (!orderId || orderId === "undefined") {
    showToast("Invalid order ID provided", "error");
    return;
  }
  showLoading(true);
  try {
    const res = await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: orderId, action: 'verify_and_deliver' })
    });
    const result = await res.json();
    showLoading(false);

    if (!res.ok || !result.success) throw new Error(result.error);

    const updated = result.data;
    playBeep('success');
    showToast(`✅ Order ${updated.token_number || ''} delivered successfully!`, "success");

    const idx = orders.findIndex(o => o.id === orderId);
    if (idx !== -1) orders[idx] = updated;
    else await fetchOrders();

    renderOrderQueue();
    await renderSalesSummary();
    if (currentView === 'history') loadHistoryView();
    closeOrderDetailModal();
  } catch (err) {
    showLoading(false);
    console.error("Deliver order error:", err);
    showToast("Error delivering order: " + err.message, "error");
  }
}

// 14. Order Details Modal Breakdown
function openOrderDetailModal(order) {
  if (!order) return;
  const modal = document.getElementById("order-detail-modal");
  const body = document.getElementById("order-detail-modal-body");
  if (!modal || !body) return;

  const tokenNumber = order.token_number || order.token || 'N/A';
  const orderId = order.id && order.id !== "undefined" ? order.id : null;
  const studentName = order.students ? order.students.name : (order.student_name || (order.student ? order.student.name : 'Student'));
  const regNo = order.students ? order.students.reg_no : (order.student_reg || (order.student ? order.student.reg_no : 'N/A'));
  const dept = order.students ? order.students.department : (order.student_dept || (order.student ? order.student.department : 'N/A'));
  const totalAmountFormatted = parseFloat(order.total_amount || 0).toFixed(2);

  const isPaid = order.payment_status === 'PAID';
  const orderCreatedAt = order.created_at ? new Date(order.created_at).getTime() : Date.now();
  const isPast30Min = (Date.now() - orderCreatedAt) > (30 * 60 * 1000);
  const isExpired = order.order_status === 'CANCELLED' || (!isPaid && isPast30Min);
  const isDelivered = order.order_status === 'DELIVERED';

  const orderItemsList = order.order_items || order.items || [];
  const itemsHTML = orderItemsList.map(i => {
    const itemName = i.products ? i.products.name : (i.name || 'Unknown Product');
    const uPrice = parseFloat(i.unit_price || (i.products ? i.products.price : 0) || 0);
    const sub = uPrice * (i.quantity || 1);
    return `
      <div class="flex justify-between items-center text-xs py-1.5 border-b border-slate-800/60 last:border-0">
        <div class="flex items-center gap-2">
          <span class="font-bold text-primary">${i.quantity || 1}x</span>
          <span class="text-slate-200 font-medium">${itemName}</span>
        </div>
        <span class="font-bold text-slate-300">₹${sub.toFixed(2)}</span>
      </div>
    `;
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
          <span class="text-2xl font-black text-primary tracking-wider">${tokenNumber}</span>
          <p class="text-[10px] text-slate-400 mt-0.5 font-mono">Order ID: ${orderId ? orderId.slice(0, 8) : 'N/A'}...</p>
        </div>
        <div class="text-right flex flex-col items-end gap-1.5">
          <div class="flex items-center gap-1.5 flex-wrap justify-end">
            ${guestModalBadge}
            ${paymentBadge}
          </div>
          <span class="font-extrabold text-base text-slate-100">₹${totalAmountFormatted}</span>
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

      <div class="bg-slate-900 border border-slate-800 p-3.5 rounded-xl space-y-1">
        <p class="text-[9px] uppercase font-bold text-slate-400 tracking-wider">Customer Information</p>
        <p class="text-xs font-semibold text-slate-200">
          ${isGuest 
            ? `👤 ${guestName || 'Guest User'} &bull; <span class="text-purple-400 font-bold">Instant Guest Mode (Table QR Scan)</span>` 
            : `${studentName} (Reg No: ${regNo}${dept && dept !== 'N/A' ? `, Dept: ${dept}` : ''})`}
        </p>
      </div>

      <div class="bg-slate-900 border border-slate-800 p-3.5 rounded-xl space-y-1">
        <p class="text-[9px] uppercase font-bold text-slate-400 tracking-wider mb-2">Ordered Items List</p>
        ${itemsHTML || '<p class="text-slate-500 text-xs">No items in this order.</p>'}
      </div>

      <div class="pt-2 flex gap-3">
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
          <button id="btn-modal-verify-deliver" onclick="executeQuickVerify('${tokenNumber || orderId}');" class="flex-1 bg-primary hover:bg-primary-dark text-slate-950 font-black py-2.5 rounded-xl text-xs flex items-center justify-center gap-1.5 transition-all shadow-lg active:scale-95">
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
    if (enterDeliverListener) {
      document.removeEventListener('keydown', enterDeliverListener);
    }
    enterDeliverListener = (e) => {
      if (e.key === 'Enter' && currentOrderInModal && !currentOrderInModal.isDelivered) {
        const m = document.getElementById('order-detail-modal');
        if (m && !m.classList.contains('hidden')) {
          e.preventDefault();
          executeQuickVerify(currentOrderInModal.token || currentOrderInModal.id);
        }
      }
    };
    document.addEventListener('keydown', enterDeliverListener);
  }

  modal.classList.remove("hidden");
  if (window.lucide) lucide.createIcons();
}

function openOrderDetailModalByID(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (order) openOrderDetailModal(order);
}

function closeOrderDetailModal() {
  const modal = document.getElementById("order-detail-modal");
  if (modal) modal.classList.add("hidden");
  currentOrderInModal = null;
  if (enterDeliverListener) {
    document.removeEventListener('keydown', enterDeliverListener);
    enterDeliverListener = null;
  }
}

// 15. Active Order Queue Rendering (Original Card Layout)
function renderOrderQueue() {
  const queue = document.getElementById("live-orders-list");
  const queueCountEl = document.getElementById("tab-queue-count");
  if (!queue) return;

  const now = Date.now();
  const pending = orders.filter(o => {
    if (o.order_status === 'DELIVERED' || o.order_status === 'CANCELLED') return false;
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

  if (queueCountEl) queueCountEl.innerText = pending.length;

  if (pending.length === 0) {
    queue.innerHTML = `
      <div class="text-center py-10 text-slate-500 text-xs flex flex-col items-center gap-2">
        <i data-lucide="check-circle-2" class="w-10 h-10 text-emerald-500/50"></i>
        <p class="font-semibold text-slate-300">All orders cleared!</p>
        <p class="text-[11px] text-slate-500">New customer orders will appear here in real time.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  queue.innerHTML = pending.map(o => {
    const timeStr = o.created_at 
      ? new Date(o.created_at).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) 
      : 'Just now';
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
      if (o.students && (o.students.reg_no === 'GUEST' || (o.students.name && o.students.name.startsWith('Guest')))) {
        isGuest = true;
        guestName = o.students.name;
      }
    }

    // High-visibility guest badge
    const guestBadge = isGuest ? `
      <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-black bg-purple-500/20 text-purple-300 border border-purple-500/40 shadow-sm whitespace-nowrap">
        <i data-lucide="user-x" class="w-3 h-3 text-purple-400"></i> GUEST ORDER
      </span>
    ` : '';

    // Status / Payment Mode Badge:
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

    // Action buttons: [ ✓ Mark Paid ] (if unpaid) and [ ⚡ Verify & Deliver ]
    const actionBtns = `
      <div class="flex items-center gap-2 flex-wrap sm:flex-nowrap">
        ${!isPaid ? `
          <button onclick="event.stopPropagation(); confirmOrderPayment('${o.id}')"
            class="px-3 py-2 bg-emerald-500/15 hover:bg-emerald-500/25 border border-emerald-500/30 text-emerald-400 font-bold rounded-xl text-xs transition-all flex items-center justify-center gap-1 active:scale-95 whitespace-nowrap shadow-sm">
            <i data-lucide="check" class="w-3.5 h-3.5"></i> ✓ Mark Paid
          </button>
        ` : ''}
        <button onclick="event.stopPropagation(); executeQuickVerify('${o.token_number || o.id}')"
          class="px-4 py-2 bg-primary hover:bg-primary-dark text-slate-950 font-black rounded-xl text-xs transition-all flex items-center justify-center gap-1.5 shadow-md active:scale-95 whitespace-nowrap">
          <i data-lucide="zap" class="w-4 h-4"></i> ⚡ Verify & Deliver
        </button>
      </div>
    `;

    const customerDisplay = isGuest 
      ? `<span class="text-purple-300 font-bold">👤 ${guestName || 'Guest User'}</span> <span class="text-purple-400/80 text-[10px] font-semibold">(Table QR Guest)</span>`
      : (o.students ? `${o.students.name} ${o.students.reg_no ? `(${o.students.reg_no})` : ''}` : (o.order_type === 'POS' ? 'Spot Counter Sale' : 'Student Customer'));

    return `
      <div onclick="openOrderDetailModalByID('${o.id}')" class="p-4 bg-slate-900/80 rounded-2xl border border-slate-800 flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-xs cursor-pointer hover:bg-slate-800/80 hover:border-slate-700 transition-all shadow-md">
        <div class="space-y-1 min-w-0">
          <div class="flex items-center gap-2.5 flex-wrap">
            <span class="font-black text-primary tracking-wider text-base">${o.token_number || '#TK'}</span>
            ${guestBadge}
            ${modeBadge}
          </div>
          <p class="text-slate-300 font-semibold text-xs mt-1 truncate">${customerDisplay} &bull; <span class="text-slate-400 text-[10px]">${timeStr}</span></p>
          ${!isPaid ? `<p class="text-[10px] text-amber-400/80 font-medium">${remMins}m remaining in counter window</p>` : ''}
        </div>
        <div class="flex flex-row sm:flex-col items-center sm:items-end justify-between sm:justify-center gap-3 flex-shrink-0">
          <span class="font-black text-slate-100 text-base">₹${parseFloat(o.total_amount || 0).toFixed(2)}</span>
          ${actionBtns}
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

// 16. Realtime Orders Stream Listener
function setupRealtimeOrdersListener() {
  if (activeOrdersChannel && supabase) {
    supabase.removeChannel(activeOrdersChannel);
    activeOrdersChannel = null;
  }
  if (!supabase) return;

  activeOrdersChannel = supabase
    .channel('orders_realtime_stream')
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'orders' },
      async (payload) => {
        playBeep('success');
        showToast(`🔔 New Order Received: ${payload.new?.token_number || 'Token'}!`, 'success');
        await fetchOrders();
        renderOrderQueue();
        updateTopLiveMetricCards();
        if (currentView === 'sales') renderSalesSummary();
        if (currentView === 'history') loadHistoryView();
      }
    )
    .on(
      'postgres_changes',
      { event: 'UPDATE', schema: 'public', table: 'orders' },
      async (payload) => {
        const updated = payload.new;
        const idx = orders.findIndex(o => o.id === updated.id);
        if (idx !== -1) {
          orders[idx] = { ...orders[idx], ...updated };
        } else {
          await fetchOrders();
        }
        renderOrderQueue();
        updateTopLiveMetricCards();
        if (currentView === 'sales') renderSalesSummary();
        if (currentView === 'history') loadHistoryView();
      }
    )
    .on(
      'postgres_changes',
      { event: 'DELETE', schema: 'public', table: 'orders' },
      async (payload) => {
        orders = orders.filter(o => o.id !== payload.old?.id);
        renderOrderQueue();
        updateTopLiveMetricCards();
      }
    )
    .subscribe();
}

window.addEventListener('beforeunload', () => {
  if (activeOrdersChannel && supabase) {
    supabase.removeChannel(activeOrdersChannel);
    activeOrdersChannel = null;
  }
});

// 17. MODULE 5: Order History & Logs
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

  const rangeLabel = document.getElementById('history-active-range-label');
  if (rangeLabel) {
    if (preset === 'all') rangeLabel.innerText = 'All Time';
    else if (preset === 'today') rangeLabel.innerText = 'Today';
    else if (preset === 'yesterday') rangeLabel.innerText = 'Yesterday';
    else if (preset === 'week') rangeLabel.innerText = 'This Week';
    else rangeLabel.innerText = 'Custom Range';
  }

  if (preset !== 'custom') {
    const sInput = document.getElementById('history-date-start');
    const eInput = document.getElementById('history-date-end');
    if (sInput) sInput.value = '';
    if (eInput) eInput.value = '';
  }

  loadHistoryView();
}

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
    const rangeLabel = document.getElementById('history-active-range-label');
    if (rangeLabel) rangeLabel.innerText = 'Custom Range';
    loadHistoryView();
  }
}

async function loadHistoryView() {
  const loadingEl = document.getElementById('history-loading-state');
  if (loadingEl) loadingEl.classList.remove('hidden');

  await fetchOrders();

  if (loadingEl) loadingEl.classList.add('hidden');
  filterHistoryTable();
}

function filterHistoryTable() {
  const rangeType = currentHistoryPreset;
  const statusFilter = document.getElementById("history-status-filter")?.value || "ALL";
  const typeFilter = document.getElementById("history-type-filter")?.value || "ALL";
  const searchTerm = (document.getElementById("history-search")?.value || "").toLowerCase().trim();

  const today = todayDateString();
  const yesterday = yesterdayDateString();

  let filtered = orders.filter(o => {
    if (!o.created_at) return false;
    const orderDate = o.created_at.split('T')[0];

    if (rangeType === 'today' && orderDate !== today) return false;
    if (rangeType === 'yesterday' && orderDate !== yesterday) return false;
    if (rangeType === 'week') {
      const orderTime = new Date(o.created_at).getTime();
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      if (orderTime < weekAgo) return false;
    }
    if (rangeType === 'custom') {
      const start = document.getElementById("history-date-start")?.value;
      const end = document.getElementById("history-date-end")?.value;
      if (start && orderDate < start) return false;
      if (end && orderDate > end) return false;
    }

    if (statusFilter !== 'ALL' && o.order_status !== statusFilter) return false;

    if (typeFilter === 'ONLINE' && (o.order_type === 'POS' || o.payment_method === 'CASH_AT_COUNTER')) return false;
    if (typeFilter === 'POS' && o.order_type !== 'POS') return false;

    if (searchTerm) {
      const token = (o.token_number || '').toLowerCase();
      const studentName = (o.students?.name || o.qr_code_data?.guest_name || '').toLowerCase();
      const regNo = (o.students?.reg_no || '').toLowerCase();
      const matchesItem = (o.order_items || []).some(oi => (oi.products?.name || oi.name || '').toLowerCase().includes(searchTerm));

      if (!token.includes(searchTerm) && !studentName.includes(searchTerm) && !regNo.includes(searchTerm) && !matchesItem) {
        return false;
      }
    }

    return true;
  });

  renderHistoryTable(filtered);
}

function renderHistoryTable(records) {
  const loadingEl = document.getElementById('history-loading-state');
  const emptyEl   = document.getElementById('history-empty-state');
  const wrapperEl = document.getElementById('history-table-wrapper');
  const tbody     = document.getElementById('history-table-body');

  if (loadingEl) loadingEl.classList.add('hidden');

  // Compute History Summary Stats
  const delivered = records.filter(o => o.order_status === 'DELIVERED');
  const cancelled = records.filter(o => o.order_status === 'CANCELLED');
  const onlineOrders = delivered.filter(o => o.payment_method === 'ONLINE' || (o.qr_code_data && o.qr_code_data.payment_mode === 'UPI'));
  const posOrders = delivered.filter(o => o.order_type === 'POS' || (o.qr_code_data && o.qr_code_data.order_type === 'POS'));

  const totalRev = delivered.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
  const onlineRev = onlineOrders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
  const posRev = posOrders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);

  const statTotal = document.getElementById('history-stat-total');
  const statCount = document.getElementById('history-stat-count');
  const statDelivered = document.getElementById('history-stat-delivered-count');
  const statCancelled = document.getElementById('history-stat-cancelled-count');
  const statOnline = document.getElementById('history-stat-online');
  const statOnlineCount = document.getElementById('history-stat-online-count');
  const statPos = document.getElementById('history-stat-pos');
  const statPosCount = document.getElementById('history-stat-pos-count');

  if (statTotal) statTotal.innerText = `₹${totalRev.toFixed(2)}`;
  if (statCount) statCount.innerText = records.length;
  if (statDelivered) statDelivered.innerText = delivered.length;
  if (statCancelled) statCancelled.innerText = cancelled.length;
  if (statOnline) statOnline.innerText = `₹${onlineRev.toFixed(2)}`;
  if (statOnlineCount) statOnlineCount.innerText = onlineOrders.length;
  if (statPos) statPos.innerText = `₹${posRev.toFixed(2)}`;
  if (statPosCount) statPosCount.innerText = posOrders.length;

  if (!records || records.length === 0) {
    if (emptyEl)   emptyEl.classList.remove('hidden');
    if (wrapperEl) wrapperEl.classList.add('hidden');
    return;
  }

  if (emptyEl)   emptyEl.classList.add('hidden');
  if (wrapperEl) wrapperEl.classList.remove('hidden');

  if (!tbody) return;

  tbody.innerHTML = records.map(o => {
    const timeStr = formatOrderTimestamp(o.created_at);
    const isPos = o.order_type === 'POS' || (o.qr_code_data && o.qr_code_data.order_type === 'POS');
    const isGuest = !isPos && (!o.student_id || (o.students && o.students.reg_no === 'GUEST') || (o.qr_code_data && (o.qr_code_data.is_guest || o.qr_code_data.order_type === 'GUEST_ORDER')));
    const studentName = isGuest 
      ? (o.qr_code_data?.guest_name || o.students?.name || 'Guest User')
      : (isPos ? 'Walk-in Counter POS' : (o.students?.name || 'Student Customer'));
    const regNo = isGuest ? '(GUEST)' : (isPos ? '(POS)' : (o.students?.reg_no ? `(${o.students.reg_no})` : ''));

    const isPaid = o.payment_status === 'PAID';
    const isDelivered = o.order_status === 'DELIVERED';
    const isCancelled = o.order_status === 'CANCELLED';
    const totalAmount = parseFloat(o.total_amount || 0).toFixed(2);
    const paymentMode = o.payment_method === 'ONLINE' || (o.qr_code_data && o.qr_code_data.payment_mode === 'UPI') ? 'UPI' : 'CASH';

    const itemsSummary = (o.order_items || []).map(oi => {
      const pName = oi.products?.name || oi.name || 'Item';
      return `${oi.quantity || 1}x ${pName}`;
    }).join(', ') || 'Item';

    return `
      <tr onclick="openOrderDetailModalByID('${o.id}')" class="border-b border-slate-800/40 hover:bg-slate-800/20 text-xs cursor-pointer transition-colors">
        <td class="py-3 pr-4 font-mono font-bold text-primary whitespace-nowrap">${o.token_number || '#TK'}</td>
        <td class="py-3 pr-4 whitespace-nowrap">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${isPos ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20' : (isGuest ? 'bg-purple-500/10 text-purple-400 border border-purple-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20')}">
            ${isPos ? '⚡ POS' : (isGuest ? '👤 Guest' : '📱 App')}
          </span>
        </td>
        <td class="py-3 pr-4 font-semibold text-slate-200 truncate max-w-[150px]">
          ${studentName} <span class="text-slate-400 text-[10px] font-normal">${regNo}</span>
        </td>
        <td class="py-3 pr-4 text-slate-300 truncate max-w-[200px]" title="${itemsSummary}">
          ${itemsSummary}
        </td>
        <td class="py-3 pr-4 text-center whitespace-nowrap">
          <span class="px-2 py-0.5 rounded text-[10px] font-bold ${paymentMode === 'UPI' ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20' : 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'}">
            ${paymentMode} ${isPaid ? '• PAID' : '• DUE'}
          </span>
        </td>
        <td class="py-3 pr-4 text-right font-bold text-slate-100 whitespace-nowrap">₹${totalAmount}</td>
        <td class="py-3 pr-4 text-center text-slate-400 font-mono text-[11px] whitespace-nowrap">${timeStr}</td>
        <td class="py-3 text-center whitespace-nowrap">
          <span class="px-2.5 py-0.5 rounded text-[10px] font-bold ${isDelivered ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' : (isCancelled ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30' : 'bg-amber-500/15 text-amber-400 border border-amber-500/30')}">
            ${o.order_status || 'PENDING'}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

// 18. MODULE 2: Quick Sale (Spot POS) System
function renderPosCategories() {
  const container = document.getElementById("pos-category-chips");
  if (!container) return;

  const allActive = posSelectedCategory === 'all' 
    ? 'bg-primary text-slate-900 shadow font-bold' 
    : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 font-semibold';

  let html = `
    <button type="button" onclick="setPosCategoryFilter('all')" class="px-3 py-1.5 rounded-lg text-xs transition-all ${allActive}">
      All Items
    </button>
  `;

  categories.forEach(c => {
    const isSelected = posSelectedCategory === c.id;
    const btnClass = isSelected 
      ? 'bg-primary text-slate-900 shadow font-bold' 
      : 'bg-slate-900 text-slate-300 border border-slate-800 hover:bg-slate-800 font-semibold';

    html += `
      <button type="button" onclick="setPosCategoryFilter('${c.id}')" class="px-3 py-1.5 rounded-lg text-xs transition-all ${btnClass}">
        <span>${c.icon_url || c.icon || '📦'}</span> <span>${c.name}</span>
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
  posSearchQuery = (val || '').toLowerCase().trim();
  const clearBtn = document.getElementById("pos-search-clear-btn");
  if (clearBtn) {
    if (posSearchQuery) clearBtn.classList.remove('hidden');
    else clearBtn.classList.add('hidden');
  }
  renderPosMenu();
}

function clearPosSearch() {
  posSearchQuery = '';
  const input = document.getElementById("posSearch");
  if (input) input.value = '';
  const clearBtn = document.getElementById("pos-search-clear-btn");
  if (clearBtn) clearBtn.classList.add('hidden');
  renderPosMenu();
}

function renderPosMenu() {
  const grid = document.getElementById("pos-items-grid");
  const countBadge = document.getElementById("pos-items-count");
  if (!grid) return;

  let filtered = products.filter(p => p.stock_quantity > 0);

  if (posSelectedCategory !== 'all') {
    filtered = filtered.filter(p => p.category_id === posSelectedCategory);
  }

  if (posSearchQuery) {
    filtered = filtered.filter(p => p.name.toLowerCase().includes(posSearchQuery) || (p.barcode_id && p.barcode_id.toLowerCase().includes(posSearchQuery)));
  }

  if (countBadge) {
    countBadge.innerText = `${filtered.length} ${filtered.length === 1 ? 'item' : 'items'}`;
  }

  if (filtered.length === 0) {
    grid.innerHTML = `<div class="col-span-full text-center py-12 text-slate-500 text-xs">No available products found in catalog.</div>`;
    return;
  }

  grid.innerHTML = filtered.map(p => {
    const inCartQty = posCart[p.id]?.quantity || 0;
    return `
      <div onclick="addToPosCart('${p.id}')" class="bg-slate-900 border border-slate-800 hover:border-primary/50 p-3 rounded-2xl cursor-pointer flex flex-col justify-between transition-all aspect-square relative group hover:shadow-lg">
        ${inCartQty > 0 ? `<span class="absolute top-2 right-2 bg-primary text-slate-900 text-[11px] font-black w-6 h-6 rounded-full flex items-center justify-center shadow-md animate-scale">${inCartQty}</span>` : ''}
        <div class="w-full h-20 rounded-xl overflow-hidden bg-slate-800 mb-2">
          <img src="${p.image_url || 'https://images.unsplash.com/photo-1546273031-28b72a64353b?w=150'}" alt="${p.name}" class="w-full h-full object-cover group-hover:scale-105 transition-transform">
        </div>
        <div>
          <h4 class="font-bold text-xs text-slate-100 truncate">${p.name}</h4>
          <div class="flex items-center justify-between mt-1">
            <span class="text-sm font-black text-primary">₹${p.price.toFixed(2)}</span>
            <span class="text-[10px] text-slate-400 font-mono bg-slate-800 px-1.5 py-0.5 rounded">(${p.stock_quantity})</span>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function addToPosCart(productId) {
  const prod = products.find(p => p.id === productId);
  if (!prod || prod.stock_quantity <= 0) {
    showToast("Product out of stock", "error");
    return;
  }

  const currentQty = posCart[productId]?.quantity || 0;
  if (currentQty >= prod.stock_quantity) {
    showToast(`Maximum stock limit (${prod.stock_quantity}) reached`, "warning");
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
  if (!posCart[productId]) return;
  const newQty = posCart[productId].quantity + delta;
  const prod = posCart[productId].product;

  if (newQty <= 0) {
    delete posCart[productId];
  } else if (newQty > prod.stock_quantity) {
    showToast(`Maximum stock limit (${prod.stock_quantity}) reached`, "warning");
  } else {
    posCart[productId].quantity = newQty;
  }

  renderPosCart();
  renderPosMenu();
}

function clearPosCart() {
  posCart = {};
  renderPosCart();
  renderPosMenu();
}

function renderPosCart() {
  const listEl = document.getElementById("pos-cart-items-list");
  const subtotalEl = document.getElementById("pos-cart-subtotal");
  const grandTotalEl = document.getElementById("pos-cart-grand-total");
  const countEl = document.getElementById("pos-cart-items-qty");
  const btnCash = document.getElementById("pos-btn-cash");
  const btnUpi = document.getElementById("pos-btn-upi");

  const itemIds = Object.keys(posCart);
  let totalAmount = 0;
  let totalCount = 0;

  itemIds.forEach(id => {
    const it = posCart[id];
    totalAmount += it.product.price * it.quantity;
    totalCount += it.quantity;
  });

  if (countEl) countEl.innerText = totalCount;
  if (subtotalEl) subtotalEl.innerText = `₹${totalAmount.toFixed(2)}`;
  if (grandTotalEl) grandTotalEl.innerText = `₹${totalAmount.toFixed(2)}`;

  if (btnCash) btnCash.disabled = totalCount === 0;
  if (btnUpi) btnUpi.disabled = totalCount === 0;

  if (!listEl) return;

  if (itemIds.length === 0) {
    listEl.innerHTML = `
      <div class="text-center py-12 text-slate-500 text-xs flex flex-col items-center gap-2">
        <i data-lucide="shopping-cart" class="w-8 h-8 text-slate-700"></i>
        <p>No items in tray. Tap menu items to add.</p>
      </div>
    `;
    if (window.lucide) lucide.createIcons();
    return;
  }

  listEl.innerHTML = itemIds.map(id => {
    const it = posCart[id];
    const sub = it.product.price * it.quantity;

    return `
      <div class="flex items-center justify-between py-2.5 text-xs">
        <div class="min-w-0 flex-1 mr-2">
          <h5 class="font-bold text-slate-100 truncate">${it.product.name}</h5>
          <span class="text-slate-400 text-[10px]">₹${it.product.price.toFixed(2)} each</span>
        </div>
        <div class="flex items-center gap-1.5 flex-shrink-0">
          <button onclick="updatePosCartQty('${id}', -1)" class="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center font-bold hover:bg-slate-700 active:scale-95 transition-all">-</button>
          <span class="font-mono font-bold text-slate-100 w-5 text-center">${it.quantity}</span>
          <button onclick="updatePosCartQty('${id}', 1)" class="w-6 h-6 rounded-lg bg-slate-800 text-slate-300 flex items-center justify-center font-bold hover:bg-slate-700 active:scale-95 transition-all">+</button>
        </div>
        <div class="text-right ml-3 flex-shrink-0 min-w-[55px]">
          <span class="font-bold text-slate-100 font-poppins">₹${sub.toFixed(2)}</span>
        </div>
      </div>
    `;
  }).join('');

  if (window.lucide) lucide.createIcons();
}

async function handlePosCheckout(paymentMode = 'CASH') {
  const itemIds = Object.keys(posCart);
  if (itemIds.length === 0) {
    showToast("POS Cart is empty", "error");
    return;
  }

  showLoading(true);
  try {
    const items = itemIds.map(id => ({
      product_id: id,
      quantity: posCart[id].quantity
    }));

    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        order_type: 'POS',
        payment_method: paymentMode === 'UPI' ? 'ONLINE' : 'CASH_AT_COUNTER',
        payment_status: 'PAID',
        items
      })
    });

    const result = await res.json();
    showLoading(false);

    if (!res.ok || !result.success) {
      throw new Error(result.error || "POS checkout failed");
    }

    const newOrder = result.data;
    const tokenNumber = newOrder.token_number || '#POS-000';
    const totalAmount = parseFloat(newOrder.total_amount || 0).toFixed(2);

    playBeep('success');
    showToast(`✅ POS Sale Recorded: ${tokenNumber} (₹${totalAmount} via ${paymentMode})`, "success");

    clearPosCart();
    await fetchProducts();
    await fetchOrders();
    renderInventoryTable();
    renderPosMenu();
    renderOrderQueue();
    await renderSalesSummary();
    if (currentView === 'history') loadHistoryView();

  } catch (err) {
    showLoading(false);
    console.error("POS Checkout error:", err);
    showToast("Failed to process POS sale: " + err.message, "error");
  }
}

// 19. QR & Barcode Camera / File Scanner
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

  if (manualSection) {
    if (target.startsWith('product')) {
      manualSection.classList.add('hidden');
    } else {
      manualSection.classList.remove('hidden');
    }
  }

  const manualInput = document.getElementById("scanner-manual-input");
  if (manualInput) manualInput.value = '';

  modal.classList.remove("hidden");
  await switchScannerTab('camera');
}

async function closeScannerModal() {
  const modal = document.getElementById("scanner-modal");
  if (modal) modal.classList.add("hidden");
  await stopActiveScanner();
  const readerContainer = document.getElementById("qr-reader");
  if (readerContainer) readerContainer.innerHTML = '';
  const fileInput = document.getElementById("qr-file-input");
  if (fileInput) fileInput.value = '';
}

async function stopActiveScanner() {
  if (html5QrCode) {
    try {
      if (html5QrCode.isScanning) {
        await html5QrCode.stop();
      }
    } catch (e) {}
    try {
      await html5QrCode.clear();
    } catch (e) {}
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
    if (cameraTabBtn) cameraTabBtn.className = "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold bg-primary text-slate-900 transition-all shadow";
    if (uploadTabBtn) uploadTabBtn.className = "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold text-slate-400 hover:text-white transition-all";
    if (cameraView) cameraView.classList.remove("hidden");
    if (uploadView) uploadView.classList.add("hidden");
    await startCameraFeed();
  } else {
    if (uploadTabBtn) uploadTabBtn.className = "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold bg-primary text-slate-900 transition-all shadow";
    if (cameraTabBtn) cameraTabBtn.className = "flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg text-xs font-bold text-slate-400 hover:text-white transition-all";
    if (cameraView) cameraView.classList.add("hidden");
    if (uploadView) uploadView.classList.remove("hidden");
    await stopActiveScanner();
  }
  if (window.lucide) lucide.createIcons();
}

async function startCameraFeed() {
  const modal = document.getElementById("scanner-modal");
  const readerContainer = document.getElementById("qr-reader");

  if (readerContainer) {
    readerContainer.innerHTML = `
      <div id="camera-loading-box" class="w-full h-full flex flex-col items-center justify-center gap-3 text-slate-400 bg-slate-900">
        <div class="w-9 h-9 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
        <p class="text-xs font-semibold text-slate-300">Initializing camera...</p>
      </div>
    `;
  }

  await stopActiveScanner();

  setTimeout(async () => {
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

      try {
        await html5QrCode.start({ facingMode: "environment" }, qrConfig, onScanSuccess, onScanError);
      } catch (backCamErr) {
        await html5QrCode.start(true, qrConfig, onScanSuccess, onScanError);
      }

      const loader = document.getElementById("camera-loading-box");
      if (loader) loader.remove();

    } catch (err) {
      console.error("Camera startup failed:", err);
      if (readerContainer) {
        readerContainer.innerHTML = `
          <div class="w-full h-full flex flex-col items-center justify-center p-6 text-center gap-3 text-slate-400 bg-slate-900">
            <i data-lucide="camera-off" class="w-10 h-10 text-rose-400"></i>
            <p class="text-xs font-bold text-slate-200">Unable to access camera</p>
            <p class="text-[10px] text-slate-400 max-w-[220px]">Camera permission denied or camera is in use.</p>
            <button onclick="startCameraFeed()" class="px-3.5 py-1.5 bg-slate-800 hover:bg-slate-700 border border-slate-700 text-primary font-bold rounded-lg text-xs transition-all flex items-center gap-1.5 mt-1">
              Retry Camera
            </button>
          </div>
        `;
        if (window.lucide) lucide.createIcons();
      }
      showToast("Camera access failed. Check browser permissions or use Upload tab.", "error");
    }
  }, 100);
}

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
    showToast("Please upload a valid image file.", "error");
    return;
  }

  showToast("🔍 Processing image...", "info");
  showLoading(true);

  let scannerInstance = null;
  try {
    await stopActiveScanner();
    scannerInstance = new Html5Qrcode("qr-reader");
    const decodedText = await scannerInstance.scanFile(file, true);
    showLoading(false);
    try { await scannerInstance.clear(); } catch (e) {}
    await onScanSuccess(decodedText);
  } catch (err) {
    showLoading(false);
    try { if (scannerInstance) await scannerInstance.clear(); } catch (e) {}
    showToast("No valid code found in image.", "error");
    const fileInput = document.getElementById("qr-file-input");
    if (fileInput) fileInput.value = '';
  }
}

async function onScanSuccess(decodedText) {
  const target = currentScannerTarget;
  await closeScannerModal();
  if (target && target.startsWith('product')) {
    await handleInventoryScan(decodedText, target);
  } else {
    await handleScan(decodedText);
  }
}

function onScanError(e) {}

async function handleScan(rawData) {
  const cleaned = (rawData || '').trim();
  if (!cleaned) return;

  const addModalEl = document.getElementById('add-item-modal');
  const editModalEl = document.getElementById('edit-item-modal');
  const isAddModalOpen = addModalEl && !addModalEl.classList.contains('hidden');
  const isEditModalOpen = editModalEl && !editModalEl.classList.contains('hidden');

  if (currentView === 'pos') {
    const cleanLower = cleaned.toLowerCase();
    const posMatch = products.find(p => (p.barcode_id && p.barcode_id.toLowerCase() === cleanLower) || p.id === cleaned);
    if (posMatch) {
      showToast(`⚡ POS Scanned: ${posMatch.name}`, 'success');
      addToPosCart(posMatch.id);
      return;
    }
  }

  let parsed = null;
  try { parsed = JSON.parse(cleaned); } catch (e) {}

  if (parsed && typeof parsed === 'object') {
    if (parsed.barcode_id || parsed.product_id) {
      showToast('🔍 Scanning Barcode...', 'info');
      await handleInventoryScan(parsed.barcode_id || parsed.product_id);
      return;
    }

    const orderId = parsed.order_id || parsed.orderId || parsed.id || null;
    const token = parsed.token_number || parsed.token || null;

    if (orderId || token) {
      if (inventoryScanModeActive || isAddModalOpen || isEditModalOpen) {
        showToast('🔍 Scanning Barcode...', 'info');
        await handleInventoryScan(parsed.barcode_id || parsed.order_id || parsed.token || cleaned);
        return;
      }
      showToast('🔍 Verifying Order...', 'info');
      await verifyOrderLookup(orderId || token, token);
      return;
    }
  }

  if (inventoryScanModeActive || isAddModalOpen || isEditModalOpen) {
    showToast('🔍 Scanning Barcode...', 'info');
    await handleInventoryScan(cleaned);
    return;
  }

  const cleanLower = cleaned.toLowerCase();
  const productMatch = products.find(p => (p.barcode_id && p.barcode_id.toLowerCase() === cleanLower) || p.id === cleaned);

  if (productMatch || cleaned.startsWith('BC-') || cleaned.startsWith('BARCODE-') || cleaned.startsWith('PROD-')) {
    showToast('🔍 Scanning Barcode...', 'info');
    await handleInventoryScan(cleaned);
    return;
  }

  showToast('🔍 Verifying Order...', 'info');
  await verifyOrderLookup(cleaned);
}

async function handleInventoryScan(rawBarcode, targetHint = null) {
  const cleanBarcode = (rawBarcode || '').trim().replace(/^['"]|['"]$/g, '');
  if (!cleanBarcode) return;

  if (!products || products.length === 0) {
    await fetchProducts();
  }

  if (targetHint === 'product_edit_prefill') {
    const editBarcodeInput = document.getElementById("edit-prod-barcode");
    if (editBarcodeInput) editBarcodeInput.value = cleanBarcode;
    showToast(`Barcode ${cleanBarcode} filled in edit form`, 'success');
    return;
  }

  const match = products.find(p => (p.barcode_id && p.barcode_id.toLowerCase() === cleanBarcode.toLowerCase()) || p.id === cleanBarcode);

  if (match) {
    showToast(`📦 Item Found: ${match.name} (₹${match.price.toFixed(2)})`, 'success');
    closeAddItemModal();
    openEditItemModal(match.id);
  } else {
    showToast(`🔍 New barcode: ${cleanBarcode} — Enter details to add new item`, 'info');
    closeEditItemModal();
    openAddItemModal();
    const barcodeInput = document.getElementById('new-prod-barcode');
    if (barcodeInput) barcodeInput.value = cleanBarcode;
  }
}

function toggleInventoryScanMode() {
  inventoryScanModeActive = !inventoryScanModeActive;

  const btn = document.getElementById('inventory-scan-mode-btn');
  const banner = document.getElementById('inventory-scan-mode-banner');

  if (inventoryScanModeActive) {
    showToast('📡 Inventory Scan Mode: ON', 'success');
    if (btn) {
      btn.innerHTML = `<i data-lucide="scan-line" class="w-3.5 h-3.5"></i> Scan Mode: ON`;
      btn.className = 'text-xs font-bold px-3 py-1.5 rounded-xl transition-all shadow flex items-center gap-1.5 bg-primary/20 text-primary border border-primary/40';
    }
    if (banner) banner.classList.remove('hidden');
  } else {
    showToast('Inventory Scan Mode: OFF', 'info');
    if (btn) {
      btn.innerHTML = `<i data-lucide="scan-line" class="w-3.5 h-3.5"></i> Scan Mode: OFF`;
      btn.className = 'text-xs font-bold px-3 py-1.5 rounded-xl transition-all shadow flex items-center gap-1.5 bg-slate-900 text-slate-300 border border-slate-700 hover:bg-slate-800';
    }
    if (banner) banner.classList.add('hidden');
  }
  if (window.lucide) lucide.createIcons();
}

async function verifyOrderLookup(identifier, secondaryIdentifier = null) {
  if (!identifier) {
    showToast("Empty or invalid order identifier.", "error");
    return;
  }

  const cleanId = String(identifier).trim().replace(/^['"]|['"]$/g, '');
  if (!cleanId) return;

  showLoading(true);
  try {
    let order = orders.find(o => (o.token_number && o.token_number.toLowerCase() === cleanId.toLowerCase()) || o.id === cleanId);
    if (!order) {
      const res = await fetch(`/api/orders?lookup=${encodeURIComponent(cleanId)}`);
      const result = await res.json();
      if (result.success && result.data) {
        order = result.data;
      }
    }

    showLoading(false);
    if (order) {
      openOrderDetailModal(order);
    } else {
      showToast("Order not found or invalid token.", "error");
    }
  } catch (err) {
    showLoading(false);
    console.error("Order lookup error:", err);
    showToast("Failed to lookup order", "error");
  }
}

// 20. Startup event listener
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
  if (window.lucide) lucide.createIcons();

  document.addEventListener('keydown', (e) => {
    const tag = e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.key === 'Enter') {
      const buffered = scanBuffer.trim();
      scanBuffer = '';
      clearTimeout(scanBufferTimer);

      if (buffered.length > 3) {
        handleScan(buffered);
      }

      const indicator = document.getElementById('wedge-indicator');
      if (indicator) {
        indicator.classList.remove('bg-amber-500/20', 'text-amber-400', 'border-amber-500/30');
        indicator.classList.add('bg-primary/10', 'text-primary', 'border-primary/20');
      }
    } else if (e.key.length === 1) {
      scanBuffer += e.key;
      clearTimeout(scanBufferTimer);

      const indicator = document.getElementById('wedge-indicator');
      if (indicator) {
        indicator.classList.add('bg-amber-500/20', 'text-amber-400', 'border-amber-500/30');
        indicator.classList.remove('bg-primary/10', 'text-primary', 'border-primary/20');
      }

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
