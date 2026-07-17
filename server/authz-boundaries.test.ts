import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeApp, loginAs } from "./test-utils";

describe("authorization boundaries on read endpoints (no server-side role gate previously)", () => {
  let app: Express;
  let lea: Awaited<ReturnType<typeof loginAs>>; // requester
  let sabine: Awaited<ReturnType<typeof loginAs>>; // approver
  let jana: Awaited<ReturnType<typeof loginAs>>; // purchasing ("Admin")

  const auth = (token: string) => ["Authorization", `Bearer ${token}`] as [string, string];

  beforeAll(async () => {
    app = await makeApp();
    lea = await loginAs(app, "lea.brandt@ounda.de");
    sabine = await loginAs(app, "sabine.krueger@ounda.de");
    jana = await loginAs(app, "jana.weiss@ounda.de");
  });

  it("strips budget/spent/committed from the cost-centers list for requester/purchasing, keeps only identity fields", async () => {
    const res = await request(app).get("/api/cost-centers").set(...auth(lea.token));
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const cc of res.body) {
      expect(cc.id).toBeTypeOf("number");
      expect(cc.name).toBeTypeOf("string");
      expect(cc.code).toBeTypeOf("string");
      expect(cc.annualBudget).toBeUndefined();
      expect(cc.spent).toBeUndefined();
      expect(cc.committed).toBeUndefined();
    }

    const janaRes = await request(app).get("/api/cost-centers").set(...auth(jana.token));
    expect(janaRes.body[0].spent).toBeUndefined();
  });

  it("returns the full budget breakdown to approver/finance", async () => {
    const res = await request(app).get("/api/cost-centers").set(...auth(sabine.token));
    expect(res.status).toBe(200);
    expect(res.body[0].spent).toBeTypeOf("number");
    expect(res.body[0].committed).toBeTypeOf("number");
    expect(res.body[0].annualBudget).toBeTypeOf("number");
  });

  it("blocks a requester from reading the purchase-orders list and detail", async () => {
    const list = await request(app).get("/api/purchase-orders").set(...auth(lea.token));
    expect(list.status).toBe(403);

    const detail = await request(app).get("/api/purchase-orders/1").set(...auth(lea.token));
    expect(detail.status).toBe(403);
  });

  it("blocks a requester from reading the invoices list and detail", async () => {
    const list = await request(app).get("/api/invoices").set(...auth(lea.token));
    expect(list.status).toBe(403);

    const detail = await request(app).get("/api/invoices/1").set(...auth(lea.token));
    expect(detail.status).toBe(403);
  });

  it("allows purchasing/finance to read purchase-orders and invoices as before", async () => {
    const orders = await request(app).get("/api/purchase-orders").set(...auth(jana.token));
    expect(orders.status).toBe(200);
    const invoices = await request(app).get("/api/invoices").set(...auth(jana.token));
    expect(invoices.status).toBe(200);
  });
});
