// /api/menu.js - Menu catalog, Categories & Stock Management Endpoint
const { supabase, setCORS, sendResponse } = require('./_supabase');

module.exports = async (req, res) => {
  if (setCORS(req, res)) return;

  try {
    // 1. GET: Fetch Categories & Products
    if (req.method === 'GET') {
      const { category_id, search, type } = req.query;

      if (type === 'categories') {
        const { data: cats, error: catErr } = await supabase
          .from('categories')
          .select('*')
          .order('name');
        if (catErr) throw catErr;
        return sendResponse(res, 200, true, cats || []);
      }

      if (type === 'products') {
        let prodQuery = supabase.from('products').select('*').order('name');
        if (category_id && category_id !== 'all') {
          prodQuery = prodQuery.eq('category_id', category_id);
        }
        const { data: prods, error: prodErr } = await prodQuery;
        if (prodErr) throw prodErr;
        return sendResponse(res, 200, true, prods || []);
      }

      // Default: Return both categories and products in unified payload
      const [catResult, prodResult] = await Promise.all([
        supabase.from('categories').select('*').order('name'),
        supabase.from('products').select('*').order('name')
      ]);

      if (catResult.error) throw catResult.error;
      if (prodResult.error) throw prodResult.error;

      return sendResponse(res, 200, true, {
        categories: catResult.data || [],
        products: prodResult.data || []
      });
    }

    // 2. POST: Create Product or Category
    if (req.method === 'POST') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { type } = body;

      if (type === 'category' || (!body.price && body.name && (body.icon_url || body.icon))) {
        const { name, icon_url, icon } = body;
        if (!name) return sendResponse(res, 400, false, 'Category name is required');

        const { data: newCat, error } = await supabase
          .from('categories')
          .insert([{ name: name.trim(), icon_url: icon_url || icon || '📦' }])
          .select()
          .single();

        if (error) throw error;
        return sendResponse(res, 201, true, newCat);
      }

      // Create Product
      const { name, category_id, price, stock_quantity, image_url, barcode_id } = body;
      if (!name || price === undefined) {
        return sendResponse(res, 400, false, 'Product name and price are required');
      }

      const { data: newProd, error } = await supabase
        .from('products')
        .insert([{
          name: name.trim(),
          category_id: category_id || null,
          price: parseFloat(price) || 0,
          stock_quantity: parseInt(stock_quantity) || 0,
          image_url: image_url || 'https://images.unsplash.com/photo-1546069901-ba9599a7e63c',
          barcode_id: barcode_id || null
        }])
        .select()
        .single();

      if (error) throw error;
      return sendResponse(res, 201, true, newProd);
    }

    // 3. PATCH / PUT: Update Product / Category / Stock
    if (req.method === 'PATCH' || req.method === 'PUT') {
      const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
      const { id, type } = body;

      if (!id) {
        return sendResponse(res, 400, false, 'Item ID is required for update');
      }

      // Update Category
      if (type === 'category') {
        const { name, icon_url, icon } = body;
        const updates = {};
        if (name) updates.name = name.trim();
        if (icon_url || icon) updates.icon_url = icon_url || icon;

        const { data: updatedCat, error } = await supabase
          .from('categories')
          .update(updates)
          .eq('id', id)
          .select()
          .single();

        if (error) throw error;
        return sendResponse(res, 200, true, updatedCat);
      }

      // Update Product / Stock
      const updates = {};
      if (body.name !== undefined) updates.name = body.name.trim();
      if (body.category_id !== undefined) updates.category_id = body.category_id;
      if (body.price !== undefined) updates.price = parseFloat(body.price);
      if (body.stock_quantity !== undefined) updates.stock_quantity = Math.max(0, parseInt(body.stock_quantity));
      if (body.image_url !== undefined) updates.image_url = body.image_url;
      if (body.barcode_id !== undefined) updates.barcode_id = body.barcode_id;

      const { data: updatedProd, error } = await supabase
        .from('products')
        .update(updates)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return sendResponse(res, 200, true, updatedProd);
    }

    // 4. DELETE: Delete Product or Category
    if (req.method === 'DELETE') {
      const id = req.query.id || (req.body && req.body.id);
      const type = req.query.type || (req.body && req.body.type);

      if (!id) {
        return sendResponse(res, 400, false, 'ID is required for deletion');
      }

      const table = type === 'category' ? 'categories' : 'products';
      const { error } = await supabase
        .from(table)
        .delete()
        .eq('id', id);

      if (error) throw error;
      return sendResponse(res, 200, true, { id, deleted: true, table });
    }

    return sendResponse(res, 405, false, 'Method not allowed');
  } catch (err) {
    console.error('Menu API Error:', err);
    return sendResponse(res, 500, false, err.message || 'Menu service error');
  }
};
