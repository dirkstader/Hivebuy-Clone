import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

// ---------- Users & Roles ----------
export const ROLES = ["requester", "approver", "purchasing", "finance"] as const;
export type Role = (typeof ROLES)[number];

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  email: text("email").notNull().unique(),
  password: text("password").notNull(),
  role: text("role").notNull().default("requester"),
  department: text("department").notNull().default(""),
  costCenterId: integer("cost_center_id"),
});

export const insertUserSchema = createInsertSchema(users).omit({ id: true });
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ---------- Cost Centers & Budgets ----------
export const costCenters = sqliteTable("cost_centers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  owner: text("owner").notNull().default(""),
  city: text("city").notNull().default(""),
  annualBudget: real("annual_budget").notNull().default(0),
  spent: real("spent").notNull().default(0),
});

export const insertCostCenterSchema = createInsertSchema(costCenters).omit({ id: true });
export type InsertCostCenter = z.infer<typeof insertCostCenterSchema>;
export type CostCenter = typeof costCenters.$inferSelect;

// ---------- Suppliers ----------
export const suppliers = sqliteTable("suppliers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  category: text("category").notNull().default(""),
  contactName: text("contact_name").notNull().default(""),
  email: text("email").notNull().default(""),
  phone: text("phone").notNull().default(""),
  address: text("address").notNull().default(""),
  rating: integer("rating").notNull().default(4),
  status: text("status").notNull().default("active"), // active | inactive
});

export const insertSupplierSchema = createInsertSchema(suppliers).omit({ id: true });
export type InsertSupplier = z.infer<typeof insertSupplierSchema>;
export type Supplier = typeof suppliers.$inferSelect;

// ---------- Catalog Items ----------
export const catalogItems = sqliteTable("catalog_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  supplierId: integer("supplier_id").notNull(),
  sku: text("sku").notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  unit: text("unit").notNull().default("Stk."),
  unitPrice: real("unit_price").notNull().default(0),
  category: text("category").notNull().default(""),
  brand: text("brand").notNull().default(""),
  ean: text("ean").notNull().default(""),
});

export const insertCatalogItemSchema = createInsertSchema(catalogItems).omit({ id: true });
export type InsertCatalogItem = z.infer<typeof insertCatalogItemSchema>;
export type CatalogItem = typeof catalogItems.$inferSelect;

// ---------- Purchase Requests (Bestellanforderungen) ----------
export const REQUEST_STATUSES = [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "ordered",
  "received",
  "closed",
] as const;
export type RequestStatus = (typeof REQUEST_STATUSES)[number];

export const purchaseRequests = sqliteTable("purchase_requests", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requestNumber: text("request_number").notNull().unique(),
  requesterId: integer("requester_id").notNull(),
  costCenterId: integer("cost_center_id").notNull(),
  supplierId: integer("supplier_id"),
  title: text("title").notNull(),
  justification: text("justification").notNull().default(""),
  status: text("status").notNull().default("draft"),
  totalAmount: real("total_amount").notNull().default(0),
  approverId: integer("approver_id"),
  approverComment: text("approver_comment").notNull().default(""),
  createdAt: text("created_at").notNull(),
  decidedAt: text("decided_at"),
});

export const insertPurchaseRequestSchema = createInsertSchema(purchaseRequests).omit({ id: true });
export type InsertPurchaseRequest = z.infer<typeof insertPurchaseRequestSchema>;
export type PurchaseRequest = typeof purchaseRequests.$inferSelect;

// ---------- Purchase Request Line Items ----------
export const requestLineItems = sqliteTable("request_line_items", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requestId: integer("request_id").notNull(),
  catalogItemId: integer("catalog_item_id"),
  description: text("description").notNull(),
  quantity: real("quantity").notNull().default(1),
  unitPrice: real("unit_price").notNull().default(0),
});

export const insertRequestLineItemSchema = createInsertSchema(requestLineItems).omit({ id: true });
export type InsertRequestLineItem = z.infer<typeof insertRequestLineItemSchema>;
export type RequestLineItem = typeof requestLineItems.$inferSelect;

// ---------- Purchase Orders (Bestellungen) ----------
export const ORDER_STATUSES = ["open", "partially_received", "received", "closed"] as const;
export type OrderStatus = (typeof ORDER_STATUSES)[number];

