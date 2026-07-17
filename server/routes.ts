import type { Express, Request, Response, NextFunction } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import fs from "node:fs";
import { z } from "zod";
import rateLimit from "express-rate-limit";
import { storage } from "./storage";
import { seedIfEmpty } from "./seed";
import { AMAZON_CATALOG } from "./amazon-catalog";
import { verifyPassword } from "./password";
import { createSession, destroySession, requireAuth, requireRole, sanitizeUser } from "./auth";
import { upload, attachmentPath } from "./uploads";
import type { User } from "@shared/schema";
import {
  insertUserSchema, createCostCenterRequestSchema, insertSupplierSchema, insertCatalogItemSchema,
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

function isPurchasingRole(role: string): boolean {
  return (PURCHASING_ROLES as readonly string[]).includes(role);
}

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

// Roles eligible to be NAMED as a Freigabe-Vertretung (delegate) — the delegate borrows the
// delegator's approval authority, so this is "who can receive borrowed authority".
// Hardcoded for now — a future flag could open this up to any role.
const DELEGATE_ELIGIBLE_ROLES = ["approver", "finance", "purchasing"] as const;

// Roles eligible to BE a delegator (i.e. to call PUT /api/delegations/me for themselves).
// Deliberately narrower than DELEGATE_ELIGIBLE_ROLES: canActOnStep never grants "purchasing"
// any step authority to begin with, so a purchasing user delegating would hand off authority
// they don't have — silently inert, not a real Vertretung. Only approver/finance have
// step-decision authority worth delegating.
const DELEGATOR_ELIGIBLE_ROLES = ["approver", "finance"] as const;

// endsAt may be a bare "YYYY-MM-DD" (the client's <input type="date">) or a full ISO
// timestamp (e.g. from seed data) — normalize a bare date to end-of-day before comparing
// against a full timestamp, otherwise a delegation "ending today" reads as already expired
// at midnight instead of through the end of that day.
function endOfDayIfDateOnly(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? `${value}T23:59:59.999Z` : value;
}

function delegationIsActive(d: { startsAt: string | null; endsAt: string | null }, nowIso: string): boolean {
  if (d.startsAt && d.startsAt > nowIso) return false;
  if (d.endsAt && endOfDayIfDateOnly(d.endsAt) < nowIso) return false;
  return true;
}

// Resolves whose approval authority the actor may exercise for a step of the given role:
// their own id if their role covers it directly, or — if they are the currently-active
// delegate for someone whose role covers it — that delegator's id. Shared by the decision
// endpoint and /api/notifications so both stay in lockstep.
async function resolveActingAuthority(actor: { id: number; role: string }, stepRole: string): Promise<number | undefined> {
  if (canActOnStep(actor.role, stepRole)) return actor.id;
  const now = new Date().toISOString();
  for (const d of await storage.listApprovalDelegationsByDelegate(actor.id)) {
    if (!delegationIsActive(d, now)) continue;
    const delegator = await storage.getUser(d.delegatorId);
    if (delegator && canActOnStep(delegator.role, stepRole)) return delegator.id;
  }
  return undefined;
}

// Whether a decision on behalf of `requesterId` is blocked by segregation-of-duties: normally
// yes if the represented delegator IS the requester, except a purchasing ("Admin") delegate,
// who is trusted to self-approve on someone else's behalf too. Shared by the decision
// endpoint and /api/notifications so both stay in lockstep (previously duplicated inline).
function selfApprovalBlocked(actingForId: number, requesterId: number, actorRole: string): boolean {
  return actingForId === requesterId && actorRole !== "purchasing";
}

// The receipt state of a purchase order: its request's line items enriched with the
// quantity received so far, plus the derived ordered/received values and fully-received flag.
// A PO maps 1:1 to a request, so the request's line items are the PO's lines.
async function orderReceiptState(orderId: number, requestId: number) {
  const lineItems = await storage.listLineItems(requestId);
  const received = await storage.receivedQuantitiesByOrder(orderId);
  const lines = lineItems.map((li) => ({
    ...li,
    quantityReceived: received.get(li.id) ?? 0,
  }));
  const orderedValue = lines.reduce((sum, l) => sum + l.quantity * l.unitPrice, 0);
  const receivedValue = lines.reduce((sum, l) => sum + l.quantityReceived * l.unitPrice, 0);
  const anyReceived = lines.some((l) => l.quantityReceived > 0);
  const fullyReceived = lines.length > 0 && lines.every((l) => l.quantityReceived >= l.quantity);
  return { lines, orderedValue, receivedValue, anyReceived, fullyReceived };
}

function clamp01(n: number): number {
  return Math.max(0, Math.min(1, n));
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

  // Unauthenticated by design: powers the one-click demo-user switcher on the login page.
  // Gated behind DEMO_MODE so a real production deploy doesn't expose every user's email.
  app.get("/api/users", async (_req, res) => {
    if (process.env.DEMO_MODE !== "true") return res.status(404).end();
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

  // ---------- Cost centers & budget periods (Geschäftsjahre) ----------
  // Budget/spent/committed figures are restricted to approver/finance (see the "Kostenstellen"
  // nav gate in app-sidebar.tsx) — but every role needs the plain id/name/code list to
  // populate a cost-center picker when creating a request, so strip the budget fields for
  // everyone else instead of gating the whole endpoint.
  app.get("/api/cost-centers", async (req, res) => {
    const centers = await storage.listCostCentersWithActivePeriod();
    if (req.user!.role === "approver" || req.user!.role === "finance") {
      return res.json(centers);
    }
    res.json(centers.map(({ id, name, code, owner, city }) => ({ id, name, code, owner, city })));
  });

  app.post("/api/cost-centers", requireRole("finance"), async (req, res) => {
    const parsed = createCostCenterRequestSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const { annualBudget, ...ccData } = parsed.data;
    const cc = await storage.createCostCenter(ccData);
    const year = new Date().getFullYear();
    const now = new Date().toISOString();
    await storage.createBudgetPeriod({
      costCenterId: cc.id, fiscalYear: year, budget: annualBudget, spent: 0, committed: 0,
      startsAt: `${year}-01-01T00:00:00.000Z`, endsAt: `${year + 1}-01-01T00:00:00.000Z`,
      status: "active", createdAt: now,
    });

    const withPeriod = (await storage.listCostCentersWithActivePeriod()).find((c) => c.id === cc.id);
    res.status(201).json(withPeriod);
  });

  app.get("/api/cost-centers/:id/periods", async (req, res) => {
    res.json(await storage.listBudgetPeriods(Number(req.params.id)));
  });

  // Manually close out the cost center's fiscal year and open the next one. Still-open
  // (reserved) commitments carry over to the new period so in-flight requests whose invoice
  // arrives after year-end don't silently drop out of budget tracking.
  app.post("/api/cost-centers/:id/periods", requireRole("finance"), async (req, res) => {
    const id = Number(req.params.id);
    const cc = await storage.getCostCenter(id);
    if (!cc) return res.status(404).json({ message: "Kostenstelle nicht gefunden." });

    const parsed = z.object({ budget: z.number().nonnegative() }).safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const active = await storage.getActivePeriod(id);
    if (!active) return res.status(409).json({ message: "Keine aktive Budgetperiode für diese Kostenstelle vorhanden." });

    const next = await storage.rolloverCostCenterPeriod(id, parsed.data.budget);
    await storage.createActivity({
      entityType: "cost_center", entityId: id, actorId: req.user!.id,
      action: "rollover", note: `Geschäftsjahr ${next.fiscalYear} eröffnet.`, createdAt: new Date().toISOString(),
    });
    res.status(201).json(next);
  });

  // ---------- Suppliers ----------
  app.get("/api/suppliers", async (_req, res) => {
    res.json(await storage.listSuppliers());
  });

  // Computed on demand from existing goods-receipt/invoice data — no persistence, no new
  // schema, same "load once, reduce in JS" style as /api/analytics further below.
  // suppliers.rating (the static seeded number) stays as the fallback for suppliers with no
  // order/invoice history yet, exposed here as fallbackRating. Must be registered before
  // GET /api/suppliers/:id below — otherwise that param route would shadow "scorecards" as
  // an :id and this route would never be reached.
  app.get("/api/suppliers/scorecards", async (_req, res) => {
    const [suppliersList, orders, invoicesList] = await Promise.all([
      storage.listSuppliers(),
      storage.listPurchaseOrders(),
      storage.listInvoices(),
    ]);

    const ordersBySupplier = new Map<number, typeof orders>();
    for (const o of orders) {
      const list = ordersBySupplier.get(o.supplierId);
      if (list) list.push(o); else ordersBySupplier.set(o.supplierId, [o]);
    }
    const invoicesBySupplier = new Map<number, typeof invoicesList>();
    for (const inv of invoicesList) {
      const list = invoicesBySupplier.get(inv.supplierId);
      if (list) list.push(inv); else invoicesBySupplier.set(inv.supplierId, [inv]);
    }

    const scorecards = await Promise.all(suppliersList.map(async (s) => {
      const supplierOrders = ordersBySupplier.get(s.id) ?? [];
      let completeTotal = 0, completeHit = 0, onTimeTotal = 0, onTimeHit = 0;
      for (const o of supplierOrders) {
        const receipts = await storage.listGoodsReceiptsByOrder(o.id);
        if (receipts.length === 0) continue; // not yet due / no info
        completeTotal++;
        if (o.status === "received") {
          completeHit++;
          if (o.expectedDelivery) {
            onTimeTotal++;
            const lastReceivedAt = receipts.reduce((latest, r) => (r.receivedAt > latest ? r.receivedAt : latest), receipts[0].receivedAt);
            if (lastReceivedAt <= o.expectedDelivery) onTimeHit++;
          }
        }
      }

      const supplierInvoices = invoicesBySupplier.get(s.id) ?? [];
      const discrepancyTotal = supplierInvoices.length;
      const discrepancyHit = supplierInvoices.filter((i) => i.status === "discrepancy").length;

      const onTimeRate = onTimeTotal ? onTimeHit / onTimeTotal : null;
      const completeRate = completeTotal ? completeHit / completeTotal : null;
      const discrepancyRate = discrepancyTotal ? discrepancyHit / discrepancyTotal : null;

      const parts: { rate: number; weight: number }[] = [];
      if (onTimeRate != null) parts.push({ rate: onTimeRate, weight: 0.4 });
      if (completeRate != null) parts.push({ rate: completeRate, weight: 0.3 });
      if (discrepancyRate != null) parts.push({ rate: 1 - discrepancyRate, weight: 0.3 });

      const hasData = parts.length > 0;
      const weightSum = parts.reduce((sum, p) => sum + p.weight, 0);
      const score = hasData ? Math.round((100 * parts.reduce((sum, p) => sum + p.rate * p.weight, 0)) / weightSum) : null;

      return {
        supplierId: s.id, onTimeRate, completeRate, discrepancyRate, score, hasData,
        sampleOrders: completeTotal, sampleInvoices: discrepancyTotal, fallbackRating: s.rating,
      };
    }));

    res.json(scorecards);
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
    let lineItems: any[] = await storage.listLineItems(request.id);
    const activity = await storage.listActivity("request", request.id);
    const approvalSteps = await storage.listApprovalSteps(request.id);

    // Enrich line items with received quantities once a purchase order exists.
    const order = (await storage.listPurchaseOrders()).find((o) => o.requestId === request.id);
    if (order) {
      const received = await storage.receivedQuantitiesByOrder(order.id);
      lineItems = lineItems.map((li) => ({ ...li, quantityReceived: received.get(li.id) ?? 0 }));
    }

    res.json({ ...request, lineItems, activity, approvalSteps, orderId: order?.id ?? null, orderStatus: order?.status ?? null });
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

    // Validate line items BEFORE computing totalAmount — otherwise an invalid item (e.g. a
    // negative quantity) would be silently dropped from what's persisted while still having
    // contributed its (bogus) value to the stored total.
    const validLineItems = Array.isArray(lineItems)
      ? lineItems
          .map((li: any) => insertRequestLineItemSchema.safeParse({ ...li, requestId: 0 }))
          .filter((r: any) => r.success)
          .map((r: any) => r.data)
      : [];

    const totalAmount = Array.isArray(lineItems)
      ? validLineItems.reduce((sum: number, li: any) => sum + li.quantity * li.unitPrice, 0)
      : parsed.data.totalAmount;

    const request = await storage.createPurchaseRequest({ ...parsed.data, totalAmount });

    for (const li of validLineItems) {
      await storage.createLineItem({ ...li, requestId: request.id });
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
    const isPurchasing = isPurchasingRole(actor.role);
    const nextStatus = parsed.data.status;

    // Approve/reject run through POST /:id/decision (multi-step chain); goods receipt runs
    // through POST /api/purchase-orders/:id/receipts (which flips the request to "received").
    // This PATCH only covers submit and "ordered", plus draft edits by the owner. Editing any
    // field (title, totalAmount, lineItems, costCenterId, ...) without changing status is only
    // ever legitimate while the request is still a draft — once it has left "draft", the only
    // way to change it is through an explicit, validated status transition below, so a
    // decided/ordered/received request can't be silently rewritten (e.g. inflating totalAmount
    // post-approval to dodge the finance sign-off threshold).
    if (nextStatus && nextStatus !== existing.status) {
      const allowed =
        (nextStatus === "pending_approval" && existing.status === "draft" && isOwner) ||
        (nextStatus === "ordered" && existing.status === "approved" && isPurchasing);
      if (!allowed) {
        return res.status(403).json({ message: "Für diesen Statuswechsel fehlt die Berechtigung." });
      }
      // The "Bestellung auslösen" button is only client-disabled without a supplier — enforce
      // it here too, otherwise the request flips to "ordered" with no purchase order ever
      // created (auto-creation below is itself conditional on supplierId) and gets stuck.
      if (nextStatus === "ordered" && !existing.supplierId) {
        return res.status(400).json({ message: "Für die Bestellung muss zuerst ein Lieferant hinterlegt werden." });
      }
    } else if (existing.status !== "draft" || (!isOwner && !isPurchasing)) {
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

      // On "ordered", auto-create a purchase order. expectedDelivery defaults to 14 days out
      // (no UI lets purchasing set a real delivery date yet) — without SOME value here, the
      // supplier scorecard's on-time-delivery leg (GET /api/suppliers/scorecards) would never
      // have any data to compute from, for any order placed through the app.
      if (nextStatus === "ordered" && updated && updated.supplierId) {
        const orderedAt = new Date();
        await storage.createPurchaseOrder({
          orderNumber: genNumber("PO"),
          requestId: updated.id,
          supplierId: updated.supplierId,
          status: "open",
          totalAmount: updated.totalAmount,
          orderedAt: orderedAt.toISOString(),
          expectedDelivery: new Date(orderedAt.getTime() + 14 * 86400000).toISOString(),
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
    // Segregation of duties: you cannot decide on your own request. (A purchasing/"Admin"
    // delegate gets a narrower exemption further below, once we know who's really deciding.)
    if (request.requesterId === actor.id) {
      return res.status(403).json({ message: "Die eigene Anforderung kann nicht selbst freigegeben werden." });
    }

    const steps = await storage.listApprovalSteps(id);
    const currentStep = steps.find((s) => s.status === "pending");
    if (!currentStep) {
      return res.status(409).json({ message: "Keine offene Freigabestufe vorhanden." });
    }

    const actingForId = await resolveActingAuthority(actor, currentStep.approverRole);
    if (actingForId === undefined) {
      return res.status(403).json({ message: "Für diese Freigabestufe fehlt die Berechtigung." });
    }
    const isDelegating = actingForId !== actor.id;
    if (isDelegating && selfApprovalBlocked(actingForId, request.requesterId, actor.role)) {
      return res.status(403).json({ message: "Die eigene Anforderung kann nicht selbst freigegeben werden." });
    }

    const remaining = steps.filter((s) => s.status === "pending" && s.id !== currentStep.id);
    const isFinalApproval = decision === "approved" && remaining.length === 0;

    // If this decision would fully approve the request, confirm there's an active budget
    // period to reserve against BEFORE touching the approval step or request — otherwise the
    // step could end up persisted as "approved" with the request stuck unable to progress
    // (no pending step left to retry, but never marked approved either). Mirrors the hard 409
    // the rollover endpoint gives for the same precondition instead of silently skipping the
    // budget commitment.
    let period: Awaited<ReturnType<typeof storage.getActivePeriod>>;
    if (isFinalApproval) {
      period = await storage.getActivePeriod(request.costCenterId);
      if (!period) {
        return res.status(409).json({ message: "Die Kostenstelle hat keine aktive Budgetperiode — Freigabe nicht möglich." });
      }
    }

    const now = new Date().toISOString();
    await storage.updateApprovalStep(currentStep.id, {
      status: decision, decidedById: actor.id, decidedOnBehalfOfId: isDelegating ? actingForId : null,
      comment, decidedAt: now,
    });

    let updated;
    if (decision === "rejected") {
      updated = await storage.updatePurchaseRequest(id, {
        status: "rejected", approverId: actor.id, approverComment: comment, decidedAt: now,
      });
    } else if (isFinalApproval) {
      // Last step approved → request is fully approved. Reserve the budget as a commitment
      // (Obligo) rather than counting it as spent — actual spend is booked when invoiced.
      updated = await storage.updatePurchaseRequest(id, {
        status: "approved", approverId: actor.id, approverComment: comment, decidedAt: now,
      });
      if (updated && period) {
        await storage.createBudgetCommitment({
          costCenterId: updated.costCenterId, periodId: period.id, requestId: updated.id,
          amount: updated.totalAmount, status: "reserved", createdAt: now, resolvedAt: null,
        });
        await storage.updatePeriodCommitted(period.id, updated.totalAmount);
      }
    } else {
      // More steps remain — record the interim approval but keep the request pending.
      updated = await storage.updatePurchaseRequest(id, { approverComment: comment });
    }

    const onBehalfOf = isDelegating ? await storage.getUser(actingForId) : undefined;
    await storage.createActivity({
      entityType: "request", entityId: id, actorId: actor.id,
      action: decision === "rejected" ? "rejected" : isFinalApproval ? "approved" : "step_approved",
      note: [comment, onBehalfOf && `(Vertretung für ${onBehalfOf.name})`].filter(Boolean).join(" "),
      createdAt: now,
    });

    const approvalSteps = await storage.listApprovalSteps(id);
    res.json({ ...updated, approvalSteps });
  });

  // ---------- Purchase orders ----------
  // Operational, purchasing/finance-only data (see the "Bestellungen" nav gate in
  // app-sidebar.tsx) — every mutation on this resource already requires PURCHASING_ROLES,
  // the reads were the only unguarded gap.
  app.get("/api/purchase-orders", requireRole(...PURCHASING_ROLES), async (_req, res) => {
    res.json(await storage.listPurchaseOrders());
  });

  app.get("/api/purchase-orders/:id", requireRole(...PURCHASING_ROLES), async (req, res) => {
    const order = await storage.getPurchaseOrder(Number(req.params.id));
    if (!order) return res.status(404).json({ message: "Bestellung nicht gefunden." });
    const { lines, orderedValue, receivedValue, fullyReceived } = await orderReceiptState(order.id, order.requestId);
    const receipts = await storage.listGoodsReceiptsByOrder(order.id);
    res.json({ ...order, lines, receipts, orderedValue, receivedValue, fullyReceived });
  });

  // Book a goods receipt against a purchase order. Records received quantities per line,
  // recomputes the PO status (open / partially_received / received), and once every line is
  // fully received flips the linked request to "received".
  app.post("/api/purchase-orders/:id/receipts", requireRole(...PURCHASING_ROLES), async (req, res) => {
    const orderId = Number(req.params.id);
    const order = await storage.getPurchaseOrder(orderId);
    if (!order) return res.status(404).json({ message: "Bestellung nicht gefunden." });

    const inputLines = Array.isArray(req.body?.lines) ? req.body.lines : [];
    const note = typeof req.body?.note === "string" ? req.body.note : "";
    const valid = inputLines
      .map((l: any) => ({ requestLineItemId: Number(l.requestLineItemId), quantityReceived: Number(l.quantityReceived) }))
      .filter((l: any) => Number.isFinite(l.requestLineItemId) && Number.isFinite(l.quantityReceived) && l.quantityReceived > 0);
    if (valid.length === 0) {
      return res.status(400).json({ message: "Es wurde keine empfangene Menge angegeben." });
    }

    // Reject over-receipt: a line's cumulative received quantity may never exceed what was
    // ordered — otherwise receivedValue in the 3-way match (below) could be inflated past the
    // real order value and let an equally-inflated invoice pass as "matched".
    const orderedLines = await storage.listLineItems(order.requestId);
    const alreadyReceived = await storage.receivedQuantitiesByOrder(orderId);
    for (const line of valid) {
      const orderedLine = orderedLines.find((li) => li.id === line.requestLineItemId);
      if (!orderedLine) {
        return res.status(400).json({ message: "Unbekannte Bestellposition." });
      }
      const totalAfter = (alreadyReceived.get(line.requestLineItemId) ?? 0) + line.quantityReceived;
      if (totalAfter > orderedLine.quantity + 1e-9) {
        return res.status(400).json({
          message: `Menge für "${orderedLine.description}" übersteigt die bestellte Menge (${orderedLine.quantity}).`,
        });
      }
    }

    const now = new Date().toISOString();
    const receipt = await storage.createGoodsReceipt({
      orderId, receivedById: req.user!.id, note, receivedAt: now,
    });
    for (const line of valid) {
      await storage.createGoodsReceiptLine({
        receiptId: receipt.id, requestLineItemId: line.requestLineItemId, quantityReceived: line.quantityReceived,
      });
    }

    // Recompute PO + request status from the aggregate received quantities.
    const state = await orderReceiptState(orderId, order.requestId);
    const orderStatus = state.fullyReceived ? "received" : state.anyReceived ? "partially_received" : "open";
    await storage.updatePurchaseOrder(orderId, { status: orderStatus });

    await storage.createActivity({
      entityType: "order", entityId: orderId, actorId: req.user!.id,
      action: state.fullyReceived ? "received" : "partially_received", note, createdAt: now,
    });

    if (state.fullyReceived) {
      const request = await storage.getPurchaseRequest(order.requestId);
      if (request && request.status === "ordered") {
        await storage.updatePurchaseRequest(order.requestId, { status: "received" });
        await storage.createActivity({
          entityType: "request", entityId: order.requestId, actorId: req.user!.id,
          action: "received", note, createdAt: now,
        });
      }
    }

    const updatedOrder = await storage.getPurchaseOrder(orderId);
    res.status(201).json({ ...updatedOrder, lines: state.lines, fullyReceived: state.fullyReceived });
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
  // Operational, purchasing/finance-only data (see the "Rechnungsabgleich" nav gate in
  // app-sidebar.tsx) — every mutation on this resource already requires PURCHASING_ROLES,
  // the reads were the only unguarded gap.
  app.get("/api/invoices", requireRole(...PURCHASING_ROLES), async (_req, res) => {
    res.json(await storage.listInvoices());
  });

  app.get("/api/invoices/:id", requireRole(...PURCHASING_ROLES), async (req, res) => {
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

    // One order gets at most one invoice — the 3-way match and budget realization below both
    // assume a single invoice per order; a second invoice would silently fail to book its
    // amount as spend (the reservation is already realized) instead of erroring out.
    const existingInvoices = await storage.listInvoices();
    if (existingInvoices.some((i) => i.orderId === parsed.data.orderId)) {
      return res.status(409).json({ message: "Für diese Bestellung liegt bereits eine Rechnung vor." });
    }

    const amount = parsed.data.amount ?? 0;
    const fmt = (v: number) => `${v.toFixed(2)} €`;

    // Real 3-way match: order (bestellt) ↔ goods receipt (geliefert) ↔ invoice (berechnet).
    // An invoice only matches if the goods are fully received AND the billed amount equals
    // the received value; anything else is a discrepancy explaining which leg disagrees.
    const order = await storage.getPurchaseOrder(parsed.data.orderId);
    let status = parsed.data.status;
    let matchNote = parsed.data.matchNote;
    if (order) {
      const { orderedValue, receivedValue, anyReceived, fullyReceived } = await orderReceiptState(order.id, order.requestId);
      if (!anyReceived) {
        status = "discrepancy";
        matchNote = `Noch kein Wareneingang gebucht — Rechnung über ${fmt(amount)} kann nicht abgeglichen werden (bestellt ${fmt(orderedValue)}).`;
      } else if (Math.abs(receivedValue - amount) < 0.01 && fullyReceived) {
        status = "matched";
        matchNote = `3-Way-Match ok: bestellt, geliefert und berechnet stimmen überein (${fmt(amount)}).`;
      } else {
        status = "discrepancy";
        const parts = [`bestellt ${fmt(orderedValue)}`, `geliefert ${fmt(receivedValue)}`, `berechnet ${fmt(amount)}`];
        matchNote = `Abweichung im 3-Way-Match: ${parts.join(" · ")}${fullyReceived ? "" : " (Wareneingang unvollständig)"}.`;
      }
    }

    const invoice = await storage.createInvoice({ ...parsed.data, amount, status, matchNote });

    // Realize the budget: release the request's reservation (Obligo) and book the invoiced
    // amount as actual spend. Only the first invoice per order clears the reservation.
    if (order) {
      const commitment = await storage.getReservedCommitmentByRequest(order.requestId);
      if (commitment) {
        await storage.updateBudgetCommitment(commitment.id, { status: "realized", resolvedAt: new Date().toISOString() });
        await storage.updatePeriodCommitted(commitment.periodId, -commitment.amount);
        await storage.updatePeriodSpent(commitment.periodId, amount);
      }
    }

    res.status(201).json(invoice);
  });

  app.patch("/api/invoices/:id", requireRole(...PURCHASING_ROLES), async (req, res) => {
    const parsed = insertInvoiceSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    const existing = await storage.getInvoice(Number(req.params.id));
    if (!existing) return res.status(404).json({ message: "Rechnung nicht gefunden." });

    const updated = await storage.updateInvoice(existing.id, parsed.data);
    if (!updated) return res.status(404).json({ message: "Rechnung nicht gefunden." });

    // A corrected amount must also correct the budget period's booked spend — otherwise
    // `spent` permanently desyncs from the invoice's real amount with no reconciliation path.
    if (parsed.data.amount !== undefined && parsed.data.amount !== existing.amount) {
      const order = await storage.getPurchaseOrder(existing.orderId);
      const commitment = order && (await storage.getCommitmentByRequest(order.requestId));
      if (commitment) {
        await storage.updatePeriodSpent(commitment.periodId, parsed.data.amount - existing.amount);
      }
    }

    res.json(updated);
  });

  // ---------- Attachments (Datei-Anhänge) ----------
  // Multer reports bad-file-type/too-large errors via its own callback rather than throwing —
  // wrap it so those land as a normal 4xx JSON response instead of falling through to the
  // generic 500 error handler in server/index.ts.
  function handleUpload(req: Request, res: Response, next: NextFunction) {
    upload.single("file")(req, res, (err: unknown) => {
      if (err) return res.status(400).json({ message: err instanceof Error ? err.message : "Datei-Upload fehlgeschlagen." });
      next();
    });
  }

  type AttachmentActor = { id: number; role: string };
  const ATTACHMENT_PARENTS: Record<string, {
    getParent: (id: number) => Promise<any>;
    notFoundMessage: string;
    // Requests are broadly readable app-wide today (GET /api/purchase-requests/:id has no
    // role gate either), so attachment visibility follows the same convention. Orders and
    // invoices are purchasing/finance-operational entities — every other mutation on them
    // (POST/PATCH /api/purchase-orders, /api/invoices) already requires PURCHASING_ROLES, so
    // their attachments (list/upload alike) follow the same gate.
    canView: (parent: any, actor: AttachmentActor) => boolean;
    canUpload: (parent: any, actor: AttachmentActor) => boolean;
  }> = {
    request: {
      getParent: (id) => storage.getPurchaseRequest(id),
      notFoundMessage: "Bestellanforderung nicht gefunden.",
      canView: () => true,
      canUpload: (parent, actor) => parent.requesterId === actor.id || isPurchasingRole(actor.role),
    },
    order: {
      getParent: (id) => storage.getPurchaseOrder(id),
      notFoundMessage: "Bestellung nicht gefunden.",
      canView: (_parent, actor) => isPurchasingRole(actor.role),
      canUpload: (_parent, actor) => isPurchasingRole(actor.role),
    },
    invoice: {
      getParent: (id) => storage.getInvoice(id),
      notFoundMessage: "Rechnung nicht gefunden.",
      canView: (_parent, actor) => isPurchasingRole(actor.role),
      canUpload: (_parent, actor) => isPurchasingRole(actor.role),
    },
  };

  function registerAttachmentRoutes(entityType: keyof typeof ATTACHMENT_PARENTS, routePrefix: string) {
    const { getParent, notFoundMessage, canView, canUpload } = ATTACHMENT_PARENTS[entityType];

    app.get(`/api/${routePrefix}/:id/attachments`, async (req, res) => {
      const entityId = Number(req.params.id);
      const parent = await getParent(entityId);
      if (!parent) return res.status(404).json({ message: notFoundMessage });
      if (!canView(parent, req.user!)) return res.status(403).json({ message: "Für diese Anhänge fehlt die Berechtigung." });
      res.json(await storage.listAttachments(entityType, entityId));
    });

    app.post(`/api/${routePrefix}/:id/attachments`, handleUpload, async (req, res) => {
      const entityId = Number(req.params.id);
      const parent = await getParent(entityId);
      if (!parent) return res.status(404).json({ message: notFoundMessage });
      if (!canUpload(parent, req.user!)) return res.status(403).json({ message: "Für das Hochladen fehlt die Berechtigung." });
      if (!req.file) return res.status(400).json({ message: "Keine Datei übermittelt." });

      const now = new Date().toISOString();
      const attachment = await storage.createAttachment({
        entityType, entityId, filename: req.file.originalname, storedName: req.file.filename,
        mimeType: req.file.mimetype, size: req.file.size, uploadedById: req.user!.id, createdAt: now,
      });
      await storage.createActivity({
        entityType, entityId, actorId: req.user!.id, action: "attachment_added",
        note: req.file.originalname, createdAt: now,
      });
      res.status(201).json(attachment);
    });
  }

  registerAttachmentRoutes("request", "purchase-requests");
  registerAttachmentRoutes("order", "purchase-orders");
  registerAttachmentRoutes("invoice", "invoices");

  app.get("/api/attachments/:id/download", async (req, res) => {
    const attachment = await storage.getAttachment(Number(req.params.id));
    if (!attachment) return res.status(404).json({ message: "Anhang nicht gefunden." });
    const parentDef = ATTACHMENT_PARENTS[attachment.entityType];
    const parent = parentDef && (await parentDef.getParent(attachment.entityId));
    if (!parentDef || !parent || !parentDef.canView(parent, req.user!)) {
      return res.status(403).json({ message: "Für diesen Anhang fehlt die Berechtigung." });
    }
    res.download(attachmentPath(attachment.storedName), attachment.filename);
  });

  app.delete("/api/attachments/:id", async (req, res) => {
    const attachment = await storage.getAttachment(Number(req.params.id));
    if (!attachment) return res.status(404).json({ message: "Anhang nicht gefunden." });
    if (attachment.uploadedById !== req.user!.id && !isPurchasingRole(req.user!.role)) {
      return res.status(403).json({ message: "Für das Löschen dieses Anhangs fehlt die Berechtigung." });
    }
    fs.unlink(attachmentPath(attachment.storedName), () => {});
    await storage.deleteAttachment(attachment.id);
    await storage.createActivity({
      entityType: attachment.entityType, entityId: attachment.entityId, actorId: req.user!.id,
      action: "attachment_removed", note: attachment.filename, createdAt: new Date().toISOString(),
    });
    res.status(204).end();
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
      storage.listCostCentersWithActivePeriod(),
      storage.listSuppliers(),
    ]);

    res.json({
      pendingApprovals: requests.filter(r => r.status === "pending_approval").length,
      openOrders: orders.filter(o => o.status === "open" || o.status === "partially_received").length,
      discrepancyInvoices: invoices.filter(i => i.status === "discrepancy").length,
      totalSpent: costCenters.reduce((s, c) => s + c.spent, 0),
      totalCommitted: costCenters.reduce((s, c) => s + c.committed, 0),
      totalBudget: costCenters.reduce((s, c) => s + c.annualBudget, 0),
      activeSuppliers: suppliers.filter(s => s.status === "active").length,
      requestsByStatus: requests.reduce((acc: Record<string, number>, r) => {
        acc[r.status] = (acc[r.status] ?? 0) + 1;
        return acc;
      }, {}),
      recentRequests: requests.slice(0, 6),
    });
  });

  // ---------- Spend analytics (finance/purchasing) ----------
  app.get("/api/analytics", requireRole(...PURCHASING_ROLES, "approver"), async (_req, res) => {
    const [requests, invoices, costCenters, suppliers] = await Promise.all([
      storage.listPurchaseRequests(),
      storage.listInvoices(),
      storage.listCostCentersWithActivePeriod(),
      storage.listSuppliers(),
    ]);

    const spendByCostCenter = [...costCenters]
      .sort((a, b) => (b.spent + b.committed) - (a.spent + a.committed))
      .slice(0, 8)
      .map((c) => ({ name: c.name, code: c.code, spent: c.spent, committed: c.committed }));

    const supplierName = new Map(suppliers.map((s) => [s.id, s.name]));
    const bySupplier = new Map<number, number>();
    for (const inv of invoices) bySupplier.set(inv.supplierId, (bySupplier.get(inv.supplierId) ?? 0) + inv.amount);
    const spendBySupplier = Array.from(bySupplier.entries())
      .map(([id, amount]) => ({ name: supplierName.get(id) ?? `#${id}`, amount }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 8);

    const byMonth = new Map<string, number>();
    for (const inv of invoices) {
      const month = (inv.receivedAt ?? "").slice(0, 7); // YYYY-MM
      if (month) byMonth.set(month, (byMonth.get(month) ?? 0) + inv.amount);
    }
    const spendByMonth = Array.from(byMonth.entries())
      .map(([month, amount]) => ({ month, amount }))
      .sort((a, b) => a.month.localeCompare(b.month));

    const requestsByStatus = requests.reduce((acc: Record<string, number>, r) => {
      acc[r.status] = (acc[r.status] ?? 0) + 1;
      return acc;
    }, {});

    // Budget vs. Ist: every cost center's actual (spent+committed) against its annual budget,
    // plus how far through its fiscal period "today" is (elapsedPct) so the client can flag
    // cost centers spending faster than the year is passing (pacing), not just over budget.
    const now = Date.now();
    const budgetVariance = costCenters.map((c) => {
      const actual = c.spent + c.committed;
      const variance = c.annualBudget - actual;
      const variancePct = c.annualBudget > 0 ? (actual / c.annualBudget) * 100 : 0;
      const start = new Date(c.periodStartsAt).getTime();
      const end = new Date(c.periodEndsAt).getTime();
      const elapsedPct = end > start ? clamp01((now - start) / (end - start)) * 100 : 0;
      return { id: c.id, name: c.name, code: c.code, annualBudget: c.annualBudget, actual, variance, variancePct, elapsedPct };
    });
    const totalBudget = budgetVariance.reduce((s, c) => s + c.annualBudget, 0);
    const totalActual = budgetVariance.reduce((s, c) => s + c.actual, 0);
    const budgetSummary = {
      totalBudget, totalActual,
      variance: totalBudget - totalActual,
      variancePct: totalBudget > 0 ? (totalActual / totalBudget) * 100 : 0,
      overBudgetCount: budgetVariance.filter((c) => c.variance < 0).length,
    };

    res.json({ spendByCostCenter, spendBySupplier, spendByMonth, requestsByStatus, budgetVariance, budgetSummary });
  });

  // ---------- Approval delegations (Freigabe-Vertretung) ----------
  const setDelegationSchema = z.object({
    delegateId: z.number().int().nullable(),
    startsAt: z.string().nullable().optional(),
    endsAt: z.string().nullable().optional(),
    note: z.string().optional(),
  });

  app.get("/api/delegations/me", async (req, res) => {
    const actor = req.user!;
    const mine = await storage.getApprovalDelegationByDelegator(actor.id);
    const delegate = mine ? await storage.getUser(mine.delegateId) : undefined;

    const now = new Date().toISOString();
    const asDelegate = (await storage.listApprovalDelegationsByDelegate(actor.id)).filter((d) => delegationIsActive(d, now));
    const delegators = await Promise.all(asDelegate.map((d) => storage.getUser(d.delegatorId)));
    const delegatingFor = delegators.filter((u): u is User => !!u).map(sanitizeUser);

    res.json({
      delegation: mine ? { ...mine, delegateName: delegate?.name ?? null } : null,
      delegatingFor,
    });
  });

  app.put("/api/delegations/me", requireRole(...DELEGATOR_ELIGIBLE_ROLES), async (req, res) => {
    const actor = req.user!;
    const parsed = setDelegationSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });

    if (parsed.data.delegateId === null) {
      await storage.deleteApprovalDelegationByDelegator(actor.id);
      return res.json({ delegation: null });
    }
    if (parsed.data.delegateId === actor.id) {
      return res.status(400).json({ message: "Man kann sich nicht selbst als Vertretung eintragen." });
    }
    const delegate = await storage.getUser(parsed.data.delegateId);
    if (!delegate) return res.status(404).json({ message: "Nutzer nicht gefunden." });
    if (!(DELEGATE_ELIGIBLE_ROLES as readonly string[]).includes(delegate.role)) {
      return res.status(400).json({ message: "Diese Person kann nicht als Vertretung eingetragen werden (Rolle nicht berechtigt)." });
    }

    // Setting a delegation is create-or-replace (a delegator has at most one active row) —
    // report 200 when this replaces an existing delegation, 201 only for a genuinely new one,
    // matching the create=201/update=200 convention used by every other endpoint in this file.
    const existed = !!(await storage.getApprovalDelegationByDelegator(actor.id));
    const saved = await storage.upsertApprovalDelegation({
      delegatorId: actor.id, delegateId: delegate.id,
      startsAt: parsed.data.startsAt ?? null, endsAt: parsed.data.endsAt ?? null,
      note: parsed.data.note ?? "", createdAt: new Date().toISOString(),
    });
    res.status(existed ? 200 : 201).json({ delegation: { ...saved, delegateName: delegate.name } });
  });

  // ---------- Notifications ----------
  // A derived, role-aware "what needs my attention" list (no persistence, no email — the
  // target runtime has no mailer). Computed live from request state, approval steps and the
  // activity log for the current user.
  app.get("/api/notifications", async (req, res) => {
    const actor = req.user!;
    const isPurchasing = isPurchasingRole(actor.role);
    const requests = await storage.listPurchaseRequests();
    const notifications: {
      id: string; type: string; title: string; description: string; href: string; createdAt: string;
    }[] = [];

    for (const r of requests) {
      // Approvals awaiting me: the current pending step is one my role can act on, and it is
      // not my own request (segregation of duties).
      if (r.status === "pending_approval" && r.requesterId !== actor.id) {
        const steps = await storage.listApprovalSteps(r.id);
        const current = steps.find((s) => s.status === "pending");
        if (current) {
          const actingForId = await resolveActingAuthority(actor, current.approverRole);
          const blockedBySoD = actingForId !== undefined && actingForId !== actor.id
            && selfApprovalBlocked(actingForId, r.requesterId, actor.role);
          if (actingForId !== undefined && !blockedBySoD) {
            notifications.push({
              id: `approval-${r.id}`, type: "approval",
              title: "Freigabe erforderlich",
              description: `${r.requestNumber} · ${r.title}`,
              href: `/requests/${r.id}`, createdAt: r.createdAt,
            });
          }
        }
      }

      // My requests that were decided.
      if (r.requesterId === actor.id && (r.status === "approved" || r.status === "rejected") && r.decidedAt) {
        notifications.push({
          id: `decision-${r.id}`, type: r.status === "approved" ? "approved" : "rejected",
          title: r.status === "approved" ? "Anforderung freigegeben" : "Anforderung abgelehnt",
          description: `${r.requestNumber} · ${r.title}`,
          href: `/requests/${r.id}`, createdAt: r.decidedAt,
        });
      }

      // Purchasing/finance: approved requests waiting to be ordered.
      if (isPurchasing && r.status === "approved") {
        notifications.push({
          id: `order-${r.id}`, type: "order",
          title: "Bereit zur Bestellung",
          description: `${r.requestNumber} · ${r.title}`,
          href: `/requests/${r.id}`, createdAt: r.decidedAt ?? r.createdAt,
        });
      }
    }

    // Purchasing/finance: invoices flagged as a discrepancy.
    if (isPurchasing) {
      const invoices = await storage.listInvoices();
      for (const inv of invoices.filter((i) => i.status === "discrepancy")) {
        notifications.push({
          id: `invoice-${inv.id}`, type: "discrepancy",
          title: "Rechnungsabweichung",
          description: `${inv.invoiceNumber} · ${inv.matchNote}`,
          href: `/invoices`, createdAt: inv.receivedAt,
        });
      }
    }

    notifications.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
    res.json(notifications);
  });

  return httpServer;
}
