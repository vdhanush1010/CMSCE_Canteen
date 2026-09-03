// /api/auth.js - Authentication handler for Managers and Students
const { supabase, setCORS, sendResponse } = require('./_supabase');

module.exports = async (req, res) => {
  if (setCORS(req, res)) return;

  try {
    if (req.method === 'GET') {
      const { reg_no, id } = req.query;
      if (!reg_no && !id) {
        return sendResponse(res, 400, false, 'Registration number or student ID is required');
      }

      let query = supabase.from('students').select('id, reg_no, name, department, dob, wallet_balance');
      if (id) query = query.eq('id', id);
      else if (reg_no) query = query.ilike('reg_no', reg_no);

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      if (!data) return sendResponse(res, 404, false, 'Student not found');

      return sendResponse(res, 200, true, data);
    }

    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { action } = body;

      // 1. Manager Login
      if (action === 'manager-login' || body.role === 'manager') {
        const { phone, otp, password } = body;
        const enteredOtp = otp || password;

        if (phone !== '9025114185' && phone !== 'admin') {
          return sendResponse(res, 401, false, 'Unauthorized Mobile Number');
        }
        if (enteredOtp !== '1234') {
          return sendResponse(res, 401, false, 'Invalid verification code OTP');
        }

        return sendResponse(res, 200, true, {
          role: 'manager',
          authenticated: true,
          phone
        });
      }

      // 2. Student Login
      if (action === 'student-login' || (!action && body.reg_no)) {
        const regNo = (body.reg_no || body.regNo || '').trim();
        const dobOrPass = (body.dob || body.password || '').trim();

        if (!regNo) {
          return sendResponse(res, 400, false, 'Please enter your Registration Number');
        }

        const { data: student, error } = await supabase
          .from('students')
          .select('*')
          .ilike('reg_no', regNo)
          .maybeSingle();

        if (error) throw error;

        if (!student) {
          return sendResponse(res, 404, false, 'No student found with this Register Number');
        }

        if (dobOrPass) {
          const passMatch = student.password_hash === dobOrPass || student.dob === dobOrPass;
          if (!passMatch) {
            return sendResponse(res, 401, false, 'Incorrect Password / Date of Birth');
          }
        }

        const safeStudent = {
          id: student.id,
          reg_no: student.reg_no,
          name: student.name,
          department: student.department,
          dob: student.dob,
          wallet_balance: student.wallet_balance
        };

        return sendResponse(res, 200, true, safeStudent);
      }

      // 3. Student Registration
      if (action === 'student-register') {
        const { reg_no, name, department, dob, password } = body;

        if (!reg_no || !name || !department || !dob) {
          return sendResponse(res, 400, false, 'Please fill in all required registration fields');
        }

        const password_hash = password || dob;

        const { data: created, error } = await supabase
          .from('students')
          .insert([{
            reg_no: reg_no.trim(),
            name: name.trim(),
            department: department.trim(),
            dob: dob.trim(),
            password_hash: password_hash.trim(),
            wallet_balance: 0.00
          }])
          .select('id, reg_no, name, department, dob, wallet_balance')
          .single();

        if (error) {
          if (error.code === '23505') {
            return sendResponse(res, 409, false, 'A student with this Register Number already exists');
          }
          throw error;
        }

        return sendResponse(res, 201, true, created);
      }

      return sendResponse(res, 400, false, 'Invalid auth action specified');
    }

    return sendResponse(res, 405, false, 'Method not allowed');
  } catch (err) {
    console.error('Auth API Error:', err);
    return sendResponse(res, 500, false, err.message || 'Authentication service error');
  }
};
