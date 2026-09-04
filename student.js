// Hostel Canteen Student Ordering Application - Centralized SPA Architecture

// 1. Supabase Client Configuration Credentials
const SUPABASE_URL = 'https://llbegpqowjvsadbundrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsYmVncHFvd2p2c2FkYnVuZHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3Njg4NzAsImV4cCI6MjEwMjM0NDg3MH0.SGoLEoE5PP_Ex0C7tOXrwvcol2vxxOvOFPoSGfD93VA';
var supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// 2. Global SPA Application State
let currentStudent = null;
let products = [];
let categories = [];
let cart = {}; // product_id -> quantity
let orders = [];
let currentCategory = null;
let currentSort = "default";
let currentPaymentMode = "CASH";
let ordersSubscription = null;
let cashCountdownInterval = null;
let qrCountdownInterval = null;
const CASH_EXPIRY_WINDOW_SECONDS = 30 * 60; // 30 minutes (1800 seconds)
let pendingOrderToken = "";
let isCanteenOpen = true;

// Online Payment Gateway State (UPI App Intent & Dynamic QR Dual Engine)
let activePaymentSession = null;
let paymentGatewayTab = "upi_app"; // 'upi_app' | 'dynamic_qr'
let qrExpiryCountdownInterval = null;
let qrStatusPollInterval = null;
const DYNAMIC_QR_DURATION_SECONDS = 180; // 3 minutes


// 3. Centralized Routing System
const router = {
  currentScreen: null,
  navigateTo(screenId) {
    showScreen(screenId);
    this.currentScreen = screenId;
  }
};

// Safe Navigation wrappers & Fallback helper
function navigateTo(screenId) {
  showScreen(screenId);
}
window.goHome = () => showScreen('home-screen');

function switchScreen(screenId) {
  showScreen(screenId);
}

function showScreen(screenId) {
  const screens = ['login-screen', 'home-screen', 'category-screen', 'cart-screen', 'qr-screen', 'profile-screen', 'notices-screen'];
  screens.forEach(id => {
    const el = document.getElementById(id);
    if (el) {
      if (id === screenId) {
        // Remove hidden, add active — CSS .screen.active { display: flex } takes full control
        el.classList.remove('hidden');
        el.classList.add('active');
        el.style.removeProperty('display');
      } else {
        // Hide by removing active and ensuring hidden class is present
        el.classList.remove('active');
        el.classList.add('hidden');
        el.style.removeProperty('display');
      }
    }
  });
  window.scrollTo(0, 0);
  toggleDrawer(false);
  lucide.createIcons();
}


// 4. Loading Indicators Toggler
function showLoading(show) {
  const loader = document.getElementById("loading-overlay");
  if (loader) {
    if (show) {
      loader.classList.remove("hidden");
    } else {
      loader.classList.add("hidden");
    }
  }
}

// Toast Notification Helper
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

// 5. Backend REST API Dynamic Data Fetches
let notices = [];
// Direct Supabase Client Integration (Serverless Mode)

async function fetchCategories() {
  try {
    const res = await fetch('/api/menu?type=categories');
    const result = await res.json();
    if (result.success) categories = result.data || [];
  } catch (err) {
    console.warn('Could not load categories from /api/menu:', err);
    categories = [];
  }
}

async function fetchProducts() {
  try {
    const res = await fetch('/api/menu?type=products');
    const result = await res.json();
    if (result.success) products = result.data || [];
  } catch (err) {
    console.warn('Could not load products from /api/menu:', err);
    products = [];
  }
}

async function fetchNotices() {
  try {
    const res = await fetch('/api/notices');
    const result = await res.json();
    if (result.success) {
      notices = result.data || [];
      updateNoticesUI();
    }
  } catch (err) {
    console.warn('Could not load notices from /api/notices:', err);
    notices = [];
  }
}

async function initDatabase() {
  await fetchCategories();
  await fetchProducts();
  await fetchNotices();

  // Instant Guest Mode detection: check URL parameters or localStorage
  const urlParams = new URLSearchParams(window.location.search);
  const isGuestParam = urlParams.get('guest') === 'true' || window.location.hash === '#guest';
  const isStoredGuest = localStorage.getItem("isGuest") === "true";

  if (isGuestParam && !isStoredGuest) {
    startGuestSession();
    return;
  }

  if (isStoredGuest) {
    const guestStudent = localStorage.getItem("guestStudent");
    if (guestStudent) {
      currentStudent = JSON.parse(guestStudent);
    } else {
      const randNum = Math.floor(1000 + Math.random() * 9000);
      currentStudent = { id: null, isGuest: true, name: `Guest_${randNum}`, reg_no: 'GUEST', department: 'Table QR Guest' };
    }
    updateDrawerInfo();
    setupGeneralRealtimeListeners();
    await fetchCanteenStatus();
    navigateHome();
    return;
  }

  const storedStudent = sessionStorage.getItem("session_student");
  if (storedStudent) {
    currentStudent = JSON.parse(storedStudent);
    try {
      if (currentStudent && currentStudent.id && typeof supabase !== 'undefined') {
        const { data: dbStudent, error: dbErr } = await supabase
          .from('students')
          .select('*')
          .eq('id', currentStudent.id)
          .maybeSingle();

        if (!dbErr && dbStudent) {
          const resolvedPhone = dbStudent.phone || dbStudent.phone_number || currentStudent.phone || currentStudent.phone_number || '';
          const resolvedEmail = dbStudent.email || currentStudent.email || '';
          currentStudent = {
            ...currentStudent,
            ...dbStudent,
            phone: resolvedPhone,
            phone_number: resolvedPhone,
            email: resolvedEmail
          };
          sessionStorage.setItem("session_student", JSON.stringify(currentStudent));
        }
      }
    } catch (dbErr) {
      console.warn("Direct Supabase profile refresh notice:", dbErr);
    }
    try {
      if (currentStudent && currentStudent.id) {
        const res = await fetch('/api/auth?id=' + encodeURIComponent(currentStudent.id));
        const result = await res.json();
        if (result.success && result.data) {
          currentStudent = { ...currentStudent, ...result.data };
          if (!currentStudent.avatar_url) {
            const scopedAvatar = localStorage.getItem("student_avatar_" + currentStudent.id);
            if (scopedAvatar) currentStudent.avatar_url = scopedAvatar;
          }
          sessionStorage.setItem("session_student", JSON.stringify(currentStudent));
        }
      }
    } catch (err) {
      console.warn("Could not sync student profile with backend", err);
    }
    updateDrawerInfo();
    setupRealtimeListener();
    await fetchStudentOrders();
    await fetchCanteenStatus();
    navigateHome();
  } else {
    setupGeneralRealtimeListeners();
    await fetchCanteenStatus();
    showScreen("login-screen");
  }
}

function startGuestSession() {
  const randNum = Math.floor(1000 + Math.random() * 9000);
  const guestTag = `Guest_${randNum}`;
  const guestUser = {
    id: null,
    isGuest: true,
    name: guestTag,
    reg_no: 'GUEST',
    department: 'Table QR Guest'
  };

  localStorage.setItem('isGuest', 'true');
  localStorage.setItem('guestStudent', JSON.stringify(guestUser));
  currentStudent = guestUser;

  updateDrawerInfo();
  setupGeneralRealtimeListeners();
  fetchCanteenStatus();
  navigateHome();
  showToast(`⚡ Welcome! Ordering as ${guestTag} (Guest Mode)`, "success");
}

async function fetchStudentOrders() {
  if (!currentStudent || currentStudent.isGuest || !currentStudent.id) {
    orders = [];
    return;
  }
  try {
    const { data, error } = await supabase
      .from('orders')
      .select(`
        id,
        student_id,
        token_number,
        total_amount,
        payment_method,
        payment_status,
        order_status,
        qr_code_data,
        created_at,
        order_items (
          id,
          product_id,
          quantity,
          unit_price,
          products (
            id,
            name,
            price,
            stock_quantity,
            image_url
          )
        )
      `)
      .eq('student_id', currentStudent.id)
      .order('created_at', { ascending: false });

    if (error) throw error;
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
      items: (o.order_items || []).map(oi => ({
        id: oi.id,
        product_id: oi.product_id,
        name: oi.products ? oi.products.name : 'Unknown Product',
        quantity: oi.quantity,
        unit_price: parseFloat(oi.unit_price),
        stock_quantity: oi.products ? oi.products.stock_quantity : 0
      }))
    }));
  } catch (err) {
    console.error('Fetch student orders error:', err);
  }
}

// Global general realtime listeners for categories, products, and notices (active even when logged out)
let generalRealtimeChannel = null;
function setupGeneralRealtimeListeners() {
  if (generalRealtimeChannel) {
    supabase.removeChannel(generalRealtimeChannel);
  }

  generalRealtimeChannel = supabase
    .channel('general_realtime_sync')
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'categories' },
      async () => {
        await fetchCategories();
        if (router.currentScreen === 'home-screen' || document.getElementById("home-screen").classList.contains("active")) {
          renderCategoriesGrid();
        }
      }
    )
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'products' },
      async () => {
        await fetchProducts();
        if (router.currentScreen === 'category-screen' || document.getElementById("category-screen").classList.contains("active")) {
          renderCategoryProducts();
        }
        if (router.currentScreen === 'home-screen' || document.getElementById("home-screen").classList.contains("active")) {
          renderFrequentlyBought();
        }
      }
    )
    .on(
      'postgres_changes',
      { event: 'INSERT', schema: 'public', table: 'notices' },
      async (payload) => {
        console.log("New notice broadcasted:", payload.new);
        await fetchNotices();
        // Trigger browser audio notification if possible
        try {
          const synth = window.speechSynthesis;
          if (synth) {
            const utter = new SpeechSynthesisUtterance("New canteen announcement: " + payload.new.title);
            utter.rate = 1.1;
            synth.speak(utter);
          }
        } catch (e) {}
        showToast(`📢 Canteen Broadcast: ${payload.new.title}`, "success");
      }
    )
    .subscribe();
}

function setupRealtimeListener() {
  // Setup the general non-student specific listeners first
  setupGeneralRealtimeListeners();

  if (!currentStudent || currentStudent.isGuest || !currentStudent.id) return;

  if (ordersSubscription) {
    supabase.removeChannel(ordersSubscription);
  }

  ordersSubscription = supabase
    .channel('orders_realtime')
    .on(
      'postgres_changes',
      {
        event: 'UPDATE',
        schema: 'public',
        table: 'orders',
        filter: `student_id=eq.${currentStudent.id}`
      },
      async (payload) => {
        console.log('Realtime update received:', payload);
        const updatedOrder = payload.new;
        await fetchStudentOrders();
        
        if (document.getElementById("cart-history-view") && !document.getElementById("cart-history-view").classList.contains("hidden")) {
          renderCartHistoryView();
        }
        
        if (updatedOrder.order_status === "DELIVERED") {
          showToast(`Order ${updatedOrder.token_number} is DELIVERED! Pick it up at the counter.`, "success");
          const activeScreen = document.getElementById("qr-screen");
          const activeTokenEl = document.getElementById("confirm-token-number");
          if (activeScreen && !activeScreen.classList.contains("hidden") && activeTokenEl && activeTokenEl.innerText === updatedOrder.token_number) {
            showConfirmationScreen(updatedOrder);
          }
        } else if (updatedOrder.order_status === "CANCELLED") {
          const isCash = updatedOrder.payment_method === 'CASH_AT_COUNTER';
          showToast(`Order ${updatedOrder.token_number} has EXPIRED: 30-minute cash payment window passed.`, "error");
          
          // If the student is currently on the QR screen for this order, refresh it to show the expired state
          const activeScreen = document.getElementById("qr-screen");
          const activeTokenEl = document.getElementById("confirm-token-number");
          if (activeScreen && !activeScreen.classList.contains("hidden") && activeTokenEl && activeTokenEl.innerText === updatedOrder.token_number) {
            showConfirmationScreen(updatedOrder);
          }
        } else {
          showToast(`Order ${updatedOrder.token_number} status updated to ${updatedOrder.order_status}.`, "success");
          const activeScreen = document.getElementById("qr-screen");
          const activeTokenEl = document.getElementById("confirm-token-number");
          if (activeScreen && !activeScreen.classList.contains("hidden") && activeTokenEl && activeTokenEl.innerText === updatedOrder.token_number) {
            showConfirmationScreen(updatedOrder);
          }
        }
      }
    )
    .subscribe();
}

// Window unload cleanup to prevent memory leaks
window.addEventListener('beforeunload', () => {
  if (generalRealtimeChannel) {
    supabase.removeChannel(generalRealtimeChannel);
    generalRealtimeChannel = null;
  }
  if (ordersSubscription) {
    supabase.removeChannel(ordersSubscription);
    ordersSubscription = null;
  }
});

// 6. Navigation Drawer & Profile Functions
function toggleDrawer(open) {
  const overlay = document.getElementById("drawer-overlay");
  const drawer = document.getElementById("drawer");
  if (open) {
    overlay.classList.add("active");
    drawer.classList.add("active");
  } else {
    overlay.classList.remove("active");
    drawer.classList.remove("active");
  }
}

function renderStudentAvatar(container, student, sizeClasses = "w-full h-full") {
  if (!container) return;
  const avatarUrl = (student && student.avatar_url) || (student && student.id && localStorage.getItem("student_avatar_" + student.id));
  if (avatarUrl) {
    container.innerHTML = `<img src="${avatarUrl}" alt="${(student && student.name) || 'Student'}" class="${sizeClasses} object-cover rounded-full">`;
  } else {
    const initial = (student && student.name) ? student.name.trim().charAt(0).toUpperCase() : 'U';
    container.innerHTML = `<span class="font-bold text-slate-800 text-lg select-none">${initial}</span>`;
  }
}

function updateDrawerInfo() {
  if (!currentStudent) return;
  const nameEl = document.getElementById("drawer-student-name");
  if (nameEl) nameEl.innerText = currentStudent.name || '';
  const regEl = document.getElementById("drawer-student-reg");
  if (regEl) regEl.innerText = currentStudent.reg_no || '';
  
  const avatarEl = document.getElementById("drawer-avatar");
  if (avatarEl) {
    renderStudentAvatar(avatarEl, currentStudent, "w-full h-full");
  }
}

