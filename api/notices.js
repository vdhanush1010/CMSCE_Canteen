// /api/notices.js - Student Notices & Announcements API
const { supabase, setCORS, sendResponse } = require('./_supabase');

module.exports = async (req, res) => {
  if (setCORS(req, res)) return;

  try {
    if (req.method === 'GET') {
      const { data, error } = await supabase
        .from('notices')
        .select('*')
        .order('created_at', { ascending: false })
        .limit(10);

      if (error) throw error;
      return sendResponse(res, 200, true, data || []);
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { title, message } = body;

      if (!title || !message) {
        return sendResponse(res, 400, false, 'Title and message are required for notice');
      }

      const { data, error } = await supabase
        .from('notices')
        .insert([{ title: title.trim(), message: message.trim() }])
        .select()
        .single();

      if (error) throw error;
      return sendResponse(res, 201, true, data);
    }

    return sendResponse(res, 405, false, 'Method not allowed');
  } catch (err) {
    console.error('Notices API Error:', err);
    return sendResponse(res, 500, false, err.message || 'Notices service error');
  }
};
