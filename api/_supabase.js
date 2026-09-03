// Shared Supabase client & API helpers for Vercel Serverless Functions
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL = process.env.SUPABASE_URL || 'https://llbegpqowjvsadbundrn.supabase.co';
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImxsYmVncHFvd2p2c2FkYnVuZHJuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODY3Njg4NzAsImV4cCI6MjEwMjM0NDg3MH0.SGoLEoE5PP_Ex0C7tOXrwvcol2vxxOvOFPoSGfD93VA';

const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function setCORS(req, res) {
  res.setHeader('Access-Control-Allow-Credentials', 'true');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS,PATCH,DELETE,POST,PUT');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'X-CSRF-Token, X-Requested-With, Accept, Accept-Version, Content-Length, Content-MD5, Content-Type, Date, X-Api-Version, Authorization'
  );
  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return true;
  }
  return false;
}

function sendResponse(res, statusCode, success, payload) {
  if (success) {
    return res.status(statusCode).json({ success: true, data: payload });
  } else {
    const errorMsg = typeof payload === 'string' ? payload : (payload && payload.message ? payload.message : 'An error occurred');
    return res.status(statusCode).json({ success: false, error: errorMsg });
  }
}

// In-memory / fallback store for canteen operational status if DB table is not used
let _canteenStatus = { is_open: true };

module.exports = {
  supabase,
  setCORS,
  sendResponse,
  _canteenStatus
};
