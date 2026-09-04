/**
 * register.js - Standalone Student Registration Handler
 * Enforces mandatory email validation and syncs with Supabase Auth
 */

const SUPABASE_URL = 'https://llbegpqowjvsadbundrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsYmVncHFvd2p2c2FkYnVuZHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3Njg4NzAsImV4cCI6MjEwMjM0NDg3MH0.SGoLEoE5PP_Ex0C7tOXrwvcol2vxxOvOFPoSGfD93VA';
const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

function showToast(msg, type = 'info') {
  const toast = document.getElementById('toast');
  const toastMsg = document.getElementById('toast-message');
  const toastIcon = document.getElementById('toast-icon');
  if (!toast || !toastMsg) return;

  toastMsg.innerText = msg;
  if (type === 'error') {
    toast.className = 'toast flex items-center gap-2 px-4 py-3 rounded-2xl shadow-xl border text-xs font-semibold text-white bg-rose-900 border-rose-800 show';
    toastIcon.innerHTML = '<i data-lucide="alert-circle" class="w-4 h-4 text-rose-300"></i>';
  } else if (type === 'success') {
    toast.className = 'toast flex items-center gap-2 px-4 py-3 rounded-2xl shadow-xl border text-xs font-semibold text-white bg-emerald-900 border-emerald-800 show';
    toastIcon.innerHTML = '<i data-lucide="check-circle-2" class="w-4 h-4 text-emerald-300"></i>';
  } else {
    toast.className = 'toast flex items-center gap-2 px-4 py-3 rounded-2xl shadow-xl border text-xs font-semibold text-white bg-slate-900 border-slate-800 show';
    toastIcon.innerHTML = '<i data-lucide="info" class="w-4 h-4 text-primary"></i>';
  }
  if (window.lucide) lucide.createIcons();

  clearTimeout(window.toastTimer);
  window.toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3500);
}

function togglePasswordVisibility(inputId, el) {
  const input = document.getElementById(inputId);
  if (!input) return;
  const isPassword = input.type === 'password';
  input.type = isPassword ? 'text' : 'password';
  const icon = el.querySelector('i') || el;
  if (icon) {
    icon.setAttribute('data-lucide', isPassword ? 'eye-off' : 'eye');
    if (window.lucide) lucide.createIcons();
  }
}

async function handleStandaloneRegisterSubmit(event) {
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

  // 1. Validate phone number
  if (phone.length !== 10) {
    showToast("Mobile number must be exactly 10 digits", "error");
    document.getElementById("reg-phone")?.focus();
    return;
  }

  // 2. Strict Email Requirement (Non-empty and valid format)
  if (!email) {
    if (emailErrorEl) {
      emailErrorEl.innerText = "Email address is strictly mandatory for account recovery.";
      emailErrorEl.classList.remove("hidden");
    }
    showToast("Email address is required", "error");
    document.getElementById("reg-email")?.focus();
    return;
  }

  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!emailRegex.test(email)) {
    if (emailErrorEl) {
      emailErrorEl.innerText = "Please enter a valid email address (e.g. student@college.edu).";
      emailErrorEl.classList.remove("hidden");
    }
    showToast("Invalid email address format", "error");
    document.getElementById("reg-email")?.focus();
    return;
  }

  // 3. Password length
  if (password.length < 6) {
    showToast("Password must be at least 6 characters", "error");
    document.getElementById("reg-password")?.focus();
    return;
  }

  const submitBtn = document.getElementById("reg-submit-btn");
  if (submitBtn) {
    submitBtn.disabled = true;
    submitBtn.innerHTML = `<span class="animate-spin inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full mr-2"></span> Creating Account...`;
  }

  try {
    // 1. Check if Register Number is already registered in students table
    if (supabase) {
      const { data: existingReg } = await supabase
        .from('students')
        .select('id')
        .ilike('reg_no', regNo)
        .maybeSingle();

      if (existingReg) {
        showToast("Register number is already registered", "error");
        return;
      }
    }

    const cleanEmail = email.trim().toLowerCase();
    const cleanPhone = phone.trim();
    const cleanName = name.trim();

    // 2. Trigger Supabase Auth Sign Up FIRST
    if (!supabase || !supabase.auth) {
      throw new Error("Supabase client is not initialized.");
    }

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

    // 3. Gracefully handle existing email and auth errors
    if (authError) {
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

    // When email enumeration protection / confirmation is on, existing users return identities: []
    if (authData?.user && Array.isArray(authData.user.identities) && authData.user.identities.length === 0) {
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

    // 4. Link Auth UID to Student Profile & Upsert directly into public.students
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

    let { error: dbError } = await supabase
      .from('students')
      .upsert(studentRecord, { onConflict: 'id' });

    // Schema cache fallback if column is 'phone_number'
    if (dbError && (dbError.code === 'PGRST204' || dbError.message.includes('column'))) {
      console.warn("Retrying with alternate column mapping:", dbError.message);
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
      dbError = retry.error;
    }

    if (dbError) {
      console.error("Database sync error:", dbError);
      if (dbError.code === '23505') {
        showToast("A student with this Register Number or ID already exists", "error");
        return;
      }
      throw dbError;
    }

    // 5. Synchronize with extended backend profiles using the Auth UID
    try {
      await fetch('/api/auth', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'student-register',
          id: authUid,
          reg_no: regNo,
          name: cleanName,
          department: dept,
          dob: dob,
          password: password,
          phone: cleanPhone,
          phone_number: cleanPhone,
          email: cleanEmail
        })
      });
    } catch (apiErr) {
      console.warn("Backend API sync notice:", apiErr);
    }

    // 6. Save active session student
    const studentSafe = {
      id: authUid,
      reg_no: regNo,
      name: cleanName,
      department: dept,
      dob: dob,
      phone: cleanPhone,
      phone_number: cleanPhone,
      email: cleanEmail,
      wallet_balance: 0.00
    };

    sessionStorage.setItem("session_student", JSON.stringify(studentSafe));

    showToast("🎉 Account created & linked to Supabase Auth!", "success");
    setTimeout(() => {
      window.location.href = "index.html";
    }, 1500);

  } catch (err) {
    console.error("Registration error:", err);
    showToast("Error creating account: " + (err.message || "Please try again"), "error");
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i data-lucide="user-check" class="w-4 h-4"></i> <span>Create Student Account</span>`;
      if (window.lucide) lucide.createIcons();
    }
  }
}

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();
});
