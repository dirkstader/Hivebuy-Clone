import {
  users, costCenters, suppliers, catalogItems, purchaseRequests, requestLineItems,
  purchaseOrders, invoices, activityLog, punchoutSessions, approvalSteps,
  goodsReceipts, goodsReceiptLines, budgetCommitments, budgetPeriods, approvalDelegations,
  attachments,
} from '@shared/schema';
import type {
  User, InsertUser, CostCenter, InsertCostCenter, Supplier, InsertSupplier,
  CatalogItem, InsertCatalogItem, PurchaseRequest, InsertPurchaseRequest,
  RequestLineItem, InsertRequestLineItem, PurchaseOrder, InsertPurchaseOrder,
  Invoice, InsertInvoice, ActivityLog, InsertActivityLog,
  PunchoutSession, InsertPunchoutSession, ApprovalStep, InsertApprovalStep,
  GoodsReceipt, InsertGoodsReceipt, GoodsReceiptLine, InsertGoodsReceiptLine,
  BudgetCommitment, InsertBudgetCommitment, BudgetPeriod, InsertBudgetPeriod,
  CostCenterWithPeriod, ApprovalDelegation, InsertApprovalDelegation,
  Attachment, InsertAttachment,
} from '@shared/schema';
import { and } from "drizzle-orm";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { eq, desc } from "drizzle-orm";
import { hashPassword } from "./password";

const sqlite = new Database(process.env.DATABASE_PATH || "data.db");
sqlite.pragma("journal_mode = WAL");

export const db = drizzle(sqlite);

// Applies migrations/*.sql (generated via `npm run db:generate`), tracked in the
// __drizzle_migrations table — replaces the old CREATE TABLE IF NOT EXISTS bootstrap so
// schema changes are versioned and reviewable instead of applied ad hoc.
migrate(db, { migrationsFolder: "./migrations" });

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
  deleteCostCenter(id: number): Promise<void>;

  // Budget periods (Geschäftsjahre)
  listCostCentersWithActivePeriod(): Promise<CostCenterWithPeriod[]>;
  listBudgetPeriods(costCenterId: number): Promise<BudgetPeriod[]>;
  getActivePeriod(costCenterId: number): Promise<BudgetPeriod | undefined>;
  getBudgetPeriod(id: number): Promise<BudgetPeriod | undefined>;
  createBudgetPeriod(p: InsertBudgetPeriod): Promise<BudgetPeriod>;
  updatePeriodSpent(id: number, delta: number): Promise<void>;
  updatePeriodCommitted(id: number, delta: number): Promise<void>;
  // Closes the cost center's active period and opens a new one for the next fiscal year,
  // carrying over any still-open (reserved) commitments so in-flight requests aren't dropped.
  rolloverCostCenterPeriod(costCenterId: number, newBudget: number): Promise<BudgetPeriod>;

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

  // Approval steps
  listApprovalSteps(requestId: number): Promise<ApprovalStep[]>;
  createApprovalStep(s: InsertApprovalStep): Promise<ApprovalStep>;
  updateApprovalStep(id: number, s: Partial<InsertApprovalStep>): Promise<ApprovalStep | undefined>;

  // Approval delegations (Freigabe-Vertretung)
  getApprovalDelegationByDelegator(delegatorId: number): Promise<ApprovalDelegation | undefined>;
  listApprovalDelegationsByDelegate(delegateId: number): Promise<ApprovalDelegation[]>;
  upsertApprovalDelegation(d: InsertApprovalDelegation): Promise<ApprovalDelegation>;
  deleteApprovalDelegationByDelegator(delegatorId: number): Promise<void>;

  // Budget commitments (Obligo)
  createBudgetCommitment(c: InsertBudgetCommitment): Promise<BudgetCommitment>;
  getReservedCommitmentByRequest(requestId: number): Promise<BudgetCommitment | undefined>;
  updateBudgetCommitment(id: number, c: Partial<InsertBudgetCommitment>): Promise<BudgetCommitment | undefined>;

  // Goods receipts
  createGoodsReceipt(r: InsertGoodsReceipt): Promise<GoodsReceipt>;
  createGoodsReceiptLine(l: InsertGoodsReceiptLine): Promise<GoodsReceiptLine>;
  listGoodsReceiptsByOrder(orderId: number): Promise<GoodsReceipt[]>;
  listReceiptLines(receiptId: number): Promise<GoodsReceiptLine[]>;
  // Total received quantity per requestLineItemId across all receipts for an order.
  receivedQuantitiesByOrder(orderId: number): Promise<Map<number, number>>;

  // Activity log
  listActivity(entityType: string, entityId: number): Promise<ActivityLog[]>;
  createActivity(a: InsertActivityLog): Promise<ActivityLog>;

  // Attachments (Datei-Anhänge)
  createAttachment(a: InsertAttachment): Promise<Attachment>;
  listAttachments(entityType: string, entityId: number): Promise<Attachment[]>;
  getAttachment(id: number): Promise<Attachment | undefined>;
  deleteAttachment(id: number): Promise<void>;

  // Amazon Business punch-out sessions
  createPunchoutSession(p: InsertPunchoutSession): Promise<PunchoutSession>;
  getPunchoutSession(id: number): Promise<PunchoutSession | undefined>;
  updatePunchoutSession(id: number, p: Partial<InsertPunchoutSession>): Promise<PunchoutSession | undefined>;
}

