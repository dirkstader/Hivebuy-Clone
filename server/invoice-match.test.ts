import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeApp, loginAs } from "./test-utils";

describe("invoice 3-way match", () => {
  let app: Express;
  let jana: Awaited<ReturnType<typeof loginAs>>; // purchasing
  let lea: Awaited<ReturnType<typeof loginAs>>; // requester
  let orderA: { id: number; totalAmount: number };
  let orderB: { id: number; totalAmount: number };

  const auth = (token: string) => ["Authorization", `Bearer ${token}`] as [string, string];

  beforeAll(async () => {
    app = await makeApp();
    jana = await loginAs(app, "jana.weiss@ounda.de");
    lea = await loginAs(app, "lea.brandt@ounda.de");

    const orders = await request(app).get("/api/purchase-orders").set(...auth(jana.token));
    orderA = orders.body.find((o: any) => o.orderNumber === "PO-2026-0114");
    orderB = orders.body.find((o: any) => o.orderNumber === "PO-2026-0098");
  });

  it("rejects invoice capture from a non-purchasing role", async () => {
    const res = await request(app)
      .post("/api/invoices")
      .set(...auth(lea.token))
      .send({ invoiceNumber: "RE-TEST-1", orderId: orderA.id, supplierId: 1, amount: orderA.totalAmount });
    expect(res.status).toBe(403);
  });

  it("marks an invoice as matched when the amount equals the order total", async () => {
    const res = await request(app)
      .post("/api/invoices")
      .set(...auth(jana.token))
      .send({ invoiceNumber: "RE-TEST-2", orderId: orderA.id, supplierId: 1, amount: orderA.totalAmount });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("matched");
  });

  it("flags a discrepancy when the amount differs from the order total", async () => {
    const wrongAmount = orderB.totalAmount + 50;
    const res = await request(app)
      .post("/api/invoices")
      .set(...auth(jana.token))
      .send({ invoiceNumber: "RE-TEST-3", orderId: orderB.id, supplierId: 1, amount: wrongAmount });
    expect(res.status).toBe(201);
    expect(res.body.status).toBe("discrepancy");
    expect(res.body.matchNote).toContain("50");
  });
});
