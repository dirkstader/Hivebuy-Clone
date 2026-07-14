import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeApp, loginAs } from "./test-utils";

describe("notifications (derived, role-aware)", () => {
  let app: Express;
  let lea: Awaited<ReturnType<typeof loginAs>>; // requester
  let sabine: Awaited<ReturnType<typeof loginAs>>; // approver
  let jana: Awaited<ReturnType<typeof loginAs>>; // purchasing

  const auth = (token: string) => ["Authorization", `Bearer ${token}`] as [string, string];
  const notify = async (token: string) => (await request(app).get("/api/notifications").set(...auth(token))).body;

  beforeAll(async () => {
    app = await makeApp();
    lea = await loginAs(app, "lea.brandt@ounda.de");
    sabine = await loginAs(app, "sabine.krueger@ounda.de");
    jana = await loginAs(app, "jana.weiss@ounda.de");
  });

  it("shows purchasing a discrepancy-invoice notification from the seed", async () => {
    const items = await notify(jana.token);
    expect(items.some((n: any) => n.type === "discrepancy")).toBe(true);
  });

  it("notifies an eligible approver of a pending request, and clears it after the decision", async () => {
    const create = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(lea.token))
      .send({
        costCenterId: 1,
        title: "Notify-Test",
        status: "pending_approval",
        lineItems: [{ description: "Artikel", quantity: 1, unitPrice: 100 }],
      });
    const id = create.body.id;

    // Approver sees an approval notification linking to the request.
    const before = await notify(sabine.token);
    expect(before.some((n: any) => n.id === `approval-${id}`)).toBe(true);

    // The requester does NOT see it as an approval (segregation of duties).
    const leaItems = await notify(lea.token);
    expect(leaItems.some((n: any) => n.id === `approval-${id}`)).toBe(false);

    // After approval, the approver's approval item clears; the requester gets a decision item.
    await request(app).post(`/api/purchase-requests/${id}/decision`).set(...auth(sabine.token)).send({ decision: "approved" });
    const after = await notify(sabine.token);
    expect(after.some((n: any) => n.id === `approval-${id}`)).toBe(false);

    const leaAfter = await notify(lea.token);
    expect(leaAfter.some((n: any) => n.id === `decision-${id}` && n.type === "approved")).toBe(true);
  });

  it("notifies purchasing that an approved request is ready to order", async () => {
    const create = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(lea.token))
      .send({
        costCenterId: 1,
        supplierId: 1,
        title: "Order-Notify-Test",
        status: "pending_approval",
        lineItems: [{ description: "Artikel", quantity: 1, unitPrice: 200 }],
      });
    const id = create.body.id;
    await request(app).post(`/api/purchase-requests/${id}/decision`).set(...auth(sabine.token)).send({ decision: "approved" });

    const items = await notify(jana.token);
    expect(items.some((n: any) => n.id === `order-${id}` && n.type === "order")).toBe(true);
  });
});
