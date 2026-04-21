-- Large, idempotent dataset for join/aggregation/load testing
-- Creates a parallel commerce schema with enough rows to stress NL-to-SQL and execution paths.

CREATE TABLE IF NOT EXISTS big_customers (
  id BIGSERIAL PRIMARY KEY,
  customer_code TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL UNIQUE,
  full_name TEXT NOT NULL,
  segment TEXT NOT NULL CHECK (segment IN ('retail', 'business', 'enterprise')),
  region TEXT NOT NULL CHECK (region IN ('NA', 'EU', 'APAC', 'LATAM', 'MEA')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS big_products (
  id BIGSERIAL PRIMARY KEY,
  sku TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  category TEXT NOT NULL CHECK (category IN ('hardware', 'accessories', 'software', 'services')),
  price_cents INTEGER NOT NULL CHECK (price_cents >= 0),
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS big_orders (
  id BIGSERIAL PRIMARY KEY,
  order_number TEXT NOT NULL UNIQUE,
  customer_id BIGINT NOT NULL REFERENCES big_customers (id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'shipped', 'cancelled', 'refunded')),
  order_date DATE NOT NULL,
  shipped_at TIMESTAMPTZ,
  total_cents INTEGER NOT NULL DEFAULT 0 CHECK (total_cents >= 0)
);

CREATE TABLE IF NOT EXISTS big_order_items (
  id BIGSERIAL PRIMARY KEY,
  order_id BIGINT NOT NULL REFERENCES big_orders (id) ON DELETE CASCADE,
  line_number INTEGER NOT NULL CHECK (line_number > 0),
  product_id BIGINT NOT NULL REFERENCES big_products (id),
  quantity INTEGER NOT NULL CHECK (quantity > 0),
  unit_price_cents INTEGER NOT NULL CHECK (unit_price_cents >= 0),
  UNIQUE (order_id, line_number)
);

CREATE INDEX IF NOT EXISTS idx_big_orders_customer_id ON big_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_big_orders_order_date ON big_orders (order_date);
CREATE INDEX IF NOT EXISTS idx_big_orders_status ON big_orders (status);
CREATE INDEX IF NOT EXISTS idx_big_order_items_order_id ON big_order_items (order_id);
CREATE INDEX IF NOT EXISTS idx_big_order_items_product_id ON big_order_items (product_id);
CREATE INDEX IF NOT EXISTS idx_big_customers_region ON big_customers (region);
CREATE INDEX IF NOT EXISTS idx_big_products_category ON big_products (category);

-- 5,000 customers
INSERT INTO big_customers (customer_code, email, full_name, segment, region, created_at)
SELECT
  format('C%05s', g),
  format('customer%05s@example.com', g),
  format('Customer %s', g),
  (ARRAY['retail', 'business', 'enterprise'])[1 + ((g - 1) % 3)],
  (ARRAY['NA', 'EU', 'APAC', 'LATAM', 'MEA'])[1 + ((g - 1) % 5)],
  now() - ((g % 1460) * interval '1 day')
FROM generate_series(1, 5000) AS g
ON CONFLICT (customer_code) DO NOTHING;

-- 1,200 products
INSERT INTO big_products (sku, name, category, price_cents, is_active, created_at)
SELECT
  format('B-SKU-%04s', g),
  format('Product %s', g),
  (ARRAY['hardware', 'accessories', 'software', 'services'])[1 + ((g - 1) % 4)],
  499 + ((g * 137) % 35000),
  (g % 10) <> 0,
  now() - ((g % 730) * interval '1 day')
FROM generate_series(1, 1200) AS g
ON CONFLICT (sku) DO NOTHING;

-- 30,000 orders linked to existing customers
INSERT INTO big_orders (order_number, customer_id, status, order_date, shipped_at, total_cents)
SELECT
  format('O%07s', g) AS order_number,
  c.id AS customer_id,
  (ARRAY['pending', 'paid', 'shipped', 'cancelled', 'refunded'])[1 + ((g - 1) % 5)] AS status,
  current_date - (g % 365),
  CASE
    WHEN (g % 5) IN (2, 3)
      THEN now() - ((g % 180) * interval '1 day')
    ELSE NULL
  END AS shipped_at,
  0
FROM generate_series(1, 30000) AS g
JOIN big_customers c
  ON c.customer_code = format('C%05s', 1 + ((g - 1) % 5000))
ON CONFLICT (order_number) DO NOTHING;

-- 3 items per order => up to ~90,000 rows
INSERT INTO big_order_items (order_id, line_number, product_id, quantity, unit_price_cents)
SELECT
  o.id AS order_id,
  ln AS line_number,
  p.id AS product_id,
  1 + ((o.id::int + ln) % 5) AS quantity,
  p.price_cents AS unit_price_cents
FROM big_orders o
JOIN generate_series(1, 3) AS ln ON true
JOIN big_products p
  ON p.sku = format('B-SKU-%04s', 1 + (((o.id::int * 7) + (ln * 13)) % 1200))
ON CONFLICT (order_id, line_number) DO NOTHING;

-- Keep order totals in sync with line items.
UPDATE big_orders o
SET total_cents = x.total_cents
FROM (
  SELECT
    oi.order_id,
    SUM(oi.quantity * oi.unit_price_cents)::int AS total_cents
  FROM big_order_items oi
  GROUP BY oi.order_id
) x
WHERE x.order_id = o.id
  AND o.total_cents <> x.total_cents;