function showProfileScreen() {
  if (!currentStudent) return;
  
  const nameEl = document.getElementById("profile-name");
  if (nameEl) nameEl.innerText = currentStudent.name || '-';
  const regEl = document.getElementById("profile-reg");
  if (regEl) regEl.innerText = currentStudent.reg_no || '-';
  const deptEl = document.getElementById("profile-dept");
  if (deptEl) deptEl.innerText = currentStudent.department || '-';
  const dobEl = document.getElementById("profile-dob");
  if (dobEl) dobEl.innerText = currentStudent.dob || '-';
  
  // Registered Mobile Number - strictly map to phone (fallback phone_number)
  const phoneEl = document.getElementById("profile-phone");
  if (phoneEl) {
    const rawPhone = (currentStudent.phone || currentStudent.phone_number) 
      ? String(currentStudent.phone || currentStudent.phone_number).trim() 
      : '';
    phoneEl.innerHTML = rawPhone 
      ? `<i data-lucide="phone" class="w-3.5 h-3.5 text-emerald-600"></i> <span>+91 ${rawPhone}</span>` 
      : `<span class="text-slate-400 font-normal italic">Not provided</span>`;
  }

  // Email Address - strictly map to email
  const emailEl = document.getElementById("profile-email");
  if (emailEl) {
    const rawEmail = currentStudent.email ? String(currentStudent.email).trim() : '';
    emailEl.innerText = rawEmail ? rawEmail : "Not provided";
    if (!rawEmail) {
      emailEl.className = "text-sm text-slate-400 font-normal italic";
    } else {
      emailEl.className = "text-sm font-bold text-text-primary";
    }
  }
  
  const container = document.getElementById("profile-avatar-container");
  if (container) {
    renderStudentAvatar(container, currentStudent, "w-full h-full");
  }
  
  router.navigateTo("profile-screen");
  if (window.lucide) lucide.createIcons();
}

// ─────────────────────────────────────────────────────────
// Edit Profile Feature
// ─────────────────────────────────────────────────────────
function openEditProfileModal() {
  if (!currentStudent) {
    showToast("Please log in to edit your profile", "error");
    return;
  }

  const modal = document.getElementById("edit-profile-modal");
  if (!modal) return;

  const nameInput = document.getElementById("edit-profile-name");
  const regInput  = document.getElementById("edit-profile-reg");
  const phoneInput= document.getElementById("edit-profile-phone");
  const emailInput= document.getElementById("edit-profile-email");
  const deptInput = document.getElementById("edit-profile-dept");

  if (nameInput)  nameInput.value = currentStudent.name || '';
  if (regInput)   regInput.value = currentStudent.reg_no || '';
  if (phoneInput) phoneInput.value = currentStudent.phone || currentStudent.phone_number || '';
  if (emailInput) emailInput.value = currentStudent.email || '';
  if (deptInput)  deptInput.value = currentStudent.department || '';

  modal.classList.remove("hidden");
  if (window.lucide) lucide.createIcons();
}

function closeEditProfileModal() {
  const modal = document.getElementById("edit-profile-modal");
  if (modal) modal.classList.add("hidden");
}

async function handleEditProfileSubmit(event) {
  event.preventDefault();
  if (!currentStudent || !currentStudent.id) {
    showToast("Session expired. Please log in again.", "error");
    return;
  }

  const name = document.getElementById("edit-profile-name").value.trim();
  const phone = document.getElementById("edit-profile-phone").value.trim().replace(/\D/g, '');
  const email = document.getElementById("edit-profile-email").value.trim();
  const dept = document.getElementById("edit-profile-dept").value.trim();

  if (!name) {
    showToast("Please enter your full name", "error");
    return;
  }

  if (phone.length !== 10) {
    showToast("Mobile number must be exactly 10 digits", "error");
    return;
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    showToast("Please enter a valid email address", "error");
    return;
  }

  if (!dept) {
    showToast("Please enter your department", "error");
    return;
  }

  const submitBtn = document.getElementById("edit-profile-submit-btn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full"></span> Saving...`;
  }

  try {
    const updatePayload = {
      phone: phone,
      email: email || null,
      department: dept,
      name: name
    };

    let updateSuccessful = false;

    // Direct Supabase update targeted at authenticated student's unique primary key
    if (typeof supabase !== 'undefined') {
      try {
        let { data, error } = await supabase
          .from('students')
          .update(updatePayload)
          .eq('id', currentStudent.id)
          .select()
          .single();

        if (!error && data) {
          updateSuccessful = true;
        } else {
          console.warn("Direct Supabase update with 'phone' column note:", error ? error.message : "No data");
          // Fallback update if table uses 'phone_number'
          const fbRes = await supabase
            .from('students')
            .update({
              phone_number: phone,
              email: email || null,
              department: dept,
              name: name
            })
            .eq('id', currentStudent.id)
            .select()
            .single();
          if (!fbRes.error) updateSuccessful = true;
        }
      } catch (dbErr) {
        console.warn("Direct database update caught exception:", dbErr.message);
      }
    }

    // Also update auth user metadata if active
    if (typeof supabase !== 'undefined' && supabase.auth) {
      try {
        await supabase.auth.updateUser({
          data: { phone: phone, name: name }
        });
      } catch (e) {}
    }

    // Secondary persistence via backend API
    try {
      const apiRes = await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-profile',
          id: currentStudent.id,
          phone: phone,
          phone_number: phone,
          email: email || '',
          department: dept,
          name: name
        })
      });
      const apiResult = await apiRes.json();
      if (apiResult.success) {
        updateSuccessful = true;
      }
    } catch (apiErr) {
      console.warn("Backend auth sync warning:", apiErr);
    }

    if (!updateSuccessful && typeof supabase !== 'undefined') {
      showToast("Failed to update profile. Please check database permissions.", "error");
      return;
    }

    // Refresh active session state immediately
    currentStudent = {
      ...currentStudent,
      name,
      department: dept,
      phone: phone,
      phone_number: phone,
      email: email || ''
    };
    sessionStorage.setItem("session_student", JSON.stringify(currentStudent));

    // Refresh UI immediately without requiring manual reloads
    showProfileScreen();
    updateDrawerInfo();
    closeEditProfileModal();
    showToast("Profile updated successfully!", "success");
  } catch (err) {
    console.error("Error updating profile:", err);
    showToast("Error saving profile: " + (err.message || "Unknown error"), "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i> <span>Save Changes</span>`;
      if (window.lucide) lucide.createIcons();
    }
  }
}

async function handleAvatarUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!currentStudent || !currentStudent.id) {
    showToast("Session expired. Please log in again.", "error");
    return;
  }

  // File type validation: PNG, JPEG, WEBP
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (!allowedTypes.includes(file.type.toLowerCase())) {
    showToast("Invalid format. Please upload a PNG, JPEG, or WEBP image.", "error");
    event.target.value = '';
    return;
  }

  // File size validation: max 2MB
  const MAX_SIZE = 2 * 1024 * 1024; // 2MB
  if (file.size > MAX_SIZE) {
    showToast("Image size exceeds 2MB limit. Please choose a smaller image.", "error");
    event.target.value = '';
    return;
  }

  // Visual loading feedback
  const profileContainer = document.getElementById("profile-avatar-container");
  if (profileContainer) {
    profileContainer.innerHTML = `<div class="w-full h-full flex items-center justify-center bg-slate-100 rounded-full"><span class="animate-spin inline-block w-6 h-6 border-2 border-primary border-t-transparent rounded-full"></span></div>`;
  }

  try {
    const fileExt = file.name.split('.').pop() || 'png';
    // Strictly scope storage path to authenticated student's ID and timestamp
    const storagePath = `avatars/${currentStudent.id}_${Date.now()}.${fileExt}`;

    let publicUrl = null;

    // 1. Attempt upload to Supabase Storage bucket 'avatars'
    try {
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('avatars')
        .upload(storagePath, file, { cacheControl: '3600', upsert: true });

      if (!uploadError && uploadData) {
        const { data: urlData } = supabase.storage.from('avatars').getPublicUrl(storagePath);
        if (urlData && urlData.publicUrl) {
          publicUrl = urlData.publicUrl;
        }
      } else if (uploadError) {
        console.warn("Supabase storage upload error:", uploadError.message);
      }
    } catch (sErr) {
      console.warn("Storage upload exception:", sErr);
    }

    // 2. Fallback to scoped Data URL if Supabase Storage bucket is unavailable
    if (!publicUrl) {
      publicUrl = await new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => resolve(e.target.result);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    }

    // 3. Persist public URL to students.avatar_url targeting current student ID
    try {
      const { error: dbErr } = await supabase
        .from('students')
        .update({ avatar_url: publicUrl })
        .eq('id', currentStudent.id);
      if (dbErr) console.warn("Supabase avatar_url update note:", dbErr.message);
    } catch (e) {}

    // 4. Persist to server extended profile and scoped local storage
    try {
      await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'update-avatar',
          id: currentStudent.id,
          avatar_url: publicUrl
        })
      });
    } catch (e) {}

    // Isolated per-student storage key (never global)
    localStorage.setItem("student_avatar_" + currentStudent.id, publicUrl);

    // 5. Update active session state
    currentStudent.avatar_url = publicUrl;
    sessionStorage.setItem("session_student", JSON.stringify(currentStudent));

    // 6. Update UI immediately without requiring a page reload
    if (profileContainer) {
      renderStudentAvatar(profileContainer, currentStudent);
    }
    const drawerAvatar = document.getElementById("drawer-avatar");
    if (drawerAvatar) {
      renderStudentAvatar(drawerAvatar, currentStudent);
    }

    showToast("Profile picture updated successfully!", "success");
  } catch (err) {
    console.error("Avatar upload error:", err);
    showToast("Failed to upload avatar: " + (err.message || "Unknown error"), "error");
    if (profileContainer) {
      renderStudentAvatar(profileContainer, currentStudent);
    }
  } finally {
    event.target.value = '';
    if (window.lucide) lucide.createIcons();
  }
}

// 7. Student Auth System
async function handleLoginSubmit(event) {
  event.preventDefault();
  const regNo = document.getElementById("login-reg-no").value.trim().toUpperCase();
  const password = document.getElementById("login-password").value;

  showLoading(true);
  try {
    const { data: student, error } = await supabase
      .from('students')
      .select('*')
      .ilike('reg_no', regNo)
      .maybeSingle();

    showLoading(false);

    if (error) {
      showToast("Login error: " + error.message, "error");
      return;
    }
    if (!student) {
      showToast("Student with Register Number not found", "error");
      return;
    }

    if (student.password_hash !== password && student.password !== password) {
      showToast("Invalid register number or password", "error");
      return;
    }

    const { password_hash, ...studentSafe } = student;
    const resolvedPhone = student.phone || student.phone_number || '';
    const resolvedEmail = student.email || '';
    currentStudent = {
      ...studentSafe,
      phone: resolvedPhone,
      phone_number: resolvedPhone,
      email: resolvedEmail
    };

    // If Supabase Auth is active, check if user.email or user_metadata.phone can fill missing fields
    if (typeof supabase !== 'undefined' && supabase.auth) {
      try {
        const { data: authUserData } = await supabase.auth.getUser();
        const u = authUserData?.user;
        if (u && u.id === currentStudent.id) {
          const authEmail = u.email || '';
          const authPhone = u.user_metadata?.phone || u.user_metadata?.phone_number || u.phone || '';
          if (!currentStudent.email && authEmail) {
            currentStudent.email = authEmail;
            supabase.from('students').update({ email: authEmail }).eq('id', currentStudent.id).catch(() => {});
          }
          if (!currentStudent.phone && authPhone) {
            currentStudent.phone = authPhone;
            currentStudent.phone_number = authPhone;
            supabase.from('students').update({ phone: authPhone }).eq('id', currentStudent.id).catch(() => {});
          }
        }
      } catch (e) {}
    }

    // Sync extended profile attributes (phone, email, avatar)
    try {
      const authRes = await fetch('/api/auth?id=' + encodeURIComponent(student.id));
      const authData = await authRes.json();
      if (authData.success && authData.data) {
        currentStudent = { ...currentStudent, ...authData.data };
      }
    } catch (e) {}

    if (!currentStudent.avatar_url) {
      const localScoped = localStorage.getItem("student_avatar_" + currentStudent.id);
      if (localScoped) currentStudent.avatar_url = localScoped;
    }

    sessionStorage.setItem("session_student", JSON.stringify(currentStudent));
    updateDrawerInfo();
    setupRealtimeListener();

    showLoading(true);
    await fetchStudentOrders();
    showLoading(false);

    navigateHome();
    showToast(`Welcome back, ${currentStudent.name}!`, "success");
  } catch (err) {
    showLoading(false);
    console.error('Error logging in:', err);
    showToast("Login error. Please try again.", "error");
  }
}

