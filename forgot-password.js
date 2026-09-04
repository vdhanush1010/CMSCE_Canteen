/**
 * forgot-password.js - Standalone Supabase Auth OTP Recovery Controller
 * Enforces strict 3-Minute Validity (03:00) with Resend and Expiration logic
 */

const SUPABASE_URL = 'https://llbegpqowjvsadbundrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsYmVncHFvd2p2c2FkYnVuZHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3Njg4NzAsImV4cCI6MjEwMjM0NDg3MH0.SGoLEoE5PP_Ex0C7tOXrwvcol2vxxOvOFPoSGfD93VA';
const supabase = window.supabase ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY) : null;

let fpCurrentEmail = "";
let fpTimerInterval = null;
let fpRemainingSeconds = 180; // Strict 3:00 minute window

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
      showToast("OTP has expired. Please request a fresh OTP.", "error");
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
        ? "No account found with this email. Please check your email or register."
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

    // Automatic redirection to login
    setTimeout(() => {
      window.location.href = 'index.html';
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
      if (!fpCurrentEmail && session.user.email) {
        fpCurrentEmail = session.user.email;
      }
      stopFpTimer();
      hideFpOtpError();
      goToFpStep(3);
      showToast("✅ Authenticated! Create your new password.", "success");
    }
  });
}

document.addEventListener("DOMContentLoaded", () => {
  if (window.lucide) lucide.createIcons();
});
