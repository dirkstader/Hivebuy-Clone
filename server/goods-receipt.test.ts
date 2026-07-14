import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeApp, loginAs } from "./test-utils";

describe("goods receipt (partial then full)", () => {
  let app: Express;
  let lea: Awaited<ReturnType<typeof loginAs>>; // requester
  let sabine: Awaited<ReturnType<typeof loginAs>>; // approver
  let jana: Awaited<ReturnType<typeof loginAs>>; // purchasing
  let requestId: number;
  let orderId: number;
  let lineItemId: number;

  const auth = (token: string) => ["Authorization", `Bearer ${token}`] as [string, string];

  beforeAll(async () => {
    app = await makeApp();
    lea = await loginAs(app, "lea.brandt@ounda.de");
    sabine = await loginAs(app, "sabine.krueger@ounda.de");
    jana = await loginAs(app, "jana.weiss@ounda.de");

    // Create -> submit -> approve -> order, so an "ordered" PO with one 10-unit line exists.
    const create = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(lea.token))
      .send({
        costCenterId: 1,
        supplierId: 1,
        title: "Wareneingang-Test",
        status: "pending_approval",
        lineItems: [{ description: "Testartikel", quantity: 10, unitPrice: 50 }],
      });
    requestId = create.body.id;
    await request(app).post(`/api/purchase-requests/${requestId}/decision`).set(...auth(sabine.token)).send({ decision: "approved" });
    await request(app).patch(`/api/purchase-requests/${requestId}`).set(...auth(jana.token)).send({ status: "ordered" });

    const orders = await request(app).get("/api/purchase-orders").set(...auth(jana.token));
    const po = orders.body.find((o: any) => o.requestId === requestId);
    orderId = po.id;
    const detail = await request(app).get(`/api/purchase-orders/${orderId}`).set(...auth(jana.token));
    lineItemId = detail.body.lines[0].id;
  });

  it("marks the order partially_received and keeps the request ordered after a partial receipt", async () => {
    const res = await request(app)
      .post(`/api/purchase-orders/${orderId}/receipts`)
      .set(...auth(jana.token))
      .send({ lines: [{ requestLineItemId: lineItemId, quantityReceived: 4 }] });
    expect(res.status).toBe(201);

    const order = await request(app).get(`/api/purchase-orders/${orderId}`).set(...auth(jana.token));
    expect(order.body.status).toBe("partially_received");
    expect(order.body.lines[0].quantityReceived).toBe(4);

    const req = await request(app).get(`/api/purchase-requests/${requestId}`).set(...auth(jana.token));
    expect(req.body.status).toBe("ordered");
  });

  it("marks the order received and flips the request to received once fully delivered", async () => {
    const res = await request(app)
      .post(`/api/purchase-orders/${orderId}/receipts`)
      .set(...auth(jana.token))
      .send({ lines: [{ requestLineItemId: lineItemId, quantityReceived: 6 }] }); // 4 + 6 = 10
    expect(res.status).toBe(201);

    const order = await request(app).get(`/api/purchase-orders/${orderId}`).set(...auth(jana.token));
    expect(order.body.status).toBe("received");
    expect(order.body.lines[0].quantityReceived).toBe(10);

    const req = await request(app).get(`/api/purchase-requests/${requestId}`).set(...auth(jana.token));
    expect(req.body.status).toBe("received");
  });

  it("rejects a receipt from a non-purchasing role", async () => {
    const res = await request(app)
      .post(`/api/purchase-orders/${orderId}/receipts`)
      .set(...auth(lea.token))
      .send({ lines: [{ requestLineItemId: lineItemId, quantityReceived: 1 }] });
    expect(res.status).toBe(403);
  });
});
