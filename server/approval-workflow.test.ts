import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeApp, loginAs } from "./test-utils";

describe("purchase request approval workflow", () => {
  let app: Express;
  let lea: Awaited<ReturnType<typeof loginAs>>; // requester
  let tobias: Awaited<ReturnType<typeof loginAs>>; // requester, not the owner of lea's request
  let sabine: Awaited<ReturnType<typeof loginAs>>; // approver
  let dirk: Awaited<ReturnType<typeof loginAs>>; // finance
  let jana: Awaited<ReturnType<typeof loginAs>>; // purchasing

  beforeAll(async () => {
    app = await makeApp();
    lea = await loginAs(app, "lea.brandt@ounda.de");
    tobias = await loginAs(app, "tobias.reimann@ounda.de");
    sabine = await loginAs(app, "sabine.krueger@ounda.de");
    dirk = await loginAs(app, "dirk@stader.de");
    jana = await loginAs(app, "jana.weiss@ounda.de");
  });

  const auth = (token: string) => ["Authorization", `Bearer ${token}`] as [string, string];

  it("forces requesterId to the acting user, ignoring a spoofed value in the body", async () => {
    const res = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(lea.token))
      .send({
        requesterId: tobias.user.id, // attempted spoof
        costCenterId: 1,
        title: "Testartikel",
        status: "draft",
        lineItems: [{ description: "Testartikel", quantity: 1, unitPrice: 10 }],
      });
    expect(res.status).toBe(201);
    expect(res.body.requesterId).toBe(lea.user.id);
  });

  it("runs a full single-step lifecycle draft -> pending -> approved -> ordered -> received", async () => {
    const create = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(lea.token))
      .send({
        costCenterId: 1,
        supplierId: 1, // a supplier must be set for the "ordered" transition to auto-create a PO
        title: "Bürostühle",
        status: "draft",
        lineItems: [{ description: "Bürostuhl", quantity: 2, unitPrice: 150 }], // 300 € -> single step
      });
    const id = create.body.id;
    expect(create.body.status).toBe("draft");

    // A different requester may not submit someone else's draft.
    const wrongOwner = await request(app)
      .patch(`/api/purchase-requests/${id}`)
      .set(...auth(tobias.token))
      .send({ status: "pending_approval" });
    expect(wrongOwner.status).toBe(403);

    // Can't skip straight from draft to ordered.
    const skipStep = await request(app)
      .patch(`/api/purchase-requests/${id}`)
      .set(...auth(jana.token))
      .send({ status: "ordered" });
    expect(skipStep.status).toBe(403);

    // Owner submits — this builds the approval chain.
    const submit = await request(app)
      .patch(`/api/purchase-requests/${id}`)
      .set(...auth(lea.token))
      .send({ status: "pending_approval" });
    expect(submit.status).toBe(200);
    expect(submit.body.status).toBe("pending_approval");

    // A requester cannot decide (wrong role for the step).
    const requesterDecide = await request(app)
      .post(`/api/purchase-requests/${id}/decision`)
      .set(...auth(tobias.token))
      .send({ decision: "approved" });
    expect(requesterDecide.status).toBe(403);

    // Purchasing cannot decide an approver step either.
    const purchasingDecide = await request(app)
      .post(`/api/purchase-requests/${id}/decision`)
      .set(...auth(jana.token))
      .send({ decision: "approved" });
    expect(purchasingDecide.status).toBe(403);

    // Approver approves the single step -> request fully approved, approverId is the decider.
    const approve = await request(app)
      .post(`/api/purchase-requests/${id}/decision`)
      .set(...auth(sabine.token))
      .send({ decision: "approved", comment: "Passt." });
    expect(approve.status).toBe(200);
    expect(approve.body.status).toBe("approved");
    expect(approve.body.approverId).toBe(sabine.user.id);

    // Purchasing triggers the order — this must also auto-create a purchase order.
    const order = await request(app)
      .patch(`/api/purchase-requests/${id}`)
      .set(...auth(jana.token))
      .send({ status: "ordered" });
    expect(order.status).toBe(200);

    const orders = await request(app).get("/api/purchase-orders").set(...auth(jana.token));
    const po = orders.body.find((o: any) => o.requestId === id);
    expect(po).toBeTruthy();

    // Goods receipt now runs through the receipts endpoint. Book the full quantity.
    const poDetail = await request(app).get(`/api/purchase-orders/${po.id}`).set(...auth(jana.token));
    const receiptLines = poDetail.body.lines.map((l: any) => ({ requestLineItemId: l.id, quantityReceived: l.quantity }));
    const receipt = await request(app)
      .post(`/api/purchase-orders/${po.id}/receipts`)
      .set(...auth(jana.token))
      .send({ lines: receiptLines });
    expect(receipt.status).toBe(201);

    // Fully received -> request flips to "received".
    const after = await request(app).get(`/api/purchase-requests/${id}`).set(...auth(jana.token));
    expect(after.body.status).toBe("received");
  });

  it("requires a second (finance) approval for requests over the threshold", async () => {
    const create = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(lea.token))
      .send({
        costCenterId: 1,
        title: "Großbestellung Hörgeräte",
        status: "pending_approval",
        lineItems: [{ description: "Hörgerät", quantity: 5, unitPrice: 1650 }], // 8.250 € -> two steps
      });
    const id = create.body.id;

    const detail = await request(app).get(`/api/purchase-requests/${id}`).set(...auth(lea.token));
    expect(detail.body.approvalSteps).toHaveLength(2);

    // First approval by an approver does NOT finalize — request stays pending.
    const step1 = await request(app)
      .post(`/api/purchase-requests/${id}/decision`)
      .set(...auth(sabine.token))
      .send({ decision: "approved", comment: "Fachlich ok." });
    expect(step1.status).toBe(200);
    expect(step1.body.status).toBe("pending_approval");

    // An approver cannot satisfy the finance step.
    const approverOnFinanceStep = await request(app)
      .post(`/api/purchase-requests/${id}/decision`)
      .set(...auth(sabine.token))
      .send({ decision: "approved" });
    expect(approverOnFinanceStep.status).toBe(403);

    // Finance completes the second step -> fully approved.
    const step2 = await request(app)
      .post(`/api/purchase-requests/${id}/decision`)
      .set(...auth(dirk.token))
      .send({ decision: "approved", comment: "Budget freigegeben." });
    expect(step2.status).toBe(200);
    expect(step2.body.status).toBe("approved");
  });

  it("rejects at any step, immediately marking the request rejected", async () => {
    const create = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(lea.token))
      .send({
        costCenterId: 1,
        title: "Abzulehnende Anforderung",
        status: "pending_approval",
        lineItems: [{ description: "Kram", quantity: 1, unitPrice: 200 }],
      });
    const id = create.body.id;

    const reject = await request(app)
      .post(`/api/purchase-requests/${id}/decision`)
      .set(...auth(sabine.token))
      .send({ decision: "rejected", comment: "Nicht notwendig." });
    expect(reject.status).toBe(200);
    expect(reject.body.status).toBe("rejected");
  });

  it("enforces segregation of duties: a user cannot decide on their own request", async () => {
    // Sabine (approver) creates and submits her own request, then tries to approve it herself.
    const create = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(sabine.token))
      .send({
        costCenterId: 1,
        title: "Eigenantrag Sabine",
        status: "pending_approval",
        lineItems: [{ description: "Artikel", quantity: 1, unitPrice: 100 }],
      });
    const id = create.body.id;

    const selfApprove = await request(app)
      .post(`/api/purchase-requests/${id}/decision`)
      .set(...auth(sabine.token))
      .send({ decision: "approved" });
    expect(selfApprove.status).toBe(403);
  });
});
