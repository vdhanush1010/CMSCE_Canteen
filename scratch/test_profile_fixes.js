// scratch/test_profile_fixes.js
const authHandler = require('../api/auth');

function createMockRes() {
  return {
    statusCode: 200,
    headers: {},
    data: null,
    setHeader(key, val) { this.headers[key] = val; },
    status(code) { this.statusCode = code; return this; },
    json(payload) { this.data = payload; return this; },
    end() { return this; }
  };
}

async function runTests() {
  console.log('=== TEST SUITE: Profile Contact Details & Isolated Avatar Upload ===\n');

  const testStudentId = '3104d58d-4de8-4d55-97bd-d23966723169'; // Dhanush V

  // Test 1: GET student profile via api/auth.js
  console.log('Test 1: Fetch student profile via GET /api/auth?id=...');
  const req1 = {
    method: 'GET',
    query: { id: testStudentId }
  };
  const res1 = createMockRes();
  await authHandler(req1, res1);

  console.log('Status:', res1.statusCode);
  console.log('Payload success:', res1.data?.success);
  console.log('Student details returned:');
  console.log(' - Name:', res1.data?.data?.name);
  console.log(' - Reg No:', res1.data?.data?.reg_no);
  console.log(' - Phone Number:', res1.data?.data?.phone_number);
  console.log(' - Email:', res1.data?.data?.email);
  console.log(' - Department:', res1.data?.data?.department);
  console.log(' - Avatar URL:', res1.data?.data?.avatar_url || '(none yet)');

  if (res1.data?.data?.phone_number === '6379325715' && res1.data?.data?.email === 'dhanush10official@gmail.com') {
    console.log('✅ PASS: Phone number and email mapped accurately and preserved!');
  } else {
    console.error('❌ FAIL: Contact details missing or not preserved!');
  }

  // Test 2: Update student profile
  console.log('\nTest 2: Update profile via POST /api/auth (action: update-profile)...');
  const req2 = {
    method: 'POST',
    body: {
      action: 'update-profile',
      id: testStudentId,
      name: 'Dhanush V',
      department: 'Computer Science and Engineering',
      phone_number: '6379325715',
      email: 'dhanush10official@gmail.com'
    }
  };
  const res2 = createMockRes();
  await authHandler(req2, res2);

  console.log('Status:', res2.statusCode);
  console.log('Update result:', res2.data);
  if (res2.data?.success && res2.data?.data?.phone_number === '6379325715') {
    console.log('✅ PASS: Profile update executed and saved successfully!');
  } else {
    console.error('❌ FAIL: Profile update failed!');
  }

  // Test 3: Update avatar with isolated student path
  console.log('\nTest 3: Update avatar via POST /api/auth (action: update-avatar)...');
  const testTimestamp = Date.now();
  const testAvatarUrl = `https://llbegpqowjvsadbundrn.supabase.co/storage/v1/object/public/avatars/${testStudentId}_${testTimestamp}.png`;
  const req3 = {
    method: 'POST',
    body: {
      action: 'update-avatar',
      id: testStudentId,
      avatar_url: testAvatarUrl
    }
  };
  const res3 = createMockRes();
  await authHandler(req3, res3);

  console.log('Status:', res3.statusCode);
  console.log('Avatar update result:', res3.data);
  if (res3.data?.success && res3.data?.data?.avatar_url === testAvatarUrl) {
    console.log('✅ PASS: Isolated avatar persisted successfully!');
  } else {
    console.error('❌ FAIL: Avatar update failed!');
  }

  // Test 4: Re-fetch student to ensure persistence without reload
  console.log('\nTest 4: Verify persistence on fresh GET request...');
  const req4 = {
    method: 'GET',
    query: { id: testStudentId }
  };
  const res4 = createMockRes();
  await authHandler(req4, res4);

  const finalStudent = res4.data?.data;
  console.log('Persisted Profile:');
  console.log(' - Name:', finalStudent?.name);
  console.log(' - Phone:', finalStudent?.phone_number);
  console.log(' - Email:', finalStudent?.email);
  console.log(' - Avatar URL:', finalStudent?.avatar_url);

  if (
    finalStudent?.phone_number === '6379325715' &&
    finalStudent?.email === 'dhanush10official@gmail.com' &&
    finalStudent?.avatar_url === testAvatarUrl
  ) {
    console.log('✅ PASS: All attributes accurately mapped, isolated, and permanently persisted!');
  } else {
    console.error('❌ FAIL: Persistence verification failed!');
  }

  console.log('\n=== ALL AUTOMATED TESTS COMPLETED ===');
}

runTests().catch(console.error);
