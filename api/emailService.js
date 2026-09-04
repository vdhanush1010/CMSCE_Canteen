// api/emailService.js - High deliverability transactional email service for Canteen App
const nodemailer = require('nodemailer');

// Configure SMTP transport if environment variables are set
function getTransporter() {
  const host = process.env.SMTP_HOST;
  const port = parseInt(process.env.SMTP_PORT || '587', 10);
  const user = process.env.SMTP_USER || process.env.EMAIL_USER;
  const pass = process.env.SMTP_PASS || process.env.EMAIL_PASS;

  if (host && user && pass) {
    return nodemailer.createTransport({
      host,
      port,
      secure: port === 465,
      auth: { user, pass }
    });
  }

  // Check if Gmail app password is provided
  if (user && pass && user.includes('@gmail.com')) {
    return nodemailer.createTransport({
      service: 'gmail',
      auth: { user, pass }
    });
  }

  return null;
}

let cachedEtherealTransporter = null;

async function getEtherealTransporter() {
  if (cachedEtherealTransporter) return cachedEtherealTransporter;
  try {
    const testAccount = await nodemailer.createTestAccount();
    cachedEtherealTransporter = nodemailer.createTransport({
      host: testAccount.smtp.host,
      port: testAccount.smtp.port,
      secure: testAccount.smtp.secure,
      auth: {
        user: testAccount.user,
        pass: testAccount.pass
      }
    });
    return cachedEtherealTransporter;
  } catch (err) {
    console.warn('[Email Service] Could not initialize Ethereal account:', err.message);
    return null;
  }
}

/**
 * Sends a 6-digit password recovery OTP email
 * @param {Object} options
 * @param {string} options.to - Recipient email
 * @param {string} options.name - Recipient name
 * @param {string} options.otp - 6-digit OTP
 * @returns {Promise<{ sent: boolean, preview_url?: string, mode?: string, error?: string }>}
 */
async function sendRecoveryEmail({ to, name, otp }) {
  const transporter = getTransporter();

  const formattedName = name || 'Student';
  const fromAddress = process.env.SMTP_FROM || process.env.EMAIL_USER || '"CMSCE Canteen Portal" <canteen@cmsce.edu>';

  const htmlContent = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; background-color: #f8fafc; margin: 0; padding: 20px; }
        .container { max-width: 480px; margin: 0 auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 16px rgba(0,0,0,0.05); border: 1px solid #e2e8f0; }
        .header { background: linear-gradient(135deg, #0f172a, #1e293b); padding: 24px; text-align: center; color: #ffffff; }
        .header h1 { margin: 0; font-size: 20px; font-weight: bold; }
        .header p { margin: 4px 0 0; font-size: 12px; color: #94a3b8; }
        .content { padding: 32px 24px; text-align: center; }
        .greeting { font-size: 16px; font-weight: 600; color: #0f172a; margin-bottom: 12px; }
        .instructions { font-size: 13px; color: #64748b; line-height: 1.6; margin-bottom: 24px; }
        .otp-box { background: #fff0e5; border: 2px dashed #ff6b00; border-radius: 12px; padding: 18px 24px; display: inline-block; margin-bottom: 24px; }
        .otp-code { font-size: 32px; font-weight: 800; color: #e05a00; letter-spacing: 6px; font-family: monospace; margin: 0; }
        .timer-warning { font-size: 12px; color: #b45309; background: #fef3c7; border: 1px solid #fde68a; border-radius: 8px; padding: 8px 12px; margin-bottom: 24px; display: inline-block; }
        .footer { background: #f8fafc; padding: 20px; text-align: center; font-size: 11px; color: #94a3b8; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="container">
        <div class="header">
          <h1>CMSCE Canteen Portal</h1>
          <p>Secure Account Password Recovery</p>
        </div>
        <div class="content">
          <div class="greeting">Hello ${formattedName},</div>
          <p class="instructions">
            We received a request to reset your password. Use the 6-digit verification code below to complete your password reset:
          </p>
          <div class="otp-box">
            <div class="otp-code">${otp}</div>
          </div>
          <br>
          <div class="timer-warning">
            ⏳ <strong>Strict 3-Minute Validity:</strong> This code will expire in 3 minutes.
          </div>
          <p class="instructions" style="font-size: 11px; margin-top: 16px;">
            If you did not request a password reset, please ignore this email or contact the Canteen Admin immediately.
          </p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} CMSCE Hostel Canteen Ordering System.<br>All rights reserved.
        </div>
      </div>
    </body>
    </html>
  `;

  if (transporter) {
    try {
      const info = await transporter.sendMail({
        from: fromAddress,
        to,
        subject: `[CMSCE Canteen] Your Password Recovery OTP: ${otp}`,
        text: `Your password recovery OTP is: ${otp}. It is valid for 3 minutes.`,
        html: htmlContent
      });
      console.log(`[Email Service] ✅ Real email successfully delivered via SMTP to: ${to} (MessageId: ${info.messageId})`);
      return { sent: true, mode: 'smtp', messageId: info.messageId };
    } catch (err) {
      console.error(`[Email Service] ❌ Custom SMTP delivery failed:`, err.message);
    }
  }

  // Fallback to Ethereal live preview inbox
  try {
    const etherealTransporter = await getEtherealTransporter();
    if (etherealTransporter) {
      const info = await etherealTransporter.sendMail({
        from: '"CMSCE Canteen Portal" <canteen@cmsce.edu>',
        to,
        subject: `[CMSCE Canteen] Your Password Recovery OTP: ${otp}`,
        text: `Hello ${formattedName}, your 6-digit OTP code is ${otp}. Valid for 3 minutes.`,
        html: htmlContent
      });
      const previewUrl = nodemailer.getTestMessageUrl(info);
      console.log(`[Email Service] 📨 Ethereal Test Email dispatched for ${to}!`);
      console.log(`[Email Service] 🌐 View Sent Email Online: ${previewUrl}`);
      return { sent: true, mode: 'ethereal', preview_url: previewUrl };
    }
  } catch (etherealErr) {
    console.warn('[Email Service] Ethereal delivery error:', etherealErr.message);
  }

  return { sent: false, note: 'SMTP_NOT_CONFIGURED' };
}

module.exports = {
  sendRecoveryEmail,
  getTransporter
};
