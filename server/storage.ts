import {
  users, costCenters, suppliers, catalogItems, purchaseRequests, requestLineItems,
  purchaseOrders, invoices, activityLog, punchoutSessions,
} from '@shared/schema';
import type {
  User, InsertUser, CostCenter, InsertCostCenter, Supplier, InsertSupplier,
  CatalogItem, InsertCatalogItem, PurchaseRequest, InsertPurchaseRequest,
  RequestLineItem, InsertRequestLineItem, PurchaseOrder, InsertPurchaseOrder,
  Invoice, InsertInvoice, ActivityLog, InsertActivityLog,
  PunchoutSession, InsertPunchoutSession,
} from '@shared/schema';
import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";

const sqlite = new Database("data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// ---------- Schema bootstrap (no migrations tool wired up, so create tables directly) ----------
sqlite.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'requester',
  department TEXT NOT NULL DEFAULT '',
  cost_center_id INTEGER
);
CREATE TABLE IF NOT EXISTS cost_centers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  owner TEXT NOT NULL DEFAULT '',
  annual_budget REAL NOT NULL DEFAULT 0,
  spent REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS suppliers (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '',
  contact_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  address TEXT NOT NULL DEFAULT '',
  rating INTEGER NOT NULL DEFAULT 4,
  status TEXT NOT NULL DEFAULT 'active'
);
CREATE TABLE IF NOT EXISTS catalog_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  supplier_id INTEGER NOT NULL,
  sku TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  unit TEXT NOT NULL DEFAULT 'Stk.',
  unit_price REAL NOT NULL DEFAULT 0,
  category TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS purchase_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_number TEXT NOT NULL UNIQUE,
  requester_id INTEGER NOT NULL,
  cost_center_id INTEGER NOT NULL,
  supplier_id INTEGER,
  title TEXT NOT NULL,
  justification TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  total_amount REAL NOT NULL DEFAULT 0,
  approver_id INTEGER,
  approver_comment TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  decided_at TEXT
);
CREATE TABLE IF NOT EXISTS request_line_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER NOT NULL,
  catalog_item_id INTEGER,
  description TEXT NOT NULL,
  quantity REAL NOT NULL DEFAULT 1,
  unit_price REAL NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS purchase_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_number TEXT NOT NULL UNIQUE,
  request_id INTEGER NOT NULL,
  supplier_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  total_amount REAL NOT NULL DEFAULT 0,
  ordered_at TEXT NOT NULL,
  expected_delivery TEXT
);
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_number TEXT NOT NULL,
  order_id INTEGER NOT NULL,
  supplier_id INTEGER NOT NULL,
  amount REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'pending_review',
  received_at TEXT NOT NULL,
  due_date TEXT,
  match_note TEXT NOT NULL DEFAULT '',
  paid_at TEXT
);
CREATE TABLE IF NOT EXISTS punchout_sessions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id INTEGER,
  user_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  cart_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  returned_at TEXT
);
CREATE TABLE IF NOT EXISTS activity_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  entity_type TEXT NOT NULL,
  entity_id INTEGER NOT NULL,
  actor_id INTEGER,
  action TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`);

export interface IStorage {
  // Users
  getUser(id: number): Promise<User | undefined>;
  getUserByEmail(email: string): Promise<User | undefined>;
  listUsers(): Promise<User[]>;
  createUser(user: InsertUser): Promise<User>;

  // Cost centers
  listCostCenters(): Promise<CostCenter[]>;
  getCostCenter(id: number): Promise<CostCenter | undefined>;
  createCostCenter(cc: InsertCostCenter): Promise<CostCenter>;
  updateCostCenterSpent(id: number, delta: number): Promise<void>;

  // Suppliers
  listSuppliers(): Promise<Supplier[]>;
  getSupplier(id: number): Promise<Supplier | undefined>;
  createSupplier(s: InsertSupplier): Promise<Supplier>;
  updateSupplier(id: number, s: Partial<InsertSupplier>): Promise<Supplier | undefined>;
  deleteSupplier(id: number): Promise<void>;

  // Catalog items
  listCatalogItems(): Promise<CatalogItem[]>;
  listCatalogItemsBySupplier(supplierId: number): Promise<CatalogItem[]>;
  createCatalogItem(c: InsertCatalogItem): Promise<CatalogItem>;
  deleteCatalogItem(id: number): Promise<void>;

  // Purchase requests
  listPurchaseRequests(): Promise<PurchaseRequest[]>;
  getPurchaseRequest(id: number): Promise<PurchaseRequest | undefined>;
  createPurchaseRequest(r: InsertPurchaseRequest): Promise<PurchaseRequest>;
  updatePurchaseRequest(id: number, r: Partial<InsertPurchaseRequest>): Promise<PurchaseRequest | undefined>;

  // Line items
  listLineItems(requestId: number): Promise<RequestLineItem[]>;
  createLineItem(li: InsertRequestLineItem): Promise<RequestLineItem>;
  deleteLineItemsForRequest(requestId: number): Promise<void>;

  // Purchase orders
  listPurchaseOrders(): Promise<PurchaseOrder[]>;
  getPurchaseOrder(id: number): Promise<PurchaseOrder | undefined>;
  createPurchaseOrder(o: InsertPurchaseOrder): Promise<PurchaseOrder>;
  updatePurchaseOrder(id: number, o: Partial<InsertPurchaseOrder>): Promise<PurchaseOrder | undefined>;

  // Invoices
  listInvoices(): Promise<Invoice[]>;
  getInvoice(id: number): Promise<Invoice | undefined>;
  createInvoice(i: InsertInvoice): Promise<Invoice>;
  updateInvoice(id: number, i: Partial<InsertInvoice>): Promise<Invoice | undefined>;

  // Activity log
  listActivity(entityType: string, entityId: number): Promise<ActivityLog[]>;
  createActivity(a: InsertActivityLog): Promise<ActivityLog>;

  // Amazon Business punch-out sessions
  createPunchoutSession(p: InsertPunchoutSession): Promise<PunchoutSession>;
  getPunchoutSession(id: number): Promise<PunchoutSession | undefined>;
  updatePunchoutSession(id: number, p: Partial<InsertPunchoutSession>): Promise<PunchoutSession | undefined>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number) { return db.select().from(users).where(eq(users.id, id)).get(); }
  async getUserByEmail(email: string) { return db.select().from(users).where(eq(users.email, email)).get(); }
  async listUsers() { return db.select().from(users).all(); }
  async createUser(u: InsertUser) { return db.insert(users).values(u).returning().get(); }

  async listCostCenters() { return db.select().from(costCenters).all(); }
  async getCostCenter(id: number) { return db.select().from(costCenters).where(eq(costCenters.id, id)).get(); }
  async createCostCenter(cc: InsertCostCenter) { return db.insert(costCenters).values(cc).returning().get(); }
  async updateCostCenterSpent(id: number, delta: number) {
    const cc = await this.getCostCenter(id);
    if (!cc) return;
    db.update(costCenters).set({ spent: cc.spent + delta }).where(eq(costCenters.id, id)).run();
  }

  async listSuppliers() { return db.select().from(suppliers).all(); }
  async getSupplier(id: number) { return db.select().from(suppliers).where(eq(suppliers.id, id)).get(); }
  async createSupplier(s: InsertSupplier) { return db.insert(suppliers).values(s).returning().get(); }
  async updateSupplier(id: number, s: Partial<InsertSupplier>) {
    return db.update(suppliers).set(s).where(eq(suppliers.id, id)).returning().get();
  }
  async deleteSupplier(id: number) { db.delete(suppliers).where(eq(suppliers.id, id)).run(); }

  async listCatalogItems() { return db.select().from(catalogItems).all(); }
  async listCatalogItemsBySupplier(supplierId: number) {
    return db.select().from(catalogItems).where(eq(catalogItems.supplierId, supplierId)).all();
  }
  async createCatalogItem(c: InsertCatalogItem) { return db.insert(catalogItems).values(c).returning().get(); }
  async deleteCatalogItem(id: number) { db.delete(catalogItems).where(eq(catalogItems.id, id)).run(); }

  async listPurchaseRequests() { return db.select().from(purchaseRequests).orderBy(desc(purchaseRequests.id)).all(); }
  async getPurchaseRequest(id: number) { return db.select().from(purchaseRequests).where(eq(purchaseRequests.id, id)).get(); }
  async createPurchaseRequest(r: InsertPurchaseRequest) { return db.insert(purchaseRequests).values(r).returning().get(); }
  async updatePurchaseRequest(id: number, r: Partial<InsertPurchaseRequest>) {
    return db.update(purchaseRequests).set(r).where(eq(purchaseRequests.id, id)).returning().get();
  }

  async listLineItems(requestId: number) {
    return db.select().from(requestLineItems).where(eq(requestLineItems.requestId, requestId)).all();
  }
  async createLineItem(li: InsertRequestLineItem) { return db.insert(requestLineItems).values(li).returning().get(); }
  async deleteLineItemsForRequest(requestId: number) {
    db.delete(requestLineItems).where(eq(requestLineItems.requestId, requestId)).run();
  }

  async listPurchaseOrders() { return db.select().from(purchaseOrders).orderBy(desc(purchaseOrders.id)).all(); }
  async getPurchaseOrder(id: number) { return db.select().from(purchaseOrders).where(eq(purchaseOrders.id, id)).get(); }
  async createPurchaseOrder(o: InsertPurchaseOrder) { return db.insert(purchaseOrders).values(o).returning().get(); }
  async updatePurchaseOrder(id: number, o: Partial<InsertPurchaseOrder>) {
    return db.update(purchaseOrders).set(o).where(eq(purchaseOrders.id, id)).returning().get();
  }

  async listInvoices() { return db.select().from(invoices).orderBy(desc(invoices.id)).all(); }
  async getInvoice(id: number) { return db.select().from(invoices).where(eq(invoices.id, id)).get(); }
  async createInvoice(i: InsertInvoice) { return db.insert(invoices).values(i).returning().get(); }
  async updateInvoice(id: number, i: Partial<InsertInvoice>) {
    return db.update(invoices).set(i).where(eq(invoices.id, id)).returning().get();
  }

  async listActivity(entityType: string, entityId: number) {
    return db.select().from(activityLog)
      .where(eq(activityLog.entityType, entityType))
      .all()
      .filter(a => a.entityId === entityId);
  }
  async createActivity(a: InsertActivityLog) { return db.insert(activityLog).values(a).returning().get(); }

  async createPunchoutSession(p: InsertPunchoutSession) { return db.insert(punchoutSessions).values(p).returning().get(); }
  async getPunchoutSession(id: number) { return db.select().from(punchoutSessions).where(eq(punchoutSessions.id, id)).get(); }
  async updatePunchoutSession(id: number, p: Partial<InsertPunchoutSession>) {
    return db.update(punchoutSessions).set(p).where(eq(punchoutSessions.id, id)).returning().get();
  }
}

export const storage = new DatabaseStorage();
