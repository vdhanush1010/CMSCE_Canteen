const fs = require('fs');

const files = ['app.js', 'forgot-password.js', 'student.js'];

files.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  if (!content.includes('verifyOtp')) throw new Error(`${file} missing verifyOtp`);
  if (!content.includes("type: 'recovery'")) throw new Error(`${file} missing type: 'recovery'`);
  if (content.includes('fp-sandbox-otp-banner')) throw new Error(`${file} still contains fp-sandbox-otp-banner`);
  if (content.includes('autoFillFpOtp')) throw new Error(`${file} still contains autoFillFpOtp`);
  console.log(`[PASS] ${file}: Native verifyOtp enabled, mock banner/autofill removed.`);
});

const htmlFiles = ['index.html', 'forgot-password.html'];
htmlFiles.forEach(file => {
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes('fp-sandbox-otp-banner')) throw new Error(`${file} still contains fp-sandbox-otp-banner`);
  if (!content.includes('fp-otp-error')) throw new Error(`${file} missing inline error alert #fp-otp-error`);
  console.log(`[PASS] ${file}: Inline modal error box added, mock sandbox banner removed.`);
});

const cssContent = fs.readFileSync('index.css', 'utf8');
if (!cssContent.includes('z-index: 10001;')) throw new Error('index.css missing z-index: 10001 on #toast-container');
console.log('[PASS] index.css: #toast-container elevated to z-index 10001 fixed.');

console.log('\nALL VERIFICATION CRITERIA MET SUCCESSFULLY!');
