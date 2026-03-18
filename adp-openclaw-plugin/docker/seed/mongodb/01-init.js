// Copyright 2026 Datastrato, Inc.
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

db = db.getSiblingDB("adp_mongo_demo");

db.customer_profiles.createIndex({ customer_id: 1 }, { unique: true });
db.customer_profiles.createIndex({ email: 1 }, { unique: true });
db.customer_profiles.createIndex({ churn_risk: 1 });

db.customer_profiles.deleteMany({});
db.customer_profiles.insertMany([
  { customer_id: 1, email: "alice@example.com",  name: "Alice Johnson", segment: "premium",    lifetime_value: 119.98, churn_risk: "low",    last_purchase_days_ago: 28 },
  { customer_id: 2, email: "bob@example.com",    name: "Bob Smith",     segment: "standard",   lifetime_value: 107.97, churn_risk: "medium", last_purchase_days_ago: 45 },
  { customer_id: 3, email: "carol@example.com",  name: "Carol White",   segment: "premium",   lifetime_value:  92.49, churn_risk: "high",   last_purchase_days_ago: 52 },
  { customer_id: 4, email: "david@example.com",  name: "David Brown",   segment: "standard",   lifetime_value:  89.99, churn_risk: "high",   last_purchase_days_ago: 35 },
  { customer_id: 5, email: "eva@example.com",    name: "Eva Martinez",  segment: "enterprise", lifetime_value: 104.98, churn_risk: "low",    last_purchase_days_ago: 20 },
]);
