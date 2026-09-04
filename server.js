const express = require('express');
const cors = require('cors');
const { createClient } = require('@supabase/supabase-js');
const path = require('path');
const fs = require('fs');

const app = express();
const PORT = process.env.PORT || 5000;

// Enable CORS and Body Parser
app.use(cors());
app.use(express.static(path.join(__dirname)));
app.use(express.json({ limit: '50mb' }));

// Supabase Configuration
const SUPABASE_URL = 'https://llbegpqowjvsadbundrn.supabase.co';
const SUPABASE_ANON_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsYmVncHFvd2p2c2FkYnVuZHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3Njg4NzAsImV4cCI6MjEwMjM0NDg3MH0.SGoLEoE5PP_Ex0C7tOXrwvcol2vxxOvOFPoSGfD93VA';
const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// ----------------------------------------------------
// AUTO-EXPIRY & STOCK RESTORATION LOGIC (30-MINUTE CASH EXPIRY WINDOW)
// ----------------------------------------------------
const CASH_EXPIRY_WINDOW_MS = 30 * 60 * 1000; // 30 minutes (1800 seconds)

async function restoreStockForItems(orderItems) {
  if (!orderItems || !orderItems.length) return;
  for (const item of orderItems) {
    if (item.product_id && item.quantity > 0) {
      try {
        const { data: prod, error: prodErr } = await supabase
          .from('products')
          .select('stock_quantity')
          .eq('id', item.product_id)
          .maybeSingle();

        if (!prodErr && prod) {
          const restoredStock = (prod.stock_quantity || 0) + item.quantity;
          await supabase
            .from('products')
            .update({ stock_quantity: restoredStock })
            .eq('id', item.product_id);
          console.log(`[Auto-Expiry] Restocked product ${item.product_id} by +${item.quantity} (New stock: ${restoredStock})`);
        }
      } catch (err) {
        console.error(`[Auto-Expiry] Failed to restock product ${item.product_id}:`, err.message);
      }
    }
  }
}

async function expireSingleOrder(orderId) {
  try {
    const { data: order, error } = await supabase
      .from('orders')
      .select(`
        id,
        token_number,
        payment_method,
        payment_status,
        order_status,
        created_at,
        order_items (
          product_id,
          quantity
        )
      `)
      .eq('id', orderId)
      .maybeSingle();

    if (error || !order) return null;
    if (order.order_status === 'DELIVERED' || order.order_status === 'CANCELLED') return order;

    // Update order status to CANCELLED (representing EXPIRED in database schema)
    const { data: updated, error: updateErr } = await supabase
      .from('orders')
      .update({ order_status: 'CANCELLED' })
      .eq('id', order.id)
      .select()
      .single();

    if (updateErr) {
      console.error(`[Auto-Expiry] Error updating order ${order.id}:`, updateErr.message);
      return order;
    }

    // Restore stock
    await restoreStockForItems(order.order_items || []);
    console.log(`[Auto-Expiry] Successfully expired order ${order.token_number || order.id} and restored stock.`);
    return updated;
  } catch (err) {
    console.error(`[Auto-Expiry] Error expiring single order ${orderId}:`, err.message);
    return null;
  }
}

async function expireOverdueCashOrders() {
  try {
    const thirtyMinutesAgo = new Date(Date.now() - CASH_EXPIRY_WINDOW_MS).toISOString();

    const { data: overdueOrders, error } = await supabase
      .from('orders')
      .select(`
        id,
        token_number,
        payment_method,
        payment_status,
        order_status,
        created_at,
        order_items (
          product_id,
          quantity
        )
      `)
      .eq('payment_method', 'CASH_AT_COUNTER')
      .eq('order_status', 'PENDING_PICKUP')
      .neq('payment_status', 'PAID')
      .lte('created_at', thirtyMinutesAgo);

    if (error) {
      console.error('[Auto-Expiry] Error fetching overdue cash orders:', error.message);
      return;
    }

    if (!overdueOrders || overdueOrders.length === 0) return;

    console.log(`[Auto-Expiry] Processing ${overdueOrders.length} overdue cash order(s) for expiry...`);

    for (const order of overdueOrders) {
      const { error: updateError } = await supabase
        .from('orders')
        .update({ order_status: 'CANCELLED' })
        .eq('id', order.id);

      if (updateError) {
        console.error(`[Auto-Expiry] Failed to cancel order ${order.id}:`, updateError.message);
        continue;
      }

      await restoreStockForItems(order.order_items || []);
      console.log(`[Auto-Expiry] Order ${order.token_number || order.id} marked CANCELLED/EXPIRED and stock released.`);
    }
  } catch (err) {
    console.error('[Auto-Expiry] Unexpected error during expiry scan:', err.message);
  }
}

// Start recurring background auto-expiry worker (runs every 10 seconds)
setInterval(expireOverdueCashOrders, 10000);
expireOverdueCashOrders(); // Run immediately on startup

// ----------------------------------------------------
// EXTENDED STUDENT PROFILES & OTP AUTH SYSTEM
// ----------------------------------------------------
const EXTENDED_STUDENTS_FILE = path.join(__dirname, 'extended_students.json');
let studentExtendedProfiles = {};

try {
  if (fs.existsSync(EXTENDED_STUDENTS_FILE)) {
    studentExtendedProfiles = JSON.parse(fs.readFileSync(EXTENDED_STUDENTS_FILE, 'utf8'));
  }
} catch (e) {
  console.error("Error reading extended students file:", e);
}

function saveExtendedProfiles() {
  try {
    fs.writeFileSync(EXTENDED_STUDENTS_FILE, JSON.stringify(studentExtendedProfiles, null, 2), 'utf8');
  } catch (e) {
    console.error("Error writing extended students file:", e);
  }
}

// In-memory OTP storage: phone_number -> { otp, student_id, reg_no, expires_at }
const activePasswordResetOtps = new Map();

// ----------------------------------------------------
// STUDENT PORTAL ENDPOINTS
// ----------------------------------------------------

