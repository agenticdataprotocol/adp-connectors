CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE items (
    id       SERIAL PRIMARY KEY,
    title    VARCHAR(200) NOT NULL,
    category VARCHAR(60)  NOT NULL,
    price    NUMERIC(10, 2) NOT NULL,
    embedding vector(3) NOT NULL
);

CREATE INDEX ON items USING ivfflat (embedding vector_cosine_ops) WITH (lists = 1);

INSERT INTO items (title, category, price, embedding) VALUES
    ('Wireless Mouse',          'Electronics',  29.99, '[0.9, 0.7, 0.2]'),
    ('Mechanical Keyboard',     'Electronics',  89.99, '[0.9, 0.8, 0.1]'),
    ('USB-C Hub',               'Electronics',  45.00, '[0.95, 0.5, 0.1]'),
    ('Notebook (A5)',           'Stationery',   12.50, '[0.1, 0.9, 0.3]'),
    ('Ballpoint Pen Pack',      'Stationery',    5.99, '[0.05, 0.95, 0.2]'),
    ('Desk Lamp',               'Furniture',    39.99, '[0.2, 0.6, 0.9]'),
    ('Standing Desk Mat',       'Furniture',    49.99, '[0.1, 0.7, 0.8]'),
    ('Monitor Arm',             'Electronics',  59.99, '[0.85, 0.75, 0.15]'),
    ('Ergonomic Chair Cushion', 'Furniture',    34.99, '[0.1, 0.8, 0.7]'),
    ('Laptop Stand',            'Electronics',  27.99, '[0.9, 0.6, 0.3]');
