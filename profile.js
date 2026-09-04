/**
 * profile.js - Student Profile & Isolated Avatar Management Module
 * Handles:
 * 1. Accurately mapping database columns (phone_number, email, department, name)
 * 2. Supabase update targeted at authenticated student primary key .eq('id', currentStudent.id)
 * 3. Isolated avatar uploads via Supabase Storage bucket 'avatars' with timestamp scoping:
 *    avatars/${currentStudent.id}_${Date.now()}.${fileExt}
 * 4. Eliminating global avatar collisions (no generic 'student_avatar' localStorage)
 * 5. Immediate session and UI updates without full page reloads
 */

// Global state reference (shares with app.js / student.js if loaded together)
if (typeof currentStudent === 'undefined') {
  var currentStudent = null;
}

/**
 * Renders a student's avatar or fallback initial into the target element
 * @param {HTMLElement} container 
 * @param {Object} student 
 * @param {string} sizeClasses 
 */
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

/**
 * Updates drawer/navigation avatar and details if elements exist
 */
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

/**
 * Fetches the authenticated student's persistent profile record from the students table by id (matching supabase.auth.getUser()).
 * Ensures the fetched email and phone populate the profile view and input states reliably.
 * Supports graceful fallback and automatic legacy backfill if phone/email are empty in students table.
 */
async function fetchStudentProfile(providedId = null) {
  let userId = providedId;

  // 1. Resolve Auth UID via supabase.auth.getUser() if available
  let authUser = null;
  if (typeof supabase !== 'undefined' && supabase.auth) {
    try {
      const { data: authData } = await supabase.auth.getUser();
      authUser = authData?.user;
      if (authUser && authUser.id) {
        userId = userId || authUser.id;
      }
    } catch (e) {
      console.warn("supabase.auth.getUser notice:", e);
    }
  }

  // 2. Fallback to active memory or session
  if (!userId && currentStudent && currentStudent.id) {
    userId = currentStudent.id;
  }
  if (!userId) {
    const stored = sessionStorage.getItem("session_student");
    if (stored) {
      try {
        const parsed = JSON.parse(stored);
        if (parsed && parsed.id) userId = parsed.id;
      } catch (e) {}
    }
  }

  if (!userId) return null;

  let dbStudent = null;

  // 3. Direct fetch from Supabase students table by id
  if (typeof supabase !== 'undefined') {
    try {
      const { data, error } = await supabase
        .from('students')
        .select('*')
        .eq('id', userId)
        .maybeSingle();

      if (!error && data) {
        dbStudent = data;
      } else if (error) {
        console.warn("Supabase students fetch notice:", error.message);
      }
    } catch (dbErr) {
      console.warn("Direct DB fetch caught exception:", dbErr);
    }
  }

  // 4. Secondary sync with /api/auth
  let apiStudent = null;
  try {
    const res = await fetch('/api/auth?id=' + encodeURIComponent(userId));
    const result = await res.json();
    if (result.success && result.data) {
      apiStudent = result.data;
    }
  } catch (e) {}

  // 5. Graceful fallbacks for legacy records (extract email/phone from auth user metadata if needed)
  const authEmail = authUser?.email || null;
  const authPhone = authUser?.user_metadata?.phone || authUser?.user_metadata?.phone_number || authUser?.phone || null;

  const resolvedPhone = (dbStudent && (dbStudent.phone || dbStudent.phone_number))
    || (apiStudent && (apiStudent.phone || apiStudent.phone_number))
    || authPhone
    || (currentStudent && (currentStudent.phone || currentStudent.phone_number))
    || '';

  const resolvedEmail = (dbStudent && dbStudent.email)
    || (apiStudent && apiStudent.email)
    || authEmail
    || (currentStudent && currentStudent.email)
    || '';

  currentStudent = {
    ...(currentStudent || {}),
    ...(apiStudent || {}),
    ...(dbStudent || {}),
    id: userId,
    phone: resolvedPhone,
    phone_number: resolvedPhone,
    email: resolvedEmail
  };

  // Backfill students table if phone or email were empty for legacy records
  if (typeof supabase !== 'undefined' && dbStudent) {
    const needPhoneSync = !dbStudent.phone && resolvedPhone;
    const needEmailSync = !dbStudent.email && resolvedEmail;
    if (needPhoneSync || needEmailSync) {
      const backfillData = {};
      if (needPhoneSync) backfillData.phone = resolvedPhone;
      if (needEmailSync) backfillData.email = resolvedEmail;
      supabase
        .from('students')
        .update(backfillData)
        .eq('id', userId)
        .then(() => console.log("Synced missing attributes to students table:", backfillData))
        .catch(err => console.warn("Backfill notice:", err));
    }
  }

  if (!currentStudent.avatar_url) {
    const scopedAvatar = localStorage.getItem("student_avatar_" + currentStudent.id);
    if (scopedAvatar) currentStudent.avatar_url = scopedAvatar;
  }

  sessionStorage.setItem("session_student", JSON.stringify(currentStudent));
  return currentStudent;
}

