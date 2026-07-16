import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeApp, loginAs } from "./test-utils";

describe("supplier scorecards (computed Lieferanten-Bewertung)", () => {
  let app: Express;
  let lea: Awaited<ReturnType<typeof loginAs>>; // requester
  let sabine: Awaited<ReturnType<typeof loginAs>>; // approver
  let jana: Awaited<ReturnType<typeof loginAs>>; // purchasing

  const auth = (token: string) => ["Authorization", `Bearer ${token}`] as [string, string];

  beforeAll(async () => {
    app = await makeApp();
    lea = await loginAs(app, "lea.brandt@ounda.de");
    sabine = await loginAs(app, "sabine.krueger@ounda.de");
    jana = await loginAs(app, "jana.weiss@ounda.de");
  });

  it("falls back to the static rating for a supplier with no order/invoice history", async () => {
    const suppliers = await request(app).get("/api/suppliers").set(...auth(jana.token));
    const office = suppliers.body.find((s: any) => s.name === "Büro Schmitz OHG");
    expect(office).toBeTruthy();

    const res = await request(app).get("/api/suppliers/scorecards").set(...auth(jana.token));
    expect(res.status).toBe(200);
    const entry = res.body.find((sc: any) => sc.supplierId === office.id);
    expect(entry).toBeTruthy();
    expect(entry.hasData).toBe(false);
    expect(entry.score).toBeNull();
    expect(entry.fallbackRating).toBe(office.rating);
  });

  it("computes the exact seeded score for NordIT Systemhaus GmbH (one on-time/complete order, one discrepancy invoice out of two)", async () => {
    const suppliers = await request(app).get("/api/suppliers").set(...auth(jana.token));
    const nordit = suppliers.body.find((s: any) => s.name === "NordIT Systemhaus GmbH");
    expect(nordit).toBeTruthy();

    const res = await request(app).get("/api/suppliers/scorecards").set(...auth(jana.token));
    const entry = res.body.find((sc: any) => sc.supplierId === nordit.id);
    expect(entry).toBeTruthy();
    expect(entry.hasData).toBe(true);
    expect(entry.onTimeRate).toBe(1);
    expect(entry.completeRate).toBe(1);
    expect(entry.discrepancyRate).toBe(0.5);
    expect(entry.score).toBe(85); // 0.4*100 + 0.3*100 + 0.3*50
  });

  it("scores a late delivery with onTimeRate 0 while completeRate stays 1", async () => {
    const suppliers = await request(app).get("/api/suppliers").set(...auth(jana.token));
    const marchon = suppliers.body.find((s: any) => s.name === "Marchon Eyewear GmbH");
    expect(marchon).toBeTruthy();

    // Create -> approve -> order a fresh request for this supplier.
    const create = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(lea.token))
      .send({
        costCenterId: 1,
        supplierId: marchon.id,
        title: "Scorecard-Test: verspätete Lieferung",
        status: "pending_approval",
        lineItems: [{ description: "Testartikel", quantity: 1, unitPrice: 100 }],
      });
    expect(create.status).toBe(201);
    const requestId = create.body.id;

    await request(app).post(`/api/purchase-requests/${requestId}/decision`).set(...auth(sabine.token)).send({ decision: "approved" });
    await request(app).patch(`/api/purchase-requests/${requestId}`).set(...auth(jana.token)).send({ status: "ordered" });

    const orders = await request(app).get("/api/purchase-orders").set(...auth(jana.token));
    const order = orders.body.find((o: any) => o.requestId === requestId);
    expect(order).toBeTruthy();

    // Backdate the expected delivery so today's receipt lands after it (late).
    const twoDaysAgo = new Date(Date.now() - 2 * 86400000).toISOString();
    await request(app)
      .patch(`/api/purchase-orders/${order.id}`)
      .set(...auth(jana.token))
      .send({ expectedDelivery: twoDaysAgo });

    const detail = await request(app).get(`/api/purchase-orders/${order.id}`).set(...auth(jana.token));
    const lineItemId = detail.body.lines[0].id;

    const receipt = await request(app)
      .post(`/api/purchase-orders/${order.id}/receipts`)
      .set(...auth(jana.token))
      .send({ lines: [{ requestLineItemId: lineItemId, quantityReceived: 1 }] });
    expect(receipt.status).toBe(201);
    expect(receipt.body.status).toBe("received");

    const res = await request(app).get("/api/suppliers/scorecards").set(...auth(jana.token));
    const entry = res.body.find((sc: any) => sc.supplierId === marchon.id);
    expect(entry).toBeTruthy();
    expect(entry.hasData).toBe(true);
    expect(entry.onTimeRate).toBe(0);
    expect(entry.completeRate).toBe(1);
    // This supplier has no invoices in this test, so the discrepancy leg (weight 0.3) must be
    // excluded from both the score numerator and the weight-sum denominator, not treated as 0.
    expect(entry.discrepancyRate).toBeNull();
    expect(entry.score).toBe(43); // round(100 * (0*0.4 + 1*0.3) / (0.4+0.3)) = round(42.857) = 43
  });

  it("is reachable by every role, including a plain requester and an approver", async () => {
    const asRequester = await request(app).get("/api/suppliers/scorecards").set(...auth(lea.token));
    expect(asRequester.status).toBe(200);
    expect(Array.isArray(asRequester.body)).toBe(true);

    const asApprover = await request(app).get("/api/suppliers/scorecards").set(...auth(sabine.token));
    expect(asApprover.status).toBe(200);
    expect(Array.isArray(asApprover.body)).toBe(true);
  });
});
