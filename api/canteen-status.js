// /api/canteen-status.js - Canteen Operational Status (OPEN/CLOSED) Endpoint
const { setCORS, sendResponse, _canteenStatus } = require('./_supabase');

module.exports = async (req, res) => {
  if (setCORS(req, res)) return;

  try {
    if (req.method === 'GET') {
      return sendResponse(res, 200, true, { is_open: _canteenStatus.is_open });
    }

    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const isOpen = body.is_open !== undefined ? Boolean(body.is_open) : (body.status === 'OPEN');

      _canteenStatus.is_open = isOpen;

      return sendResponse(res, 200, true, {
        is_open: _canteenStatus.is_open,
        status: _canteenStatus.is_open ? 'OPEN' : 'CLOSED',
        updated_at: new Date().toISOString()
      });
    }

    return sendResponse(res, 405, false, 'Method not allowed');
  } catch (err) {
    console.error('Canteen Status API Error:', err);
    return sendResponse(res, 500, false, err.message || 'Status service error');
  }
};