async function handleRegisterSubmit(event) {
  event.preventDefault();
  const name = document.getElementById("reg-name").value.trim();
  const regNo = document.getElementById("reg-no").value.trim().toUpperCase();
  const phone = document.getElementById("reg-phone").value.trim().replace(/\D/g, '');
  const email = document.getElementById("reg-email").value.trim();
  const dept = document.getElementById("reg-dept").value.trim();
  const dob = document.getElementById("reg-dob").value;
  const password = document.getElementById("reg-password").value;

  const emailErrorEl = document.getElementById("reg-email-error");
  if (emailErrorEl) {
    emailErrorEl.innerText = "";
    emailErrorEl.classList.add("hidden");
  }

  if (phone.length !== 10) {
    showToast("Mobile number must be exactly 10 digits", "error");
    return;
  }

  // Enforce strictly mandatory email address
  if (!email) {
    if (emailErrorEl) {
      emailErrorEl.innerText = "Email address is required and cannot be left blank.";
      emailErrorEl.classList.remove("hidden");
    }
    showToast("Email address is strictly mandatory", "error");
    document.getElementById("reg-email")?.focus();
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    if (emailErrorEl) {
      emailErrorEl.innerText = "Please enter a valid email address (e.g. student@college.edu).";
      emailErrorEl.classList.remove("hidden");
    }
    showToast("Please enter a valid email address", "error");
    document.getElementById("reg-email")?.focus();
    return;
  }

  if (password.length < 6) {
    showToast("Password must be at least 6 characters", "error");
    return;
  }

  showLoading(true);
  try {
    const { data: existingReg } = await supabase
      .from('students')
      .select('id')
      .ilike('reg_no', regNo)
      .maybeSingle();

    if (existingReg) {
      showLoading(false);
      showToast("Register number already registered", "error");
      return;
    }

    // 1. Trigger Supabase Auth Sign Up FIRST
    if (!supabase || !supabase.auth) {
      throw new Error("Supabase client is not initialized.");
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();
    const cleanName = name.trim();

    const { data: authData, error: authError } = await supabase.auth.signUp({
      email: cleanEmail,
      password: password,
      options: {
        data: {
          phone: cleanPhone,
          name: cleanName,
          phone_number: cleanPhone,
          reg_no: regNo,
          department: dept,
          dob: dob
        }
      }
    });

    if (authError) {
      showLoading(false);
      const msg = authError.message || "";
      if (msg.toLowerCase().includes("already registered") || authError.status === 400 || authError.code === "user_already_exists") {
        if (emailErrorEl) {
          emailErrorEl.innerText = "This email is already registered in Supabase Authentication.";
          emailErrorEl.classList.remove("hidden");
        }
        showToast("This email is already registered. Please log in or reset your password.", "error");
        return;
      }
      if (authError.status === 429 || authError.code === "over_email_send_rate_limit") {
        showToast("Email send rate limit reached. Please wait a moment before trying again.", "error");
        return;
      }
      throw authError;
    }

    if (authData?.user && Array.isArray(authData.user.identities) && authData.user.identities.length === 0) {
      showLoading(false);
      if (emailErrorEl) {
        emailErrorEl.innerText = "This email is already registered in Supabase Authentication.";
        emailErrorEl.classList.remove("hidden");
      }
      showToast("This email is already registered. Please log in or reset your password.", "error");
      return;
    }

    const authUid = authData?.user?.id;
    if (!authUid) {
      throw new Error("Unable to retrieve Supabase Auth UID for new student.");
    }

    // 2. Link Auth UID to Student Profile & Upsert directly into public.students
    const studentRecord = {
      id: authUid,
      email: cleanEmail,
      phone: cleanPhone,
      name: cleanName,
      reg_no: regNo,
      department: dept,
      dob: dob,
      password_hash: password,
      wallet_balance: 0.00
    };

    let { error: insertErr } = await supabase
      .from('students')
      .upsert(studentRecord, { onConflict: 'id' });

    if (insertErr && (insertErr.code === 'PGRST204' || insertErr.message.includes('column'))) {
      console.warn("Retrying with alternate column mapping:", insertErr.message);
      const fallbackRecord = {
        id: authUid,
        email: cleanEmail,
        phone_number: cleanPhone,
        name: cleanName,
        reg_no: regNo,
        department: dept,
        dob: dob,
        password_hash: password,
        wallet_balance: 0.00
      };
      const retry = await supabase.from('students').upsert(fallbackRecord, { onConflict: 'id' });
      insertErr = retry.error;
    }

    showLoading(false);

    if (insertErr) {
      console.error("Database sync error:", insertErr);
      if (insertErr.code === '23505') {
        showToast("A student with this Register Number or ID already exists", "error");
        return;
      }
      showToast("Registration failed: " + insertErr.message, "error");
      return;
    }

    const newStudent = {
      ...studentRecord,
      phone_number: cleanPhone
    };

    // 3. Synchronize with extended backend profiles using the Auth UID
    try {
      await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'student-register',
          id: authUid,
          reg_no: regNo,
          name,
          department: dept,
          dob,
          password,
          phone_number: phone,
          email
        })
      });
    } catch (apiErr) {}

    currentStudent = {
      id: authUid,
      reg_no: regNo,
      name,
      department: dept,
      dob,
      phone_number: phone,
      email,
      wallet_balance: 0.00
    };
    sessionStorage.setItem("session_student", JSON.stringify(currentStudent));

    updateDrawerInfo();
    setupRealtimeListener();

    showLoading(true);
    await fetchStudentOrders();
    showLoading(false);

    navigateHome();
    showToast("🎉 Account created successfully!", "success");
  } catch (err) {
    showLoading(false);
    console.error('Error registering student:', err);
    showToast("Registration error. Please try again.", "error");
  }
}

function handleLogout() {
  if (ordersSubscription) {
    supabase.removeChannel(ordersSubscription);
    ordersSubscription = null;
  }
  currentStudent = null;
  cart = {};
  sessionStorage.removeItem("session_student");
  localStorage.removeItem("session_student");
  localStorage.removeItem("isGuest");
  localStorage.removeItem("guestStudent");
  router.navigateTo("login-screen");
  showToast("Logged out successfully", "success");
}

function toggleAuthTab(tab) {
  const loginBtn = document.getElementById("tab-login-btn");
  const regBtn = document.getElementById("tab-register-btn");
  const loginForm = document.getElementById("form-login");
  const regForm = document.getElementById("form-register");

  if (tab === "login") {
    loginBtn.classList.add("active");
    regBtn.classList.remove("active");
    loginForm.classList.remove("hidden");
    regForm.classList.add("hidden");
  } else {
    loginBtn.classList.remove("active");
    regBtn.classList.add("active");
    loginForm.classList.add("hidden");
    regForm.classList.remove("hidden");
  }
}

// Backward-compatibility switchAuthTab wrapper
function switchAuthTab(tab) {
  toggleAuthTab(tab);
}

// ----------------------------------------------------
// 7b. Supabase Auth OTP "Forgot Password" Flow (3-Minute Validity)
// ----------------------------------------------------
let fpCurrentEmail = "";
let fpTimerInterval = null;
let fpRemainingSeconds = 180; // 3 minutes = 180 seconds

function openForgotPasswordModal(event) {
  if (event) event.preventDefault();
  const modal = document.getElementById("forgot-password-modal");
  if (modal) modal.classList.remove("hidden");
  goToFpStep(1);
  const emailInput = document.getElementById("fp-email-input");
  const emailError = document.getElementById("fp-email-error");
  if (emailError) emailError.classList.add("hidden");
  if (emailInput) {
    emailInput.value = "";
    setTimeout(() => emailInput.focus(), 100);
  }
  if (window.lucide) lucide.createIcons();
}

function closeForgotPasswordModal() {
  const modal = document.getElementById("forgot-password-modal");
  if (modal) modal.classList.add("hidden");
  stopFpTimer();
  fpCurrentEmail = "";
  fpRemainingSeconds = 180;
}

function goToFpStep(step) {
  for (let i = 1; i <= 4; i++) {
    const el = document.getElementById(`fp-step-${i}`);
    if (el) {
      if (i === step) el.classList.remove("hidden");
      else el.classList.add("hidden");
    }
  }
  if (window.lucide) lucide.createIcons();
}

function stopFpTimer() {
  if (fpTimerInterval) {
    clearInterval(fpTimerInterval);
    fpTimerInterval = null;
  }
}

function formatFpTimer(seconds) {
  const mins = Math.floor(seconds / 60);
  const secs = seconds % 60;
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function startFpTimer(durationSeconds = 180) {
  stopFpTimer();
  fpRemainingSeconds = durationSeconds;

  const countdownEl = document.getElementById("fp-countdown");
  const verifyBtn = document.getElementById("fp-verify-btn");
  const resendBtn = document.getElementById("fp-resend-btn");
  const expiredBanner = document.getElementById("fp-expired-banner");
  const timerBox = document.getElementById("fp-timer-box");

  if (countdownEl) countdownEl.innerText = formatFpTimer(fpRemainingSeconds);
  if (verifyBtn) {
    verifyBtn.disabled = false;
    verifyBtn.classList.remove("opacity-50", "cursor-not-allowed");
  }
  if (resendBtn) resendBtn.disabled = true;
  if (expiredBanner) expiredBanner.classList.add("hidden");
  if (timerBox) timerBox.classList.remove("hidden");

  fpTimerInterval = setInterval(() => {
    fpRemainingSeconds--;
    if (countdownEl) countdownEl.innerText = formatFpTimer(fpRemainingSeconds);

    if (fpRemainingSeconds <= 0) {
      stopFpTimer();
      // Flag code as expired
      if (verifyBtn) {
        verifyBtn.disabled = true;
        verifyBtn.classList.add("opacity-50", "cursor-not-allowed");
      }
      if (resendBtn) resendBtn.disabled = false;
      if (expiredBanner) expiredBanner.classList.remove("hidden");
      if (window.lucide) lucide.createIcons();
      showFpOtpError("OTP has expired. Please request a fresh OTP.");
    }
  }, 1000);
}

function showFpOtpError(msg) {
  const errorBox = document.getElementById("fp-otp-error");
  const errorMsg = document.getElementById("fp-otp-error-msg");
  if (errorBox && errorMsg) {
    errorMsg.innerText = msg;
    errorBox.classList.remove("hidden");
    if (window.lucide) lucide.createIcons();
  }
  showToast(msg, 'error');
}

function hideFpOtpError() {
  const errorBox = document.getElementById("fp-otp-error");
  const errorMsg = document.getElementById("fp-otp-error-msg");
  if (errorBox) {
    errorBox.classList.add("hidden");
  }
  if (errorMsg) {
    errorMsg.innerText = "";
  }
}

// Helper to interact with backend Auth API (for public.students sync)
async function callAuthApi(payload) {
  try {
    const res = await fetch('/api/auth', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const json = await res.json();
    return json;
  } catch (err) {
    let endpoint = '';
    if (payload.action === 'forgot-password-reset') endpoint = '/api/student/forgot-password/reset-password';
    if (endpoint) {
      try {
        const res2 = await fetch(endpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload)
        });
        const json2 = await res2.json();
        return { success: json2.success || !json2.error, data: json2, error: json2.error };
      } catch (e) {}
    }
    return { success: false, error: err.message };
  }
}

