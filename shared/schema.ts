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

// Login always lowercases the email before lookup — normalize it the same way at creation
// time, otherwise a mixed-case email is stored as-is and can never match on login again.
export const insertUserSchema = createInsertSchema(users).omit({ id: true }).extend({
  email: z.string().min(1).transform((v) => v.trim().toLowerCase()),
});
export type InsertUser = z.infer<typeof insertUserSchema>;
export type User = typeof users.$inferSelect;

// ---------- Cost Centers (identity only — budgets live in budgetPeriods) ----------
export const costCenters = sqliteTable("cost_centers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").notNull(),
  code: text("code").notNull().unique(),
  owner: text("owner").notNull().default(""),
  city: text("city").notNull().default(""),
});

export const insertCostCenterSchema = createInsertSchema(costCenters).omit({ id: true });
export type InsertCostCenter = z.infer<typeof insertCostCenterSchema>;
export type CostCenter = typeof costCenters.$inferSelect;

// The creation request also seeds the cost center's first budget period — annualBudget isn't
// a column on costCenters itself, so it's not part of insertCostCenterSchema.
export const createCostCenterRequestSchema = insertCostCenterSchema.extend({
  annualBudget: z.number().nonnegative(),
});

// ---------- Budget Periods (Geschäftsjahre) ----------
// A cost center's budget/spent/committed numbers are scoped to a fiscal year instead of being
// a single perpetual bucket. Exactly one period per cost center is "active" at a time — moving
// to a new fiscal year is a manual finance action (rolloverCostCenterPeriod in storage.ts), not
// date-driven, since there is no scheduler in this app.
export const PERIOD_STATUSES = ["active", "closed"] as const;
export type PeriodStatus = (typeof PERIOD_STATUSES)[number];

export const budgetPeriods = sqliteTable("budget_periods", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  costCenterId: integer("cost_center_id").notNull(),
  fiscalYear: integer("fiscal_year").notNull(),
  budget: real("budget").notNull().default(0),
  spent: real("spent").notNull().default(0),
  // Reserved-but-not-yet-invoiced amount (Obligo): rises on approval, released on invoicing.
  committed: real("committed").notNull().default(0),
  startsAt: text("starts_at").notNull(),
  endsAt: text("ends_at").notNull(),
  status: text("status").notNull().default("active"), // active | closed
  createdAt: text("created_at").notNull(),
});

export const insertBudgetPeriodSchema = createInsertSchema(budgetPeriods).omit({ id: true });
export type InsertBudgetPeriod = z.infer<typeof insertBudgetPeriodSchema>;
export type BudgetPeriod = typeof budgetPeriods.$inferSelect;

// Composed shape returned by the cost-centers list/detail endpoints: flattens the active
// period's numbers onto the historical field names so dashboard/analytics JSON is unchanged.
export interface CostCenterWithPeriod extends CostCenter {
  periodId: number;
  fiscalYear: number;
  annualBudget: number;
  spent: number;
  committed: number;
  periodStartsAt: string;
  periodEndsAt: string;
}

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

// Optional (not required) to match the original drizzle-zod-derived shape: the client never
// sends totalAmount directly, it's computed server-side from lineItems (see routes.ts) — this
// only guards the fallback path where a request is created/patched without a lineItems array.
export const insertPurchaseRequestSchema = createInsertSchema(purchaseRequests).omit({ id: true }).extend({
  totalAmount: z.number().nonnegative().optional(),
});
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

export const insertRequestLineItemSchema = createInsertSchema(requestLineItems).omit({ id: true }).extend({
  quantity: z.number().positive(),
  unitPrice: z.number().nonnegative(),
});
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

export const insertInvoiceSchema = createInsertSchema(invoices).omit({ id: true }).extend({
  amount: z.number().positive(),
});
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

// ---------- Budget Commitments (Obligo ledger) ----------
// Each fully approved request reserves budget on its cost center (status reserved). Booking
// an invoice realizes the reservation (status realized); a future cancel path would release
// it. The cost center's committed column is the denormalized sum of reserved amounts.
export const COMMITMENT_STATUSES = ["reserved", "realized", "released"] as const;
export type CommitmentStatus = (typeof COMMITMENT_STATUSES)[number];

export const budgetCommitments = sqliteTable("budget_commitments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  costCenterId: integer("cost_center_id").notNull(),
  // Which fiscal year this reservation/spend belongs to — stamped at reservation time and kept
  // even if the cost center rolls over to a new period before the invoice arrives, so an
  // approved-but-not-yet-invoiced request never silently drops out of budget tracking.
  periodId: integer("period_id").notNull(),
  requestId: integer("request_id").notNull(),
  amount: real("amount").notNull().default(0),
  status: text("status").notNull().default("reserved"),
  createdAt: text("created_at").notNull(),
  resolvedAt: text("resolved_at"),
});

