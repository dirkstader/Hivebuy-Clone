import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { seedIfEmpty } from "./seed";
import { AMAZON_CATALOG } from "./amazon-catalog";
import { verifyPassword } from "./password";
import { createSession, destroySession, requireAuth, requireRole, sanitizeUser } from "./auth";
import {
  insertUserSchema, insertCostCenterSchema, insertSupplierSchema, insertCatalogItemSchema,
  insertPurchaseRequestSchema, insertRequestLineItemSchema, insertPurchaseOrderSchema, insertInvoiceSchema,
  insertPunchoutSessionSchema,
} from "@shared/schema";

const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });

// Brute-force guard: 10 attempts per IP per 15 minutes, regardless of outcome.
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { message: "Zu viele Anmeldeversuche. Bitte in ein paar Minuten erneut versuchen." },
});

// purchasing capabilities are a subset of "finance", mirroring the client-side gates in
// suppliers.tsx / invoices.tsx. Approver capability is handled per-step via canActOnStep.
const PURCHASING_ROLES = ["purchasing", "finance"] as const;

// Requests above this net amount require a second (finance) sign-off on top of the
// regular approver step. Below it, a single approver step is enough.
const FINANCE_APPROVAL_THRESHOLD = 5000;

// The ordered approval chain for a request of a given amount. Each entry names the role
// required to satisfy that step; steps are resolved in order (see the decision endpoint).
function buildApprovalChain(totalAmount: number): { stepOrder: number; approverRole: string }[] {
  const chain = [{ stepOrder: 1, approverRole: "approver" }];
  if (totalAmount > FINANCE_APPROVAL_THRESHOLD) {
    chain.push({ stepOrder: 2, approverRole: "finance" });
  }
  return chain;
}

// finance covers both step kinds; approver covers only approver steps.
function canActOnStep(userRole: string, stepRole: string): boolean {
  if (userRole === "finance") return true;
  return userRole === "approver" && stepRole === "approver";
}