/**
 * Populates and displays the Profile Screen
 */
function showProfileScreen() {
  if (!currentStudent) {
    const stored = sessionStorage.getItem("session_student");
    if (stored) {
      currentStudent = JSON.parse(stored);
    } else {
      if (typeof showToast === 'function') {
        showToast("Please log in to view your profile", "error");
      }
      if (window.location.pathname.includes("profile.html")) {
        window.location.href = "index.html";
      }
      return;
    }
  }

  // Map database attributes accurately
  const nameEl = document.getElementById("profile-name");
  if (nameEl) nameEl.innerText = currentStudent.name || '-';

  const regEl = document.getElementById("profile-reg");
  if (regEl) regEl.innerText = currentStudent.reg_no || '-';

  const deptEl = document.getElementById("profile-dept");
  if (deptEl) deptEl.innerText = currentStudent.department || '-';

  const dobEl = document.getElementById("profile-dob");
  if (dobEl) dobEl.innerText = currentStudent.dob || '-';

  // Registered Mobile Number - check phone first, fallback to phone_number
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

  // Render isolated student avatar
  const container = document.getElementById("profile-avatar-container");
  if (container) {
    renderStudentAvatar(container, currentStudent, "w-full h-full");
  }

  // If in SPA router
  if (typeof router !== 'undefined' && router.navigateTo) {
    router.navigateTo("profile-screen");
  }

  if (window.lucide) lucide.createIcons();
}

/**
 * Opens the Edit Profile modal and pre-fills form fields
 */