// Step A: Email Input & OTP Dispatch via signInWithOtp
async function handleSendOtpSubmit(event) {
  event.preventDefault();
  const sendBtn = document.getElementById("fp-send-otp-btn");
  if (sendBtn) {
    sendBtn.disabled = true;
    sendBtn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></span> Dispatching OTP...`;
  }

  const emailInput = document.getElementById("fp-email-input");
  const emailError = document.getElementById("fp-email-error");
  const cleanEmail = emailInput ? emailInput.value.trim().toLowerCase() : "";

  if (emailError) {
    emailError.innerText = "";
    emailError.classList.add("hidden");
  }

  if (!cleanEmail) {
    if (emailError) {
      emailError.innerText = "Please enter your registered email address.";
      emailError.classList.remove("hidden");
    }
    showToast("Email address is required", "error");
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = `<i data-lucide="send" class="w-4 h-4"></i> Send 6-Digit OTP`;
      if (window.lucide) lucide.createIcons();
    }
    emailInput?.focus();
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(cleanEmail)) {
    if (emailError) {
      emailError.innerText = "Please enter a valid email address (e.g. student@college.edu).";
      emailError.classList.remove("hidden");
    }
    showToast("Invalid email address format", "error");
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = `<i data-lucide="send" class="w-4 h-4"></i> Send 6-Digit OTP`;
      if (window.lucide) lucide.createIcons();
    }
    emailInput?.focus();
    return;
  }

  try {
    if (!supabase || !supabase.auth) {
      throw new Error("Supabase Auth client is not initialized");
    }

    // Native signInWithOtp to issue a genuine email numeric code
    const { data, error } = await supabase.auth.signInWithOtp({
      email: cleanEmail,
      options: {
        shouldCreateUser: false // Strictly reject non-registered emails
      }
    });

    if (error) {
      const errMsg = error.message.includes('Signups not allowed')
        ? "No student account found with this email. Please register first."
        : error.message;
      if (emailError) {
        emailError.innerText = errMsg;
        emailError.classList.remove("hidden");
      }
      showToast(errMsg, "error");
      return;
    }

    fpCurrentEmail = cleanEmail;

    // Display target email on Step 2
    const displayEmail = document.getElementById("fp-display-email");
    if (displayEmail) displayEmail.innerText = cleanEmail;

    // Transition to verification screen and initialize 3:00 countdown timer
    goToFpStep(2);
    startFpTimer(180);
    hideFpOtpError();

    const otpInput = document.getElementById("fp-otp-input");
    if (otpInput) {
      otpInput.value = "";
      setTimeout(() => otpInput.focus(), 100);
    }

    showToast("🔑 Verification OTP sent to " + cleanEmail + "! Valid for 3:00 minutes.", "success");
  } catch (err) {
    console.error("Error dispatching OTP:", err);
    const errMsg = err.message || "Failed to dispatch recovery OTP. Account not found with this email.";
    if (emailError) {
      emailError.innerText = errMsg;
      emailError.classList.remove("hidden");
    }
    showToast(errMsg, "error");
  } finally {
    if (sendBtn) {
      sendBtn.disabled = false;
      sendBtn.innerHTML = `<i data-lucide="send" class="w-4 h-4"></i> Send 6-Digit OTP`;
      if (window.lucide) lucide.createIcons();
    }
  }
}

// Resend OTP handler within Step 2
async function handleResendOtp() {
  if (!fpCurrentEmail) {
    showToast("Session expired. Please enter your email again.", "error");
    goToFpStep(1);
    return;
  }

  const resendBtn = document.getElementById("fp-resend-btn");
  if (resendBtn) {
    resendBtn.disabled = true;
    resendBtn.innerText = "Sending...";
  }

  try {
    if (!supabase || !supabase.auth) {
      throw new Error("Supabase Auth client is not initialized");
    }

    const { data, error } = await supabase.auth.signInWithOtp({
      email: fpCurrentEmail,
      options: {
        shouldCreateUser: false
      }
    });

    if (error) {
      const errMsg = error.message.includes('Signups not allowed')
        ? "No account found with this email."
        : error.message;
      showFpOtpError(errMsg);
      return;
    }

    // Reset 3:00 countdown timer and re-enable verification
    startFpTimer(180);
    hideFpOtpError();

    const otpInput = document.getElementById("fp-otp-input");
    if (otpInput) {
      otpInput.value = "";
      otpInput.focus();
    }

    showToast("🔄 Fresh verification OTP sent to " + fpCurrentEmail + "! Valid for 3:00 minutes.", "success");
  } catch (e) {
    console.error("Resend OTP error:", e);
    showFpOtpError(e.message || "Failed to resend OTP");
  } finally {
    if (resendBtn) {
      resendBtn.disabled = false;
      resendBtn.innerText = "Resend OTP";
    }
  }
}

// Step B: Native Supabase OTP Verification (type: 'email')
async function handleVerifyOtpSubmit(event) {
  event.preventDefault();
  hideFpOtpError();

  if (fpRemainingSeconds <= 0) {
    showFpOtpError("OTP has expired. Please request a fresh OTP using 'Resend OTP'.");
    return;
  }

  const otpInput = document.getElementById("fp-otp-input");
  const cleanToken = otpInput ? otpInput.value.trim().replace(/\s+/g, '') : "";

  if (cleanToken.length !== 6) {
    showFpOtpError("Please enter the complete 6-digit OTP code");
    return;
  }

  const verifyBtn = document.getElementById("fp-verify-btn");
  if (verifyBtn) {
    verifyBtn.disabled = true;
    verifyBtn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></span> Verifying...`;
  }

  try {
    if (!supabase || !supabase.auth) {
      throw new Error("Supabase Auth client is not initialized");
    }

    const cleanEmail = fpCurrentEmail.trim().toLowerCase();

    // Direct Native Supabase Auth OTP verification (type: 'email')
    const { data, error } = await supabase.auth.verifyOtp({
      email: cleanEmail,
      token: cleanToken,
      type: 'email'
    });

    if (error) {
      showFpOtpError(error.message || "Invalid or expired verification code. Please check and try again.");
      return;
    }

    // On success, Supabase creates an active authenticated session.
    // Stop timer, clear errors, and immediately transition to "New Password" inputs.
    stopFpTimer();
    hideFpOtpError();
    goToFpStep(3);

    const newPwdInput = document.getElementById("fp-new-pwd");
    if (newPwdInput) {
      newPwdInput.value = "";
      setTimeout(() => newPwdInput.focus(), 100);
    }
    const confirmPwdInput = document.getElementById("fp-confirm-pwd");
    if (confirmPwdInput) confirmPwdInput.value = "";

    showToast("✅ Code verified! Create your new password.", "success");
  } catch (err) {
    console.error("OTP verification error:", err);
    const msg = err.message || "Invalid or expired verification code. Please check and try again.";
    showFpOtpError(msg);
  } finally {
    if (verifyBtn && fpRemainingSeconds > 0) {
      verifyBtn.disabled = false;
      verifyBtn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i> Verify OTP`;
      if (window.lucide) lucide.createIcons();
    }
  }
}

// Step C: Password Reset, Sign Out & Cleanup
async function handleResetPasswordSubmit(event) {
  event.preventDefault();
  const newPwd = document.getElementById("fp-new-pwd")?.value || "";
  const confirmPwd = document.getElementById("fp-confirm-pwd")?.value || "";

  if (newPwd.length < 6) {
    showToast("New password must be at least 6 characters", "error");
    return;
  }

  if (newPwd !== confirmPwd) {
    showToast("Passwords do not match!", "error");
    return;
  }

  const submitBtn = document.getElementById("fp-submit-pwd-btn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></span> Updating...`;
  }

  try {
    if (!supabase || !supabase.auth) {
      throw new Error("Supabase client is not initialized");
    }

    // 1. Update password in Supabase Auth (authenticated via verifyOtp session)
    const newPassword = newPwd;
    const { error } = await supabase.auth.updateUser({
      password: newPassword
    });

    if (error) {
      throw error;
    }

    // 2. Sync to public.students table so student reg_no/password login remains consistent
    try {
      await supabase
        .from('students')
        .update({ password_hash: newPassword })
        .ilike('email', fpCurrentEmail);
    } catch (dbErr) {
      console.warn("Notice: public.students password sync:", dbErr);
    }

    // 3. Fallback sync to local API if applicable
    try {
      await callAuthApi({
        action: 'forgot-password-reset',
        email: fpCurrentEmail,
        new_password: newPassword
      });
    } catch (apiErr) {}

    // 4. Once updated, call signOut to cleanly end the reset session
    try {
      await supabase.auth.signOut();
    } catch (soErr) {}

    // Transition to Confirmation step
    goToFpStep(4);
    showToast("Password updated successfully! Please login", "success");

    // Cleanly clear temporary reset state
    stopFpTimer();
    fpCurrentEmail = "";
    fpRemainingSeconds = 180;

    // Automatic redirection to login after 2.2 seconds
    setTimeout(() => {
      closeForgotPasswordModal();
      switchAuthTab('login');
    }, 2200);
  } catch (err) {
    console.error("Password reset error:", err);
    showToast("Error updating password: " + (err.message || "Unknown error"), "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i data-lucide="shield-check" class="w-4 h-4"></i> Change Password`;
      if (window.lucide) lucide.createIcons();
    }
  }
}

// Automatically detect if user authenticated via email link or existing session
if (supabase && supabase.auth) {
  supabase.auth.onAuthStateChange((event, session) => {
    if ((event === 'SIGNED_IN' || event === 'PASSWORD_RECOVERY') && session && session.user) {
      const modal = document.getElementById("forgot-password-modal");
      if (modal && !modal.classList.contains("hidden")) {
        if (!fpCurrentEmail && session.user.email) {
          fpCurrentEmail = session.user.email;
        }
        stopFpTimer();
        hideFpOtpError();
        goToFpStep(3);
        showToast("✅ Authenticated! Create your new password.", "success");
      }
    }
  });
}

function togglePasswordVisibility(inputId, toggleEl) {
  const input = document.getElementById(inputId);
  const icon = toggleEl.querySelector('i');
  if (input.type === "password") {
    input.type = "text";
    icon.setAttribute("data-lucide", "eye-off");
  } else {
    input.type = "password";
    icon.setAttribute("data-lucide", "eye");
  }
  lucide.createIcons();
}

// 8. Search & Product Listing System
function handleHomeSearch(val) {
  searchProducts(val);
}

function searchProducts(val) {
  const query = val.trim().toLowerCase();
  const searchWrapper = document.getElementById("search-results-wrapper");
  const mainContent = document.getElementById("home-main-content");
  const resultsList = document.getElementById("search-results-list");

  if (!query) {
    if (searchWrapper) searchWrapper.classList.add("hidden");
    if (mainContent) mainContent.classList.remove("hidden");
    return;
  }

  if (searchWrapper) searchWrapper.classList.remove("hidden");
  if (mainContent) mainContent.classList.add("hidden");

  const matched = products.filter(p => p.name.toLowerCase().includes(query) || p.barcode_id.toLowerCase().includes(query));

  if (matched.length === 0) {
    if (resultsList) resultsList.innerHTML = `<div class="text-center py-8 text-xs text-text-secondary">No matching products found.</div>`;
    return;
  }

  if (resultsList) {
    resultsList.innerHTML = matched.map(item => {
      const qty = cart[item.id] || 0;
      const isOutOfStock = item.stock_quantity === 0;
      const isLowStock = item.stock_quantity > 0 && item.stock_quantity <= 5;
      
      let stockBadgeHTML = '';
      let quantitySelectorHTML = '';

      if (isOutOfStock) {
        stockBadgeHTML = `<span class="badge-out-of-stock">Out of Stock</span>`;
        quantitySelectorHTML = `<span class="text-xs text-secondary font-bold font-poppins">Out of Stock</span>`;
      } else {
        if (isLowStock) stockBadgeHTML = `<span class="badge-low-stock">⚠️ Only a few left!</span>`;
        
        if (qty === 0) {
          quantitySelectorHTML = `<button onclick="updateCartQty('${item.id}', 1)" class="btn-primary py-1 px-4 text-xs font-semibold rounded-lg" ${!isCanteenOpen ? 'disabled' : ''}>Add</button>`;
        } else {
          quantitySelectorHTML = `
            <div class="flex items-center gap-2">
              <button onclick="updateCartQty('${item.id}', ${qty - 1})" class="qty-btn bg-slate-100 hover:bg-slate-200 text-text-primary">-</button>
              <span class="font-bold text-sm text-text-primary w-4 text-center">${qty}</span>
              <button onclick="updateCartQty('${item.id}', ${qty + 1})" class="qty-btn bg-primary text-white hover:bg-primary-dark" ${qty >= item.stock_quantity || !isCanteenOpen ? 'disabled' : ''}>+</button>
            </div>
          `;
        }
      }

      return `
        <div class="card-premium p-4 flex gap-4 relative items-center ${isOutOfStock ? 'opacity-70' : ''}">
          <div class="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0">
            <img src="${item.image_url}" alt="${item.name}" class="w-full h-full object-cover">
          </div>
          <div class="flex-1 flex flex-col justify-between h-20 py-0.5 min-w-0">
            <div>
              <h4 class="font-bold text-xs truncate text-text-primary">${item.name}</h4>
              <p class="text-xs text-text-secondary mt-1">₹${item.price.toFixed(2)}</p>
            </div>
            <div class="flex items-center justify-between mt-1">
              <div class="min-h-[22px]">${stockBadgeHTML}</div>
              <div>${quantitySelectorHTML}</div>
            </div>
          </div>
        </div>
      `;
    }).join('');
  }
}

function clearSearch() {
  const input = document.getElementById("home-search-input");
  if (input) input.value = "";
  searchProducts("");
}

function startVoiceSearch() {
  showToast("Voice search activated...", "success");
}

function renderFrequentlyBought() {
  const container = document.getElementById("frequent-list");
  if (!container) return;
  const topItems = products.filter(p => p.stock_quantity > 0).slice(0, 3);
  
  container.innerHTML = topItems.map(item => `
    <div class="snap-start flex-shrink-0 w-36 bg-white card-premium p-3 flex flex-col justify-between" onclick="addQuickItem('${item.id}')">
      <div class="relative w-full h-20 rounded-xl overflow-hidden mb-2 bg-slate-100">
        <img src="${item.image_url}" alt="${item.name}" class="w-full h-full object-cover">
      </div>
      <div>
        <h4 class="font-bold text-xs truncate text-text-primary mb-1">${item.name}</h4>
        <div class="flex justify-between items-center mt-1">
          <span class="text-xs font-extrabold text-primary-dark">₹${item.price.toFixed(0)}</span>
          <button class="bg-primary/10 text-primary-dark w-6 h-6 rounded-full flex items-center justify-center font-bold text-xs hover:bg-primary hover:text-white transition-colors">
            +
          </button>
        </div>
      </div>
    </div>
  `).join('');
}

function addQuickItem(prodId) {
  if (!isCanteenOpen) {
    showToast("Canteen is closed. Cannot add items.", "error");
    return;
  }
  const prod = products.find(p => p.id === prodId);
  if (!prod || prod.stock_quantity === 0) {
    showToast("Item is out of stock", "error");
    return;
  }
  cart[prodId] = (cart[prodId] || 0) + 1;
  updateCartBadge();
  showToast(`${prod.name} added to cart!`, "success");
}

function renderCategoriesGrid() {
  const container = document.getElementById("categories-list");
  if (!container) return;
  if (categories.length === 0) {
    container.innerHTML = `<div class="col-span-full text-center py-12 text-xs text-text-secondary">No categories available yet. Contact Canteen Manager.</div>`;
    return;
  }
  container.innerHTML = categories.map(cat => `
    <div class="card-premium p-4 flex flex-col items-center justify-center text-center cursor-pointer aspect-square hover:border-primary/30" onclick="navigateToCategory('${cat.id}')">
      <span class="text-3xl mb-2">${cat.icon_url || cat.icon || '📦'}</span>
      <span class="text-xs font-semibold text-text-primary leading-tight font-poppins">${cat.name}</span>
    </div>
  `).join('');
}

function navigateHome() {
  try {
    renderFrequentlyBought();
  } catch (e) {
    console.error("Error rendering frequently bought:", e);
  }
  try {
    renderCategoriesGrid();
  } catch (e) {
    console.error("Error rendering categories grid:", e);
  }
  try {
    updateCartBadge();
  } catch (e) {
    console.error("Error updating cart badge:", e);
  }
  navigateTo("home-screen");
}

function navigateToCategory(catId) {
  try {
    currentCategory = categories.find(c => c.id === catId);
    if (!currentCategory) {
      navigateTo("home-screen");
      return;
    }
    
    const catTitle = document.getElementById("category-title");
    if (catTitle) catTitle.innerText = currentCategory.name;
    
    currentSort = "default";
    const sortSelect = document.getElementById("sort-select");
    if (sortSelect) sortSelect.value = "default";
    
    renderCategoryProducts();
    updateCategoryFloatingBar();
  } catch (e) {
    console.error("Error navigating to category:", e);
  }
  navigateTo("category-screen");
}

function renderCategoryProducts() {
  const container = document.getElementById("category-products-list");
  if (!container) return;
  let filtered = products.filter(p => p.category_id === currentCategory.id);
  
  if (currentSort === "price-asc") {
    filtered.sort((a, b) => a.price - b.price);
  } else if (currentSort === "price-desc") {
    filtered.sort((a, b) => b.price - a.price);
  } else if (currentSort === "popularity") {
    filtered.sort((a, b) => b.stock_quantity - a.stock_quantity);
  }

  if (filtered.length === 0) {
    container.innerHTML = `<div class="text-center py-12 text-xs text-text-secondary">No items listed in this category yet.</div>`;
    return;
  }

  container.innerHTML = filtered.map(item => {
    const qty = cart[item.id] || 0;
    const isOutOfStock = item.stock_quantity === 0;
    const isLowStock = item.stock_quantity > 0 && item.stock_quantity <= 5;
    
    let stockBadgeHTML = '';
    let quantitySelectorHTML = '';

    if (isOutOfStock) {
      stockBadgeHTML = `<span class="badge-out-of-stock">Out of Stock</span>`;
      quantitySelectorHTML = `<span class="text-xs text-secondary font-bold font-poppins">Out of Stock</span>`;
    } else {
      if (isLowStock) stockBadgeHTML = `<span class="badge-low-stock">⚠️ Only a few left!</span>`;
      
      if (qty === 0) {
        quantitySelectorHTML = `<button onclick="updateCartQty('${item.id}', 1)" class="btn-primary py-1 px-4 text-xs font-semibold rounded-lg" ${!isCanteenOpen ? 'disabled' : ''}>Add</button>`;
      } else {
        quantitySelectorHTML = `
          <div class="flex items-center gap-2">
            <button onclick="updateCartQty('${item.id}', ${qty - 1})" class="qty-btn bg-slate-100 hover:bg-slate-200 text-text-primary">-</button>
            <span class="font-bold text-sm text-text-primary w-4 text-center">${qty}</span>
            <button onclick="updateCartQty('${item.id}', ${qty + 1})" class="qty-btn bg-primary text-white hover:bg-primary-dark" ${qty >= item.stock_quantity || !isCanteenOpen ? 'disabled' : ''}>+</button>
          </div>
        `;
      }
    }

    return `
      <div class="card-premium p-4 flex gap-4 relative items-center ${isOutOfStock ? 'opacity-70' : ''}">
        <div class="w-20 h-20 rounded-xl overflow-hidden bg-slate-100 flex-shrink-0">
          <img src="${item.image_url}" alt="${item.name}" class="w-full h-full object-cover">
        </div>
        <div class="flex-1 flex flex-col justify-between h-20 py-0.5 min-w-0">
          <div>
            <h4 class="font-bold text-xs truncate text-text-primary">${item.name}</h4>
            <p class="text-xs text-text-secondary mt-1">₹${item.price.toFixed(2)}</p>
          </div>
          <div class="flex items-center justify-between mt-1">
            <div class="min-h-[22px]">${stockBadgeHTML}</div>
            <div>${quantitySelectorHTML}</div>
          </div>
        </div>
      </div>
    `;
  }).join('');
}

function handleSortChange(val) {
  currentSort = val;
  renderCategoryProducts();
}

function updateCartQty(prodId, newQty) {
  if (!isCanteenOpen && newQty > (cart[prodId] || 0)) {
    showToast("Canteen is closed. Cannot add items.", "error");
    return;
  }
  const prod = products.find(p => p.id === prodId);
  if (!prod) return;

  if (newQty > prod.stock_quantity) {
    showToast(`Only ${prod.stock_quantity} items available in stock.`, "error");
    return;
  }

  if (newQty <= 0) {
    delete cart[prodId];
  } else {
    cart[prodId] = newQty;
  }

  if (currentCategory) renderCategoryProducts();
  
  const searchInput = document.getElementById("home-search-input");
  if (searchInput && searchInput.value.trim()) {
    searchProducts(searchInput.value);
  }

  if (document.getElementById("cart-screen").classList.contains("active")) {
    renderCartScreen();
  }

  updateCategoryFloatingBar();
  updateCartBadge();
}


function updateCategoryFloatingBar() {
  const floatingBar = document.getElementById("category-floating-bar");
  if (!floatingBar) return;
  
  let totalCount = 0;
  let totalPrice = 0.00;
  
  Object.keys(cart).forEach(id => {
    const prod = products.find(p => p.id === id);
    if (prod) {
      totalCount += cart[id];
      totalPrice += prod.price * cart[id];
    }
  });

  if (totalCount > 0) {
    floatingBar.classList.remove("hidden");
    document.getElementById("floating-cart-count").innerText = totalCount;
    document.getElementById("floating-cart-total").innerText = totalPrice.toFixed(2);
  } else {
    floatingBar.classList.add("hidden");
  }
}

function updateCartBadge() {
  const badge = document.getElementById("cart-badge");
  if (!badge) return;
  let totalCount = 0;
  Object.keys(cart).forEach(id => {
    totalCount += cart[id];
  });

  if (totalCount > 0) {
    badge.innerText = totalCount;
    badge.classList.remove("scale-0");
    badge.classList.add("scale-100");
  } else {
    badge.classList.remove("scale-100");
    badge.classList.add("scale-0");
  }
}

// 9. Cart Screen, History & UPI Verification
function navigateToCart() {
  pendingOrderToken = "";
  switchCartTab("current");
  showScreen("cart-screen");
}


function goBackFromCart() {
  if (currentCategory) {
    navigateToCategory(currentCategory.id);
  } else {
    navigateHome();
  }
}

async function switchCartTab(tab) {
  const currentTabBtn = document.getElementById("cart-tab-current");
  const historyTabBtn = document.getElementById("cart-tab-history");
  const currentView = document.getElementById("cart-current-view");
  const historyView = document.getElementById("cart-history-view");

  if (!currentTabBtn || !historyTabBtn || !currentView || !historyView) return;

  if (tab === "current") {
    currentTabBtn.classList.add("border-primary", "text-primary");
    currentTabBtn.classList.remove("border-transparent", "text-text-secondary");
    historyTabBtn.classList.remove("border-primary", "text-primary");
    historyTabBtn.classList.add("border-transparent", "text-text-secondary");
    currentView.classList.remove("hidden");
    historyView.classList.add("hidden");
    renderCartScreen();
  } else {
    historyTabBtn.classList.add("border-primary", "text-primary");
    historyTabBtn.classList.remove("border-transparent", "text-text-secondary");
    currentTabBtn.classList.remove("border-primary", "text-primary");
    currentTabBtn.classList.add("border-transparent", "text-text-secondary");
    
    showLoading(true);
    await fetchStudentOrders();
    showLoading(false);
    
    historyView.classList.remove("hidden");
    currentView.classList.add("hidden");
    renderCartHistoryView();
  }
}

function renderCartScreen() {
  const itemsContainer = document.getElementById("cart-items-list");
  let totalAmount = 0;
  let itemsCount = 0;
  const cartItemKeys = Object.keys(cart);

  if (cartItemKeys.length === 0) {
    if (itemsContainer) {
      itemsContainer.innerHTML = `
        <div class="text-center py-16">
          <i data-lucide="shopping-cart" class="w-12 h-12 text-slate-300 mx-auto mb-3"></i>
          <p class="text-xs text-text-secondary">Your basket is empty.</p>
          <button class="btn-primary mt-6 mx-auto px-6 py-2 text-xs" onclick="navigateHome()">Shop Now</button>
        </div>
      `;
    }
    document.getElementById("place-order-btn").disabled = true;
    document.getElementById("cart-subtotal").innerText = "₹0.00";
    document.getElementById("cart-total-amount").innerText = "₹0.00";
    return;
  }

  document.getElementById("place-order-btn").disabled = false;
  
  if (itemsContainer) {
    itemsContainer.innerHTML = cartItemKeys.map(prodId => {
      const item = products.find(p => p.id === prodId);
      const qty = cart[prodId];
      const sub = item.price * qty;
      totalAmount += sub;
      itemsCount += qty;

      return `
        <div class="card-premium p-4 flex gap-4 items-center">
          <img src="${item.image_url}" alt="${item.name}" class="w-14 h-14 rounded-lg object-cover flex-shrink-0">
          <div class="flex-1 min-w-0">
            <h4 class="font-bold text-xs truncate text-text-primary">${item.name}</h4>
            <p class="text-xs text-text-secondary mt-1">₹${item.price.toFixed(2)}</p>
          </div>
          <div class="flex items-center gap-2 flex-shrink-0">
            <button onclick="updateCartQty('${item.id}', ${qty - 1})" class="qty-btn bg-slate-100 hover:bg-slate-200 text-text-primary w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold">-</button>
            <span class="font-bold text-xs text-text-primary w-4 text-center">${qty}</span>
            <button onclick="updateCartQty('${item.id}', ${qty + 1})" class="qty-btn bg-primary text-white hover:bg-primary-dark w-6 h-6 flex items-center justify-center rounded-full text-xs font-bold" ${qty >= item.stock_quantity || !isCanteenOpen ? 'disabled' : ''}>+</button>
          </div>
          <div class="text-right ml-2 min-w-[60px] flex-shrink-0">
            <p class="font-bold text-xs text-primary-dark">₹${sub.toFixed(2)}</p>
            <button onclick="removeCartItem('${item.id}')" class="text-secondary hover:text-red-700 text-[10px] font-semibold mt-1">Remove</button>
          </div>
        </div>
      `;
    }).join('');
  }

  document.getElementById("cart-subtotal").innerText = `₹${totalAmount.toFixed(2)}`;
  document.getElementById("cart-total-amount").innerText = `₹${totalAmount.toFixed(2)}`;
  
  if (!pendingOrderToken) {
    const tokenSeq = Math.floor(Math.random() * 900) + 100;
    pendingOrderToken = `#TK-${tokenSeq}`;
  }

  togglePaymentSelection(currentPaymentMode);
}

function removeCartItem(prodId) {
  delete cart[prodId];
  renderCartScreen();
  updateCartBadge();
  updateCategoryFloatingBar();
}

function startCashCountdown() {
  if (cashCountdownInterval) clearInterval(cashCountdownInterval);
  let timeRemaining = 30 * 60; // 30 minutes
  
  function updateTimerText() {
    const minutes = Math.floor(timeRemaining / 60);
    const seconds = timeRemaining % 60;
    const formattedTime = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    const el = document.getElementById("cash-timer-countdown");
    if (el) el.innerText = formattedTime;
  }
  
  updateTimerText();
  cashCountdownInterval = setInterval(() => {
    timeRemaining--;
    if (timeRemaining <= 0) {
      clearInterval(cashCountdownInterval);
      timeRemaining = 0;
    }
    updateTimerText();
  }, 1000);
}

function togglePaymentSelection(mode) {
  currentPaymentMode = mode === "UPI" ? "UPI" : "CASH";
  const cashCard = document.getElementById("payment-cash-card");
  const upiCard = document.getElementById("payment-upi-card");
  const cashInd = document.getElementById("cash-indicator");
  const upiInd = document.getElementById("upi-indicator");
  const bannerIcon = document.getElementById("payment-banner-icon");
  const bannerTitle = document.getElementById("payment-banner-title");
  const bannerDesc = document.getElementById("payment-banner-desc");
  const placeOrderBtn = document.getElementById("place-order-btn");

  let grandTotal = 0;
  Object.keys(cart).forEach(id => {
    const prod = products.find(p => p.id === id);
    if (prod) grandTotal += prod.price * cart[id];
  });

  if (currentPaymentMode === "CASH") {
    if (cashCard) cashCard.className = "card-premium p-4 flex flex-col justify-between cursor-pointer border-2 border-emerald-500 bg-emerald-500/[0.04] relative transition-all";
    if (upiCard) upiCard.className = "card-premium p-4 flex flex-col justify-between cursor-pointer border-2 border-slate-100 bg-white relative transition-all";
    if (cashInd) cashInd.className = "w-2.5 h-2.5 rounded-full bg-emerald-500 ring-4 ring-emerald-500/20";
    if (upiInd) upiInd.className = "w-2.5 h-2.5 rounded-full bg-slate-300 ring-0";
    if (bannerIcon) bannerIcon.setAttribute("data-lucide", "banknote");
    if (bannerTitle) bannerTitle.innerText = "Cash Payment at Counter";
    if (bannerDesc) bannerDesc.innerText = `Please pay exact cash (₹${grandTotal.toFixed(2)}) at the canteen counter within 30 minutes of ordering to collect your items.`;
    if (placeOrderBtn) {
      placeOrderBtn.disabled = grandTotal <= 0 || !isCanteenOpen;
      placeOrderBtn.className = "w-full btn-primary bg-emerald-600 hover:bg-emerald-700 text-white font-bold py-3.5 px-6 rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all";
      placeOrderBtn.innerHTML = `<i data-lucide="banknote" class="w-5 h-5"></i> Place Order - Pay Cash at Counter (₹${grandTotal.toFixed(2)})`;
    }
    startCashCountdown();
  } else {
    // UPI Mode
    if (cashCard) cashCard.className = "card-premium p-4 flex flex-col justify-between cursor-pointer border-2 border-slate-100 bg-white relative transition-all";
    if (upiCard) upiCard.className = "card-premium p-4 flex flex-col justify-between cursor-pointer border-2 border-blue-500 bg-blue-500/[0.04] relative transition-all";
    if (cashInd) cashInd.className = "w-2.5 h-2.5 rounded-full bg-slate-300 ring-0";
    if (upiInd) upiInd.className = "w-2.5 h-2.5 rounded-full bg-blue-500 ring-4 ring-blue-500/20";
    if (bannerIcon) bannerIcon.setAttribute("data-lucide", "smartphone");
    if (bannerTitle) bannerTitle.innerText = "Scan UPI QR at Counter";
    if (bannerDesc) bannerDesc.innerText = `Scan the canteen UPI QR code (₹${grandTotal.toFixed(2)}) using any UPI app (GPay, PhonePe, Paytm) upon order pickup.`;
    if (placeOrderBtn) {
      placeOrderBtn.disabled = grandTotal <= 0 || !isCanteenOpen;
      placeOrderBtn.className = "w-full btn-primary bg-blue-600 hover:bg-blue-700 text-white font-bold py-3.5 px-6 rounded-xl flex items-center justify-center gap-2 shadow-lg transition-all";
      placeOrderBtn.innerHTML = `<i data-lucide="smartphone" class="w-5 h-5"></i> Place Order - Scan UPI at Counter (₹${grandTotal.toFixed(2)})`;
    }
    if (cashCountdownInterval) {
      clearInterval(cashCountdownInterval);
      cashCountdownInterval = null;
    }
  }
  lucide.createIcons();
}

// ----------------------------------------------------
// 10. STUDENT COUNTER CHECKOUT HANDLER
// ----------------------------------------------------

function handleCheckoutClick() {
  if (!currentStudent) {
    showToast("Please log in to proceed with checkout", "error");
    showScreen("login-screen");
    return;
  }

  if (!isCanteenOpen) {
    showToast("Canteen is currently CLOSED. Orders cannot be placed.", "error");
    return;
  }

  const cartKeys = Object.keys(cart);
  if (cartKeys.length === 0) {
    showToast("Your cart is empty!", "error");
    return;
  }

  placeOrder();
}

function getCartPayload() {
  let grandTotal = 0;
  const orderItemsList = [];

  for (let prodId of Object.keys(cart)) {
    const prod = products.find(p => p.id === prodId);
    if (prod && cart[prodId] > 0) {
      grandTotal += prod.price * cart[prodId];
      orderItemsList.push({
        product_id: prodId,
        quantity: cart[prodId],
        unit_price: prod.price
      });
    }
  }

  return { grandTotal, orderItemsList };
}

async function openPaymentGatewayModal() {
  const { grandTotal, orderItemsList } = getCartPayload();
  if (orderItemsList.length === 0) {
    showToast("Cart is empty", "error");
    return;
  }

  const txnRef = `TXN_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const upiPa = 'cmscecanteen@upi';
  const upiPn = 'CMSCE Canteen';
  const upiIntentUrl = `upi://pay?pa=${encodeURIComponent(upiPa)}&pn=${encodeURIComponent(upiPn)}&am=${grandTotal.toFixed(2)}&cu=INR&tr=${encodeURIComponent(txnRef)}&tn=${encodeURIComponent('Canteen Order ' + txnRef)}`;

  activePaymentSession = {
    txn_ref: txnRef,
    amount: grandTotal,
    student_id: currentStudent ? currentStudent.id : null,
    items: orderItemsList,
    upi_intent_url: upiIntentUrl,
    created_at: Date.now()
  };

  const modalAmountEl = document.getElementById("pg-modal-amount");
  const intentBtnAmtEl = document.getElementById("pg-intent-btn-amount");
  const qrAmtDisplay = document.getElementById("pg-qr-amount-display");
  const txnRefEl = document.getElementById("pg-upi-txn-ref");

  if (modalAmountEl) modalAmountEl.innerText = `₹${grandTotal.toFixed(2)}`;
  if (intentBtnAmtEl) intentBtnAmtEl.innerText = `${grandTotal.toFixed(2)}`;
  if (qrAmtDisplay) qrAmtDisplay.innerText = `${grandTotal.toFixed(2)}`;
  if (txnRefEl) txnRefEl.innerText = txnRef;

  const intentLink = document.getElementById("pg-upi-intent-link");
  if (intentLink) intentLink.href = upiIntentUrl;

  const modal = document.getElementById("payment-gateway-modal");
  if (modal) modal.classList.remove("hidden");

  switchPaymentGatewayTab('upi_app');
  lucide.createIcons();
}

function closePaymentGatewayModal() {
  stopDynamicQrTimers();
  const modal = document.getElementById("payment-gateway-modal");
  if (modal) modal.classList.add("hidden");
  activePaymentSession = null;
}

function stopDynamicQrTimers() {
  if (qrExpiryCountdownInterval) {
    clearInterval(qrExpiryCountdownInterval);
    qrExpiryCountdownInterval = null;
  }
  if (qrStatusPollInterval) {
    clearInterval(qrStatusPollInterval);
    qrStatusPollInterval = null;
  }
}

function switchPaymentGatewayTab(tab) {
  paymentGatewayTab = tab;

  const btnUpiApp = document.getElementById("tab-btn-upi-app");
  const btnDynamicQr = document.getElementById("tab-btn-dynamic-qr");
  const contentUpiApp = document.getElementById("tab-content-upi-app");
  const contentDynamicQr = document.getElementById("tab-content-dynamic-qr");

  if (tab === "upi_app") {
    // 1. Highlight Tab 1
    if (btnUpiApp) btnUpiApp.className = "payment-tab-btn active py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all";
    if (btnDynamicQr) btnDynamicQr.className = "payment-tab-btn py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all";
    if (contentUpiApp) contentUpiApp.classList.remove("hidden");
    if (contentDynamicQr) contentDynamicQr.classList.add("hidden");

    // 2. STRICT SESSION EXCLUSIVITY: Stop any active QR timer & polling immediately
    stopDynamicQrTimers();

    // Clear dynamic QR canvas to ensure zero double-payment risk
    const qrCanvas = document.getElementById("pg-dynamic-qr-canvas");
    if (qrCanvas) {
      const ctx = qrCanvas.getContext('2d');
      if (ctx) ctx.clearRect(0, 0, qrCanvas.width, qrCanvas.height);
    }
  } else {
    // 1. Highlight Tab 2
    if (btnDynamicQr) btnDynamicQr.className = "payment-tab-btn active py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all";
    if (btnUpiApp) btnUpiApp.className = "payment-tab-btn py-2.5 px-3 rounded-xl text-xs font-bold flex items-center justify-center gap-1.5 transition-all";
    if (contentDynamicQr) contentDynamicQr.classList.remove("hidden");
    if (contentUpiApp) contentUpiApp.classList.add("hidden");

    // 2. Render fresh Dynamic QR Code and start 3-minute Countdown with Auto-Expiry
    renderDynamicQrAndStartCountdown();
  }

  lucide.createIcons();
}

function renderDynamicQrAndStartCountdown() {
  if (!activePaymentSession || !activePaymentSession.upi_intent_url) return;

  stopDynamicQrTimers();

  // Hide expired overlay if previously shown
  const expiredOverlay = document.getElementById("pg-qr-expired-overlay");
  if (expiredOverlay) expiredOverlay.classList.add("hidden");

  // Render QR Code to Canvas
  const qrCanvas = document.getElementById("pg-dynamic-qr-canvas");
  const qrImage = document.getElementById("pg-dynamic-qr-image");
  const upiPayload = activePaymentSession.upi_intent_url;

  if (qrCanvas && typeof QRCode !== 'undefined' && QRCode.toCanvas) {
    QRCode.toCanvas(qrCanvas, upiPayload, {
      width: 160,
      margin: 1,
      color: { dark: '#0F172A', light: '#FFFFFF' }
    }, function (err) {
      if (err && qrImage) {
        qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiPayload)}`;
        qrImage.classList.remove("hidden");
        qrCanvas.classList.add("hidden");
      } else if (qrImage) {
        qrImage.classList.add("hidden");
        qrCanvas.classList.remove("hidden");
      }
    });
  } else if (qrImage) {
    qrImage.src = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(upiPayload)}`;
    qrImage.classList.remove("hidden");
    if (qrCanvas) qrCanvas.classList.add("hidden");
  }

  // 3-Minute (180s) Live Countdown
  let remainingSeconds = DYNAMIC_QR_DURATION_SECONDS;
  const countdownTextEl = document.getElementById("pg-qr-countdown-text");
  const progressBarEl = document.getElementById("pg-qr-progress-bar");

  function updateCountdownUI() {
    const mins = Math.floor(remainingSeconds / 60);
    const secs = remainingSeconds % 60;
    const formatted = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
    if (countdownTextEl) countdownTextEl.innerText = formatted;

    const percent = Math.max(0, (remainingSeconds / DYNAMIC_QR_DURATION_SECONDS) * 100);
    if (progressBarEl) progressBarEl.style.width = `${percent}%`;
  }

  updateCountdownUI();

  qrExpiryCountdownInterval = setInterval(() => {
    remainingSeconds--;
    if (remainingSeconds <= 0) {
      stopDynamicQrTimers();
      remainingSeconds = 0;
      updateCountdownUI();
      // Show EXPIRED overlay
      if (expiredOverlay) expiredOverlay.classList.remove("hidden");
      showToast("Dynamic QR expired. Tap 'Refresh QR' to generate a new session.", "error");
    } else {
      updateCountdownUI();
    }
  }, 1000);

  // Dynamic QR Countdown timer (Client-side auto-expiry)
  // Student clicks 'I Have Paid' button to confirm verification
}

async function refreshDynamicQrSession() {
  const { grandTotal, orderItemsList } = getCartPayload();
  if (orderItemsList.length === 0) return;

  const txnRef = `TXN_${Date.now()}_${Math.floor(1000 + Math.random() * 9000)}`;
  const upiPa = 'cmscecanteen@upi';
  const upiPn = 'CMSCE Canteen';
  const upiIntentUrl = `upi://pay?pa=${encodeURIComponent(upiPa)}&pn=${encodeURIComponent(upiPn)}&am=${grandTotal.toFixed(2)}&cu=INR&tr=${encodeURIComponent(txnRef)}&tn=${encodeURIComponent('Canteen Order ' + txnRef)}`;

  activePaymentSession = {
    txn_ref: txnRef,
    amount: grandTotal,
    student_id: currentStudent ? currentStudent.id : null,
    items: orderItemsList,
    upi_intent_url: upiIntentUrl,
    created_at: Date.now()
  };

  const intentLink = document.getElementById("pg-upi-intent-link");
  if (intentLink) intentLink.href = upiIntentUrl;
  const txnRefEl = document.getElementById("pg-upi-txn-ref");
  if (txnRefEl) txnRefEl.innerText = txnRef;

  renderDynamicQrAndStartCountdown();
  showToast("Fresh Dynamic QR generated! Valid for 3 minutes.", "success");
}

function handleUpiIntentTrigger() {
  showToast("Opening installed UPI App...", "success");
}

async function verifyUpiAppPayment() {
  if (!activePaymentSession) {
    showToast("Payment session expired", "error");
    return;
  }

  showLoading(true);
  try {
    const { grandTotal, orderItemsList } = getCartPayload();
    const isGuest = !currentStudent || currentStudent.isGuest || !currentStudent.id;
    const studentId = isGuest ? null : currentStudent.id;
    const guestName = isGuest ? (currentStudent?.name || 'Guest User') : null;

    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: studentId,
        items: orderItemsList,
        payment_method: 'ONLINE',
        payment_status: 'PAID',
        is_guest: isGuest,
        guest_name: guestName,
        notes: activePaymentSession.txn_ref ? `TxnRef: ${activePaymentSession.txn_ref}` : null
      })
    });

    const result = await res.json();
    showLoading(false);

    if (!res.ok || !result.success) {
      showToast(result.error || "Error processing payment. Please try again.", "error");
      return;
    }

    const finalOrder = result.data;

    cart = {};
    pendingOrderToken = "";
    if (cashCountdownInterval) {
      clearInterval(cashCountdownInterval);
      cashCountdownInterval = null;
    }
    updateCartBadge();
    updateCategoryFloatingBar();

    if (!isGuest) {
      orders.unshift(finalOrder);
    }

    closePaymentGatewayModal();
    showConfirmationScreen(finalOrder);
  } catch (err) {
    showLoading(false);
    console.error("UPI verification error:", err);
    showToast("Error processing payment. Please try again.", "error");
  }
}

