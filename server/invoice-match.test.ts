import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeApp, loginAs } from "./test-utils";

describe("invoice 3-way match (order ↔ goods receipt ↔ invoice)", () => {
  let app: Express;
  let jana: Awaited<ReturnType<typeof loginAs>>; // purchasing
  let lea: Awaited<ReturnType<typeof loginAs>>; // requester
  let sabine: Awaited<ReturnType<typeof loginAs>>; // approver

  const auth = (token: string) => ["Authorization", `Bearer ${token}`] as [string, string];

  beforeAll(async () => {
    app = await makeApp();
    jana = await loginAs(app, "jana.weiss@ounda.de");
    lea = await loginAs(app, "lea.brandt@ounda.de");
    sabine = await loginAs(app, "sabine.krueger@ounda.de");
  });

  // Every test needs its own fresh order — an order may only ever carry one invoice (see the
  // "rejects a second invoice" test below), so reusing a seeded, already-invoiced order (as
  // this file previously did) would just hit that guard instead of exercising the match logic.
  const freshOrder = async (title: string, quantity: number, unitPrice: number) => {
    const create = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(lea.token))
      .send({
        costCenterId: 1, supplierId: 1, title, status: "pending_approval",
        lineItems: [{ description: "Artikel", quantity, unitPrice }],
      });
    const requestId = create.body.id;
    await request(app).post(`/api/purchase-requests/${requestId}/decision`).set(...auth(sabine.token)).send({ decision: "approved" });
    await request(app).patch(`/api/purchase-requests/${requestId}`).set(...auth(jana.token)).send({ status: "ordered" });
    const orders = await request(app).get("/api/purchase-orders").set(...auth(jana.token));
    const order = orders.body.find((o: any) => o.requestId === requestId);
    const detail = await request(app).get(`/api/purchase-orders/${order.id}`).set(...auth(jana.token));
    return { order, lineItemId: detail.body.lines[0].id as number };
  };

  it("rejects invoice capture from a non-purchasing role", async () => {
    const { order } = await freshOrder("Rollen-Test", 1, 100);
    const res = await request(app)
      .post("/api/invoices")
      .set(...auth(lea.token))
      .send({ invoiceNumber: "RE-T1", orderId: order.id, supplierId: 1, amount: order.totalAmount });
    expect(res.status).toBe(403);
  });

  it("matches when goods are fully received and the amount equals the received value", async () => {
    const { order, lineItemId } = await freshOrder("Match-Test", 2, 150);
    await request(app)
      .post(`/api/purchase-orders/${order.id}/receipts`)
      .set(...auth(jana.token))
      .send({ lines: [{ requestLineItemId: lineItemId, quantityReceived: 2 }] });

    const res = await request(app)
      .post("/api/invoices")
      .set(...auth(jana.token))
      .send({ invoiceNumber: "RE-T2", orderId: order.id, supplierId: 1, amount: order.totalAmount });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("matched");
  });

  it("flags a discrepancy when nothing has been received yet", async () => {
    const { order } = await freshOrder("Kein-Wareneingang-Test", 1, 200);
    const res = await request(app)
      .post("/api/invoices")
      .set(...auth(jana.token))
      .send({ invoiceNumber: "RE-T3", orderId: order.id, supplierId: 1, amount: order.totalAmount });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("discrepancy");
    expect(res.body.matchNote).toContain("Wareneingang");
  });

  it("flags a discrepancy when the billed amount exceeds the received value", async () => {
    const { order, lineItemId } = await freshOrder("Abweichung-Test", 3, 100);
    await request(app)
      .post(`/api/purchase-orders/${order.id}/receipts`)
      .set(...auth(jana.token))
      .send({ lines: [{ requestLineItemId: lineItemId, quantityReceived: 3 }] });

    const res = await request(app)
      .post("/api/invoices")
      .set(...auth(jana.token))
      .send({ invoiceNumber: "RE-T4", orderId: order.id, supplierId: 1, amount: order.totalAmount + 100 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("discrepancy");
    expect(res.body.matchNote).toContain("geliefert");
  });

  it("rejects over-receiving beyond the ordered quantity", async () => {
    const { order, lineItemId } = await freshOrder("Overreceipt-Test", 5, 100);
    const res = await request(app)
      .post(`/api/purchase-orders/${order.id}/receipts`)
      .set(...auth(jana.token))
      .send({ lines: [{ requestLineItemId: lineItemId, quantityReceived: 500 }] });
    expect(res.status).toBe(400);
  });

  it("rejects a second invoice against an order that already has one", async () => {
    const { order, lineItemId } = await freshOrder("Duplikat-Test", 1, 300);
    await request(app)
      .post(`/api/purchase-orders/${order.id}/receipts`)
      .set(...auth(jana.token))
      .send({ lines: [{ requestLineItemId: lineItemId, quantityReceived: 1 }] });

    const first = await request(app)
      .post("/api/invoices")
      .set(...auth(jana.token))
      .send({ invoiceNumber: "RE-T5", orderId: order.id, supplierId: 1, amount: order.totalAmount });
    expect(first.status).toBe(201);

    const second = await request(app)
      .post("/api/invoices")
      .set(...auth(jana.token))
      .send({ invoiceNumber: "RE-T5b", orderId: order.id, supplierId: 1, amount: order.totalAmount });
    expect(second.status).toBe(409);
  });
});