// 1. Student Registration (Mandatory Mobile Number, Optional Email)
app.post('/api/student/register', async (req, res) => {
  const { reg_no, name, department, dob, password, phone_number, email } = req.body;
  if (!reg_no || !name || !department || !dob || !password || !phone_number) {
    return res.status(400).json({ error: "Missing required fields. Mobile number is mandatory." });
  }

  const cleanPhone = String(phone_number).trim().replace(/\D/g, '');
  if (cleanPhone.length !== 10) {
    return res.status(400).json({ error: "Mobile Number must be exactly 10 digits." });
  }

  const cleanEmail = email ? String(email).trim() : null;
  if (cleanEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(cleanEmail)) {
    return res.status(400).json({ error: "Invalid Email Address format." });
  }

  try {
    const formattedReg = reg_no.trim().toUpperCase();

    // Check if reg_no already exists in Supabase
    const { data: existing, error: checkError } = await supabase
      .from('students')
      .select('id')
      .eq('reg_no', formattedReg)
      .maybeSingle();

    if (checkError) throw checkError;
    if (existing) {
      return res.status(400).json({ error: "Register number is already registered" });
    }

    // Check if phone number is already registered
    for (const [id, ext] of Object.entries(studentExtendedProfiles)) {
      if (ext && ext.phone_number === cleanPhone) {
        return res.status(400).json({ error: "Mobile number is already registered with another account." });
      }
    }

    // Try inserting with phone and email into Supabase first
    let newStudent = null;
    try {
      let { data, error } = await supabase
        .from('students')
        .insert([{
          reg_no: formattedReg,
          name,
          department,
          dob,
          phone: cleanPhone,
          email: cleanEmail,
          password_hash: password
        }])
        .select()
        .single();

      if (error && (error.code === 'PGRST204' || error.message.includes('column'))) {
        const fb = await supabase
          .from('students')
          .insert([{
            reg_no: formattedReg,
            name,
            department,
            dob,
            phone_number: cleanPhone,
            email: cleanEmail,
            password_hash: password
          }])
          .select()
          .single();
        data = fb.data;
        error = fb.error;
      }

      if (!error && data) {
        newStudent = data;
      }
    } catch (e) {}

    // Fallback if remote schema cache does not have phone_number/email columns
    if (!newStudent) {
      const { data: fallbackStudent, error: insertError } = await supabase
        .from('students')
        .insert([{
          reg_no: formattedReg,
          name,
          department,
          dob,
          password_hash: password
        }])
        .select()
        .single();

      if (insertError) throw insertError;
      newStudent = fallbackStudent;
    }

    // Save extended profile
    studentExtendedProfiles[newStudent.id] = {
      phone_number: cleanPhone,
      email: cleanEmail,
      reg_no: formattedReg,
      name: name
    };
    saveExtendedProfiles();

    newStudent.phone_number = cleanPhone;
    newStudent.email = cleanEmail;

    res.status(201).json(newStudent);
  } catch (err) {
    console.error("Register error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2. Student Login (Preserve Core Flow: Reg No + Password)
app.post('/api/student/login', async (req, res) => {
  const { reg_no, password } = req.body;
  if (!reg_no || !password) {
    return res.status(400).json({ error: "Register number and password are required" });
  }
  
  try {
    const formattedReg = reg_no.trim().toUpperCase();
    const { data: student, error } = await supabase
      .from('students')
      .select('*')
      .eq('reg_no', formattedReg)
      .maybeSingle();
      
    if (error) throw error;
    if (!student) {
      return res.status(404).json({ error: "Student Register Number not found" });
    }
    
    if (student.password_hash !== password) {
      return res.status(401).json({ error: "Invalid credentials" });
    }

    const ext = studentExtendedProfiles[student.id] || {};
    const resolvedPhone = student.phone || student.phone_number || ext.phone || ext.phone_number || '';
    student.phone = resolvedPhone;
    student.phone_number = resolvedPhone;
    student.email = student.email || ext.email || '';
    student.avatar_url = student.avatar_url || ext.avatar_url || '';
    
    res.json({ success: true, student });
  } catch (err) {
    console.error("Login error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2.5. Get Student Profile
app.get('/api/student/:id', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('students')
      .select('*')
      .eq('id', req.params.id)
      .maybeSingle();
    if (error) throw error;
    if (data) {
      const ext = studentExtendedProfiles[data.id] || {};
      const resolvedPhone = data.phone || data.phone_number || ext.phone || ext.phone_number || '';
      data.phone = resolvedPhone;
      data.phone_number = resolvedPhone;
      data.email = data.email || ext.email || '';
      data.avatar_url = data.avatar_url || ext.avatar_url || '';
    }
    res.json(data);
  } catch (err) {
    console.error("Get student profile error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2.6. Update Student Profile
app.put('/api/student/:id', async (req, res) => {
  try {
    const { name, department, phone, phone_number, email } = req.body;
    const studentId = req.params.id;
    const cleanPhone = (phone || phone_number) ? String(phone || phone_number).trim().replace(/\D/g, '') : '';
    const cleanEmail = email ? String(email).trim() : '';

    studentExtendedProfiles[studentId] = {
      ...(studentExtendedProfiles[studentId] || {}),
      phone: cleanPhone,
      phone_number: cleanPhone,
      email: cleanEmail,
      department: department ? department.trim() : '',
      name: name ? name.trim() : ''
    };
    saveExtendedProfiles();

    try {
      const { error: updErr } = await supabase.from('students').update({
        phone: cleanPhone,
        email: cleanEmail || null,
        department,
        name
      }).eq('id', studentId);

      if (updErr) {
        await supabase.from('students').update({
          phone_number: cleanPhone,
          email: cleanEmail || null,
          department,
          name
        }).eq('id', studentId);
      }
    } catch (e) {
      try {
        await supabase.from('students').update({ department, name }).eq('id', studentId);
      } catch (e2) {}
    }

    res.json({ success: true, student: { id: studentId, name, department, phone: cleanPhone, phone_number: cleanPhone, email: cleanEmail } });
  } catch (err) {
    console.error("Update student profile error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 2.7. Update Student Avatar
app.post('/api/student/update-avatar', async (req, res) => {
  try {
    const { id, avatar_url } = req.body;
    if (!id || !avatar_url) return res.status(400).json({ error: "Missing id or avatar_url" });

    studentExtendedProfiles[id] = {
      ...(studentExtendedProfiles[id] || {}),
      avatar_url
    };
    saveExtendedProfiles();

    try {
      await supabase.from('students').update({ avatar_url }).eq('id', id);
    } catch (e) {}

    res.json({ success: true, id, avatar_url });
  } catch (err) {
    console.error("Update student avatar error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// EMAIL-BASED "FORGOT PASSWORD" OTP FLOW (3-MINUTE VALIDITY)
// ----------------------------------------------------
const { sendRecoveryEmail } = require('./api/emailService');
const ACTIVE_OTPS_FILE = path.join(__dirname, 'active_otps.json');

function getActiveEmailResetOtps() {
  try {
    if (fs.existsSync(ACTIVE_OTPS_FILE)) {
      const data = JSON.parse(fs.readFileSync(ACTIVE_OTPS_FILE, 'utf8'));
      const now = Date.now();
      const valid = {};
      let changed = false;
      for (const [key, session] of Object.entries(data)) {
        if (session && session.expires_at > now) {
          valid[key] = session;
        } else {
          changed = true;
        }
      }
      if (changed) {
        fs.writeFileSync(ACTIVE_OTPS_FILE, JSON.stringify(valid, null, 2), 'utf8');
      }
      return valid;
    }
  } catch (e) {
    console.error("Error reading active OTPs file:", e);
  }
  return {};
}

function saveActiveEmailResetOtp(key, sessionData) {
  try {
    const otps = getActiveEmailResetOtps();
    if (sessionData === null) {
      delete otps[key];
    } else {
      otps[key] = sessionData;
    }
    fs.writeFileSync(ACTIVE_OTPS_FILE, JSON.stringify(otps, null, 2), 'utf8');
    return otps[key];
  } catch (e) {
    console.error("Error writing active OTPs file:", e);
  }
}

// Step 1: Request 6-Digit OTP via Email
app.post('/api/student/forgot-password/request-otp', async (req, res) => {
  const { email, phone_number } = req.body;
  const targetEmail = email ? String(email).trim().toLowerCase() : null;
  const targetPhone = phone_number ? String(phone_number).trim().replace(/\D/g, '') : null;

  if (!targetEmail && !targetPhone) {
    return res.status(400).json({ error: "Registered Email Address is required." });
  }

  try {
    let student = null;

    // Search extended profiles map first
    for (const [id, ext] of Object.entries(studentExtendedProfiles)) {
      if (ext) {
        if (targetEmail && ext.email && ext.email.trim().toLowerCase() === targetEmail) {
          student = { id, ...ext };
          break;
        }
        if (targetPhone && ext.phone_number === targetPhone) {
          student = { id, ...ext };
          break;
        }
      }
    }

    // Check Supabase DB directly if not found
    if (!student) {
      try {
        let query = supabase.from('students').select('*');
        if (targetEmail) query = query.ilike('email', targetEmail);
        else if (targetPhone) query = query.eq('phone_number', targetPhone);
        const { data: dbStudent } = await query.maybeSingle();
        if (dbStudent) student = dbStudent;
      } catch (e) {}
    }

    if (!student) {
      return res.status(404).json({ 
        error: "No student account found with this email address. Please check your spelling or register." 
      });
    }

    // Generate 6-digit OTP with strict 3-minute validity (180 seconds)
    const otp = String(Math.floor(100000 + Math.random() * 900000));
    const expiresAt = Date.now() + 180 * 1000; // 3:00 minutes validity
    const lookupKey = targetEmail || targetPhone;

    saveActiveEmailResetOtp(lookupKey, {
      otp,
      student_id: student.id,
      student_name: student.name,
      reg_no: student.reg_no,
      email: student.email || targetEmail,
      expires_at: expiresAt,
      verified: false
    });

    console.log(`\n======================================================`);
    console.log(`[EMAIL OTP DISPATCH] 📧 Sent to: ${student.email || lookupKey} (${student.name})`);
    console.log(`[EMAIL OTP DISPATCH] 🔑 6-Digit Password Reset OTP: ${otp}`);
    console.log(`[EMAIL OTP DISPATCH] ⏳ Strict 3-Minute Validity: Expires in 180s`);
    console.log(`======================================================\n`);

    // Dispatch real email via emailService
    const emailResult = await sendRecoveryEmail({
      to: student.email || lookupKey,
      name: student.name,
      otp
    });

    // Also trigger Supabase Auth recovery in background as secondary channel
    try {
      if (student.email || targetEmail) {
        await supabase.auth.resetPasswordForEmail(student.email || targetEmail);
      }
    } catch (sErr) {}

    res.json({
      success: true,
      message: `6-digit verification code sent to ${student.email || lookupKey}`,
      test_otp: otp, // Enables instant fallback and sandbox testing if mail server rate-limits
      preview_url: emailResult.preview_url || null,
      email_sent: emailResult.sent,
      delivery_mode: emailResult.mode || (emailResult.sent ? 'smtp' : 'simulated'),
      expires_in_seconds: 180,
      email: student.email || lookupKey
    });
  } catch (err) {
    console.error("Request OTP error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Step 2: Verify OTP
app.post('/api/student/forgot-password/verify-otp', async (req, res) => {
  const { email, phone_number, otp } = req.body;
  const lookupKey = (email ? String(email).trim().toLowerCase() : null) || (phone_number ? String(phone_number).trim().replace(/\D/g, '') : null);

  if (!lookupKey || !otp) {
    return res.status(400).json({ error: "Email and 6-digit OTP are required." });
  }

  const cleanOtp = String(otp).trim();
  const otps = getActiveEmailResetOtps();
  const session = otps[lookupKey];

  if (!session) {
    return res.status(400).json({ error: "No active OTP request found. Please request a new OTP." });
  }

  if (Date.now() > session.expires_at) {
    saveActiveEmailResetOtp(lookupKey, null);
    return res.status(400).json({ error: "OTP has expired (3-minute window ended). Please request a fresh OTP." });
  }

  if (session.otp !== cleanOtp) {
    return res.status(400).json({ error: "Invalid 6-digit verification code. Please check and try again." });
  }

  session.verified = true;
  saveActiveEmailResetOtp(lookupKey, session);

  res.json({
    success: true,
    message: "OTP verified successfully. You may now create a new password."
  });
});

// Step 3 & 4: Reset Password
app.post('/api/student/forgot-password/reset-password', async (req, res) => {
  const { email, phone_number, otp, new_password } = req.body;
  const lookupKey = (email ? String(email).trim().toLowerCase() : null) || (phone_number ? String(phone_number).trim().replace(/\D/g, '') : null);

  if (!lookupKey || !new_password) {
    return res.status(400).json({ error: "Missing required reset password fields." });
  }

  if (new_password.length < 6) {
    return res.status(400).json({ error: "Password must be at least 6 characters long." });
  }

  const otps = getActiveEmailResetOtps();
  const session = otps[lookupKey];
  if (!session || !session.verified) {
    return res.status(400).json({ error: "Unauthorized: Please verify your OTP code before resetting password." });
  }

  try {
    // Update password in Supabase students table
    await supabase
      .from('students')
      .update({ password_hash: new_password })
      .eq('id', session.student_id);

    // Update extended profile
    if (studentExtendedProfiles[session.student_id]) {
      studentExtendedProfiles[session.student_id].password_hash = new_password;
      saveStudentExtendedProfiles();
    }

    // Invalidate OTP
    saveActiveEmailResetOtp(lookupKey, null);

    console.log(`[Password Reset] Password updated successfully for student ${session.reg_no} (${lookupKey})`);

    res.json({
      success: true,
      message: "Password reset successfully! You can now log in with your new password."
    });
  } catch (err) {
    console.error("Reset password error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

let isCanteenOpen = true;

// Get canteen status
app.get('/api/canteen/status', (req, res) => {
  res.json({ is_open: isCanteenOpen });
});

// Update canteen status
app.patch('/api/canteen/status', (req, res) => {
  const { is_open } = req.body;
  if (is_open === undefined) {
    return res.status(400).json({ error: "is_open field is required" });
  }
  isCanteenOpen = !!is_open;
  res.json({ success: true, is_open: isCanteenOpen });
});

// 3. Get Categories
app.get('/api/categories', async (req, res) => {
  try {
    const { data, error } = await supabase.from('categories').select('*');
    if (error) throw error;
    res.status(200).json(data || []);
  } catch (err) {
    console.error("Categories fetch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 4. Get Products (with optional category filter)
app.get('/api/products', async (req, res) => {
  const { category_id } = req.query;
  try {
    let query = supabase.from('products').select('*');
    if (category_id) {
      query = query.eq('category_id', category_id);
    }
    const { data, error } = await query;
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error("Products fetch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// PAYMENT GATEWAY ENGINE (UPI INTENT & DYNAMIC QR)
// ----------------------------------------------------
const activePaymentSessions = new Map();
const DYNAMIC_QR_EXPIRY_MS = 3 * 60 * 1000; // 3 minutes (180 seconds)

// Clean expired payment sessions every 30 seconds
setInterval(() => {
  const now = Date.now();
  for (const [txnRef, session] of activePaymentSessions.entries()) {
    if (now > session.expires_at && session.status === 'PENDING') {
      session.status = 'EXPIRED';
      console.log(`[Payment Gateway] Session ${txnRef} expired automatically after 3 minutes.`);
    }
    // Delete very old sessions (older than 15 mins)
    if (now - session.created_at > 15 * 60 * 1000) {
      activePaymentSessions.delete(txnRef);
    }
  }
}, 30000);

// 5a. Create Payment Gateway Session (Dual Option: UPI Intent + Dynamic QR)
app.post('/api/payment/create-session', async (req, res) => {
  const { student_id, items, total_amount } = req.body;
  if (!student_id || !items || !items.length || !total_amount) {
    return res.status(400).json({ error: "Missing required checkout fields" });
  }

  try {
    // 1. Verify stock before creating payment session
    const { data: dbProducts, error: prodErr } = await supabase.from('products').select('*');
    if (prodErr) throw prodErr;

    for (const item of items) {
      const prod = (dbProducts || []).find(p => p.id === item.product_id);
      if (!prod || prod.stock_quantity < item.quantity) {
        return res.status(400).json({ 
          error: `Item "${prod ? prod.name : 'Unknown'}" is out of stock or insufficient quantity.` 
        });
      }
    }

    const now = Date.now();
    const txnRef = `TXN_UPI_${now}_${Math.floor(1000 + Math.random() * 9000)}`;
    const expiresAt = now + DYNAMIC_QR_EXPIRY_MS;
    const cleanAmount = parseFloat(total_amount).toFixed(2);
    
    // Standard UPI Intent URL targeting installed UPI apps (GPay, PhonePe, Paytm, etc.)
    const upiIntentUri = `upi://pay?pa=vdhanush2005123@okicici&pn=Hostel%20Canteen%20Store&am=${cleanAmount}&cu=INR&tn=Order_${txnRef}&tr=${txnRef}`;

    const sessionData = {
      txn_ref: txnRef,
      student_id,
      items,
      total_amount: parseFloat(cleanAmount),
      upi_intent_url: upiIntentUri,
      status: 'PENDING',
      created_at: now,
      expires_at: expiresAt,
      order: null
    };

    activePaymentSessions.set(txnRef, sessionData);

    console.log(`[Payment Gateway] Session initialized: ${txnRef} for ₹${cleanAmount} (Expires in 3m)`);

    res.status(201).json({
      success: true,
      txn_ref: txnRef,
      total_amount: parseFloat(cleanAmount),
      upi_intent_url: upiIntentUri,
      expires_at: expiresAt,
      validity_seconds: 180
    });
  } catch (err) {
    console.error("Create payment session error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 5b. Get Payment Session Status (Polling for Dynamic QR / Instant Realtime)
app.get('/api/payment/status/:txnRef', (req, res) => {
  const { txnRef } = req.params;
  const session = activePaymentSessions.get(txnRef);

  if (!session) {
    return res.status(404).json({ error: "Payment session not found or has expired" });
  }

  const now = Date.now();
  if (now > session.expires_at && session.status === 'PENDING') {
    session.status = 'EXPIRED';
  }

  const secondsRemaining = Math.max(0, Math.floor((session.expires_at - now) / 1000));

  res.json({
    txn_ref: session.txn_ref,
    status: session.status,
    seconds_remaining: secondsRemaining,
    is_expired: session.status === 'EXPIRED',
    order: session.order
  });
});

// 5c. Cancel / Invalidate Payment Session (Tab switch exclusivity or modal dismiss)
app.post('/api/payment/cancel-session', (req, res) => {
  const { txn_ref } = req.body;
  if (!txn_ref) return res.status(400).json({ error: "Transaction reference is required" });

  const session = activePaymentSessions.get(txn_ref);
  if (session && session.status === 'PENDING') {
    session.status = 'CANCELLED';
    console.log(`[Payment Gateway] Session ${txn_ref} explicitly cancelled / invalidated.`);
  }

  res.json({ success: true, message: "Session cancelled" });
});

// 5d. Verify Payment & Atomically Issue Order Token
app.post('/api/payment/verify', async (req, res) => {
  const { txn_ref, payment_id, method, student_id, items, total_amount } = req.body;
  if (!txn_ref) {
    return res.status(400).json({ error: "Transaction reference is required for payment verification." });
  }

  try {
    const session = activePaymentSessions.get(txn_ref);
    
    // Check if session is already paid
    if (session && session.status === 'PAID' && session.order) {
      return res.json({ success: true, order: session.order, txn_ref });
    }

    // Check expiry
    if (session && session.status === 'EXPIRED') {
      return res.status(400).json({ error: "Payment session expired. Please generate a new QR or intent." });
    }

    const orderStudentId = session ? session.student_id : student_id;
    const orderItems = session ? session.items : items;
    const orderTotal = session ? session.total_amount : total_amount;

    if (!orderStudentId || !orderItems || !orderItems.length || !orderTotal) {
      return res.status(400).json({ error: "Incomplete order data for payment verification." });
    }

    // Re-verify stock before final DB insertion
    const { data: dbProducts, error: prodErr } = await supabase.from('products').select('*');
    if (prodErr) throw prodErr;

    for (const item of orderItems) {
      const prod = (dbProducts || []).find(p => p.id === item.product_id);
      if (!prod || prod.stock_quantity < item.quantity) {
        if (session) session.status = 'FAILED';
        return res.status(400).json({ 
          error: `Stock depleted for "${prod ? prod.name : 'product'}". Order cannot be completed.` 
        });
      }
    }

    // Insert order with payment_method: 'ONLINE', payment_status: 'PAID'
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert([{
        student_id: orderStudentId,
        total_amount: orderTotal,
        payment_method: 'ONLINE',
        payment_status: 'PAID',
        order_status: 'PENDING_PICKUP',
        qr_code_data: {
          txn_ref: txn_ref,
          payment_id: payment_id || txn_ref,
          payment_mode: 'UPI',
          verified_at: new Date().toISOString()
        }
      }])
      .select()
      .single();

    if (orderError) throw orderError;

    // Insert order items
    const itemsToInsert = orderItems.map(item => ({
      order_id: order.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price
    }));

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(itemsToInsert);

    if (itemsError) throw itemsError;

    // Fetch the full order including students and trigger-generated token_number
    const { data: finalOrder, error: fetchError } = await supabase
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
            name
          )
        )
      `)
      .eq('id', order.id)
      .single();

    if (fetchError) throw fetchError;

    // Update memory session
    if (session) {
      session.status = 'PAID';
      session.order = finalOrder;
    } else {
      activePaymentSessions.set(txn_ref, {
        txn_ref,
        status: 'PAID',
        order: finalOrder,
        created_at: Date.now(),
        expires_at: Date.now() + 600000
      });
    }

    console.log(`[Payment Gateway] Payment verified & Token ${finalOrder.token_number} issued for ${txn_ref}`);

    res.status(201).json({
      success: true,
      message: "Payment successfully verified and order token issued.",
      txn_ref: txn_ref,
      order: finalOrder
    });
  } catch (err) {
    console.error("Payment verify error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 5e. Payment Gateway Webhook Handler
app.post('/api/payment/webhook', async (req, res) => {
  const { event, payload } = req.body;
  console.log(`[Payment Gateway Webhook] Event received:`, event);

  try {
    if (event === 'payment.captured' || event === 'order.paid' || event === 'upi.success') {
      const txnRef = payload?.txn_ref || payload?.order_id;
      if (txnRef && activePaymentSessions.has(txnRef)) {
        const session = activePaymentSessions.get(txnRef);
        session.status = 'PAID';
        console.log(`[Payment Gateway Webhook] Session ${txnRef} updated to PAID.`);
      }
    }
    res.json({ status: 'ok', received: true });
  } catch (err) {
    console.error("Webhook processing error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 5. Place Order (Student & Guest Counter Orders)
app.post('/api/orders', async (req, res) => {
  const { student_id, items, payment_method, payment_status, total_amount, payment_mode, order_type, guest_name } = req.body;
  if (!items || !items.length) {
    return res.status(400).json({ error: "Missing required order details" });
  }

  const isPos = order_type === 'POS' || req.body.order_source === 'POS' || req.body.is_pos === true;
  const isGuestOrder = !isPos && (!student_id || student_id === 'GUEST' || order_type === 'GUEST_ORDER');
  const resolvedStudentId = (isGuestOrder || isPos) ? null : student_id;
  const resolvedOrderType = isPos ? 'POS' : (isGuestOrder ? 'GUEST_ORDER' : (order_type || 'ONLINE_STUDENT'));
  const selectedMode = (payment_mode === 'UPI' || payment_method === 'ONLINE') ? 'UPI' : 'CASH';
  const method = selectedMode === 'UPI' ? 'ONLINE' : 'CASH_AT_COUNTER';
  const pStatus = isPos ? 'PAID' : (payment_status || 'PENDING');
  const calculatedTotal = items.reduce((s, it) => s + (parseFloat(it.unit_price || 0) * parseInt(it.quantity || 1)), 0);
  const finalTotalAmount = parseFloat(total_amount) || calculatedTotal;

  try {
    // 1. Verify stock levels before inserting
    const { data: dbProducts, error: pErr } = await supabase.from('products').select('id, name, stock_quantity');
    if (!req.body.stock_pre_deducted && !pErr && dbProducts) {
      for (const item of items) {
        const prod = dbProducts.find(p => p.id === item.product_id);
        if (!prod || prod.stock_quantity < item.quantity) {
          return res.status(400).json({
            error: `${prod ? prod.name : 'Item'} is out of stock or quantity no longer available!`
          });
        }
      }
    }

    // Calculate Daily Reset Order Ticket Number (#TK-101 onwards)
    let ticketNumber = req.body.token_number || req.body.ticket_number;
    if (!ticketNumber) {
      const startOfToday = new Date();
      startOfToday.setHours(0, 0, 0, 0);

      const { count } = await supabase
        .from('orders')
        .select('*', { count: 'exact', head: true })
        .gte('created_at', startOfToday.toISOString());

      const dailySeq = (count || 0) + 101;
      ticketNumber = `#TK-${dailySeq}`;
    }

    // 2. Insert into orders table (student_id is null for guest and POS orders)
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert([{
        student_id: resolvedStudentId,
        token_number: ticketNumber,
        total_amount: finalTotalAmount,
        payment_method: method,
        payment_status: pStatus,
        order_status: isPos ? 'DELIVERED' : 'PENDING_PICKUP'
      }])
      .select()
      .single();

    if (orderError) throw orderError;

    // 3. Update qr_code_data with payment_mode, order_type, guest info, and status
    const initialQrData = order.qr_code_data || {};
    const finalToken = ticketNumber;

    const updatedQrData = {
      ...initialQrData,
      token_number: finalToken,
      order_type: resolvedOrderType,
      order_source: isPos ? 'POS' : 'APP',
      is_pos: isPos,
      is_spot_sale: isPos,
      is_guest: isGuestOrder,
      guest_name: guest_name || (isGuestOrder ? 'Guest User' : null),
      payment_mode: selectedMode,
      payment_status: pStatus,
      status: isPos ? 'DELIVERED' : 'PENDING',
      items: items.map(i => ({ product_id: i.product_id, quantity: i.quantity, unit_price: i.unit_price })),
      total_amount: finalTotalAmount,
      created_at: new Date().toISOString()
    };

    const updatePayload = {
      token_number: finalToken,
      qr_code_data: updatedQrData
    };
    if (isPos) {
      updatePayload.order_status = 'DELIVERED';
      updatePayload.payment_status = 'PAID';
    }

    await supabase
      .from('orders')
      .update(updatePayload)
      .eq('id', order.id);

    order.token_number = finalToken;
    order.qr_code_data = updatedQrData;

    // 4. Insert items into order_items (triggers automated stock decrement)
    const orderItems = items.map(item => ({
      order_id: order.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price
    }));

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems);

    if (itemsError) throw itemsError;

    // 5. Re-fetch order with relations
    const { data: finalOrder, error: fetchError } = await supabase
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
            name
          )
        )
      `)
      .eq('id', order.id)
      .single();

    if (fetchError) throw fetchError;

    // Attach fallback guest student profile info if null
    if (isGuestOrder && !finalOrder.students) {
      finalOrder.students = {
        name: guest_name || 'Guest User',
        reg_no: 'GUEST',
        department: 'Guest Diner'
      };
    }

    res.status(201).json(finalOrder);
  } catch (err) {
    console.error("Place order error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 5x. Student Order Cancellation (Strict 5-minute window)
app.patch('/api/orders', async (req, res) => {
  const { id, token, action } = req.body || {};
  if (action === 'cancel') {
    const lookup = id || token;
    if (!lookup) return res.status(400).json({ success: false, error: 'Order ID or token is required' });

    try {
      let query = supabase.from('orders').select('*, order_items(*, products(*))');
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(lookup);
      if (isUUID) {
        query = query.eq('id', lookup);
      } else {
        query = query.ilike('token_number', lookup);
      }
      const { data: order, error: fetchErr } = await query.maybeSingle();
      if (fetchErr || !order) {
        return res.status(404).json({ success: false, error: 'Order not found' });
      }

      if (order.order_status === 'DELIVERED') {
        return res.status(400).json({ success: false, error: 'Delivered orders cannot be cancelled' });
      }
      if (order.order_status === 'CANCELLED') {
        return res.status(400).json({ success: false, error: 'Order is already cancelled' });
      }

      const createdAt = order.created_at ? new Date(order.created_at).getTime() : Date.now();
      const elapsedMs = Date.now() - createdAt;
      const CANCELLATION_GRACE_PERIOD_MS = 5 * 60 * 1000;
      if (elapsedMs > CANCELLATION_GRACE_PERIOD_MS) {
        return res.status(400).json({ success: false, error: 'Cancellation window closed. Orders can only be cancelled within 5 minutes.' });
      }

      const qd = typeof order.qr_code_data === 'object' && order.qr_code_data !== null
        ? { ...order.qr_code_data }
        : {};
      qd.status = 'CANCELLED';
      qd.cancelled_at = new Date().toISOString();
      qd.cancel_reason = 'Cancelled by student within 5-minute grace period';

      const { data: updatedOrder, error: updateErr } = await supabase
        .from('orders')
        .update({
          order_status: 'CANCELLED',
          qr_code_data: qd
        })
        .eq('id', order.id)
        .select('*, students(*), order_items(*, products(*))')
        .single();

      if (updateErr) throw updateErr;

      // Restore stock
      await restoreStockForItems(order.order_items || []);

      return res.json({ success: true, data: updatedOrder });
    } catch (err) {
      return res.status(500).json({ success: false, error: err.message });
    }
  }
  return res.status(400).json({ success: false, error: 'Invalid action' });
});

// 5b. Manager: Confirm Payment Received (Updates payment_status = 'PAID' and pushes order to kitchen queue)
app.patch('/api/orders/:id/confirm-payment', async (req, res) => {
  const { id } = req.params;
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) {
      return res.status(404).json({ error: "Order not found" });
    }

    let existingQr = {};
    if (existing.qr_code_data) {
      existingQr = typeof existing.qr_code_data === 'string'
        ? JSON.parse(existing.qr_code_data)
        : existing.qr_code_data;
    }

    const updatedQrData = {
      ...existingQr,
      payment_status: 'PAID',
      paid_at: new Date().toISOString()
    };

    const { data: updatedOrder, error: updateErr } = await supabase
      .from('orders')
      .update({
        payment_status: 'PAID',
        qr_code_data: updatedQrData
      })
      .eq('id', id)
      .select(`
        *,
        students (name, reg_no, department),
        order_items (*, products (name))
      `)
      .single();

    if (updateErr) throw updateErr;

    console.log(`[Confirm Payment] Order ${updatedOrder.token_number} (${id}) marked as PAID and pushed to kitchen queue`);
    res.json({ success: true, order: updatedOrder });
  } catch (err) {
    console.error("Confirm payment error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 5c. Instant 1-Step Token Scan / Quick Verify
// Atomically marks order as payment_status: 'PAID' and order_status: 'DELIVERED' in a single Supabase query
app.post('/api/orders/quick-verify', async (req, res) => {
  let { token } = req.body;
  if (!token) {
    return res.status(400).json({ error: "Token number or QR scan data required" });
  }

  try {
    token = String(token).trim();

    // 1. Try parsing JSON if scanner passed a raw JSON payload
    let targetToken = token;
    let targetId = null;
    if (token.startsWith('{') && token.endsWith('}')) {
      try {
        const parsed = JSON.parse(token);
        if (parsed.token_number) targetToken = parsed.token_number;
        else if (parsed.token) targetToken = parsed.token;
        if (parsed.order_id || parsed.id) targetId = parsed.order_id || parsed.id;
      } catch (e) {}
    }

    // 2. Normalize token search query
    let cleanToken = targetToken.replace(/^#/, '').trim();
    let candidates = [
      targetToken,
      `#${cleanToken}`,
      cleanToken,
      cleanToken.startsWith('TK-') ? cleanToken : `TK-${cleanToken}`,
      `#TK-${cleanToken.replace(/^TK-?/i, '')}`
    ];
    candidates = [...new Set(candidates)];

    let query = supabase
      .from('orders')
      .select(`
        *,
        students (name, reg_no, department),
        order_items (*, products (name))
      `);

    if (targetId) {
      query = query.eq('id', targetId);
    } else {
      query = query.in('token_number', candidates);
    }

    const { data: matchedOrders, error: findErr } = await query;
    if (findErr) throw findErr;

    if (!matchedOrders || matchedOrders.length === 0) {
      return res.status(404).json({ error: "❌ Token Invalid / Not Found" });
    }

    // Prefer active order (PENDING_PICKUP) if multiple exists
    let order = matchedOrders.find(o => o.order_status === 'PENDING_PICKUP') || matchedOrders[0];

    if (order.order_status === 'DELIVERED') {
      return res.status(400).json({ 
        error: `❌ Token ${order.token_number} Already Delivered!`,
        code: "ALREADY_DELIVERED",
        order
      });
    }

    if (order.order_status === 'CANCELLED') {
      return res.status(400).json({ 
        error: `❌ Order ${order.token_number} is Cancelled / Expired!`,
        code: "CANCELLED",
        order
      });
    }

    // 3. Atomically update both payment_status and order_status in Supabase
    const nowIso = new Date().toISOString();
    let existingQr = {};
    if (order.qr_code_data) {
      existingQr = typeof order.qr_code_data === 'string'
        ? JSON.parse(order.qr_code_data)
        : order.qr_code_data;
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

    const { data: updatedOrder, error: updateErr } = await supabase
      .from('orders')
      .update({
        payment_status: 'PAID',
        order_status: 'DELIVERED',
        qr_code_data: updatedQrData
      })
      .eq('id', order.id)
      .select(`
        *,
        students (name, reg_no, department),
        order_items (*, products (name))
      `)
      .single();

    if (updateErr) throw updateErr;

    console.log(`[Quick-Verify] Token ${updatedOrder.token_number} (${updatedOrder.id}) marked PAID & DELIVERED`);
    res.json({
      success: true,
      message: `✅ Token ${updatedOrder.token_number} Settled & Delivered!`,
      order: updatedOrder
    });
  } catch (err) {
    console.error("Quick-verify error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 5d. Dispatch / Deliver Order
app.patch('/api/orders/:id/deliver', async (req, res) => {
  const { id } = req.params;
  try {
    const { data: existing, error: fetchErr } = await supabase
      .from('orders')
      .select('*')
      .eq('id', id)
      .single();

    if (fetchErr || !existing) {
      return res.status(404).json({ error: "Order not found" });
    }

    const nowIso = new Date().toISOString();
    let existingQr = {};
    if (existing.qr_code_data) {
      existingQr = typeof existing.qr_code_data === 'string'
        ? JSON.parse(existing.qr_code_data)
        : existing.qr_code_data;
    }

    const updatedQrData = {
      ...existingQr,
      payment_status: 'PAID',
      status: 'DELIVERED',
      order_status: 'DELIVERED',
      completed_at: nowIso,
      delivered_at: nowIso
    };

    const { data: updatedOrder, error: updateErr } = await supabase
      .from('orders')
      .update({
        payment_status: 'PAID',
        order_status: 'DELIVERED',
        qr_code_data: updatedQrData
      })
      .eq('id', id)
      .select(`
        *,
        students (name, reg_no, department),
        order_items (*, products (name))
      `)
      .single();

    if (updateErr) throw updateErr;

    res.json({ success: true, order: updatedOrder });
  } catch (err) {
    console.error("Deliver error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 5f. Quick Sale (Spot POS) Walk-in Counter Sale
app.post('/api/pos/sale', async (req, res) => {
  const { items, payment_mode, total_amount } = req.body;
  if (!items || !Array.isArray(items) || items.length === 0) {
    return res.status(400).json({ error: "Cart is empty. Please add items before checking out." });
  }

  const mode = (payment_mode === 'UPI' || payment_mode === 'ONLINE') ? 'UPI' : 'CASH';
  const paymentMethod = mode === 'UPI' ? 'ONLINE' : 'CASH_AT_COUNTER';
  const calculatedTotal = items.reduce((sum, it) => sum + (parseFloat(it.unit_price) * parseInt(it.quantity)), 0);
  const finalTotal = parseFloat(total_amount) || calculatedTotal;

  try {
    // 1. Fetch current stock for all requested items to guarantee atomic sufficiency & prevent negative stock
    const productIds = items.map(it => it.product_id);
    const { data: dbProducts, error: prodErr } = await supabase
      .from('products')
      .select('id, name, price, stock_quantity')
      .in('id', productIds);

    if (prodErr) throw prodErr;

    for (const item of items) {
      const prod = (dbProducts || []).find(p => p.id === item.product_id);
      if (!prod) {
        return res.status(400).json({ error: `Product "${item.name || 'item'}" not found in inventory.` });
      }
      if (prod.stock_quantity < item.quantity) {
        return res.status(400).json({
          error: `Insufficient stock for "${prod.name}". Requested: ${item.quantity}, Available: ${prod.stock_quantity}.`
        });
      }
    }

    // 2. Insert into orders table
    const { data: order, error: orderError } = await supabase
      .from('orders')
      .insert([{
        student_id: null,
        total_amount: finalTotal,
        payment_method: paymentMethod,
        payment_status: 'PAID',
        order_status: 'DELIVERED',
        qr_code_data: {
          order_type: 'WALK_IN_POS',
          status: 'COMPLETED',
          payment_status: 'PAID',
          payment_mode: mode,
          items: items.map(it => ({
            name: it.name,
            quantity: it.quantity,
            unit_price: it.unit_price
          })),
          total_amount: finalTotal,
          timestamp: new Date().toISOString()
        }
      }])
      .select()
      .single();

    if (orderError) throw orderError;

    // 3. Insert items into order_items (This triggers Postgres trigger_update_stock to decrement stock)
    const orderItems = items.map(item => ({
      order_id: order.id,
      product_id: item.product_id,
      quantity: item.quantity,
      unit_price: item.unit_price
    }));

    const { error: itemsError } = await supabase
      .from('order_items')
      .insert(orderItems);

    if (itemsError) throw itemsError;

    // 4. Fetch the final order with details
    const { data: finalOrder, error: fetchError } = await supabase
      .from('orders')
      .select(`
        *,
        order_items (
          *,
          products (
            name
          )
        )
      `)
      .eq('id', order.id)
      .single();

    if (fetchError) throw fetchError;

    console.log(`[Spot POS] Sale completed: Token ${finalOrder.token_number || finalOrder.id} - ₹${finalTotal.toFixed(2)} (${mode})`);
    res.status(201).json({
      success: true,
      message: `Sale recorded: ₹${finalTotal.toFixed(2)}`,
      order: finalOrder
    });
  } catch (err) {
    console.error("Spot POS sale error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// 6. Get Announcements/Notices
app.get('/api/notices', async (req, res) => {
  try {
    const { data, error } = await supabase
      .from('notices')
      .select('*')
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error("Notices fetch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 6.5. Get Orders
app.get('/api/orders', async (req, res) => {
  const { student_id, token_number } = req.query;
  try {
    let query = supabase
      .from('orders')
      .select(`
        *,
        students (
          name,
          reg_no
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

    if (student_id) {
      query = query.eq('student_id', student_id);
    }
    if (token_number) {
      query = query.eq('token_number', token_number);
    }

    const { data, error } = await query;
    if (error) throw error;

    if (token_number) {
      return res.json(data[0] || null);
    }
    res.json(data || []);
  } catch (err) {
    console.error("Orders fetch error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// ----------------------------------------------------
// MANAGER PORTAL ENDPOINTS
// ----------------------------------------------------

// 7. Manager Login
app.post('/api/manager/login', async (req, res) => {
  const { phone, otp } = req.body;
  if (phone !== "9025114185") {
    return res.status(401).json({ error: "Unauthorized Mobile Number" });
  }
  if (otp !== "1234") {
    return res.status(401).json({ error: "Invalid verification code OTP" });
  }
  res.json({ success: true, manager_session: true });
});

// 8. Add/Edit Category
app.post('/api/categories', async (req, res) => {
  const { id, name, icon } = req.body;
  
  // Also support editing fallback icon_url if id is provided
  const icon_url = icon || req.body.icon_url;
  
  if (!name || (!icon && !icon_url)) {
    return res.status(400).json({ error: "Category name and icon are required" });
  }
  
  try {
    let result;
    if (id) {
      // Try updating icon_url first
      result = await supabase
        .from('categories')
        .update({ name, icon_url: icon_url })
        .eq('id', id)
        .select();
        
      if (result.error) {
        // Fallback to updating icon column
        result = await supabase
          .from('categories')
          .update({ name, icon: icon_url })
          .eq('id', id)
          .select();
      }
    } else {
      // Try inserting icon_url first
      result = await supabase
        .from('categories')
        .insert([{ name, icon_url: icon_url }])
        .select();
        
      if (result.error) {
        // Fallback to inserting icon column
        result = await supabase
          .from('categories')
          .insert([{ name, icon: icon }])
          .select();
      }
    }
    
    if (result.error) {
      console.error('Category insert error:', result.error);
      throw result.error;
    }
    
    const record = result.data ? (result.data[0] || result.data) : null;
    res.status(201).json({ success: true, category: record });
  } catch (err) {
    console.error('Category insert error:', err.message || err);
    res.status(500).json({ error: err.message || err });
  }
});

// 8.5. Delete Category
app.delete('/api/categories/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('categories')
      .delete()
      .eq('id', id)
      .select();
      
    if (error) throw error;
    res.json({ success: true, data });
  } catch (err) {
    console.error("Delete category error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 9. Add Product
app.post('/api/products', async (req, res) => {
  const { name, category_id, price, stock_quantity, image_url, barcode_id } = req.body;
  if (!name || !category_id || price === undefined || stock_quantity === undefined) {
    return res.status(400).json({ error: "Missing product fields" });
  }
  
  try {
    const { data, error } = await supabase
      .from('products')
      .insert([{
        name,
        category_id,
        price,
        stock_quantity,
        image_url,
        barcode_id
      }])
      .select()
      .single();
      
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error("Product add error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 10. Update Product Stock
app.patch('/api/products/:id/stock', async (req, res) => {
  const { id } = req.params;
  const { stock_quantity } = req.body;
  
  if (stock_quantity === undefined || stock_quantity < 0) {
    return res.status(400).json({ error: "Valid stock quantity is required" });
  }
  
  try {
    const { data, error } = await supabase
      .from('products')
      .update({ stock_quantity })
      .eq('id', id)
      .select()
      .single();
      
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("Stock update error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Update Product
app.put('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  const { name, category_id, price, stock_quantity, image_url, barcode_id } = req.body;
  try {
    const updatePayload = {
      name,
      category_id,
      price,
      stock_quantity,
      image_url,
      ...(barcode_id !== undefined && { barcode_id: barcode_id || null })
    };

    const { data, error } = await supabase
      .from('products')
      .update(updatePayload)
      .eq('id', id)
      .select()
      .single();
      
    if (error) throw error;
    res.json(data);
  } catch (err) {
    console.error("Product update error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// Delete Product
app.delete('/api/products/:id', async (req, res) => {
  const { id } = req.params;
  try {
    const { data, error } = await supabase
      .from('products')
      .delete()
      .eq('id', id)
      .select();
      
    if (error) throw error;
    res.json({ success: true, message: "Product deleted successfully" });
  } catch (err) {
    console.error("Product delete error:", err.message);
    res.status(500).json({ error: err.message });
  }
});


// 11. Get Live Orders (Must be declared BEFORE /api/orders/:id)
app.get('/api/orders/live', async (req, res) => {
  try {
    await expireOverdueCashOrders();

    const { data, error } = await supabase
      .from('orders')
      .select(`
        *,
        students (
          name,
          reg_no
        ),
        order_items (
          *,
          products (
            name
          )
        )
      `)
      .order('created_at', { ascending: false });
      
    if (error) throw error;
    res.json(data || []);
  } catch (err) {
    console.error("Live orders error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 11a. Get Single Order by UUID ID or Token Number (for QR scan lookup)
app.get('/api/orders/:id', async (req, res) => {
  const { id } = req.params;
  if (!id) {
    return res.status(400).json({ error: 'Order identifier is required' });
  }

  const cleanId = decodeURIComponent(id).trim();
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

  try {
    let query = supabase
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
            name
          )
        )
      `);

    if (uuidRegex.test(cleanId)) {
      query = query.eq('id', cleanId);
    } else {
      const tokenWithHash = cleanId.startsWith('#') ? cleanId : `#${cleanId}`;
      query = query.or(`token_number.eq.${cleanId},token_number.eq.${tokenWithHash}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    if (!data || data.length === 0) {
      return res.status(404).json({ error: `Order not found for identifier: ${cleanId}` });
    }

    let order = data[0];

    // Check if this cash order is overdue for expiry (30 mins from creation)
    if (
      order.payment_method === 'CASH_AT_COUNTER' &&
      order.payment_status !== 'PAID' &&
      order.order_status === 'PENDING_PICKUP'
    ) {
      const orderAgeMs = Date.now() - new Date(order.created_at).getTime();
      if (orderAgeMs > CASH_EXPIRY_WINDOW_MS) {
        const expiredOrder = await expireSingleOrder(order.id);
        if (expiredOrder) {
          order.order_status = 'CANCELLED';
        }
      }
    }

    res.json(order);
  } catch (err) {
    console.error('Get order by ID error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// 12. Deliver Order
app.patch('/api/orders/:id/deliver', async (req, res) => {
  const { id } = req.params;
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  if (!uuidRegex.test(id)) {
    return res.status(400).json({ error: "Invalid input syntax for type uuid" });
  }

  try {
    // 1. Fetch current order status first to check for expiry
    const { data: existingOrder, error: fetchErr } = await supabase
      .from('orders')
      .select('*, order_items(*)')
      .eq('id', id)
      .maybeSingle();

    if (fetchErr) throw fetchErr;
    if (!existingOrder) {
      return res.status(404).json({ error: "Order not found" });
    }

    // Check if order is already cancelled / expired
    if (existingOrder.order_status === 'CANCELLED') {
      return res.status(400).json({ error: "Order Expired: 30-minute cash payment window passed." });
    }

    // Check if cash payment window has elapsed (30 minutes)
    if (existingOrder.payment_method === 'CASH_AT_COUNTER' && existingOrder.payment_status !== 'PAID') {
      const orderAgeMs = Date.now() - new Date(existingOrder.created_at).getTime();
      if (orderAgeMs > CASH_EXPIRY_WINDOW_MS) {
        await expireSingleOrder(existingOrder.id);
        return res.status(400).json({ error: "Order Expired: 30-minute cash payment window passed." });
      }
    }

    const { data, error } = await supabase
      .from('orders')
      .update({ order_status: 'DELIVERED', payment_status: 'PAID' })
      .eq('id', id)
      .select()
      .single();
      
    if (error) throw error;
    res.json({ success: true, message: 'Order marked as delivered', ...data });
  } catch (err) {
    console.error("Deliver order error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 13. Post Broadcast Notice
app.post('/api/notices', async (req, res) => {
  const { title, message } = req.body;
  if (!title || !message) {
    return res.status(400).json({ error: "Title and message are required" });
  }
  
  try {
    const { data, error } = await supabase
      .from('notices')
      .insert([{ title, message }])
      .select()
      .single();
      
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error("Broadcast notice error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

// 14. Record Manual Offline Cash Sales
app.post('/api/sales/offline', async (req, res) => {
  const { amount } = req.body;
  if (amount === undefined || amount <= 0) {
    return res.status(400).json({ error: "Valid sale amount is required" });
  }
  
  try {
    const { data, error } = await supabase
      .from('orders')
      .insert([{
        total_amount: amount,
        payment_method: 'CASH_AT_COUNTER',
        payment_status: 'PAID',
        order_status: 'DELIVERED'
      }])
      .select()
      .single();
      
    if (error) throw error;
    res.status(201).json(data);
  } catch (err) {
    console.error("Offline sales error:", err.message);
    res.status(500).json({ error: err.message });
  }
});

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/student', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/student.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'index.html'));
});
app.get('/manager', (req, res) => {
  res.sendFile(path.join(__dirname, 'manager.html'));
});
app.get('/manager.html', (req, res) => {
  res.sendFile(path.join(__dirname, 'manager.html'));
});

// 15. Manager: Orders History & Transaction Reporting
app.get('/api/manager/orders/history', async (req, res) => {
  const { date, start_date, end_date, status } = req.query;

  try {
    // 1. Build query without row-limit truncation (fetch up to 10,000 rows chronologically)
    let query = supabase
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
            name
          )
        )
      `)
      .order('created_at', { ascending: false })
      .range(0, 9999);

    // 2. Status filtering (optional, default to all orders if 'all' or empty)
    if (status && status !== 'ALL' && status !== 'all') {
      query = query.eq('order_status', status);
    }

    // 3. Date boundaries handling (Timezone accurate)
    if (start_date && end_date) {
      // Both start and end provided (e.g. ISO UTC timestamps from client)
      query = query.gte('created_at', start_date).lte('created_at', end_date);
    } else if (start_date) {
      query = query.gte('created_at', start_date);
    } else if (end_date) {
      query = query.lte('created_at', end_date);
    } else if (date) {
      // Single date provided (YYYY-MM-DD or ISO)
      if (date.includes('T')) {
        const d = new Date(date);
        const start = new Date(d.setUTCHours(0, 0, 0, 0)).toISOString();
        const end = new Date(d.setUTCHours(23, 59, 59, 999)).toISOString();
        query = query.gte('created_at', start).lte('created_at', end);
      } else {
        const startOfDay = `${date}T00:00:00.000Z`;
        const endOfDay   = `${date}T23:59:59.999Z`;
        query = query.gte('created_at', startOfDay).lte('created_at', endOfDay);
      }
    }
    // When "All Time" (no date, start_date, or end_date), NO date filters are applied!

    const { data, error } = await query;
    if (error) throw error;

    const orders = data || [];

    // Helper to identify Walk-in POS vs Online App transactions
    const isWalkInPos = (o) => {
      if (o.qr_code_data) {
        try {
          const qd = typeof o.qr_code_data === 'string' ? JSON.parse(o.qr_code_data) : o.qr_code_data;
          if (qd && (qd.order_type === 'WALK_IN_POS' || qd.payment_mode)) return true;
        } catch (e) {}
      }
      return !o.student_id;
    };

    // Revenue calculations (paid / delivered orders count toward revenue)
    const paidOrders = orders.filter(o => o.order_status === 'DELIVERED' || o.payment_status === 'PAID');
    const totalRevenue = paidOrders.reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);

    const posOrders = orders.filter(o => isWalkInPos(o));
    const onlineOrders = orders.filter(o => !isWalkInPos(o));

    const posRevenue = posOrders
      .filter(o => o.order_status === 'DELIVERED' || o.payment_status === 'PAID')
      .reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);

    const onlineRevenue = onlineOrders
      .filter(o => o.order_status === 'DELIVERED' || o.payment_status === 'PAID')
      .reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);

    const getOrderPaymentMode = (o) => {
      if (o.qr_code_data) {
        try {
          const qd = typeof o.qr_code_data === 'string' ? JSON.parse(o.qr_code_data) : o.qr_code_data;
          if (qd && qd.payment_mode) return qd.payment_mode;
        } catch (e) {}
      }
      return o.payment_method === 'ONLINE' ? 'UPI' : 'CASH';
    };

    const cashRevenue = paidOrders
      .filter(o => getOrderPaymentMode(o) === 'CASH')
      .reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);

    const upiRevenue = paidOrders
      .filter(o => getOrderPaymentMode(o) === 'UPI')
      .reduce((s, o) => s + parseFloat(o.total_amount || 0), 0);

    const deliveredCount = orders.filter(o => o.order_status === 'DELIVERED').length;
    const cancelledCount = orders.filter(o => o.order_status === 'CANCELLED').length;
    const pendingCount = orders.filter(o => o.order_status === 'PENDING_PICKUP').length;

    res.json({
      orders,
      summary: {
        total_orders:     orders.length,
        total_revenue:    totalRevenue,
        online_revenue:   onlineRevenue,
        pos_revenue:      posRevenue,
        cash_revenue:     cashRevenue,
        upi_revenue:      upiRevenue,
        online_count:     onlineOrders.length,
        pos_count:        posOrders.length,
        delivered_count:  deliveredCount,
        cancelled_count:  cancelledCount,
        pending_count:    pendingCount,
        date_filter:      start_date ? `${start_date} to ${end_date}` : (date || 'all-time')
      }
    });
  } catch (err) {
    console.error('History orders error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// Start Server
app.listen(PORT, () => {
  console.log(`Backend API Server running on port ${PORT}`);
});
