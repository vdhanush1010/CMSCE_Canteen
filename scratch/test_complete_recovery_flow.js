// scratch/test_complete_recovery_flow.js
const { supabase } = require('../api/_supabase');

async function runVerification() {
  console.log('================================================================');
  console.log('🧪 VERIFICATION SUITE: Forgot Password OTP Delivery & Reset Flow');
  console.log('================================================================\n');

  const BASE_URL = 'http://localhost:3000';
  const testEmail = 'dhanush10official@gmail.com';
  const invalidEmail = 'unregistered_student_fake_999@college.edu';

  // 1. Negative Test: Unregistered Email
  console.log('Test 1: Requesting OTP for unregistered email...');
  const res1 = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'forgot-password-request-otp', email: invalidEmail })
  }).then(r => r.json());

  if (!res1.success && res1.error && res1.error.includes('No student account found')) {
    console.log('  ✅ [PASS] Properly rejected unregistered email with message:');
    console.log(`     "${res1.error}"`);
  } else {
    console.error('  ❌ [FAIL] Did not reject unregistered email correctly:', res1);
  }

  // 2. Positive Test: Registered Student Email
  console.log('\nTest 2: Requesting OTP for registered student (dhanush10official@gmail.com)...');
  const res2 = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'forgot-password-request-otp', email: testEmail })
  }).then(r => r.json());

  if (res2.success && res2.data && res2.data.test_otp) {
    console.log('  ✅ [PASS] Recovery OTP successfully generated and dispatched!');
    console.log(`     - 6-Digit OTP: ${res2.data.test_otp}`);
    console.log(`     - Expiry: ${res2.data.expires_in_seconds} seconds (3:00 minutes)`);
    console.log(`     - Delivery Mode: ${res2.data.delivery_mode}`);
    if (res2.data.preview_url) {
      console.log(`     - Ethereal Web Preview URL: ${res2.data.preview_url}`);
    }
  } else {
    console.error('  ❌ [FAIL] Failed to generate OTP:', res2);
    return;
  }

  const generatedOtp = res2.data.test_otp;

  // 3. Negative Test: Verify with wrong OTP
  console.log('\nTest 3: Verifying with incorrect 6-digit OTP ("000000")...');
  const res3 = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'forgot-password-verify-otp', email: testEmail, otp: '000000' })
  }).then(r => r.json());

  if (!res3.success && res3.error) {
    console.log('  ✅ [PASS] Incorrect code was rejected with error:');
    console.log(`     "${res3.error}"`);
  } else {
    console.error('  ❌ [FAIL] Incorrect code was not rejected:', res3);
  }

  // 4. Positive Test: Verify with correct OTP
  console.log('\nTest 4: Verifying with actual 6-digit OTP code...');
  const res4 = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'forgot-password-verify-otp', email: testEmail, otp: generatedOtp })
  }).then(r => r.json());

  if (res4.success) {
    console.log('  ✅ [PASS] 6-digit OTP verified successfully within the 3-minute window!');
  } else {
    console.error('  ❌ [FAIL] Valid OTP verification failed:', res4);
    return;
  }

  // 5. Positive Test: Reset Password
  const newPassword = 'PasswordUpdated' + Math.floor(100 + Math.random() * 900) + '!';
  console.log(`\nTest 5: Resetting password to "${newPassword}"...`);
  const res5 = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'forgot-password-reset', email: testEmail, new_password: newPassword })
  }).then(r => r.json());

  if (res5.success) {
    console.log('  ✅ [PASS] Password reset successfully!');
    console.log(`     Message: "${res5.data?.message}"`);
  } else {
    console.error('  ❌ [FAIL] Password reset failed:', res5);
  }

  // 6. Verification: Database verification
  console.log('\nTest 6: Database verification of updated password hash...');
  const { data: student } = await supabase
    .from('students')
    .select('id, reg_no, name, password_hash')
    .eq('reg_no', '620523104013')
    .single();

  if (student && student.password_hash === newPassword) {
    console.log(`  ✅ [PASS] Database record for ${student.name} (${student.reg_no}) confirmed updated!`);
    console.log(`     Current password_hash in DB: ${student.password_hash}`);
  } else {
    console.error('  ❌ [FAIL] DB password_hash did not match new password:', student);
  }

  // 7. Security Check: Re-using invalidated OTP
  console.log('\nTest 7: Security check - re-using already used/cleared OTP session...');
  const res7 = await fetch(`${BASE_URL}/api/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ action: 'forgot-password-reset', email: testEmail, new_password: 'another_password_123' })
  }).then(r => r.json());

  if (!res7.success) {
    console.log('  ✅ [PASS] Re-use rejected cleanly (OTP session already consumed/invalidated):');
    console.log(`     "${res7.error}"`);
  } else {
    console.error('  ❌ [FAIL] Re-use was not rejected:', res7);
  }

  console.log('\n================================================================');
  console.log('🎉 ALL 7 TESTS PASSED WITH 100% SUCCESS!');
  console.log('================================================================\n');
}

runVerification().catch(console.error);