export const purchaseOrders = sqliteTable("purchase_orders", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderNumber: text("order_number").notNull().unique(),
  requestId: integer("request_id").notNull(),
  supplierId: integer("supplier_id").notNull(),
  status: text("status").notNull().default("open"),
  totalAmount: real("total_amount").notNull().default(0),
  orderedAt: text("ordered_at").notNull(),
  expectedDelivery: text("expected_delivery"),
});

export const insertPurchaseOrderSchema = createInsertSchema(purchaseOrders).omit({ id: true });
export type InsertPurchaseOrder = z.infer<typeof insertPurchaseOrderSchema>;
export type PurchaseOrder = typeof purchaseOrders.$inferSelect;

// ---------- Invoices (Rechnungen) & 3-Way-Match ----------
export const INVOICE_STATUSES = ["pending_review", "matched", "discrepancy", "approved", "paid"] as const;
export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

export const invoices = sqliteTable("invoices", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  invoiceNumber: text("invoice_number").notNull(),
  orderId: integer("order_id").notNull(),
  supplierId: integer("supplier_id").notNull(),
  amount: real("amount").notNull().default(0),
  status: text("status").notNull().default("pending_review"),
  receivedAt: text("received_at").notNull(),
  dueDate: text("due_date"),
  matchNote: text("match_note").notNull().default(""),
  paidAt: text("paid_at"),
});

export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true });
export type InsertInvoice = z.infer<typeof insertInvoiceSchema>;
export type Invoice = typeof invoices.$inferSelect;

// ---------- Amazon Business Punch-Out (simulated cXML/OCI session) ----------
// In production this session is created via a real cXML PunchOutSetupRequest to
// Amazon Business and the returned StartPage URL is opened for the user. The
// PunchOutOrderMessage callback then posts the selected cart back here.
export const punchoutSessions = sqliteTable("punchout_sessions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requestId: integer("request_id"), // draft request this session is attached to, if any
  userId: integer("user_id").notNull(),
  status: text("status").notNull().default("pending"), // pending | returned | cancelled
  cartJson: text("cart_json").notNull().default("[]"), // JSON array of returned line items
  createdAt: text("created_at").notNull(),
  returnedAt: text("returned_at"),
});

export const insertPunchoutSessionSchema = createInsertSchema(punchoutSessions).omit({ id: true });
export type InsertPunchoutSession = z.infer<typeof insertPunchoutSessionSchema>;
export type PunchoutSession = typeof punchoutSessions.$inferSelect;

export interface PunchoutCartLine {
  sku: string;
  name: string;
  description: string;
  quantity: number;
  unitPrice: number;
  imageUrl?: string;
}

// ---------- Approval Steps (multi-level approval chain per request) ----------
// A request's approval chain is a sequence of steps resolved in stepOrder. Each step is
// satisfied by any user whose role covers approverRole (finance covers approver too). The
// chain length depends on the request amount — see buildApprovalChain in server/routes.ts.
export const APPROVAL_STEP_STATUSES = ["pending", "approved", "rejected"] as const;
export type ApprovalStepStatus = (typeof APPROVAL_STEP_STATUSES)[number];

export const approvalSteps = sqliteTable("approval_steps", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  requestId: integer("request_id").notNull(),
  stepOrder: integer("step_order").notNull(),
  approverRole: text("approver_role").notNull(), // required role: approver | finance
  status: text("status").notNull().default("pending"),
  decidedById: integer("decided_by_id"),
  comment: text("comment").notNull().default(""),
  decidedAt: text("decided_at"),
});

export const insertApprovalStepSchema = createInsertSchema(approvalSteps).omit({ id: true });
export type InsertApprovalStep = z.infer<typeof insertApprovalStepSchema>;
export type ApprovalStep = typeof approvalSteps.$inferSelect;

// ---------- Activity Log (for approvals/audit trail) ----------
export const activityLog = sqliteTable("activity_log", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(), // request | order | invoice
  entityId: integer("entity_id").notNull(),
  actorId: integer("actor_id"),
  action: text("action").notNull(),
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const insertActivityLogSchema = createInsertSchema(activityLog).omit({ id: true });
export type InsertActivityLog = z.infer<typeof insertActivityLogSchema>;
export type ActivityLog = typeof activityLog.$inferSelect;
