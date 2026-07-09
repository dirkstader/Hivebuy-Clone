import type { Express } from "express";
import { createServer } from 'node:http';
import type { Server } from 'node:http';
import { storage } from "./storage";
import { seedIfEmpty } from "./seed";
import { AMAZON_CATALOG } from "./amazon-catalog";
import {
  insertUserSchema, insertCostCenterSchema, insertSupplierSchema, insertCatalogItemSchema,
  insertPurchaseRequestSchema, insertRequestLineItemSchema, insertPurchaseOrderSchema, insertInvoiceSchema,
  insertPunchoutSessionSchema,
} from "@shared/schema";

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

  // ---------- Auth (simple, no sessions — client stores current user in memory) ----------
  app.post("/api/auth/login", async (req, res) => {
    const { email, password } = req.body ?? {};
    const user = await storage.getUserByEmail(String(email ?? "").toLowerCase());
    if (!user || user.password !== password) {
      return res.status(401).json({ message: "E-Mail oder Passwort ist falsch." });
    }
    res.json(user);
  });

  app.get("/api/users", async (_req, res) => {
    res.json(await storage.listUsers());
  });

  app.post("/api/users", async (req, res) => {
    const parsed = insertUserSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const user = await storage.createUser(parsed.data);
    res.status(201).json(user);
  });

  // ---------- Cost centers ----------
  app.get("/api/cost-centers", async (_req, res) => {
    res.json(await storage.listCostCenters());
  });

  app.post("/api/cost-centers", async (req, res) => {
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

  app.post("/api/suppliers", async (req, res) => {
    const parsed = insertSupplierSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.status(201).json(await storage.createSupplier(parsed.data));
  });

  app.patch("/api/suppliers/:id", async (req, res) => {
    const parsed = insertSupplierSchema.partial().safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    const updated = await storage.updateSupplier(Number(req.params.id), parsed.data);
    if (!updated) return res.status(404).json({ message: "Lieferant nicht gefunden." });
    res.json(updated);
  });

  app.delete("/api/suppliers/:id", async (req, res) => {
    await storage.deleteSupplier(Number(req.params.id));
    res.status(204).end();
  });

  // ---------- Catalog items ----------
  app.get("/api/catalog-items", async (_req, res) => {
    res.json(await storage.listCatalogItems());
  });

  app.post("/api/catalog-items", async (req, res) => {
    const parsed = insertCatalogItemSchema.safeParse(req.body);
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.status(201).json(await storage.createCatalogItem(parsed.data));
  });

  app.delete("/api/catalog-items/:id", async (req, res) => {
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
    res.json({ ...request, lineItems, activity });
  });

  app.post("/api/purchase-requests", async (req, res) => {
    const { lineItems, ...body } = req.body ?? {};
    const parsed = insertPurchaseRequestSchema.safeParse({
      ...body,
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

    const updates: Record<string, unknown> = { ...parsed.data };
    if (parsed.data.status && ["approved", "rejected"].includes(parsed.data.status) && !existing.decidedAt) {
      updates.decidedAt = new Date().toISOString();
    }

    const updated = await storage.updatePurchaseRequest(id, updates);

    if (Array.isArray(lineItems)) {
      await storage.deleteLineItemsForRequest(id);
      for (const li of lineItems) {
        const liParsed = insertRequestLineItemSchema.safeParse({ ...li, requestId: id });
        if (liParsed.success) await storage.createLineItem(liParsed.data);
      }
    }

    if (parsed.data.status && parsed.data.status !== existing.status) {
      await storage.createActivity({
        entityType: "request", entityId: id, actorId: parsed.data.approverId ?? existing.requesterId,
        action: parsed.data.status, note: activityNote ?? parsed.data.approverComment ?? "",
        createdAt: new Date().toISOString(),
      });

      // On approval, bump the cost center's spent amount.
      if (parsed.data.status === "approved" && updated) {
        await storage.updateCostCenterSpent(updated.costCenterId, updated.totalAmount);
      }

      // On "ordered", auto-create a purchase order.
      if (parsed.data.status === "ordered" && updated && updated.supplierId) {
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

  // ---------- Purchase orders ----------
  app.get("/api/purchase-orders", async (_req, res) => {
    res.json(await storage.listPurchaseOrders());
  });

  app.get("/api/purchase-orders/:id", async (req, res) => {
    const order = await storage.getPurchaseOrder(Number(req.params.id));
    if (!order) return res.status(404).json({ message: "Bestellung nicht gefunden." });
    res.json(order);
  });

  app.post("/api/purchase-orders", async (req, res) => {
    const parsed = insertPurchaseOrderSchema.safeParse({
      ...req.body,
      orderNumber: req.body?.orderNumber || genNumber("PO"),
      orderedAt: req.body?.orderedAt || new Date().toISOString(),
    });
    if (!parsed.success) return res.status(400).json({ message: parsed.error.message });
    res.status(201).json(await storage.createPurchaseOrder(parsed.data));
  });

  app.patch("/api/purchase-orders/:id", async (req, res) => {
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

  app.post("/api/invoices", async (req, res) => {
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

  app.patch("/api/invoices/:id", async (req, res) => {
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
      userId: req.body?.userId,
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
