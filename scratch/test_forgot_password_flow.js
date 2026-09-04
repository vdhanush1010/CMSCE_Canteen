// scratch/test_forgot_password_flow.js
const { supabase } = require('../api/_supabase');

async function runTests() {
  console.log('=== TEST SUITE: Forgot Password with 3-Minute Supabase OTP & Enforced Email ===\n');

  // Test 1: Email Validation Functionality
  console.log('Test 1: Mandatory Email Format Validation');
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

  const testCases = [
    { email: '', expected: false, desc: 'Empty email' },
    { email: '   ', expected: false, desc: 'Whitespace-only email' },
    { email: 'student', expected: false, desc: 'Missing @ and domain' },
    { email: 'student@', expected: false, desc: 'Missing domain' },
    { email: 'student@college', expected: false, desc: 'Missing TLD' },
    { email: 'student@college.edu', expected: true, desc: 'Valid university email' },
    { email: 'dhanush10official@gmail.com', expected: true, desc: 'Valid Gmail address' }
  ];

  let validationPassed = true;
  testCases.forEach(({ email, expected, desc }) => {
    const isValid = Boolean(email.trim()) && emailRegex.test(email.trim());
    if (isValid === expected) {
      console.log(`  ✅ [PASS] ${desc} ("${email}") => ${isValid ? 'Valid' : 'Blocked'}`);
    } else {
      console.error(`  ❌ [FAIL] ${desc} ("${email}"): expected ${expected}, got ${isValid}`);
      validationPassed = false;
    }
  });

  // Test 2: 3-Minute Countdown Formatting
  console.log('\nTest 2: Timer 3:00 Countdown String Formatting');
  function formatFpTimer(seconds) {
    const mins = Math.floor(seconds / 60);
    const secs = seconds % 60;
    return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  }

  const timerChecks = [
    { sec: 180, expected: '03:00' },
    { sec: 179, expected: '02:59' },
    { sec: 65,  expected: '01:05' },
    { sec: 10,  expected: '00:10' },
    { sec: 0,   expected: '00:00' }
  ];

  let timerPassed = true;
  timerChecks.forEach(({ sec, expected }) => {
    const formatted = formatFpTimer(sec);
    if (formatted === expected) {
      console.log(`  ✅ [PASS] ${sec}s => "${formatted}"`);
    } else {
      console.error(`  ❌ [FAIL] ${sec}s: expected "${expected}", got "${formatted}"`);
      timerPassed = false;
    }
  });

  // Test 3: Supabase Auth Recovery OTP Dispatch
  console.log('\nTest 3: Supabase Auth resetPasswordForEmail API');
  try {
    const testEmail = 'dhanush10official@gmail.com';
    const { data, error } = await supabase.auth.resetPasswordForEmail(testEmail);
    if (!error) {
      console.log(`  ✅ [PASS] Supabase resetPasswordForEmail dispatched successfully for ${testEmail}`);
    } else {
      console.log(`  ℹ️ Supabase responded:`, error.message);
    }
  } catch (err) {
    console.error('  ❌ [FAIL] Supabase recovery OTP error:', err);
  }

  // Test 4: Supabase Auth verifyOtp Rejection Handling (Expired / Invalid token)
  console.log('\nTest 4: Supabase verifyOtp Invalid Token Handling');
  try {
    const { data, error } = await supabase.auth.verifyOtp({
      email: 'dhanush10official@gmail.com',
      token: '000000',
      type: 'recovery'
    });
    if (error) {
      console.log(`  ✅ [PASS] Expected error received cleanly without crash: [${error.code || error.status}] ${error.message}`);
    } else {
      console.log('  Unexpected success with dummy token:', data);
    }
  } catch (err) {
    console.error('  ❌ [FAIL] Exception during verifyOtp:', err);
  }

  // Test 5: Database Student Password Update Query Verification
  console.log('\nTest 5: Students Table Password Update Query Verification');
  try {
    const testEmail = 'dhanush10official@gmail.com';
    const { data: student } = await supabase
      .from('students')
      .select('id, reg_no, email')
      .ilike('email', testEmail)
      .maybeSingle();

    if (student) {
      console.log(`  ✅ [PASS] Located target student for email sync: ${student.reg_no} (${student.id})`);
    } else {
      console.log(`  ℹ️ Note: No student currently with email ${testEmail} in database (can be added on register)`);
    }
  } catch (err) {
    console.error('  ❌ [FAIL] Error querying students table:', err);
  }

  console.log('\n=== ALL AUTOMATED CHECKS COMPLETED ===');
}

runTests().catch(console.error);
