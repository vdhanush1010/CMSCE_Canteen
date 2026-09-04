// /api/orders.js - Comprehensive Orders Processing, Queue & Analytics API
const { supabase, setCORS, sendResponse } = require('./_supabase');

/**
 * Robust helper to find an order by UUID or Token Number (e.g. #TK-155, TK-155, 155, #POS-100, etc.)
 */
async function findOrderByIdOrToken(identifier) {
  if (!identifier) return null;
  const raw = String(identifier).trim();
  if (!raw) return null;

  const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw);

  // 1. If valid UUID, query by id directly
  if (isUUID) {
    const { data: byId, error: errId } = await supabase
      .from('orders')
      .select(`
        *,
        students (id, name, reg_no, department),
        order_items (
          id,
          product_id,
          quantity,
          unit_price,
          products (id, name, price, stock_quantity, image_url)
        )
      `)
      .eq('id', raw)
      .maybeSingle();

    if (!errId && byId) return byId;
  }

  // 2. Normalize token variations
  const clean = raw.replace(/^#+/, '').trim();
  const variations = [
    raw,
    `#${clean}`,
    clean,
    `#TK-${clean}`,
    `#POS-${clean}`,
    `#GST-${clean}`,
    `TK-${clean}`,
    `POS-${clean}`,
    `GST-${clean}`
  ];
  const uniqueVariants = [...new Set(variations.filter(Boolean))];

  // Try exact / ilike matching across variations
  for (const variant of uniqueVariants) {
    const { data: byVariant, error: varErr } = await supabase
      .from('orders')
      .select(`
        *,
        students (id, name, reg_no, department),
        order_items (
          id,
          product_id,
          quantity,
          unit_price,
          products (id, name, price, stock_quantity, image_url)
        )
      `)
      .ilike('token_number', variant)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!varErr && byVariant) return byVariant;
  }

  // 3. Fuzzy match substring (e.g. user entered "155" matching "#TK-155")
  if (clean.length >= 2) {
    const { data: fuzzy, error: fuzErr } = await supabase
      .from('orders')
      .select(`
        *,
        students (id, name, reg_no, department),
        order_items (
          id,
          product_id,
          quantity,
          unit_price,
          products (id, name, price, stock_quantity, image_url)
        )
      `)
      .ilike('token_number', `%${clean}%`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    if (!fuzErr && fuzzy) return fuzzy;
  }

  return null;
}

