/**
 * canteen-login.js
 * Canteen Manager Authentication against dedicated Supabase table 'canteen_managers'
 */

// Supabase Configuration
const SUPABASE_URL = 'https://llbegpqowjvsadbundrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsYmVncHFvd2p2c2FkYnVuZHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3Njg4NzAsImV4cCI6MjEwMjM0NDg3MH0.SGoLEoE5PP_Ex0C7tOXrwvcol2vxxOvOFPoSGfD93VA';
const supabase = (typeof window !== 'undefined' && window.supabase && window.supabase.createClient)
  ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
  : null;

// UI Feedback Toast
function showToast(message, type = 'info') {
  const container = document.getElementById("toast-container");
  if (!container) return;

  const toast = document.createElement("div");
  const bgClass = type === 'error' 
    ? 'bg-rose-950/90 border-rose-800 text-rose-200' 
    : (type === 'success' ? 'bg-emerald-950/90 border-emerald-800 text-emerald-200' : 'bg-slate-900/90 border-slate-700 text-slate-200');

  const iconName = type === 'error' ? 'alert-circle' : (type === 'success' ? 'check-circle' : 'info');

  toast.className = `flex items-center gap-2 px-4 py-3 rounded-xl border text-xs font-semibold shadow-xl backdrop-blur-sm transition-all duration-300 ${bgClass}`;
  toast.innerHTML = `<i data-lucide="${iconName}" class="w-4 h-4 shrink-0"></i> <span>${message}</span>`;
  container.appendChild(toast);
  if (window.lucide) lucide.createIcons();

  setTimeout(() => {
    toast.style.opacity = '0';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

function showLoading(show) {
  const loader = document.getElementById("loading-overlay");
  if (loader) {
    if (show) loader.classList.remove("hidden");
    else loader.classList.add("hidden");
  }
}

/**
 * Handles Canteen Manager Login
 * Validates credentials against dedicated table 'canteen_managers'
 */
async function handleManagerLogin(event) {
  if (event) event.preventDefault();

  const usernameInput = document.getElementById("managerUsername");
  const passwordInput = document.getElementById("managerPassword");
  const errorBadge = document.getElementById("manager-login-error");
  const errorText = document.getElementById("manager-login-error-text");
  const submitBtn = document.getElementById("manager-login-btn");

  if (errorBadge) errorBadge.classList.add("hidden");

  const username = usernameInput ? usernameInput.value.trim() : "";
  const password = passwordInput ? passwordInput.value.trim() : "";

  if (!username || !password) {
    if (errorBadge) {
      if (errorText) errorText.innerText = "Please enter both username and password";
      errorBadge.classList.remove("hidden");
      if (window.lucide) lucide.createIcons();
    }
    showToast("Please enter username and password", "error");
    return;
  }

  showLoading(true);
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="w-4 h-4 border-2 border-slate-900 border-t-transparent rounded-full animate-spin"></span> <span>Logging in...</span>`;
  }

  try {
    if (!supabase) {
      throw new Error("Supabase client is not available.");
    }

    // Direct query against dedicated Supabase table 'canteen_managers'
    const { data, error } = await supabase
      .from('canteen_managers')
      .select('*')
      .eq('username', username)
      .eq('password', password)
      .maybeSingle();

    showLoading(false);

    if (error || !data) {
      console.warn("Manager authentication failure:", error ? error.message : "Credentials mismatch");
      if (errorBadge) {
        if (errorText) errorText.innerText = "Invalid Username or Password";
        errorBadge.classList.remove("hidden");
        if (window.lucide) lucide.createIcons();
      }
      showToast("Invalid Username or Password", "error");
      return;
    }

    // Match found - Store active manager state
    const managerState = {
      id: data.id,
      role: data.role || 'manager',
      username: data.username
    };
    sessionStorage.setItem('canteen_manager_auth', JSON.stringify(managerState));
    sessionStorage.setItem('manager_auth', 'true');

    if (errorBadge) errorBadge.classList.add("hidden");
    showToast(`Welcome back, ${data.username}!`, "success");

    // Redirect smoothly to the manager dashboard
    setTimeout(() => {
      window.location.href = "manager.html";
    }, 400);

  } catch (err) {
    showLoading(false);
    console.error("Manager login error:", err);
    if (errorBadge) {
      if (errorText) errorText.innerText = "Connection error. Please try again.";
      errorBadge.classList.remove("hidden");
      if (window.lucide) lucide.createIcons();
    }
    showToast("Error connecting to server. Please try again.", "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<span>Login</span>`;
    }
  }
}

// Check existing session on load
window.addEventListener("DOMContentLoaded", () => {
  const isAuth = sessionStorage.getItem("canteen_manager_auth") || (sessionStorage.getItem("manager_auth") === "true");
  if (isAuth) {
    window.location.href = "manager.html";
    return;
  }
  if (window.lucide) lucide.createIcons();
});