async function verifyDynamicQrPayment() {
  await verifyUpiAppPayment();
}

async function placeOrder() {
  const { grandTotal, orderItemsList } = getCartPayload();
  if (orderItemsList.length === 0) return;

  if (!isCanteenOpen) {
    showToast("Canteen is currently closed. Cannot place new orders.", "error");
    return;
  }

  showLoading(true);

  try {
    const isGuest = !currentStudent || currentStudent.isGuest || !currentStudent.id;
    const studentId = isGuest ? null : currentStudent.id;
    const guestName = isGuest ? (currentStudent?.name || 'Guest User') : null;
    const paymentMode = currentPaymentMode === 'UPI' ? 'UPI' : 'CASH';
    const paymentMethod = paymentMode === 'UPI' ? 'ONLINE' : 'CASH_AT_COUNTER';
    const paymentStatus = 'PENDING';

    const res = await fetch('/api/orders', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        student_id: studentId,
        items: orderItemsList,
        payment_method: paymentMethod,
        payment_status: paymentStatus,
        is_guest: isGuest,
        guest_name: guestName
      })
    });

    const result = await res.json();
    showLoading(false);

    if (!res.ok || !result.success) {
      showToast(result.error || "Order failed. Please check stock and try again.", "error");
      return;
    }

    const finalOrder = result.data;

    cart = {};
    pendingOrderToken = "";
    if (cashCountdownInterval) {
      clearInterval(cashCountdownInterval);
      cashCountdownInterval = null;
    }
    updateCartBadge();
    updateCategoryFloatingBar();

    if (!isGuest) {
      orders.unshift(finalOrder);
    }

    showConfirmationScreen(finalOrder);
  } catch (err) {
    showLoading(false);
    console.error("Place order error:", err);
    showToast("Failed to place order. Please try again.", "error");
  }
}

