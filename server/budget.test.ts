import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeApp, loginAs } from "./test-utils";

describe("budget commitments (reserve on approval, realize on invoice)", () => {
  let app: Express;
  let lea: Awaited<ReturnType<typeof loginAs>>; // requester
  let sabine: Awaited<ReturnType<typeof loginAs>>; // approver
  let jana: Awaited<ReturnType<typeof loginAs>>; // purchasing

  const auth = (token: string) => ["Authorization", `Bearer ${token}`] as [string, string];
  // The full budget/spent/committed breakdown is restricted to approver/finance (purchasing
  // only gets the identity fields) — use sabine's token for these read-only assertions.
  const costCenter = async (id: number) => {
    const res = await request(app).get("/api/cost-centers").set(...auth(sabine.token));
    return res.body.find((c: any) => c.id === id);
  };

  beforeAll(async () => {
    app = await makeApp();
    lea = await loginAs(app, "lea.brandt@ounda.de");
    sabine = await loginAs(app, "sabine.krueger@ounda.de");
    jana = await loginAs(app, "jana.weiss@ounda.de");
  });

  it("reserves budget on approval and realizes it as spend when invoiced", async () => {
    const ccId = 1;
    const before = await costCenter(ccId);

    // Create + submit a single-step request for 900 €.
    const create = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(lea.token))
      .send({
        costCenterId: ccId,
        supplierId: 1,
        title: "Budgettest",
        status: "pending_approval",
        lineItems: [{ description: "Artikel", quantity: 3, unitPrice: 300 }],
      });
    const reqId = create.body.id;

    // Approval reserves the budget (committed up, spent unchanged).
    await request(app).post(`/api/purchase-requests/${reqId}/decision`).set(...auth(sabine.token)).send({ decision: "approved" });
    const afterApproval = await costCenter(ccId);
    expect(afterApproval.committed).toBeCloseTo(before.committed + 900, 2);
    expect(afterApproval.spent).toBeCloseTo(before.spent, 2);

    // Order + full receipt, then invoice → commitment realized (committed back down, spent up).
    await request(app).patch(`/api/purchase-requests/${reqId}`).set(...auth(jana.token)).send({ status: "ordered" });
    const orders = await request(app).get("/api/purchase-orders").set(...auth(jana.token));
    const po = orders.body.find((o: any) => o.requestId === reqId);
    const detail = await request(app).get(`/api/purchase-orders/${po.id}`).set(...auth(jana.token));
    await request(app)
      .post(`/api/purchase-orders/${po.id}/receipts`)
      .set(...auth(jana.token))
      .send({ lines: detail.body.lines.map((l: any) => ({ requestLineItemId: l.id, quantityReceived: l.quantity })) });
    await request(app)
      .post("/api/invoices")
      .set(...auth(jana.token))
      .send({ invoiceNumber: "RE-BUD-1", orderId: po.id, supplierId: 1, amount: 900 });

    const afterInvoice = await costCenter(ccId);
    expect(afterInvoice.committed).toBeCloseTo(before.committed, 2);
    expect(afterInvoice.spent).toBeCloseTo(before.spent + 900, 2);
  });
});