export const insertBudgetCommitmentSchema = createInsertSchema(budgetCommitments).omit({ id: true });
export type InsertBudgetCommitment = z.infer<typeof insertBudgetCommitmentSchema>;
export type BudgetCommitment = typeof budgetCommitments.$inferSelect;

// ---------- Goods Receipts (Wareneingang) for the 3-way match ----------
// A purchase order is received in one or more goods receipts. Each receipt line records the
// quantity actually received for a request line item (a PO maps 1:1 to a request, so its
// lines are the request's line items). The invoice match compares ordered vs received vs
// invoiced — see server/routes.ts.
export const goodsReceipts = sqliteTable("goods_receipts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  orderId: integer("order_id").notNull(),
  receivedById: integer("received_by_id"),
  note: text("note").notNull().default(""),
  receivedAt: text("received_at").notNull(),
});

export const insertGoodsReceiptSchema = createInsertSchema(goodsReceipts).omit({ id: true });
export type InsertGoodsReceipt = z.infer<typeof insertGoodsReceiptSchema>;
export type GoodsReceipt = typeof goodsReceipts.$inferSelect;

export const goodsReceiptLines = sqliteTable("goods_receipt_lines", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  receiptId: integer("receipt_id").notNull(),
  requestLineItemId: integer("request_line_item_id").notNull(),
  quantityReceived: real("quantity_received").notNull().default(0),
});

export const insertGoodsReceiptLineSchema = createInsertSchema(goodsReceiptLines).omit({ id: true });
export type InsertGoodsReceiptLine = z.infer<typeof insertGoodsReceiptLineSchema>;
export type GoodsReceiptLine = typeof goodsReceiptLines.$inferSelect;

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
  // Set only when decidedById acted as a delegate on behalf of someone else — see
  // approvalDelegations below. Null for an ordinary (non-delegated) decision.
  decidedOnBehalfOfId: integer("decided_on_behalf_of_id"),
  comment: text("comment").notNull().default(""),
  decidedAt: text("decided_at"),
});

export const insertApprovalStepSchema = createInsertSchema(approvalSteps).omit({ id: true });
export type InsertApprovalStep = z.infer<typeof insertApprovalStepSchema>;
export type ApprovalStep = typeof approvalSteps.$inferSelect;

// ---------- Approval Delegations (Freigabe-Vertretung) ----------
// A delegator (approver|finance|purchasing) can name exactly one active delegate at a time
// to act on their behalf on approval steps. Authority is borrowed from the delegator's role —
// the delegate doesn't need to hold approver/finance themselves (see buildApprovalChain /
// resolveActingAuthority in server/routes.ts). Which roles may be named as a delegate is
// restricted at the route layer, not here, so it can become configurable later.
export const approvalDelegations = sqliteTable("approval_delegations", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  delegatorId: integer("delegator_id").notNull().unique(),
  delegateId: integer("delegate_id").notNull(),
  startsAt: text("starts_at"), // null = effective immediately
  endsAt: text("ends_at"), // null = unbefristet
  note: text("note").notNull().default(""),
  createdAt: text("created_at").notNull(),
});

export const insertApprovalDelegationSchema = createInsertSchema(approvalDelegations).omit({ id: true });
export type InsertApprovalDelegation = z.infer<typeof insertApprovalDelegationSchema>;
export type ApprovalDelegation = typeof approvalDelegations.$inferSelect;

// ---------- Attachments (Datei-Anhänge) ----------
// Polymorphic like activityLog: entityType/entityId identify the parent (a request, order, or
// invoice). Files live on disk under UPLOADS_DIR (see server/uploads.ts) — storedName is the
// random on-disk filename (never client-controlled), filename is the original name shown/
// downloaded to the user.
export const ATTACHMENT_ENTITY_TYPES = ["request", "order", "invoice"] as const;
export type AttachmentEntityType = (typeof ATTACHMENT_ENTITY_TYPES)[number];

export const attachments = sqliteTable("attachments", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  entityType: text("entity_type").notNull(),
  entityId: integer("entity_id").notNull(),
  filename: text("filename").notNull(),
  storedName: text("stored_name").notNull(),
  mimeType: text("mime_type").notNull(),
  size: integer("size").notNull(),
  uploadedById: integer("uploaded_by_id"),
  createdAt: text("created_at").notNull(),
});

export const insertAttachmentSchema = createInsertSchema(attachments).omit({ id: true });
export type InsertAttachment = z.infer<typeof insertAttachmentSchema>;
export type Attachment = typeof attachments.$inferSelect;

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