function showOrderConfirmation(orderData) {
  showConfirmationScreen(orderData);
}

function processPaymentSuccess(orderData) {
  closePaymentGatewayModal();
  showConfirmationScreen(orderData);
}

let currentConfirmationOrder = null;
let cancelCountdownInterval = null;

function showConfirmationScreen(orderData) {
  if (!orderData) return;

  currentConfirmationOrder = orderData;

  // Clear any existing QR countdown timer & cancel timer
  if (qrCountdownInterval) {
    clearInterval(qrCountdownInterval);
    qrCountdownInterval = null;
  }
  if (cancelCountdownInterval) {
    clearInterval(cancelCountdownInterval);
    cancelCountdownInterval = null;
  }

  // Extract payment mode ('CASH' vs 'UPI')
  let paymentMode = 'CASH';
  if (orderData.qr_code_data) {
    try {
      const qd = typeof orderData.qr_code_data === 'string' ? JSON.parse(orderData.qr_code_data) : orderData.qr_code_data;
      if (qd?.payment_mode) paymentMode = qd.payment_mode;
      else if (orderData.payment_method === 'ONLINE') paymentMode = 'UPI';
    } catch(e) {}
  } else if (orderData.payment_method === 'ONLINE') {
    paymentMode = 'UPI';
  }

  const isPaid = orderData.payment_status === 'PAID';
  const orderCreatedAt = orderData.created_at ? new Date(orderData.created_at).getTime() : Date.now();
  const elapsedSeconds = Math.floor((Date.now() - orderCreatedAt) / 1000);
  let remainingSeconds = CASH_EXPIRY_WINDOW_SECONDS - elapsedSeconds;

  const isExpired = orderData.order_status === 'CANCELLED' || (!isPaid && remainingSeconds <= 0);

  // ── 1. Header titles & Expired Alert / Countdown bar ─────
  const titleEl = document.getElementById('confirm-screen-title');
  const subtitleEl = document.getElementById('confirm-screen-subtitle');
  const expiryAlert = document.getElementById('confirm-expiry-alert');
  const timerBar = document.getElementById('confirm-cash-timer-bar');
  const countdownEl = document.getElementById('confirm-cash-countdown');
  const statusBadge = document.getElementById('confirm-status-badge');
  const qrCaption = document.getElementById('confirm-qr-caption');

  if (timerBar) {
    const timerLabel = timerBar.querySelector('span');
    if (timerLabel) {
      timerLabel.innerHTML = `<i data-lucide="clock" class="w-4 h-4 text-amber-600"></i> ${paymentMode === 'UPI' ? 'UPI' : 'Cash'} Payment Window:`;
    }
  }

  if (isExpired) {
    if (titleEl) titleEl.innerText = "Order Expired / Cancelled";
    if (subtitleEl) subtitleEl.innerText = orderData.order_status === 'CANCELLED'
      ? "This order has been cancelled and stock released"
      : `${paymentMode === 'UPI' ? 'UPI' : 'Cash'} payment window has closed`;
    if (expiryAlert) expiryAlert.classList.remove('hidden');
    if (timerBar) timerBar.classList.add('hidden');
    if (statusBadge) {
      statusBadge.className = "inline-flex items-center gap-1 bg-red-50 text-red-700 text-[10px] font-bold px-2 py-0.5 rounded border border-red-200 mt-1";
      statusBadge.innerText = orderData.order_status === 'CANCELLED' ? "❌ Cancelled" : "❌ Expired / Cancelled";
    }
    if (qrCaption) qrCaption.innerText = "Order Inactive — Token Void";
  } else if (!isPaid) {
    if (titleEl) titleEl.innerText = "Order Placed Successfully!";
    if (subtitleEl) subtitleEl.innerText = paymentMode === 'UPI'
      ? "Scan UPI QR at counter within 30 minutes"
      : "Pay cash at counter within 30 minutes";
    if (expiryAlert) expiryAlert.classList.add('hidden');
    if (timerBar) timerBar.classList.remove('hidden');
    if (statusBadge) {
      statusBadge.className = "inline-flex items-center gap-1 bg-amber-50 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-200 mt-1";
      statusBadge.innerText = paymentMode === 'UPI' ? "⏳ Pending UPI Payment" : "⏳ Pending Cash Payment";
    }
    if (qrCaption) qrCaption.innerText = paymentMode === 'UPI'
      ? "Show token at counter to scan UPI QR & receive"
      : "Show token at counter to pay cash & receive";

    // Start live countdown timer on confirmation screen
    const updateCountdown = () => {
      const nowElapsed = Math.floor((Date.now() - orderCreatedAt) / 1000);
      const rem = Math.max(0, CASH_EXPIRY_WINDOW_SECONDS - nowElapsed);
      const mins = Math.floor(rem / 60);
      const secs = rem % 60;
      if (countdownEl) {
        countdownEl.innerText = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
      }

      if (rem <= 0) {
        if (qrCountdownInterval) {
          clearInterval(qrCountdownInterval);
          qrCountdownInterval = null;
        }
        showToast(`Order ${orderData.token_number || ''} has expired. Inventory restored.`, "error");
        fetchStudentOrders();
        showConfirmationScreen({ ...orderData, order_status: 'CANCELLED' });
      }
    };

    updateCountdown();
    qrCountdownInterval = setInterval(updateCountdown, 1000);
  } else {
    // Online Paid or Delivered
    if (titleEl) titleEl.innerText = "Order Placed Successfully!";
    if (subtitleEl) subtitleEl.innerText = "Ready for pickup at the canteen counter";
    if (expiryAlert) expiryAlert.classList.add('hidden');
    if (timerBar) timerBar.classList.add('hidden');
    if (statusBadge) {
      if (orderData.order_status === 'DELIVERED') {
        statusBadge.className = "inline-flex items-center gap-1 bg-green-50 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded border border-green-200 mt-1";
        statusBadge.innerText = "✅ Delivered";
      } else {
        statusBadge.className = "inline-flex items-center gap-1 bg-amber-50 text-amber-700 text-[10px] font-bold px-2 py-0.5 rounded border border-amber-200 mt-1";
        statusBadge.innerText = "⏳ Pending Pickup";
      }
    }
    if (qrCaption) qrCaption.innerText = "Verification QR Signature Verified";
  }

  // ── 1b. 5-Minute Student Order Cancellation Window ───────
  const cancelSection = document.getElementById('confirm-cancel-section');
  const cancelBtn = document.getElementById('confirm-cancel-btn');
  const cancelBtnText = document.getElementById('confirm-cancel-btn-text');
  const cancelClosedMsg = document.getElementById('confirm-cancel-closed-msg');

  const CANCELLATION_WINDOW_SECONDS = 5 * 60; // 300 seconds
  const isTerminalStatus = orderData.order_status === 'DELIVERED' || orderData.order_status === 'CANCELLED';

  if (cancelSection) {
    if (isTerminalStatus) {
      cancelSection.classList.add('hidden');
    } else {
      cancelSection.classList.remove('hidden');

      const updateCancelCountdown = () => {
        const nowElapsed = Math.floor((Date.now() - orderCreatedAt) / 1000);
        const remCancel = Math.max(0, CANCELLATION_WINDOW_SECONDS - nowElapsed);
        const cMins = Math.floor(remCancel / 60);
        const cSecs = remCancel % 60;
        const timeStr = `${String(cMins).padStart(2, '0')}:${String(cSecs).padStart(2, '0')}`;

        if (remCancel > 0) {
          if (cancelBtn) {
            cancelBtn.classList.remove('hidden');
            cancelBtn.disabled = false;
          }
          if (cancelBtnText) {
            cancelBtnText.innerText = `Cancel available (${timeStr})`;
          }
          if (cancelClosedMsg) {
            cancelClosedMsg.classList.add('hidden');
          }
        } else {
          if (cancelCountdownInterval) {
            clearInterval(cancelCountdownInterval);
            cancelCountdownInterval = null;
          }
          if (cancelBtn) {
            cancelBtn.classList.add('hidden');
            cancelBtn.disabled = true;
          }
          if (cancelClosedMsg) {
            cancelClosedMsg.classList.remove('hidden');
            cancelClosedMsg.innerHTML = `<i data-lucide="lock" class="w-3.5 h-3.5 text-slate-400"></i> <span>Cancellation window closed</span>`;
            if (window.lucide) lucide.createIcons();
          }
        }
      };

      updateCancelCountdown();
      const initialElapsed = Math.floor((Date.now() - orderCreatedAt) / 1000);
      if (initialElapsed < CANCELLATION_WINDOW_SECONDS) {
        cancelCountdownInterval = setInterval(updateCancelCountdown, 1000);
      }
    }
  }

  // ── 2. Populate token number ────────────────────────────
  const isGuest = (currentStudent && currentStudent.isGuest) || (orderData.qr_code_data && (orderData.qr_code_data.is_guest || orderData.qr_code_data.order_type === 'GUEST_ORDER')) || !orderData.student_id;
  const tokenEl = document.getElementById('confirm-token-number');
  if (tokenEl) {
    let rawToken = orderData.token_number || '#TK-???';
    if (isGuest) {
      const numPart = rawToken.replace(/^[^\d]*/, '');
      tokenEl.innerText = `#G-${numPart || rawToken.replace(/^#/, '')}`;
    } else {
      tokenEl.innerText = rawToken;
    }
  }

  // ── 2b. Guest Mode Warning & Screenshot Actions ──────────
  const guestWarningEl = document.getElementById('confirm-guest-warning');
  const guestActionsEl = document.getElementById('confirm-guest-actions');
  if (guestWarningEl) {
    if (isGuest) guestWarningEl.classList.remove('hidden');
    else guestWarningEl.classList.add('hidden');
  }
  if (guestActionsEl) {
    if (isGuest) guestActionsEl.classList.remove('hidden');
    else guestActionsEl.classList.add('hidden');
  }

  // ── 3. Payment badge ────────────────────────────────────
  const paymentBadge = document.getElementById('confirm-payment-badge');
  if (paymentBadge) {
    if (isPaid) {
      paymentBadge.innerText = paymentMode === 'UPI' ? '✅ PAID (UPI)' : '✅ PAID (Cash)';
      paymentBadge.className = 'inline-flex items-center gap-1 bg-green-50 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded border border-green-200 mt-1';
    } else {
      if (paymentMode === 'UPI') {
        paymentBadge.innerText = '📱 Expected: UPI QR';
        paymentBadge.className = 'inline-flex items-center gap-1 bg-blue-50 text-blue-700 text-[10px] font-bold px-2 py-0.5 rounded border border-blue-200 mt-1';
      } else {
        paymentBadge.innerText = '💵 Expected: Cash';
        paymentBadge.className = 'inline-flex items-center gap-1 bg-orange-50 text-orange-700 text-[10px] font-bold px-2 py-0.5 rounded border border-orange-200 mt-1';
      }
    }
  }

  // ── 4. Order items summary ──────────────────────────────
  const itemsEl = document.getElementById('confirm-order-items');
  if (itemsEl) {
    const items = orderData.items || orderData.order_items || [];
    if (items.length > 0) {
      const totalAmt = parseFloat(orderData.total_amount || 0).toFixed(2);
      itemsEl.innerHTML = items.map(i => {
        const name = i.name || (i.products ? i.products.name : 'Item');
        const qty  = i.quantity;
        const price = parseFloat(i.unit_price || 0);
        return `<div class="flex justify-between">
          <span>${qty}× ${name}</span>
          <span class="font-semibold">₹${(price * qty).toFixed(2)}</span>
        </div>`;
      }).join('') +
      `<div class="flex justify-between border-t border-slate-200 pt-1 mt-1 font-bold text-text-primary">
        <span>Total</span><span>₹${totalAmt}</span>
      </div>`;
    } else {
      itemsEl.innerHTML = `<p class="text-xs text-text-secondary">Order summary loaded.</p>`;
    }
  }

  // ── 5. Navigate to confirmation screen FIRST ────────────
  showScreen('qr-screen');
  lucide.createIcons();

  // ── 6. Generate QR after browser layout pass ───────────
  requestAnimationFrame(() => {
    generateAndShowQR('qrcode-container', orderData, isExpired);
  });
}

