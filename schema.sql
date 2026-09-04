-- Hostel Canteen Student Ordering Application Database Schema
-- Database: PostgreSQL / Supabase

-- Enable UUID extension if using Supabase UUIDs
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Create Tables

-- Students Table
CREATE TABLE students (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    reg_no VARCHAR(50) UNIQUE NOT NULL,
    name VARCHAR(100) NOT NULL,
    department VARCHAR(100) NOT NULL,
    dob DATE NOT NULL,
    phone_number VARCHAR(20) UNIQUE NOT NULL,
    email VARCHAR(150),
    avatar_url TEXT,
    password_hash VARCHAR(255) NOT NULL,
    wallet_balance DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Categories Table
CREATE TABLE categories (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    name VARCHAR(100) UNIQUE NOT NULL,
    icon_url TEXT,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Products Table
CREATE TABLE products (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    category_id UUID REFERENCES categories(id) ON DELETE CASCADE,
    name VARCHAR(150) NOT NULL,
    price DECIMAL(10, 2) NOT NULL,
    stock_quantity INT NOT NULL DEFAULT 0,
    is_available BOOLEAN GENERATED ALWAYS AS (stock_quantity > 0) STORED,
    image_url TEXT,
    barcode_id VARCHAR(100) UNIQUE,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Orders Table
CREATE TABLE orders (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    student_id UUID REFERENCES students(id) ON DELETE CASCADE,
    token_number VARCHAR(20) UNIQUE,
    total_amount DECIMAL(10, 2) NOT NULL,
    payment_method VARCHAR(20) NOT NULL CHECK (payment_method IN ('ONLINE', 'CASH_AT_COUNTER')),
    payment_status VARCHAR(20) NOT NULL CHECK (payment_status IN ('PAID', 'PENDING')),
    order_status VARCHAR(20) NOT NULL DEFAULT 'PENDING_PICKUP' CHECK (order_status IN ('PENDING_PICKUP', 'DELIVERED', 'CANCELLED')),
    qr_code_data JSONB,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Order Items Table
CREATE TABLE order_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID REFERENCES orders(id) ON DELETE CASCADE,
    product_id UUID REFERENCES products(id) ON DELETE RESTRICT,
    quantity INT NOT NULL CHECK (quantity > 0),
    unit_price DECIMAL(10, 2) NOT NULL
);

-- 2. Indexes for Performance Optimization
CREATE INDEX idx_students_reg_no ON students(reg_no);
CREATE INDEX idx_products_category_id ON products(category_id);
CREATE INDEX idx_products_barcode_id ON products(barcode_id);
CREATE INDEX idx_orders_student_id ON orders(student_id);
CREATE INDEX idx_orders_created_at ON orders(created_at);
CREATE INDEX idx_order_items_order_id ON order_items(order_id);

-- 3. Business Logic Helpers

-- View to include is_low_stock flag
CREATE OR REPLACE VIEW view_products AS
SELECT 
    *,
    (stock_quantity <= 5) AS is_low_stock
FROM products;

-- Sequence for Token Generator
CREATE SEQUENCE IF NOT EXISTS order_token_seq START 100 MAXVALUE 999 CYCLE;

-- Function to handle order defaults before insert (generate token and QR code payload)
CREATE OR REPLACE FUNCTION process_order_defaults()
RETURNS TRIGGER AS $$
DECLARE
    student_reg_no VARCHAR(50);
    token_num VARCHAR(20);
BEGIN
    -- Fetch student's registration number
    SELECT reg_no INTO student_reg_no FROM students WHERE id = NEW.student_id;
    
    -- Generate unique token (e.g., #TK-108)
    token_num := '#TK-' || nextval('order_token_seq');
    NEW.token_number := token_num;

    -- Build a JSON payload for qr_code_data
    NEW.qr_code_data := json_build_object(
        'order_id', NEW.id,
        'reg_no', student_reg_no,
        'total', NEW.total_amount,
        'token_number', token_num
    );

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to process order details before insert
CREATE TRIGGER trigger_order_defaults
    BEFORE INSERT ON orders
    FOR EACH ROW
    EXECUTE FUNCTION process_order_defaults();

-- Trigger Function to update stock on order placement
CREATE OR REPLACE FUNCTION update_product_stock_on_order()
RETURNS TRIGGER AS $$
BEGIN
    -- Decrement stock
    UPDATE products
    SET stock_quantity = stock_quantity - NEW.quantity
    WHERE id = NEW.product_id;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_stock
    AFTER INSERT ON order_items
    FOR EACH ROW
    EXECUTE FUNCTION update_product_stock_on_order();


-- 4. Notices Table
CREATE TABLE IF NOT EXISTS notices (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title VARCHAR(150) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 5. Disable Row-Level Security for absolute public write/read permissions
ALTER TABLE students DISABLE ROW LEVEL SECURITY;
ALTER TABLE categories DISABLE ROW LEVEL SECURITY;
ALTER TABLE products DISABLE ROW LEVEL SECURITY;
ALTER TABLE orders DISABLE ROW LEVEL SECURITY;
ALTER TABLE order_items DISABLE ROW LEVEL SECURITY;
ALTER TABLE notices DISABLE ROW LEVEL SECURITY;
