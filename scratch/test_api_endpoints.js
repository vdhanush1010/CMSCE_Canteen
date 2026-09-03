// Test all /api endpoints locally
const authHandler = require('../api/auth');
const menuHandler = require('../api/menu');
const ordersHandler = require('../api/orders');
const statusHandler = require('../api/canteen-status');
const noticesHandler = require('../api/notices');

function mockReqRes(method, body = {}, query = {}) {
  const headers = {};
  let statusCode = 200;
  let jsonResult = null;
  let ended = false;

  const req = {
    method,
    body,
    query
  };

  const res = {
    setHeader: (k, v) => { headers[k] = v; },
    status: (code) => {
      statusCode = code;
      return res;
    },
    json: (data) => {
      jsonResult = data;
      ended = true;
      return res;
    },
    end: () => {
      ended = true;
      return res;
    }
  };

  return { req, res, getResult: () => ({ statusCode, jsonResult, headers, ended }) };
}

async function runTests() {
  console.log('--- Testing /api/auth.js ---');
  // Manager Login test
  {
    const { req, res, getResult } = mockReqRes('POST', { action: 'manager-login', phone: '9025114185', otp: '1234' });
    await authHandler(req, res);
    const r = getResult();
    console.log('Manager Login:', r.statusCode, r.jsonResult);
    if (!r.jsonResult?.success) throw new Error('Manager login failed');
  }

  console.log('\n--- Testing /api/canteen-status.js ---');
  // Canteen status GET & POST
  {
    const { req, res, getResult } = mockReqRes('GET');
    await statusHandler(req, res);
    console.log('Canteen Status GET:', getResult().jsonResult);
  }
  {
    const { req, res, getResult } = mockReqRes('POST', { is_open: true });
    await statusHandler(req, res);
    console.log('Canteen Status POST:', getResult().jsonResult);
  }

  console.log('\n--- Testing /api/menu.js ---');
  // Menu GET
  {
    const { req, res, getResult } = mockReqRes('GET');
    await menuHandler(req, res);
    const r = getResult();
    console.log('Menu GET:', r.statusCode, 'Categories:', r.jsonResult?.data?.categories?.length, 'Products:', r.jsonResult?.data?.products?.length);
    if (!r.jsonResult?.success) throw new Error('Menu fetch failed');
  }

  console.log('\n--- Testing /api/orders.js ---');
  // Orders Queue GET
  {
    const { req, res, getResult } = mockReqRes('GET', {}, { type: 'queue' });
    await ordersHandler(req, res);
    const r = getResult();
    console.log('Orders Queue GET:', r.statusCode, 'Active Queue Length:', r.jsonResult?.data?.length);
    if (!r.jsonResult?.success) throw new Error('Orders queue fetch failed');
  }

  // Summary Metrics GET
  {
    const { req, res, getResult } = mockReqRes('GET', {}, { type: 'summary' });
    await ordersHandler(req, res);
    const r = getResult();
    console.log('Orders Summary GET:', r.statusCode, r.jsonResult?.data);
    if (!r.jsonResult?.success) throw new Error('Orders summary fetch failed');
  }

  console.log('\n--- Testing /api/notices.js ---');
  // Notices GET
  {
    const { req, res, getResult } = mockReqRes('GET');
    await noticesHandler(req, res);
    const r = getResult();
    console.log('Notices GET:', r.statusCode, 'Notices count:', r.jsonResult?.data?.length);
  }

  console.log('\n✅ ALL API ENDPOINT TESTS PASSED SUCCESSFULLY!');
}

runTests().catch(err => {
  console.error('❌ Test failed:', err);
  process.exit(1);
});