async function downloadOrPrintToken() {
  const token = document.getElementById('confirm-token-number')?.innerText || 'Canteen Token';
  const total = document.getElementById('confirm-order-summary')?.innerText || '';
  if (navigator.share) {
    try {
      await navigator.share({
        title: `Canteen Order Token: ${token}`,
        text: `My Canteen Order Token: ${token}.\nPlease show this token at counter!\n${total}`
      });
      return;
    } catch (e) {}
  }
  window.print();
}

// ─────────────────────────────────────────────────────────
// generateAndShowQR(containerId, orderData, isExpired)
// Clears the container and renders QR code or Expired block.
// ─────────────────────────────────────────────────────────
function generateAndShowQR(containerId, orderData, isExpired = false) {
  const container = document.getElementById(containerId);
  if (!container) return;

  container.innerHTML = '';

  if (isExpired) {
    container.innerHTML = `
      <div class="flex flex-col items-center justify-center p-4 text-center h-full">
        <div class="w-12 h-12 rounded-full bg-red-100 flex items-center justify-center mb-2">
          <i data-lucide="alert-octagon" class="w-6 h-6 text-red-600"></i>
        </div>
        <p class="text-xs font-bold text-red-700">Token Expired</p>
        <p class="text-[10px] text-slate-500 mt-1 leading-tight">30-min cash window passed. Order cancelled.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  // Build payload for scanner lookup
  const payload = JSON.stringify({
    order_id:     orderData.id     || '',
    token_number: orderData.token_number || orderData.token || '',
    total:        parseFloat(orderData.total_amount || 0).toFixed(2)
  });

  if (typeof QRCode !== 'undefined') {
    new QRCode(container, {
      text:          payload,
      width:         210,
      height:        210,
      colorDark:     '#1E293B',
      colorLight:    '#FFFFFF',
      correctLevel:  QRCode.CorrectLevel.M
    });
  } else {
    const img = document.createElement('img');
    img.src = `https://api.qrserver.com/v1/create-qr-code/?size=210x210&data=${encodeURIComponent(payload)}`;
    img.alt = 'Order QR Code';
    img.className = 'w-full h-full object-contain rounded';
    container.appendChild(img);
  }
}

async function cancelStudentOrder() {
  if (!currentConfirmationOrder) return;
  const orderId = currentConfirmationOrder.id;
  const token = currentConfirmationOrder.token_number;

  const orderCreatedAt = currentConfirmationOrder.created_at ? new Date(currentConfirmationOrder.created_at).getTime() : Date.now();
  const elapsedSeconds = Math.floor((Date.now() - orderCreatedAt) / 1000);
  if (elapsedSeconds > 300) {
    showToast("Cancellation window closed. Orders can only be cancelled within 5 minutes.", "error");
    return;
  }

  const confirmed = confirm(`Are you sure you want to cancel Order ${token || ''}?\n\nStock will be released and your order will be cancelled.`);
  if (!confirmed) return;

  showLoading(true);
  try {
    const res = await fetch('/api/orders', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: orderId,
        token: token,
        action: 'cancel'
      })
    });

    const result = await res.json();
    showLoading(false);

    if (!res.ok || !result.success) {
      showToast(result.error || "Failed to cancel order", "error");
      return;
    }

    showToast(`Order ${token || ''} cancelled. Inventory restored.`, "success");

    if (cancelCountdownInterval) {
      clearInterval(cancelCountdownInterval);
      cancelCountdownInterval = null;
    }
    if (qrCountdownInterval) {
      clearInterval(qrCountdownInterval);
      qrCountdownInterval = null;
    }

    await fetchStudentOrders();
    showConfirmationScreen(result.data);
  } catch (err) {
    showLoading(false);
    console.error("Cancel order error:", err);
    showToast("Network error while cancelling order.", "error");
  }
}

// ─────────────────────────────────────────────────────────
// resetAndGoHome()
// Wired to the "Back to Home" button on the QR screen.
// Clears any leftover UPI/checkout state and returns home.
// ─────────────────────────────────────────────────────────
function resetAndGoHome() {
  if (qrCountdownInterval) {
    clearInterval(qrCountdownInterval);
    qrCountdownInterval = null;
  }
  if (cancelCountdownInterval) {
    clearInterval(cancelCountdownInterval);
    cancelCountdownInterval = null;
  }

  // Reset UPI checkbox and UTR field if they exist
  const upiCheckbox = document.getElementById('upi-confirm-checkbox');
  const utrInput    = document.getElementById('upi-utr-input');
  if (upiCheckbox) upiCheckbox.checked = false;
  if (utrInput)    utrInput.value = '';

  // Reset place order button state
  const placeBtn = document.getElementById('place-order-btn');
  if (placeBtn) {
    placeBtn.disabled = false;
    placeBtn.innerHTML = `<i data-lucide="shield-check" class="w-5 h-5"></i> Confirm &amp; Place Order`;
  }

  // Navigate home
  navigateHome();
}