module.exports = async (req, res) => {
  if (setCORS(req, res)) return;

  try {
    // ----------------------------------------------------
    // 1. GET: Fetch Orders, Queue, History & Sales Summary
    // ----------------------------------------------------
    if (req.method === 'GET') {
      const { type, student_id, lookup, date } = req.query;

      // 1A. Token / ID Lookup
      if (lookup) {
        const order = await findOrderByIdOrToken(lookup);
        if (!order) {
          return sendResponse(res, 404, false, `Order with token "${lookup}" not found`);
        }
        return sendResponse(res, 200, true, order);
      }

      // 1B. Student Order History
      if (student_id) {
        const { data: studentOrders, error } = await supabase
          .from('orders')
          .select(`
            *,
            order_items (
              id,
              quantity,
              unit_price,
              products (id, name, price, stock_quantity, image_url)
            )
          `)
          .eq('student_id', student_id)
          .order('created_at', { ascending: false });

        if (error) throw error;
        return sendResponse(res, 200, true, studentOrders || []);
      }

      // 1C. Sales Metrics Summary
      if (type === 'summary') {
        const targetDate = date || new Date().toISOString().split('T')[0];
        const { data: allOrders, error } = await supabase
          .from('orders')
          .select('id, total_amount, payment_method, payment_status, order_status, created_at, qr_code_data')
          .order('created_at', { ascending: false });

        if (error) throw error;

        const filtered = (allOrders || []).filter(o => {
          if (!o.created_at) return false;
          return o.created_at.split('T')[0] === targetDate;
        });

        const delivered = filtered.filter(o => o.order_status === 'DELIVERED');
        const cashOrders = delivered.filter(o => o.payment_method === 'CASH_AT_COUNTER' || (o.qr_code_data && o.qr_code_data.payment_mode === 'CASH'));
        const upiOrders = delivered.filter(o => o.payment_method === 'ONLINE' || (o.qr_code_data && o.qr_code_data.payment_mode === 'UPI'));

        const totalRevenue = delivered.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
        const cashRevenue = cashOrders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);
        const upiRevenue = upiOrders.reduce((sum, o) => sum + (parseFloat(o.total_amount) || 0), 0);

        return sendResponse(res, 200, true, {
          date: targetDate,
          total_revenue: totalRevenue,
          cash_revenue: cashRevenue,
          upi_revenue: upiRevenue,
          delivered_count: delivered.length,
          total_orders: filtered.length
        });
      }

      // 1D. Active Orders Queue vs All Orders
      let query = supabase
        .from('orders')
        .select(`
          *,
          students (id, name, reg_no, department),
          order_items (
            id,
            product_id,
            quantity,
            unit_price,
            products (id, name, price, stock_quantity, image_url)
          )
        `)
        .order('created_at', { ascending: false });

      if (type === 'queue') {
        query = query.neq('order_status', 'DELIVERED').neq('order_status', 'CANCELLED');
      }

      const { data: ordersList, error: ordersErr } = await query;
      if (ordersErr) throw ordersErr;

      return sendResponse(res, 200, true, ordersList || []);
    }

    // ----------------------------------------------------
    // 2. POST: Place New Order (Student / Guest / POS)
    // ----------------------------------------------------
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const {
        student_id,
        items,
        payment_method = 'CASH_AT_COUNTER',
        payment_status,
        order_type,
        guest_name,
        is_guest,
        notes
      } = body;

      if (!items || !Array.isArray(items) || items.length === 0) {
        return sendResponse(res, 400, false, 'No items provided for order');
      }

      // Fetch live product data from DB to validate stock and calculate price securely
      const productIds = items.map(i => i.product_id || i.id);
      const { data: dbProducts, error: prodErr } = await supabase
        .from('products')
        .select('*')
        .in('id', productIds);

      if (prodErr) throw prodErr;

      // Validate Stock
      let totalAmount = 0;
      const orderItemsToInsert = [];

      for (const item of items) {
        const prodId = item.product_id || item.id;
        const qty = parseInt(item.quantity) || 1;
        const dbProd = (dbProducts || []).find(p => p.id === prodId);

        if (!dbProd) {
          return sendResponse(res, 404, false, `Product not found: ${item.name || prodId}`);
        }

        if (!body.stock_pre_deducted && dbProd.stock_quantity < qty) {
          return sendResponse(res, 400, false, `${dbProd.name} is out of stock or quantity no longer available!`);
        }

        const unitPrice = parseFloat(dbProd.price);
        totalAmount += unitPrice * qty;

        orderItemsToInsert.push({
          product_id: prodId,
          quantity: qty,
          unit_price: unitPrice
        });
      }

      // Generate Daily Reset Order Token (#TK-101 onwards)
      let ticketNumber = body.token_number || body.ticket_number;
      if (!ticketNumber) {
        const startOfToday = new Date();
        startOfToday.setHours(0, 0, 0, 0);

        const { count } = await supabase
          .from('orders')
          .select('*', { count: 'exact', head: true })
          .gte('created_at', startOfToday.toISOString());

        const dailySeq = (count || 0) + 101;
        ticketNumber = `#TK-${dailySeq}`;
      }

      const initialOrderStatus = order_type === 'POS' ? 'DELIVERED' : 'PENDING_PICKUP';
      const initialPaymentStatus = payment_status || (payment_method === 'ONLINE' || order_type === 'POS' ? 'PAID' : 'PENDING');
      const paymentMode = payment_method === 'ONLINE' ? 'UPI' : 'CASH';

      const qrPayload = {
        token_number: ticketNumber,
        order_type: order_type || (is_guest ? 'GUEST_ORDER' : 'STUDENT_ORDER'),
        payment_mode: paymentMode,
        payment_status: initialPaymentStatus,
        total_amount: totalAmount,
        is_guest: Boolean(is_guest || !student_id),
        guest_name: guest_name || (is_guest ? 'Guest User' : null),
        created_at: new Date().toISOString()
      };

      // 1. Insert Order
      const { data: newOrder, error: insertOrderErr } = await supabase
        .from('orders')
        .insert([{
          student_id: student_id || null,
          token_number: ticketNumber,
          total_amount: totalAmount,
          payment_method: payment_method === 'ONLINE' ? 'ONLINE' : 'CASH_AT_COUNTER',
          payment_status: initialPaymentStatus,
          order_status: initialOrderStatus,
          qr_code_data: qrPayload
        }])
        .select('*, students(name, reg_no, department)')
        .single();

      if (insertOrderErr) throw insertOrderErr;

      const isPos = order_type === 'POS' || body.order_source === 'POS' || body.is_pos === true;
      const finalToken = ticketNumber;

      const finalQrData = {
        ...(typeof newOrder.qr_code_data === 'object' ? newOrder.qr_code_data : {}),
        token_number: finalToken,
        order_type: isPos ? 'POS' : (is_guest || !student_id ? 'GUEST_ORDER' : 'STUDENT_ORDER'),
        order_source: isPos ? 'POS' : 'APP',
        is_pos: isPos,
        is_spot_sale: isPos,
        payment_mode: paymentMode,
        payment_status: initialPaymentStatus,
        total_amount: totalAmount
      };

      const updatePayload = {
        token_number: finalToken,
        qr_code_data: finalQrData
      };
      if (isPos) {
        updatePayload.order_status = 'DELIVERED';
        updatePayload.payment_status = 'PAID';
      }

      await supabase
        .from('orders')
        .update(updatePayload)
        .eq('id', newOrder.id);

      newOrder.token_number = finalToken;
      newOrder.qr_code_data = finalQrData;
      if (isPos) {
        newOrder.order_status = 'DELIVERED';
        newOrder.payment_status = 'PAID';
      }

      // 2. Insert Order Items
      const itemsPayload = orderItemsToInsert.map(oi => ({
        ...oi,
        order_id: newOrder.id
      }));

      const { error: insertItemsErr } = await supabase
        .from('order_items')
        .insert(itemsPayload);

      if (insertItemsErr) throw insertItemsErr;

      // 3. Update Product Stock (prevent double decrement if pre-deducted atomically)
      for (const oi of orderItemsToInsert) {
        const dbProd = dbProducts.find(p => p.id === oi.product_id);
        if (dbProd) {
          const finalStock = body.stock_pre_deducted
            ? dbProd.stock_quantity
            : Math.max(0, dbProd.stock_quantity - oi.quantity);
          await supabase
            .from('products')
            .update({ stock_quantity: finalStock })
            .eq('id', oi.product_id);
        }
      }

      // Fetch complete created order with items
      const { data: completeOrder, error: fetchCompleteErr } = await supabase
        .from('orders')
        .select(`
          *,
          students (id, name, reg_no, department),
          order_items (
            id,
            quantity,
            unit_price,
            products (id, name, price, stock_quantity, image_url)
          )
        `)
        .eq('id', newOrder.id)
        .single();

      if (fetchCompleteErr) throw fetchCompleteErr;

      return sendResponse(res, 201, true, completeOrder);
    }

    // ----------------------------------------------------
    // 3. PATCH: Update Order Status (Verify, Deliver, Pay, Cancel)
    // ----------------------------------------------------
    if (req.method === 'PATCH' || req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { id, token, action, order_status, payment_status } = body;

      const lookupIdentifier = id || token;
      if (!lookupIdentifier) {
        return sendResponse(res, 400, false, 'Order ID or Token is required for status update');
      }

      const existingOrder = await findOrderByIdOrToken(lookupIdentifier);
      if (!existingOrder) {
        return sendResponse(res, 404, false, `Order with token "${lookupIdentifier}" not found`);
      }

      const targetId = existingOrder.id;
      const updates = {};

      if (action === 'verify_and_deliver' || action === 'deliver') {
        updates.order_status = 'DELIVERED';
        updates.payment_status = 'PAID';
      } else if (action === 'mark_paid' || action === 'pay') {
        updates.payment_status = 'PAID';
      } else if (action === 'cancel') {
        // Enforce strict 5-minute cancellation window
        if (existingOrder.order_status === 'DELIVERED') {
          return sendResponse(res, 400, false, 'Delivered orders cannot be cancelled');
        }
        if (existingOrder.order_status === 'CANCELLED') {
          return sendResponse(res, 400, false, 'Order is already cancelled');
        }

        const createdAt = existingOrder.created_at ? new Date(existingOrder.created_at).getTime() : Date.now();
        const elapsedMs = Date.now() - createdAt;
        const CANCELLATION_GRACE_PERIOD_MS = 5 * 60 * 1000; // 5 minutes

        if (elapsedMs > CANCELLATION_GRACE_PERIOD_MS) {
          return sendResponse(res, 400, false, 'Cancellation window closed. Orders can only be cancelled within 5 minutes of placement.');
        }

        updates.order_status = 'CANCELLED';

        const qd = typeof existingOrder.qr_code_data === 'object' && existingOrder.qr_code_data !== null
          ? { ...existingOrder.qr_code_data }
          : {};
        qd.status = 'CANCELLED';
        qd.cancelled_at = new Date().toISOString();
        qd.cancel_reason = 'Cancelled by student within 5-minute grace period';
        updates.qr_code_data = qd;

        // Automatically increment and restore inventory stock for cancelled items
        const orderItems = existingOrder.order_items || [];
        for (const it of orderItems) {
          const prodId = it.product_id || (it.products && it.products.id);
          const qty = parseInt(it.quantity) || 0;
          if (prodId && qty > 0) {
            const { data: currentProd } = await supabase
              .from('products')
              .select('stock_quantity')
              .eq('id', prodId)
              .maybeSingle();

            if (currentProd) {
              const restoredStock = (currentProd.stock_quantity || 0) + qty;
              await supabase
                .from('products')
                .update({ stock_quantity: restoredStock })
                .eq('id', prodId);
            }
          }
        }
      } else {
        if (order_status) updates.order_status = order_status;
        if (payment_status) updates.payment_status = payment_status;
      }

      if (Object.keys(updates).length === 0) {
        return sendResponse(res, 400, false, 'No updates specified');
      }

      const { data: updatedOrder, error: updateErr } = await supabase
        .from('orders')
        .update(updates)
        .eq('id', targetId)
        .select(`
          *,
          students (id, name, reg_no, department),
          order_items (
            id,
            product_id,
            quantity,
            unit_price,
            products (id, name, price, stock_quantity, image_url)
          )
        `)
        .single();

      if (updateErr) throw updateErr;

      return sendResponse(res, 200, true, updatedOrder);
    }

    return sendResponse(res, 405, false, 'Method not allowed');
  } catch (err) {
    console.error('Orders API Error:', err);
    return sendResponse(res, 500, false, err.message || 'Orders service error');
  }
};
