// Campus Canteen Manager Dashboard Logic

// 1. Supabase Client Configuration Credentials
const SUPABASE_URL = 'https://llbegpqowjvsadbundrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsYmVncHFvd2p2c2FkYnVuZHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3Njg4NzAsImV4cCI6MjEwMjM0NDg3MH0.SGoLEoE5PP_Ex0C7tOXrwvcol2vxxOvOFPoSGfD93VA';
var supabase = (typeof window !== 'undefined' && window.supabase && window.supabase.createClient) ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

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
// Direct Supabase Client Integration (Serverless Mode)

async function handleManagerLogin(event) {
  event.preventDefault();
  const phone = document.getElementById("login-phone").value.trim();
  const otp = document.getElementById("login-otp").value.trim();

  if (phone !== "9025114185" && phone !== "admin") {
    showToast("Unauthorized Mobile Number", "error");
    return;
  }
  if (otp !== "1234") {
    showToast("Invalid verification code OTP", "error");
    return;
  }

  sessionStorage.setItem("manager_auth", "true");
  showToast("Login successful!", "success");

  document.getElementById("login-screen").classList.add("hidden");
  document.getElementById("dashboard-screen").classList.remove("hidden");

  initDashboard();
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
    const storedStatus = localStorage.getItem("canteen_is_open");
    isCanteenOpen = storedStatus === null ? true : storedStatus === "true";
    updateCanteenStatusUI();
  } catch (e) {
    isCanteenOpen = true;
    updateCanteenStatusUI();
  }
}

async function toggleCanteenStatus() {
  isCanteenOpen = !isCanteenOpen;
  localStorage.setItem("canteen_is_open", isCanteenOpen ? "true" : "false");
  updateCanteenStatusUI();
  showToast(`Canteen is now ${isCanteenOpen ? 'OPEN 🟢' : 'CLOSED 🔴'}`, 'success');
}

async function fetchCategories() {
  try {
    const { data, error } = await supabase
      .from('categories')
      .select('*')
      .order('name');
    if (error) throw error;
    categories = data || [];
  } catch (err) {
    console.error("Categories fetch error:", err);
    categories = [];
  }
}

async function fetchProducts() {
  try {
    const { data, error } = await supabase
      .from('products')
      .select('*')
      .order('name');
    if (error) throw error;
    products = data || [];
  } catch (err) {
    console.error("Products fetch error:", err);
    products = [];
  }
}

async function fetchOrders() {
  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        students (
          name,
          reg_no,
          department
        ),
        order_items (
          *,
          products (
            id,
            name,
            price,
            stock_quantity,
            image_url
          )
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;
    orders = data || [];
  } catch (err) {
    console.error("Orders fetch error:", err);
    orders = [];
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
  localStorage.setItem("hand_cash_amount", value.toFixed(2));
  showToast(`Hand Cash entry saved: ₹${value.toFixed(2)}`, "success");
}

async function updateProductStock(prodId, newStock) {
  if (newStock < 0 || isNaN(newStock)) {
    showToast("Invalid stock quantity", "error");
    return;
  }
  showLoading(true);
  try {
    const { error } = await supabase
      .from('products')
      .update({ stock_quantity: newStock })
      .eq('id', prodId);

    showLoading(false);
    if (error) throw error;

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
  showLoading(true);

  try {
    let order = orders.find(o => (o.token_number && o.token_number.toLowerCase() === token.toLowerCase()) || o.id === token);
    if (!order) {
      const { data } = await supabase
        .from('orders')
        .select('*, students(name, reg_no), order_items(*, products(*))')
        .or(`token_number.ilike.${token},id.eq.${token}`)
        .maybeSingle();
      if (data) order = data;
    }

    if (!order) {
      showLoading(false);
      playBeep('error');
      showToast(`Token ${token} not found`, 'error');
      return;
    }

    if (order.order_status === 'DELIVERED') {
      showLoading(false);
      playBeep('error');
      showToast(`Order ${order.token_number || token} is already DELIVERED`, 'info');
      return;
    }

    const { data: updated, error: upErr } = await supabase
      .from('orders')
      .update({ order_status: 'DELIVERED', payment_status: 'PAID' })
      .eq('id', order.id)
      .select('*, students(name, reg_no), order_items(*, products(*))')
      .single();

    showLoading(false);

    if (upErr) throw upErr;

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
    const { error } = await supabase
      .from('orders')
      .update({ payment_status: 'PAID' })
      .eq('id', orderId);

    showLoading(false);
    if (error) throw error;

    showToast("Payment status confirmed: PAID!", "success");
    await fetchOrders();
    renderOrderQueue();
    await renderSalesSummary();
  } catch (err) {
    showLoading(false);
    console.error("Confirm payment error:", err);
    showToast("Failed to confirm payment", "error");
  }
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
    showToast("Invalid order ID provided", "error");
    return;
  }
  showLoading(true);
  try {
    const { error } = await supabase
      .from('orders')
      .update({ order_status: 'DELIVERED', payment_status: 'PAID' })
      .eq('id', orderId);

    showLoading(false);
    if (error) throw error;

    showToast("Order status updated: DELIVERED!", "success");
    await initDashboard();
  } catch (err) {
    showLoading(false);
    console.error("Deliver order error:", err);
    showToast("Error delivering order: " + err.message, "error");
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
    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        students (
          name,
          reg_no,
          department
        ),
        order_items (
          *,
          products (
            id,
            name,
            price,
            stock_quantity,
            image_url
          )
        )
      `)
      .order('created_at', { ascending: false });

    if (error) throw error;

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

    // Direct Supabase atomic checkout
    if (true) {
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
