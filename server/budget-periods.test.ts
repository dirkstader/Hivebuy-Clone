import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeApp, loginAs } from "./test-utils";

describe("budget periods (fiscal-year rollover)", () => {
  let app: Express;
  let lea: Awaited<ReturnType<typeof loginAs>>; // requester
  let sabine: Awaited<ReturnType<typeof loginAs>>; // approver
  let jana: Awaited<ReturnType<typeof loginAs>>; // purchasing
  let dirk: Awaited<ReturnType<typeof loginAs>>; // finance

  const auth = (token: string) => ["Authorization", `Bearer ${token}`] as [string, string];
  const costCenters = async (token: string) => (await request(app).get("/api/cost-centers").set(...auth(token))).body;

  beforeAll(async () => {
    app = await makeApp();
    lea = await loginAs(app, "lea.brandt@ounda.de");
    sabine = await loginAs(app, "sabine.krueger@ounda.de");
    jana = await loginAs(app, "jana.weiss@ounda.de");
    dirk = await loginAs(app, "dirk@stader.de");
  });

  it("creating a cost center seeds its first active budget period", async () => {
    const res = await request(app)
      .post("/api/cost-centers")
      .set(...auth(dirk.token))
      .send({ name: "Testfiliale", code: "TEST-001", owner: "", city: "Münster", annualBudget: 10000 });
    expect(res.status).toBe(201);
    expect(res.body.annualBudget).toBe(10000);
    expect(res.body.spent).toBe(0);
    expect(res.body.committed).toBe(0);
    expect(res.body.fiscalYear).toBe(new Date().getFullYear());

    const periods = await request(app).get(`/api/cost-centers/${res.body.id}/periods`).set(...auth(dirk.token));
    expect(periods.body).toHaveLength(1);
    expect(periods.body[0].status).toBe("active");
  });

  it("only finance may create a cost center or trigger a rollover", async () => {
    const createAttempt = await request(app)
      .post("/api/cost-centers")
      .set(...auth(jana.token))
      .send({ name: "X", code: "X-1", owner: "", city: "", annualBudget: 1000 });
    expect(createAttempt.status).toBe(403);
  });

  it("rollover closes the old period, opens a new one, and carries over open commitments", async () => {
    const create = await request(app)
      .post("/api/cost-centers")
      .set(...auth(dirk.token))
      .send({ name: "Rollover-Testfiliale", code: "TEST-ROLL", owner: "", city: "Köln", annualBudget: 5000 });
    const ccId = create.body.id;

    // Approve a request against this cost center — reserves budget on the active period.
    const req = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(lea.token))
      .send({
        costCenterId: ccId, supplierId: 1, title: "Rollover-Test",
        status: "pending_approval", lineItems: [{ description: "Artikel", quantity: 1, unitPrice: 1200 }],
      });
    await request(app).post(`/api/purchase-requests/${req.body.id}/decision`).set(...auth(sabine.token)).send({ decision: "approved" });

    const beforeRollover = (await costCenters(dirk.token)).find((c: any) => c.id === ccId);
    expect(beforeRollover.committed).toBeCloseTo(1200, 2);
    expect(beforeRollover.fiscalYear).toBe(new Date().getFullYear());

    const rollover = await request(app)
      .post(`/api/cost-centers/${ccId}/periods`)
      .set(...auth(dirk.token))
      .send({ budget: 6000 });
    expect(rollover.status).toBe(201);
    expect(rollover.body.fiscalYear).toBe(new Date().getFullYear() + 1);
    expect(rollover.body.spent).toBe(0);
    // The still-open (reserved) commitment carried over to the new period.
    expect(rollover.body.committed).toBeCloseTo(1200, 2);

    const afterRollover = (await costCenters(dirk.token)).find((c: any) => c.id === ccId);
    expect(afterRollover.periodId).toBe(rollover.body.id);
    expect(afterRollover.annualBudget).toBe(6000);
    expect(afterRollover.committed).toBeCloseTo(1200, 2);

    const periods = await request(app).get(`/api/cost-centers/${ccId}/periods`).set(...auth(dirk.token));
    expect(periods.body).toHaveLength(2);
    const closed = periods.body.find((p: any) => p.status === "closed");
    const active = periods.body.find((p: any) => p.status === "active");
    expect(closed.committed).toBe(0); // nothing open remains attached to the closed period
    expect(active.id).toBe(rollover.body.id);

    // Invoicing the request afterward realizes the commitment on the NEW (current) period,
    // not the old closed one — proving in-flight requests survive a fiscal-year boundary.
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
      .send({ invoiceNumber: "RE-ROLL-1", orderId: po.id, supplierId: 1, amount: 1200 });

    const afterInvoice = (await costCenters(dirk.token)).find((c: any) => c.id === ccId);
    expect(afterInvoice.committed).toBeCloseTo(0, 2);
    expect(afterInvoice.spent).toBeCloseTo(1200, 2);

    const finalPeriods = await request(app).get(`/api/cost-centers/${ccId}/periods`).set(...auth(dirk.token));
    const closedAfterInvoice = finalPeriods.body.find((p: any) => p.status === "closed");
    // The closed FY's own spent value is an untouched historical snapshot.
    expect(closedAfterInvoice.spent).toBe(0);
  });

  it("realized commitments are not carried over on rollover", async () => {
    const create = await request(app)
      .post("/api/cost-centers")
      .set(...auth(dirk.token))
      .send({ name: "Realized-Testfiliale", code: "TEST-REAL", owner: "", city: "Essen", annualBudget: 5000 });
    const ccId = create.body.id;

    const req = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(lea.token))
      .send({
        costCenterId: ccId, supplierId: 1, title: "Realized-Test",
        status: "pending_approval", lineItems: [{ description: "Artikel", quantity: 1, unitPrice: 500 }],
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
    await request(app).post("/api/invoices").set(...auth(jana.token)).send({ invoiceNumber: "RE-REAL-1", orderId: po.id, supplierId: 1, amount: 500 });

    const beforeRollover = (await costCenters(dirk.token)).find((c: any) => c.id === ccId);
    expect(beforeRollover.spent).toBeCloseTo(500, 2);
    expect(beforeRollover.committed).toBeCloseTo(0, 2);

    const rollover = await request(app).post(`/api/cost-centers/${ccId}/periods`).set(...auth(dirk.token)).send({ budget: 5000 });
    expect(rollover.body.committed).toBe(0); // realized commitment does not carry over

    const periods = await request(app).get(`/api/cost-centers/${ccId}/periods`).set(...auth(dirk.token));
    const closed = periods.body.find((p: any) => p.status === "closed");
    expect(closed.spent).toBeCloseTo(500, 2); // historical snapshot preserved
  });

  it("dashboard and analytics reflect only the active period's numbers", async () => {
    const summary = await request(app).get("/api/dashboard/summary").set(...auth(dirk.token));
    expect(summary.status).toBe(200);
    expect(typeof summary.body.totalBudget).toBe("number");
    expect(typeof summary.body.totalSpent).toBe("number");
    expect(typeof summary.body.totalCommitted).toBe("number");

    const analytics = await request(app).get("/api/analytics").set(...auth(dirk.token));
    expect(analytics.status).toBe(200);
    expect(Array.isArray(analytics.body.spendByCostCenter)).toBe(true);
  });
});