function openEditProfileModal() {
  if (!currentStudent) {
    if (typeof showToast === 'function') showToast("Please log in to edit your profile", "error");
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

/**
 * Closes the Edit Profile modal
 */
function closeEditProfileModal() {
  const modal = document.getElementById("edit-profile-modal");
  if (modal) modal.classList.add("hidden");
}

/**
 * Handles Edit Profile form submission
 * Executes update query targeting authenticated student primary key .eq('id', currentStudent.id)
 */
async function handleEditProfileSubmit(event) {
  if (event) event.preventDefault();
  if (!currentStudent || !currentStudent.id) {
    if (typeof showToast === 'function') showToast("Session expired. Please log in again.", "error");
    return;
  }

  const nameInput = document.getElementById("edit-profile-name");
  const phoneInput = document.getElementById("edit-profile-phone");
  const emailInput = document.getElementById("edit-profile-email");
  const deptInput = document.getElementById("edit-profile-dept");

  const name = nameInput ? nameInput.value.trim() : '';
  const phone = phoneInput ? phoneInput.value.trim().replace(/\D/g, '') : '';
  const email = emailInput ? emailInput.value.trim() : '';
  const dept = deptInput ? deptInput.value.trim() : '';

  if (!name) {
    if (typeof showToast === 'function') showToast("Please enter your full name", "error");
    return;
  }

  if (phone.length !== 10) {
    if (typeof showToast === 'function') showToast("Mobile number must be exactly 10 digits", "error");
    return;
  }

  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    if (typeof showToast === 'function') showToast("Please enter a valid email address", "error");
    return;
  }

  if (!dept) {
    if (typeof showToast === 'function') showToast("Please enter your department", "error");
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

    // 1. Direct Supabase update targeted at authenticated student's unique primary key
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

    // 2. Also update Supabase Auth user metadata if active
    if (typeof supabase !== 'undefined' && supabase.auth) {
      try {
        await supabase.auth.updateUser({
          data: { phone: phone, name: name }
        });
      } catch (e) {}
    }

    // 3. Secondary persistence via backend API to ensure extended_students.json sync
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
      if (typeof showToast === 'function') {
        showToast("Failed to update profile. Please check database permissions.", "error");
      }
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

    // Refresh UI immediately without requiring a reload
    showProfileScreen();
    updateDrawerInfo();
    closeEditProfileModal();
    if (typeof showToast === 'function') {
      showToast("Profile updated successfully!", "success");
    }
  } catch (err) {
    console.error("Error updating profile:", err);
    if (typeof showToast === 'function') {
      showToast("Error saving profile: " + (err.message || "Unknown error"), "error");
    }
  } finally {
    if (submitBtn) {
      submitBtn.disabled = false;
      submitBtn.innerHTML = `<i data-lucide="check" class="w-4 h-4"></i> <span>Save Changes</span>`;
      if (window.lucide) lucide.createIcons();
    }
  }
}

/**
 * Handles avatar image selection and isolated upload
 * Scoped path: avatars/${currentStudent.id}_${Date.now()}.${fileExt}
 * Persists public URL to students.avatar_url
 */
async function handleAvatarUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  if (!currentStudent || !currentStudent.id) {
    if (typeof showToast === 'function') showToast("Session expired. Please log in again.", "error");
    return;
  }

  // Validate file types (image/png, image/jpeg, image/webp)
  const allowedTypes = ['image/png', 'image/jpeg', 'image/jpg', 'image/webp'];
  if (!allowedTypes.includes(file.type.toLowerCase())) {
    if (typeof showToast === 'function') {
      showToast("Invalid format. Please upload a PNG, JPEG, or WEBP image.", "error");
    }
    event.target.value = '';
    return;
  }

  // Enforce reasonable file size limits (max 2MB)
  const MAX_SIZE = 2 * 1024 * 1024; // 2MB
  if (file.size > MAX_SIZE) {
    if (typeof showToast === 'function') {
      showToast("Image size exceeds 2MB limit. Please choose a smaller image.", "error");
    }
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
    if (typeof supabase !== 'undefined' && supabase.storage) {
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
    if (typeof supabase !== 'undefined') {
      try {
        const { error: dbErr } = await supabase
          .from('students')
          .update({ avatar_url: publicUrl })
          .eq('id', currentStudent.id);
        if (dbErr) console.warn("Supabase avatar_url update note:", dbErr.message);
      } catch (e) {}
    }

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

    if (typeof showToast === 'function') {
      showToast("Profile picture updated successfully!", "success");
    }
  } catch (err) {
    console.error("Avatar upload error:", err);
    if (typeof showToast === 'function') {
      showToast("Failed to upload avatar: " + (err.message || "Unknown error"), "error");
    }
    if (profileContainer) {
      renderStudentAvatar(profileContainer, currentStudent);
    }
  } finally {
    event.target.value = '';
    if (window.lucide) lucide.createIcons();
  }
}

/**
 * Standalone Profile Page Initialization
 */
async function initProfilePage() {
  const stored = sessionStorage.getItem("session_student");
  if (!stored) {
    window.location.href = "index.html";
    return;
  }

  currentStudent = JSON.parse(stored);

  // Fetch persistent profile record from students table by id (matching auth.getUser())
  await fetchStudentProfile(currentStudent?.id);

  showProfileScreen();
}

// Auto-run if standalone profile page
if (typeof window !== 'undefined' && window.location.pathname.includes("profile.html")) {
  document.addEventListener("DOMContentLoaded", initProfilePage);
}