export class DatabaseStorage implements IStorage {
  async getUser(id: number) { return db.select().from(users).where(eq(users.id, id)).get(); }
  async getUserByEmail(email: string) { return db.select().from(users).where(eq(users.email, email)).get(); }
  async listUsers() { return db.select().from(users).all(); }
  async createUser(u: InsertUser) {
    return db.insert(users).values({ ...u, password: await hashPassword(u.password) }).returning().get();
  }

  async listCostCenters() { return db.select().from(costCenters).all(); }
  async getCostCenter(id: number) { return db.select().from(costCenters).where(eq(costCenters.id, id)).get(); }
  async createCostCenter(cc: InsertCostCenter) { return db.insert(costCenters).values(cc).returning().get(); }
  async deleteCostCenter(id: number) { db.delete(costCenters).where(eq(costCenters.id, id)).run(); }

  async listCostCentersWithActivePeriod(): Promise<CostCenterWithPeriod[]> {
    const centers = await this.listCostCenters();
    const withPeriod = await Promise.all(centers.map(async (c) => {
      const period = await this.getActivePeriod(c.id);
      if (!period) return null;
      return {
        ...c,
        periodId: period.id, fiscalYear: period.fiscalYear,
        annualBudget: period.budget, spent: period.spent, committed: period.committed,
        periodStartsAt: period.startsAt, periodEndsAt: period.endsAt,
      };
    }));
    return withPeriod.filter((c): c is CostCenterWithPeriod => c !== null);
  }
  async listBudgetPeriods(costCenterId: number) {
    return db.select().from(budgetPeriods)
      .where(eq(budgetPeriods.costCenterId, costCenterId))
      .orderBy(desc(budgetPeriods.fiscalYear))
      .all();
  }
  async getActivePeriod(costCenterId: number) {
    return db.select().from(budgetPeriods)
      .where(and(eq(budgetPeriods.costCenterId, costCenterId), eq(budgetPeriods.status, "active")))
      .get();
  }
  async getBudgetPeriod(id: number) { return db.select().from(budgetPeriods).where(eq(budgetPeriods.id, id)).get(); }
  async createBudgetPeriod(p: InsertBudgetPeriod) { return db.insert(budgetPeriods).values(p).returning().get(); }
  async updatePeriodSpent(id: number, delta: number) {
    const p = await this.getBudgetPeriod(id);
    if (!p) return;
    db.update(budgetPeriods).set({ spent: p.spent + delta }).where(eq(budgetPeriods.id, id)).run();
  }
  async updatePeriodCommitted(id: number, delta: number) {
    const p = await this.getBudgetPeriod(id);
    if (!p) return;
    db.update(budgetPeriods).set({ committed: Math.max(0, p.committed + delta) }).where(eq(budgetPeriods.id, id)).run();
  }
  async rolloverCostCenterPeriod(costCenterId: number, newBudget: number) {
    const old = await this.getActivePeriod(costCenterId);
    if (!old) throw new Error("Keine aktive Budgetperiode für diese Kostenstelle vorhanden.");

    const openCommitments = await db.select().from(budgetCommitments)
      .where(and(eq(budgetCommitments.periodId, old.id), eq(budgetCommitments.status, "reserved")))
      .all();
    const carriedCommitted = openCommitments.reduce((sum, c) => sum + c.amount, 0);

    const now = new Date().toISOString();
    const next = await this.createBudgetPeriod({
      costCenterId, fiscalYear: old.fiscalYear + 1, budget: newBudget,
      spent: 0, committed: carriedCommitted,
      startsAt: `${old.fiscalYear + 1}-01-01T00:00:00.000Z`,
      endsAt: `${old.fiscalYear + 2}-01-01T00:00:00.000Z`,
      status: "active", createdAt: now,
    });

    db.update(budgetCommitments)
      .set({ periodId: next.id })
      .where(and(eq(budgetCommitments.periodId, old.id), eq(budgetCommitments.status, "reserved")))
      .run();

    db.update(budgetPeriods).set({ status: "closed", committed: 0 }).where(eq(budgetPeriods.id, old.id)).run();

    return next;
  }

