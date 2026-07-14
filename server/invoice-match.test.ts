import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeApp, loginAs } from "./test-utils";

describe("invoice 3-way match (order ↔ goods receipt ↔ invoice)", () => {
  let app: Express;
  let jana: Awaited<ReturnType<typeof loginAs>>; // purchasing
  let lea: Awaited<ReturnType<typeof loginAs>>; // requester
  let receivedOrder: { id: number; totalAmount: number }; // seeded, fully received (PO-2026-0098)
  let openOrder: { id: number; totalAmount: number }; // seeded, no goods receipt (PO-2026-0114)

  const auth = (token: string) => ["Authorization", `Bearer ${token}`] as [string, string];

  beforeAll(async () => {
    app = await makeApp();
    jana = await loginAs(app, "jana.weiss@ounda.de");
    lea = await loginAs(app, "lea.brandt@ounda.de");

    const orders = await request(app).get("/api/purchase-orders").set(...auth(jana.token));
    receivedOrder = orders.body.find((o: any) => o.orderNumber === "PO-2026-0098");
    openOrder = orders.body.find((o: any) => o.orderNumber === "PO-2026-0114");
  });

  it("rejects invoice capture from a non-purchasing role", async () => {
    const res = await request(app)
      .post("/api/invoices")
      .set(...auth(lea.token))
      .send({ invoiceNumber: "RE-T1", orderId: receivedOrder.id, supplierId: 1, amount: receivedOrder.totalAmount });
    expect(res.status).toBe(403);
  });

  it("matches when goods are fully received and the amount equals the received value", async () => {
    const res = await request(app)
      .post("/api/invoices")
      .set(...auth(jana.token))
      .send({ invoiceNumber: "RE-T2", orderId: receivedOrder.id, supplierId: 1, amount: receivedOrder.totalAmount });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("matched");
  });

  it("flags a discrepancy when nothing has been received yet", async () => {
    const res = await request(app)
      .post("/api/invoices")
      .set(...auth(jana.token))
      .send({ invoiceNumber: "RE-T3", orderId: openOrder.id, supplierId: 1, amount: openOrder.totalAmount });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("discrepancy");
    expect(res.body.matchNote).toContain("Wareneingang");
  });

  it("flags a discrepancy when the billed amount exceeds the received value", async () => {
    const res = await request(app)
      .post("/api/invoices")
      .set(...auth(jana.token))
      .send({ invoiceNumber: "RE-T4", orderId: receivedOrder.id, supplierId: 1, amount: receivedOrder.totalAmount + 100 });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("discrepancy");
    expect(res.body.matchNote).toContain("geliefert");
  });
});