// 10b. Order History View
function renderCartHistoryView() {
  const container = document.getElementById("cart-history-view");
  if (!container) return;

  const userOrders = orders.filter(o => o.student_id === currentStudent.id);

  if (userOrders.length === 0) {
    container.innerHTML = `
      <div class="text-center py-20 text-xs text-text-secondary">
        <i data-lucide="history" class="w-12 h-12 text-slate-300 mx-auto mb-3"></i>
        <p class="mt-2 font-medium">No past orders found.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  const now = Date.now();

  container.innerHTML = userOrders.map(o => {
    const isPaid = o.payment_status === 'PAID';
    const orderCreatedAt = o.created_at ? new Date(o.created_at).getTime() : now;
    const isPast30Min = (now - orderCreatedAt) > (CASH_EXPIRY_WINDOW_SECONDS * 1000);
    const isOrderExpired = o.order_status === 'CANCELLED' || (!isPaid && isPast30Min);

    let statusBadge = "";
    if (isOrderExpired) {
      statusBadge = `
        <div class="flex items-center justify-between w-full mt-2 pt-2 border-t border-slate-100/50">
          <span class="inline-flex items-center gap-1 bg-red-50 text-red-700 text-xs font-bold px-2.5 py-1 rounded-lg border border-red-200">
            ❌ Expired (30m passed)
          </span>
          <button onclick="viewHistoricalQR('${o.id}')" class="bg-slate-100 hover:bg-slate-200 text-slate-600 px-3 py-1.5 rounded-lg text-xs font-bold transition-all">
            Details
          </button>
        </div>
      `;
    } else if (o.order_status === "PENDING_PICKUP" || o.order_status === "PENDING") {
      const remMins = !isPaid ? Math.max(1, Math.ceil((CASH_EXPIRY_WINDOW_SECONDS * 1000 - (now - orderCreatedAt)) / 60000)) : null;
      statusBadge = `
        <div class="flex items-center justify-between w-full mt-2 pt-2 border-t border-slate-100/50">
          <span class="inline-flex items-center gap-1 bg-amber-50 text-amber-700 text-xs font-bold px-2.5 py-1 rounded-lg border border-amber-200">
            ⏳ Pending Pickup ${remMins ? `(${remMins}m left)` : ''}
          </span>
          <button onclick="viewHistoricalQR('${o.id}')" class="bg-primary/10 text-primary-dark hover:bg-primary hover:text-white px-3 py-1.5 rounded-lg text-xs font-bold transition-all">
            View QR
          </button>
        </div>
      `;
    } else if (o.order_status === "DELIVERED") {
      statusBadge = `
        <div class="mt-2 pt-2 border-t border-slate-100/50">
          <span class="inline-flex items-center gap-1 bg-green-50 text-green-700 text-xs font-bold px-2.5 py-1 rounded-lg border border-green-200">
            ✅ Delivered
          </span>
        </div>
      `;
    } else {
      statusBadge = `
        <div class="mt-2 pt-2 border-t border-slate-100/50">
          <span class="inline-flex items-center gap-1 bg-red-50 text-red-700 text-xs font-bold px-2.5 py-1 rounded-lg border border-red-200">
            ❌ Cancelled
          </span>
        </div>
      `;
    }

    let paymentBadge = "";
    if (isPaid) {
      paymentBadge = `<span class="bg-green-50 text-green-700 text-[10px] font-bold px-2 py-0.5 rounded border border-green-200">PAID (Online)</span>`;
    } else if (isOrderExpired) {
      paymentBadge = `<span class="bg-red-50 text-red-700 text-[10px] font-bold px-2 py-0.5 rounded border border-red-200">EXPIRED UNPAID</span>`;
    } else {
      paymentBadge = `<span class="bg-orange-50 text-orange-700 text-[10px] font-bold px-2 py-0.5 rounded border border-orange-200">UNPAID (Cash at Counter)</span>`;
    }

    const dateTimeStr = new Date(o.created_at).toLocaleString();
    const itemsSummary = (o.items || []).map(i => `${i.quantity}x ${i.name}`).join(', ') || 'Canteen items';

    return `
      <div class="card-premium p-4 space-y-3 border border-slate-100">
        <div class="flex justify-between items-start">
          <div>
            <span class="font-extrabold text-sm text-primary-dark">${o.token_number}</span>
            <span class="text-[10px] text-text-secondary block mt-0.5">${dateTimeStr}</span>
          </div>
          <div class="text-right">
            <span class="text-sm font-bold text-text-primary block">₹${o.total_amount.toFixed(2)}</span>
            <div class="mt-1">${paymentBadge}</div>
          </div>
        </div>
        
        <div class="text-xs text-text-secondary leading-relaxed bg-slate-50 p-2.5 rounded-lg border border-slate-100/50">
          <span class="font-semibold text-text-primary">Items:</span> ${itemsSummary}
        </div>

        <div class="flex items-center justify-between gap-2 pt-2 border-t border-slate-100/60">
          <div class="flex-1">
            ${statusBadge}
          </div>
          <button onclick="reorderPastOrder('${o.id}')" class="flex-shrink-0 flex items-center gap-1.5 bg-primary/10 hover:bg-primary hover:text-white text-primary-dark border border-primary/20 px-3 py-1.5 rounded-lg text-xs font-bold transition-all shadow-sm active:scale-95" title="Order Again">
            <i data-lucide="rotate-ccw" class="w-3.5 h-3.5"></i> Re-order
          </button>
        </div>
      </div>
    `;
  }).join('');

  lucide.createIcons();
}

// Direct Order History trigger from Navbar or Drawer
async function showOrdersHistory() {
  toggleDrawer(false);

  // Guest Check
  if (currentStudent && currentStudent.isGuest) {
    showToast("Order history is not available in Guest Mode.", "info");
    return;
  }

  // Check login
  if (!currentStudent || !currentStudent.id) {
    showToast("Please login to view your order history.", "info");
    showScreen("login-screen");
    return;
  }

  // Directly show Order History view bypassing active basket
  showScreen("cart-screen");

  const currentTabBtn = document.getElementById("cart-tab-current");
  const historyTabBtn = document.getElementById("cart-tab-history");
  const currentView = document.getElementById("cart-current-view");
  const historyView = document.getElementById("cart-history-view");

  if (currentTabBtn && historyTabBtn && currentView && historyView) {
    historyTabBtn.classList.add("border-primary", "text-primary");
    historyTabBtn.classList.remove("border-transparent", "text-text-secondary");
    currentTabBtn.classList.remove("border-primary", "text-primary");
    currentTabBtn.classList.add("border-transparent", "text-text-secondary");

    currentView.classList.add("hidden");
    historyView.classList.remove("hidden");
  }

  showLoading(true);
  await fetchStudentOrders();
  showLoading(false);

  renderCartHistoryView();
}

// Smart Re-order with Live Stock Safety Validation
async function reorderPastOrder(orderId) {
  if (!orderId) return;

  let order = orders.find(o => o.id === orderId);
  if (!order) {
    try {
      const { data, error } = await supabase
        .from('orders')
        .select('*, order_items(*, products(*))')
        .eq('id', orderId)
        .maybeSingle();
      if (!error && data) {
        order = {
          ...data,
          items: (data.order_items || []).map(oi => ({
            product_id: oi.product_id,
            name: oi.products ? oi.products.name : 'Item',
            quantity: oi.quantity,
            unit_price: parseFloat(oi.unit_price)
          }))
        };
      }
    } catch (e) {
      console.warn("Could not fetch order by id:", e);
    }
  }

  if (!order) {
    showToast("Order details not found.", "error");
    return;
  }

  showLoading(true);
  await fetchProducts(); // Fetch latest stock from Supabase / API
  showLoading(false);

  let orderItems = order.items;
  if (!orderItems || orderItems.length === 0) {
    if (order.order_items && order.order_items.length > 0) {
      orderItems = order.order_items.map(oi => ({
        product_id: oi.product_id,
        name: oi.products ? oi.products.name : (oi.name || 'Item'),
        quantity: oi.quantity,
        unit_price: parseFloat(oi.unit_price)
      }));
    }
  }

  if (!orderItems || orderItems.length === 0) {
    showToast("No items found in this past order.", "error");
    return;
  }

  const addedItems = [];
  const outOfStockItems = [];
  const partialItems = [];

  for (const item of orderItems) {
    const prod = products.find(p => p.id === item.product_id || (p.name && item.name && p.name.toLowerCase() === item.name.toLowerCase()));
    if (!prod || prod.stock_quantity <= 0) {
      outOfStockItems.push(item.name || (prod ? prod.name : 'Item'));
    } else {
      const reqQty = item.quantity || 1;
      const currentCartQty = cart[prod.id] || 0;
      const availableToAdd = Math.max(0, prod.stock_quantity - currentCartQty);

      if (availableToAdd <= 0) {
        outOfStockItems.push(prod.name);
      } else {
        const qtyToAdd = Math.min(reqQty, availableToAdd);
        cart[prod.id] = (cart[prod.id] || 0) + qtyToAdd;
        if (qtyToAdd < reqQty) {
          partialItems.push(`${prod.name} (${qtyToAdd} of ${reqQty} added)`);
        } else {
          addedItems.push(prod.name);
        }
      }
    }
  }

  if (addedItems.length === 0 && partialItems.length === 0) {
    const names = outOfStockItems.join(', ');
    showToast(`Cannot re-order: ${names || 'Item'} is currently out of stock!`, "error");
    return;
  }

  updateCartBadge();
  navigateToCart();

  if (outOfStockItems.length > 0 || partialItems.length > 0) {
    const issues = [...outOfStockItems.map(n => `${n} is out of stock`), ...partialItems].join(', ');
    showToast(`Added available items to cart. (${issues})`, "warning");
  } else {
    showToast("Items added to cart!", "success");
  }
}

function viewHistoricalQR(orderId) {
  const order = orders.find(o => o.id === orderId);
  if (order) showConfirmationScreen(order);
}

// 10. Notices Announcement & Modal UI Sync
function updateNoticesUI() {
  const badge = document.getElementById("notice-badge");
  const storedSeenCount = parseInt(localStorage.getItem("seen_notices_count") || "0");
  const unseenCount = Math.max(0, notices.length - storedSeenCount);
  
  if (badge) {
    if (unseenCount > 0) {
      badge.innerText = unseenCount;
      badge.classList.remove("hidden");
    } else {
      badge.classList.add("hidden");
    }
  }

  const banner = document.getElementById("announcement-banner");
  const titleEl = document.getElementById("announcement-title");
  const msgEl = document.getElementById("announcement-message");
  
  const dismissedLatestId = localStorage.getItem("dismissed_notice_id");
  if (notices.length > 0 && dismissedLatestId !== notices[0].id) {
    const latest = notices[0];
    if (titleEl) titleEl.innerText = latest.title;
    if (msgEl) msgEl.innerText = latest.message;
    if (banner) banner.classList.remove("hidden");
  } else {
    if (banner) banner.classList.add("hidden");
  }
}

function dismissAnnouncement() {
  if (notices.length > 0) {
    localStorage.setItem("dismissed_notice_id", notices[0].id);
  }
  const banner = document.getElementById("announcement-banner");
  if (banner) banner.classList.add("hidden");
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

function updateCanteenStatusUI() {
  const badge = document.getElementById("canteen-status-badge");
  const banner = document.getElementById("canteen-closed-banner");

  if (isCanteenOpen) {
    if (badge) {
      badge.className = "badge-status";
      badge.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-primary animate-pulse"></span> 🟢 Open Now`;
    }
    if (banner) banner.classList.add("hidden");
  } else {
    if (badge) {
      badge.className = "badge-status bg-rose-500/10 text-rose-600 border border-rose-500/20";
      badge.innerHTML = `<span class="w-2.5 h-2.5 rounded-full bg-rose-500"></span> 🔴 Closed`;
    }
    if (banner) banner.classList.remove("hidden");
  }

  // Disable / Enable [Add to Cart] and [Place Order] buttons
  const placeBtn = document.getElementById("place-order-btn");
  if (placeBtn) {
    placeBtn.disabled = !isCanteenOpen;
  }
}

async function showNoticesHistory() {
  const badge = document.getElementById('notice-badge');
  if (badge) badge.classList.add('hidden');

  showScreen('notices-screen');

  const container = document.getElementById('notices-history-list');
  if (container) {
    container.innerHTML = `
      <div class="flex justify-center items-center py-20">
        <div class="w-8 h-8 border-4 border-primary border-t-transparent rounded-full animate-spin"></div>
      </div>
    `;
  }

  await fetchNotices();
  localStorage.setItem('seen_notices_count', notices.length);
  renderNoticesHistory();
}

function renderNoticesHistory() {
  const container = document.getElementById('notices-history-list');
  if (!container) return;

  if (notices.length === 0) {
    container.innerHTML = `
      <div class="text-center py-20 text-xs text-text-secondary space-y-3">
        <i data-lucide="bell-off" class="w-12 h-12 text-slate-300 mx-auto"></i>
        <p class="font-medium text-sm text-text-primary">No announcements yet.</p>
        <p class="leading-relaxed max-w-[220px] mx-auto">All updates from the canteen manager will appear here.</p>
      </div>
    `;
    lucide.createIcons();
    return;
  }

  container.innerHTML = notices.map(notice => {
    const timeStr = new Date(notice.created_at).toLocaleString('en-IN', {
      dateStyle: 'medium',
      timeStyle: 'short'
    });
    return `
      <div class="card-premium p-4 space-y-2 border border-slate-100">
        <div class="flex justify-between items-start gap-2">
          <h4 class="font-bold text-sm text-text-primary flex items-center gap-1.5">
            📢 ${notice.title}
          </h4>
          <span class="text-[10px] text-text-secondary bg-slate-100 px-2 py-0.5 rounded-full font-medium whitespace-nowrap flex-shrink-0">
            🕒 ${timeStr}
          </span>
        </div>
        <p class="text-xs text-text-secondary leading-relaxed">📝 ${notice.message}</p>
      </div>
    `;
  }).join('');
  lucide.createIcons();
}

function openNoticesModal() {
  showNoticesHistory();
}

function closeNoticesModal() {
  const modal = document.getElementById("notices-modal");
  if (modal) modal.classList.add("hidden");
}

function renderNoticesList() {
  renderNoticesHistory();
}

// 11. Initializer Bindings on DOM Content Load
window.addEventListener("DOMContentLoaded", async () => {
  showLoading(true);
  await initDatabase();
  showLoading(false);
  
  // Poll canteen status every 10 seconds
  setInterval(fetchCanteenStatus, 10000);
  
  lucide.createIcons();
});