  async createBudgetCommitment(c: InsertBudgetCommitment) { return db.insert(budgetCommitments).values(c).returning().get(); }
  async getReservedCommitmentByRequest(requestId: number) {
    return db.select().from(budgetCommitments)
      .where(and(eq(budgetCommitments.requestId, requestId), eq(budgetCommitments.status, "reserved")))
      .get();
  }
  async updateBudgetCommitment(id: number, c: Partial<InsertBudgetCommitment>) {
    return db.update(budgetCommitments).set(c).where(eq(budgetCommitments.id, id)).returning().get();
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

  async listApprovalSteps(requestId: number) {
    return db.select().from(approvalSteps)
      .where(eq(approvalSteps.requestId, requestId))
      .orderBy(approvalSteps.stepOrder)
      .all();
  }
  async createApprovalStep(s: InsertApprovalStep) { return db.insert(approvalSteps).values(s).returning().get(); }
  async updateApprovalStep(id: number, s: Partial<InsertApprovalStep>) {
    return db.update(approvalSteps).set(s).where(eq(approvalSteps.id, id)).returning().get();
  }

  async getApprovalDelegationByDelegator(delegatorId: number) {
    return db.select().from(approvalDelegations).where(eq(approvalDelegations.delegatorId, delegatorId)).get();
  }
  async listApprovalDelegationsByDelegate(delegateId: number) {
    return db.select().from(approvalDelegations).where(eq(approvalDelegations.delegateId, delegateId)).all();
  }
  // "Set" semantics: a delegator has at most one active delegation, so setting a new one
  // replaces whatever was there (matches the unique index on delegatorId).
  async upsertApprovalDelegation(d: InsertApprovalDelegation) {
    db.delete(approvalDelegations).where(eq(approvalDelegations.delegatorId, d.delegatorId)).run();
    return db.insert(approvalDelegations).values(d).returning().get();
  }
  async deleteApprovalDelegationByDelegator(delegatorId: number) {
    db.delete(approvalDelegations).where(eq(approvalDelegations.delegatorId, delegatorId)).run();
  }

  async createGoodsReceipt(r: InsertGoodsReceipt) { return db.insert(goodsReceipts).values(r).returning().get(); }
  async createGoodsReceiptLine(l: InsertGoodsReceiptLine) { return db.insert(goodsReceiptLines).values(l).returning().get(); }
  async listGoodsReceiptsByOrder(orderId: number) {
    return db.select().from(goodsReceipts).where(eq(goodsReceipts.orderId, orderId)).all();
  }
  async listReceiptLines(receiptId: number) {
    return db.select().from(goodsReceiptLines).where(eq(goodsReceiptLines.receiptId, receiptId)).all();
  }
  async receivedQuantitiesByOrder(orderId: number) {
    const receipts = await this.listGoodsReceiptsByOrder(orderId);
    const totals = new Map<number, number>();
    for (const receipt of receipts) {
      const lines = await this.listReceiptLines(receipt.id);
      for (const line of lines) {
        totals.set(line.requestLineItemId, (totals.get(line.requestLineItemId) ?? 0) + line.quantityReceived);
      }
    }
    return totals;
  }

  async listActivity(entityType: string, entityId: number) {
    return db.select().from(activityLog)
      .where(eq(activityLog.entityType, entityType))
      .all()
      .filter(a => a.entityId === entityId);
  }
  async createActivity(a: InsertActivityLog) { return db.insert(activityLog).values(a).returning().get(); }

  async createAttachment(a: InsertAttachment) { return db.insert(attachments).values(a).returning().get(); }
  async listAttachments(entityType: string, entityId: number) {
    return db.select().from(attachments)
      .where(and(eq(attachments.entityType, entityType), eq(attachments.entityId, entityId)))
      .all();
  }
  async getAttachment(id: number) { return db.select().from(attachments).where(eq(attachments.id, id)).get(); }
  async deleteAttachment(id: number) { db.delete(attachments).where(eq(attachments.id, id)).run(); }

  async createPunchoutSession(p: InsertPunchoutSession) { return db.insert(punchoutSessions).values(p).returning().get(); }
  async getPunchoutSession(id: number) { return db.select().from(punchoutSessions).where(eq(punchoutSessions.id, id)).get(); }
  async updatePunchoutSession(id: number, p: Partial<InsertPunchoutSession>) {
    return db.update(punchoutSessions).set(p).where(eq(punchoutSessions.id, id)).returning().get();
  }
}

export const storage = new DatabaseStorage();
