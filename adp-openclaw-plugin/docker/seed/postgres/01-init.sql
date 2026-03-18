-- Copyright 2026 Datastrato, Inc.
--
-- Licensed under the Apache License, Version 2.0 (the "License");
-- you may not use this file except in compliance with the License.
-- You may obtain a copy of the License at
--
--     http://www.apache.org/licenses/LICENSE-2.0
--
-- Unless required by applicable law or agreed to in writing, software
-- distributed under the License is distributed on an "AS IS" BASIS,
-- WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
-- See the License for the specific language governing permissions and
-- limitations under the License.

CREATE TABLE customers (
    id       SERIAL PRIMARY KEY,
    name     VARCHAR(100) NOT NULL,
    email    VARCHAR(150) NOT NULL UNIQUE,
    city     VARCHAR(80),
    created_at TIMESTAMP NOT NULL DEFAULT now()
);

CREATE TABLE products (
    id       SERIAL PRIMARY KEY,
    name     VARCHAR(120) NOT NULL,
    category VARCHAR(60)  NOT NULL,
    price    NUMERIC(10, 2) NOT NULL,
    in_stock BOOLEAN NOT NULL DEFAULT TRUE
);

CREATE TABLE orders (
    id          SERIAL PRIMARY KEY,
    customer_id INTEGER NOT NULL REFERENCES customers(id),
    product_id  INTEGER NOT NULL REFERENCES products(id),
    quantity    INTEGER NOT NULL DEFAULT 1,
    total       NUMERIC(10, 2) NOT NULL,
    status      VARCHAR(20) NOT NULL DEFAULT 'pending',
    ordered_at  TIMESTAMP NOT NULL DEFAULT now()
);

INSERT INTO customers (name, email, city) VALUES
    ('Alice Johnson',  'alice@example.com',  'Seattle'),
    ('Bob Smith',      'bob@example.com',    'Portland'),
    ('Carol White',    'carol@example.com',  'San Francisco'),
    ('David Brown',    'david@example.com',  'Austin'),
    ('Eva Martinez',   'eva@example.com',    'New York');

INSERT INTO products (name, category, price, in_stock) VALUES
    ('Wireless Mouse',      'Electronics', 29.99,  TRUE),
    ('Mechanical Keyboard', 'Electronics', 89.99,  TRUE),
    ('USB-C Hub',           'Electronics', 45.00,  TRUE),
    ('Notebook (A5)',       'Stationery',  12.50,  TRUE),
    ('Ballpoint Pen Pack',  'Stationery',   5.99,  TRUE),
    ('Standing Desk Mat',   'Furniture',   39.99,  FALSE);

INSERT INTO orders (customer_id, product_id, quantity, total, status, ordered_at) VALUES
    (1, 1, 1,  29.99, 'shipped',   '2025-12-01 10:00:00'),
    (1, 2, 1,  89.99, 'delivered', '2025-12-03 14:30:00'),
    (2, 3, 2,  90.00, 'shipped',   '2025-12-05 09:15:00'),
    (2, 5, 3,  17.97, 'delivered', '2025-12-05 09:15:00'),
    (3, 1, 1,  29.99, 'pending',   '2025-12-10 16:45:00'),
    (3, 4, 5,  62.50, 'shipped',   '2025-12-11 08:00:00'),
    (4, 2, 1,  89.99, 'pending',   '2025-12-15 11:20:00'),
    (4, 6, 1,  39.99, 'cancelled', '2025-12-15 11:20:00'),
    (5, 3, 1,  45.00, 'shipped',   '2025-12-18 13:00:00'),
    (5, 1, 2,  59.98, 'delivered', '2025-12-20 17:30:00');
