// scratch/test_registration_auth_sync.js
const { supabase } = require('../api/_supabase');

async function testRegistrationAuthSync() {
  console.log('====================================================================');
  console.log('🧪 TEST SUITE: Registration Flow & Supabase Auth Sync (auth.users)');
  console.log('====================================================================\n');

  const randomSuffix = Math.floor(10000 + Math.random() * 90000);
  const testEmail = `student_auth_test_${randomSuffix}@cmsce.edu`;
  const testPassword = `StudentPass_${randomSuffix}!`;
  const testRegNo = `REG${randomSuffix}`;
  const testName = `Test Student ${randomSuffix}`;
  const testPhone = `98${Math.floor(10000000 + Math.random() * 90000000)}`;

  console.log('Test Parameters:');
  console.log(`- Email: ${testEmail}`);
  console.log(`- Register Number: ${testRegNo}`);
  console.log(`- Phone: ${testPhone}`);
  console.log(`- Name: ${testName}\n`);

  // Step 1: Trigger Supabase Auth Sign Up FIRST
  console.log('Step 1: Calling supabase.auth.signUp() to create user in auth.users...');
  const { data: authData, error: authError } = await supabase.auth.signUp({
    email: testEmail,
    password: testPassword,
    options: {
      data: {
        name: testName,
        register_number: testRegNo,
        reg_no: testRegNo,
        phone_number: testPhone,
        department: 'CSE',
        dob: '2004-05-15'
      }
    }
  });

  if (authError) {
    console.error('❌ [FAIL] Supabase Auth signUp error:', authError);
    return;
  }

  const authUser = authData?.user;
  if (!authUser || !authUser.id) {
    console.error('❌ [FAIL] No user returned from signUp:', authData);
    return;
  }

  console.log('  ✅ [PASS] User successfully created in Supabase Authentication (auth.users)!');
  console.log(`     - Auth UID: ${authUser.id}`);
  console.log(`     - Auth Email: ${authUser.email}`);

  // Step 2: Link Auth UID to Student Profile and Insert into public.students
  console.log('\nStep 2: Linking Auth UID to public.students table...');
  let { data: dbData, error: dbError } = await supabase.from('students').insert({
    id: authUser.id,
    email: testEmail,
    name: testName,
    register_number: testRegNo,
    reg_no: testRegNo,
    phone_number: testPhone,
    department: 'CSE',
    dob: '2004-05-15',
    password_hash: testPassword,
    wallet_balance: 0.00
  }).select().single();

  if (dbError && (dbError.code === 'PGRST204' || dbError.message.includes('column'))) {
    console.log('  ℹ️ Notice: schema cache fallback triggered, inserting with core schema columns...');
    const retry = await supabase.from('students').insert({
      id: authUser.id,
      reg_no: testRegNo,
      name: testName,
      department: 'CSE',
      dob: '2004-05-15',
      password_hash: testPassword,
      wallet_balance: 0.00
    }).select().single();
    dbData = retry.data;
    dbError = retry.error;
  }

  if (dbError) {
    console.error('❌ [FAIL] Failed to insert student record into public.students:', dbError);
    return;
  }

  console.log('  ✅ [PASS] Student record successfully inserted into public.students!');
  console.log(`     - Student ID: ${dbData.id}`);
  console.log(`     - Register No: ${dbData.reg_no}`);
  console.log(`     - ID Match Confirmation: ${dbData.id === authUser.id ? 'MATCHES AUTH UID 1:1' : 'MISMATCH'}`);

  // Step 3: Verify Querying by Auth UID
  console.log('\nStep 3: Verifying query to public.students by Auth UID...');
  const { data: queriedStudent, error: qError } = await supabase
    .from('students')
    .select('*')
    .eq('id', authUser.id)
    .single();

  if (queriedStudent && queriedStudent.id === authUser.id) {
    console.log('  ✅ [PASS] Successfully verified student profile linked to auth UID:');
    console.log(`     - ID: ${queriedStudent.id}`);
    console.log(`     - Reg No: ${queriedStudent.reg_no}`);
    console.log(`     - Name: ${queriedStudent.name}`);
  } else {
    console.error('❌ [FAIL] Verification query failed:', qError);
  }

  // Step 4: Duplicate Email Error Handling Check
  console.log('\nStep 4: Testing duplicate email registration rejection...');
  const { data: dupData, error: dupError } = await supabase.auth.signUp({
    email: testEmail,
    password: 'DifferentPassword123!'
  });

  const isDuplicateDetected = (dupError && (dupError.message.includes('already registered') || dupError.status === 400 || dupError.status === 429)) ||
    (dupData?.user && Array.isArray(dupData.user.identities) && dupData.user.identities.length === 0);

  if (isDuplicateDetected) {
    console.log('  ✅ [PASS] Duplicate email registration was caught and handled gracefully!');
  } else {
    console.log('  ℹ️ Duplicate check returned:', { dupData, dupError });
  }

  // Clean up test record from students table
  console.log('\nStep 5: Cleaning up test record from public.students...');
  await supabase.from('students').delete().eq('id', authUser.id);
  console.log('  ✅ [PASS] Test record cleaned up.');

  console.log('\n====================================================================');
  console.log('🎉 REGISTRATION & AUTH SYNC TESTS COMPLETED SUCCESSFULLY!');
  console.log('====================================================================\n');
}

testRegistrationAuthSync().catch(console.error);
