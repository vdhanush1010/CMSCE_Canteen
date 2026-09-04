const fs = require('fs');
const { createClient } = require('@supabase/supabase-js');

const files = ['app.js', 'forgot-password.js', 'student.js'];

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');

  // Check signInWithOtp
  if (!content.includes('signInWithOtp')) {
    throw new Error(`${file} missing signInWithOtp`);
  }
  if (!content.includes('shouldCreateUser: false')) {
    throw new Error(`${file} missing shouldCreateUser: false`);
  }

  // Check verifyOtp type: 'email'
  if (!content.includes("type: 'email'")) {
    throw new Error(`${file} missing type: 'email'`);
  }
  if (content.includes("type: 'recovery'")) {
    throw new Error(`${file} still contains deprecated type: 'recovery'`);
  }

  // Check signOut cleanup
  if (!content.includes('supabase.auth.signOut()')) {
    throw new Error(`${file} missing supabase.auth.signOut() cleanup`);
  }

  // Check resetPasswordForEmail is removed
  if (content.includes('resetPasswordForEmail')) {
    throw new Error(`${file} still contains resetPasswordForEmail`);
  }

  console.log(`[PASS] ${file}: Fully aligned with signInWithOtp, type: 'email', and signOut cleanup.`);
});

console.log('\nAll source code assertions passed cleanly!');
