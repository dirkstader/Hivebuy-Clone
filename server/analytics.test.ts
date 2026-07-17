import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeApp, loginAs } from "./test-utils";

describe("analytics: budget vs. Ist (variance) reporting", () => {
  let app: Express;
  let lea: Awaited<ReturnType<typeof loginAs>>; // requester
  let sabine: Awaited<ReturnType<typeof loginAs>>; // approver
  let jana: Awaited<ReturnType<typeof loginAs>>; // purchasing
  let dirk: Awaited<ReturnType<typeof loginAs>>; // finance

  const auth = (token: string) => ["Authorization", `Bearer ${token}`] as [string, string];

  beforeAll(async () => {
    app = await makeApp();
    lea = await loginAs(app, "lea.brandt@ounda.de");
    sabine = await loginAs(app, "sabine.krueger@ounda.de");
    jana = await loginAs(app, "jana.weiss@ounda.de");
    dirk = await loginAs(app, "dirk@stader.de");
  });

  it("blocks a requester from reading analytics", async () => {
    const res = await request(app).get("/api/analytics").set(...auth(lea.token));
    expect(res.status).toBe(403);
  });

  it("computes variance and flags an over-budget cost center", async () => {
    const create = await request(app)
      .post("/api/cost-centers")
      .set(...auth(dirk.token))
      .send({ name: "Analytics-Testfiliale", code: "TEST-ANALYTICS", owner: "", city: "Bochum", annualBudget: 1000 });
    expect(create.status).toBe(201);
    const ccId = create.body.id;

    // Approve + order + receive + invoice 1500 € against a 1000 € budget — deliberately over.
    const req = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(lea.token))
      .send({
        costCenterId: ccId, supplierId: 1, title: "Analytics-Test",
        status: "pending_approval", lineItems: [{ description: "Artikel", quantity: 1, unitPrice: 1500 }],
      });
    await request(app).post(`/api/purchase-requests/${req.body.id}/decision`).set(...auth(sabine.token)).send({ decision: "approved" });
    await request(app).patch(`/api/purchase-requests/${req.body.id}`).set(...auth(jana.token)).send({ status: "ordered" });
    const orders = await request(app).get("/api/purchase-orders").set(...auth(jana.token));
    const po = orders.body.find((o: any) => o.requestId === req.body.id);
    const detail = await request(app).get(`/api/purchase-orders/${po.id}`).set(...auth(jana.token));
    await request(app)
      .post(`/api/purchase-orders/${po.id}/receipts`)
      .set(...auth(jana.token))
      .send({ lines: detail.body.lines.map((l: any) => ({ requestLineItemId: l.id, quantityReceived: l.quantity })) });
    await request(app)
      .post("/api/invoices")
      .set(...auth(jana.token))
      .send({ invoiceNumber: "RE-ANALYTICS-1", orderId: po.id, supplierId: 1, amount: 1500 });

    const analytics = await request(app).get("/api/analytics").set(...auth(dirk.token));
    expect(analytics.status).toBe(200);

    const row = analytics.body.budgetVariance.find((c: any) => c.id === ccId);
    expect(row).toBeTruthy();
    expect(row.annualBudget).toBe(1000);
    expect(row.actual).toBeCloseTo(1500, 2);
    expect(row.variance).toBeCloseTo(-500, 2);
    expect(row.variancePct).toBeCloseTo(150, 0);
    expect(row.elapsedPct).toBeGreaterThanOrEqual(0);
    expect(row.elapsedPct).toBeLessThanOrEqual(100);

    // At least our own deliberately over-budget cost center must be counted.
    expect(analytics.body.budgetSummary.overBudgetCount).toBeGreaterThanOrEqual(1);
    expect(analytics.body.budgetSummary.totalBudget).toBeGreaterThan(0);
    expect(analytics.body.budgetSummary.totalActual).toBeGreaterThan(0);
  });
});