function genNumber(prefix: string) {
  const year = new Date().getFullYear();
  const seq = Math.floor(1000 + Math.random() * 9000);
  return `${prefix}-${year}-${seq}`;
}

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {
  await seedIfEmpty();

  // ---------- Auth ----------
  // Bearer tokens kept in-memory server-side (see server/auth.ts) — no cookies, matching the
  // client's in-memory-only auth state. Login and the user list must stay public: the login
  // page needs the user list before any token exists.
  app.post("/api/auth/login", loginLimiter, async (req, res) => {
    const parsed = loginSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: "E-Mail oder Passwort ist falsch." });
    const user = await storage.getUserByEmail(parsed.data.email.toLowerCase());
    if (!user || !(await verifyPassword(parsed.data.password, user.password))) {
      return res.status(401).json({ message: "E-Mail oder Passwort ist falsch." });
    }
    const token = createSession(user.id);
    res.json({ user: sanitizeUser(user), token });
  });

  app.post("/api/auth/logout", requireAuth, async (req, res) => {
    const header = req.headers.authorization ?? "";
    destroySession(header.slice("Bearer ".length));
    res.status(204).end();
  });

  app.get("/api/auth/me", requireAuth, async (req, res) => {
    res.json(sanitizeUser(req.user!));
  });

  app.get("/api/users", async (_req, res) => {
    res.json((await storage.listUsers()).map(sanitizeUser));
  });

  app.post("/api/users", requireAuth, requireRole("finance"), async (req, res) => {
    const parsed = insertUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const user = await storage.createUser(parsed.data);
    res.status(201).json(sanitizeUser(user));
  });

  // ---------- Everything below requires a valid session ----------
  app.use("/api", requireAuth);

  // ---------- Cost centers ----------
  app.get("/api/cost-centers", async (_req, res) => {
    res.json(await storage.listCostCenters());
  });

  app.post("/api/cost-centers", requireRole("finance"), async (req, res) => {
    const parsed = insertCostCenterSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.status(201).json(await storage.createCostCenter(parsed.data));
  });

  // ---------- Suppliers ----------
  app.get("/api/suppliers", async (_req, res) => {
    res.json(await storage.listSuppliers());
  });

  app.get("/api/suppliers/:id", async (req, res) => {
    const supplier = await storage.getSupplier(Number(req.params.id));
    if (!supplier) return res.status(404).json({ message: "Lieferant nicht gefunden." });
    const items = await storage.listCatalogItemsBySupplier(supplier.id);
    res.json({ ...supplier, catalogItems: items });
  });

  app.post("/api/suppliers", requireRole(...PURCHASING_ROLES), async (req, res) => {
    const parsed = insertSupplierSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.status(201).json(await storage.createSupplier(parsed.data));
  });

  app.patch("/api/suppliers/:id", requireRole(...PURCHASING_ROLES), async (req, res) => {
    const parsed = insertSupplierSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const updated = await storage.updateSupplier(Number(req.params.id), parsed.data);
    if (!updated) return res.status(404).json({ message: "Lieferant nicht gefunden." });
    res.json(updated);
  });

  app.delete("/api/suppliers/:id", requireRole(...PURCHASING_ROLES), async (req, res) => {
    await storage.deleteSupplier(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Catalog items ----------
  app.get("/api/catalog-items", async (_req, res) => {
    res.json(await storage.listCatalogItems());
  });

  app.post("/api/catalog-items", requireRole(...PURCHASING_ROLES), async (req, res) => {
    const parsed = insertCatalogItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.status(201).json(await storage.createCatalogItem(parsed.data));
  });

  app.delete("/api/catalog-items/:id", requireRole(...PURCHASING_ROLES), async (req, res) => {
    await storage.deleteCatalogItem(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Purchase requests ----------
  app.get("/api/purchase-requests", async (_req, res) => {
    const requests = await storage.listPurchaseRequests();
    const withLines = await Promise.all(
      requests.map(async (r) => ({ ...r, lineItems: await storage.listLineItems(r.id) }))
    );
    res.json(withLines);
  });

  app.get("/api/purchase-requests/:id", async (req, res) => {
    const request = await storage.getPurchaseRequest(Number(req.params.id));
    if (!request) return res.status(404).json({ message: "Bestellanforderung nicht gefunden." });
    const lineItems = await storage.listLineItems(request.id);
    const activity = await storage.listActivity("request", request.id);
    const approvalSteps = await storage.listApprovalSteps(request.id);
    res.json({ ...request, lineItems, activity, approvalSteps });
  });

  app.post("/api/purchase-requests", async (req, res) => {
    const { lineItems, ...body } = req.body ?? {};
    const parsed = insertPurchaseRequestSchema.safeParse({
      ...body,
      requesterId: req.user!.id, // never trust a client-supplied requester
      requestNumber: body.requestNumber || genNumber("BA"),
      createdAt: new Date().toISOString(),
      status: body.status || "draft",
    });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const totalAmount = Array.isArray(lineItems)
      ? lineItems.reduce((sum: number, li: any) => sum + Number(li.quantity) * Number(li.unitPrice), 0)
      : parsed.data.totalAmount;

    const request = await storage.createPurchaseRequest({ ...parsed.data, totalAmount });

    if (Array.isArray(lineItems)) {
      for (const li of lineItems) {
        const liParsed = insertRequestLineItemSchema.safeParse({ ...li, requestId: request.id });
        if (liParsed.success) await storage.createLineItem(liParsed.data);
      }
    }
    // Created directly as pending_approval (submit without saving a draft first) → build the
    // approval chain immediately, same as the draft->submit path in PATCH.
    if (request.status === "pending_approval") {
      for (const step of buildApprovalChain(request.totalAmount)) {
        await storage.createApprovalStep({
          requestId: request.id, stepOrder: step.stepOrder, approverRole: step.approverRole,
          status: "pending", comment: "", decidedById: null, decidedAt: null,
        });
      }
    }
    await storage.createActivity({
      entityType: "request", entityId: request.id, actorId: request.requesterId,
      action: request.status === "pending_approval" ? "submitted" : "created",
      note: "", createdAt: new Date().toISOString(),
    });
    res.status(201).json(request);
  });

  app.patch("/api/purchase-requests/:id", async (req, res) => {
    const id = Number(req.params.id);
    const { lineItems, activityNote, ...body } = req.body ?? {};
    const parsed = insertPurchaseRequestSchema.partial().safeParse(body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const existing = await storage.getPurchaseRequest(id);
    if (!existing) return res.status(404).json({ message: "Bestellanforderung nicht gefunden." });

    const actor = req.user!;
    const isOwner = existing.requesterId === actor.id;
    const isPurchasing = (PURCHASING_ROLES as readonly string[]).includes(actor.role);
    const nextStatus = parsed.data.status;

    // Approve/reject are NOT handled here — they run through POST /:id/decision so the
    // multi-step chain can be resolved. This PATCH only covers submit and the purchasing-side
    // transitions, plus draft edits (line items / fields by the owner).
    if (nextStatus && nextStatus !== existing.status) {
      const allowed =
        (nextStatus === "pending_approval" && existing.status === "draft" && isOwner) ||
        (nextStatus === "ordered" && existing.status === "approved" && isPurchasing) ||
        (nextStatus === "received" && existing.status === "ordered" && isPurchasing);
      if (!allowed) {
        return res.status(403).json({ message: "Für diesen Statuswechsel fehlt die Berechtigung." });
      }
    } else if (!isOwner && !isPurchasing) {
      return res.status(403).json({ message: "Für diese Änderung fehlt die Berechtigung." });
    }

    const updated = await storage.updatePurchaseRequest(id, parsed.data);

    if (Array.isArray(lineItems)) {
      await storage.deleteLineItemsForRequest(id);
      for (const li of lineItems) {
        const liParsed = insertRequestLineItemSchema.safeParse({ ...li, requestId: id });
        if (liParsed.success) await storage.createLineItem(liParsed.data);
      }
    }

    if (nextStatus && nextStatus !== existing.status) {
      // On submit, build the approval chain (length depends on the amount).
      if (nextStatus === "pending_approval" && updated) {
        for (const step of buildApprovalChain(updated.totalAmount)) {
          await storage.createApprovalStep({
            requestId: id, stepOrder: step.stepOrder, approverRole: step.approverRole,
            status: "pending", comment: "", decidedById: null, decidedAt: null,
          });
        }
      }

      await storage.createActivity({
        entityType: "request", entityId: id, actorId: actor.id,
        action: nextStatus === "pending_approval" ? "submitted" : nextStatus,
        note: activityNote ?? "", createdAt: new Date().toISOString(),
      });

      // On "ordered", auto-create a purchase order.
      if (nextStatus === "ordered" && updated && updated.supplierId) {
        await storage.createPurchaseOrder({
          orderNumber: genNumber("PO"),
          requestId: updated.id,
          supplierId: updated.supplierId,
          status: "open",
          totalAmount: updated.totalAmount,
          orderedAt: new Date().toISOString(),
          expectedDelivery: null,
        });
      }
    }

    res.json(updated);
  });

  // Resolve one step of a request's approval chain. The acting user decides the current
  // (lowest-order still-pending) step; the request is finalized only once the last step
  // is approved, or immediately rejected if any step is rejected.
  app.post("/api/purchase-requests/:id/decision", async (req, res) => {
    const id = Number(req.params.id);
    const decision = req.body?.decision;
    const comment = typeof req.body?.comment === "string" ? req.body.comment : "";
    if (decision !== "approved" && decision !== "rejected") {
      return res.status(400).json({ message: "Ungültige Entscheidung." });
    }

    const request = await storage.getPurchaseRequest(id);
    if (!request) return res.status(404).json({ message: "Bestellanforderung nicht gefunden." });
    if (request.status !== "pending_approval") {
      return res.status(409).json({ message: "Diese Anforderung wartet nicht auf eine Freigabe." });
    }

    const actor = req.user!;
    // Segregation of duties: you cannot decide on your own request.
    if (request.requesterId === actor.id) {
      return res.status(403).json({ message: "Die eigene Anforderung kann nicht selbst freigegeben werden." });
    }

    const steps = await storage.listApprovalSteps(id);
    const currentStep = steps.find((s) => s.status === "pending");
    if (!currentStep) {
      return res.status(409).json({ message: "Keine offene Freigabestufe vorhanden." });
    }
    if (!canActOnStep(actor.role, currentStep.approverRole)) {
      return res.status(403).json({ message: "Für diese Freigabestufe fehlt die Berechtigung." });
    }

    const now = new Date().toISOString();
    await storage.updateApprovalStep(currentStep.id, {
      status: decision, decidedById: actor.id, comment, decidedAt: now,
    });

    const remaining = steps.filter((s) => s.status === "pending" && s.id !== currentStep.id);
    let updated;
    if (decision === "rejected") {
      updated = await storage.updatePurchaseRequest(id, {
        status: "rejected", approverId: actor.id, approverComment: comment, decidedAt: now,
      });
    } else if (remaining.length === 0) {
      // Last step approved → request is fully approved.
      updated = await storage.updatePurchaseRequest(id, {
        status: "approved", approverId: actor.id, approverComment: comment, decidedAt: now,
      });
      if (updated) await storage.updateCostCenterSpent(updated.costCenterId, updated.totalAmount);
    } else {
      // More steps remain — record the interim approval but keep the request pending.
      updated = await storage.updatePurchaseRequest(id, { approverComment: comment });
    }

    await storage.createActivity({
      entityType: "request", entityId: id, actorId: actor.id,
      action: decision === "rejected" ? "rejected" : remaining.length === 0 ? "approved" : "step_approved",
      note: comment, createdAt: now,
    });

    const approvalSteps = await storage.listApprovalSteps(id);
    res.json({ ...updated, approvalSteps });
  });

  // ---------- Purchase orders ----------
  app.get("/api/purchase-orders", async (_req, res) => {
    res.json(await storage.listPurchaseOrders());
  });

  app.get("/api/purchase-orders/:id", async (req, res) => {
    const order = await storage.getPurchaseOrder(Number(req.params.id));
    if (!order) return res.status(404).json({ message: "Bestellung nicht gefunden." });
    res.json(order);
  });

  app.post("/api/purchase-orders", requireRole(...PURCHASING_ROLES), async (req, res) => {
    const parsed = insertPurchaseOrderSchema.safeParse({
      ...req.body,
      orderNumber: req.body?.orderNumber || genNumber("PO"),
      orderedAt: req.body?.orderedAt || new Date().toISOString(),
    });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.status(201).json(await storage.createPurchaseOrder(parsed.data));
  });

  app.patch("/api/purchase-orders/:id", requireRole(...PURCHASING_ROLES), async (req, res) => {
    const parsed = insertPurchaseOrderSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const updated = await storage.updatePurchaseOrder(Number(req.params.id), parsed.data);
    if (!updated) return res.status(404).json({ message: "Bestellung nicht gefunden." });
    res.json(updated);
  });

  // ---------- Invoices (3-way match) ----------
  app.get("/api/invoices", async (_req, res) => {
    res.json(await storage.listInvoices());
  });

  app.get("/api/invoices/:id", async (req, res) => {
    const invoice = await storage.getInvoice(Number(req.params.id));
    if (!invoice) return res.status(404).json({ message: "Rechnung nicht gefunden." });
    res.json(invoice);
  });

  app.post("/api/invoices", requireRole(...PURCHASING_ROLES), async (req, res) => {
    const parsed = insertInvoiceSchema.safeParse({
      ...req.body,
      receivedAt: req.body?.receivedAt || new Date().toISOString(),
    });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    // Simple 3-way match: compare invoice amount to the linked order's total.
    const order = await storage.getPurchaseOrder(parsed.data.orderId);
    let status = parsed.data.status;
    let matchNote = parsed.data.matchNote;
    if (order) {
      const diff = Math.abs(order.totalAmount - parsed.data.amount);
      if (diff < 0.01) {
        status = "matched";
        matchNote = "Bestellung und Rechnung stimmen exakt überein.";
      } else {
        status = "discrepancy";
        matchNote = `Abweichung von ${diff.toFixed(2)} € zwischen Bestellwert (${order.totalAmount.toFixed(2)} €) und Rechnungsbetrag (${parsed.data.amount.toFixed(2)} €).`;
      }
    }

    const invoice = await storage.createInvoice({ ...parsed.data, status, matchNote });
    res.status(201).json(invoice);
  });

  app.patch("/api/invoices/:id", requireRole(...PURCHASING_ROLES), async (req, res) => {
    const parsed = insertInvoiceSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const updated = await storage.updateInvoice(Number(req.params.id), parsed.data);
    if (!updated) return res.status(404).json({ message: "Rechnung nicht gefunden." });
    res.json(updated);
  });

  // ---------- Amazon Business Punch-Out (simulated cXML/OCI) ----------
  // Real flow: POST here would instead send a cXML PunchOutSetupRequest to
  // Amazon Business and return their StartPage URL. We simulate the round-trip
  // by handing back our own in-app catalog "session" immediately.
  app.post("/api/punchout/sessions", async (req, res) => {
    const parsed = insertPunchoutSessionSchema.safeParse({
      requestId: req.body?.requestId ?? null,
      userId: req.user!.id,
      status: "pending",
      cartJson: "[]",
      createdAt: new Date().toISOString(),
    });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const session = await storage.createPunchoutSession(parsed.data);
    res.status(201).json({ session, catalog: AMAZON_CATALOG });
  });

  app.get("/api/punchout/catalog", async (_req, res) => {
    res.json(AMAZON_CATALOG);
  });

  // Simulated PunchOutOrderMessage callback: user submits their Amazon cart,
  // we store it against the session so the frontend can pull it into the
  // purchase request draft as line items.
  app.post("/api/punchout/sessions/:id/return", async (req, res) => {
    const cart = Array.isArray(req.body?.cart) ? req.body.cart : [];
    const updated = await storage.updatePunchoutSession(Number(req.params.id), {
      status: "returned",
      cartJson: JSON.stringify(cart),
      returnedAt: new Date().toISOString(),
    });
    if (!updated) return res.status(404).json({ message: "Punch-Out-Sitzung nicht gefunden." });
    res.json(updated);
  });

  app.get("/api/punchout/sessions/:id", async (req, res) => {
    const session = await storage.getPunchoutSession(Number(req.params.id));
    if (!session) return res.status(404).json({ message: "Punch-Out-Sitzung nicht gefunden." });
    res.json(session);
  });

  // ---------- Dashboard summary ----------
  app.get("/api/dashboard/summary", async (_req, res) => {
    const [requests, orders, invoices, costCenters, suppliers] = await Promise.all([
      storage.listPurchaseRequests(),
      storage.listPurchaseOrders(),
      storage.listInvoices(),
      storage.listCostCenters(),
      storage.listSuppliers(),
    ]);

    res.json({
      pendingApprovals: requests.filter(r => r.status === "pending_approval").length,
      openOrders: orders.filter(o => o.status === "open" || o.status === "partially_received").length,
      discrepancyInvoices: invoices.filter(i => i.status === "discrepancy").length,
      totalSpent: costCenters.reduce((s, c) => s + c.spent, 0),
      totalBudget: costCenters.reduce((s, c) => s + c.annualBudget, 0),
      activeSuppliers: suppliers.filter(s => s.status === "active").length,
      requestsByStatus: requests.reduce((acc: Record<string, number>, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      }, {}),
      recentRequests: requests.slice(0, 6),
    });
  });

  return httpServer;
}
