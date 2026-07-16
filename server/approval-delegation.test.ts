import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeApp, loginAs } from "./test-utils";

describe("approval delegations (Freigabe-Vertretung)", () => {
  let app: Express;
  let lea: Awaited<ReturnType<typeof loginAs>>; // requester
  let tobias: Awaited<ReturnType<typeof loginAs>>; // requester
  let sabine: Awaited<ReturnType<typeof loginAs>>; // approver
  let markus: Awaited<ReturnType<typeof loginAs>>; // approver
  let jana: Awaited<ReturnType<typeof loginAs>>; // purchasing ("Admin")
  let dirk: Awaited<ReturnType<typeof loginAs>>; // finance

  const auth = (token: string) => ["Authorization", `Bearer ${token}`] as [string, string];
  const setDelegation = (token: string, body: Record<string, unknown>) =>
    request(app).put("/api/delegations/me").set(...auth(token)).send(body);
  const notify = async (token: string) => (await request(app).get("/api/notifications").set(...auth(token))).body;

  const submitRequest = async (requesterToken: string, title: string, amount = 100) => {
    const res = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(requesterToken))
      .send({
        costCenterId: 1, title, status: "pending_approval",
        lineItems: [{ description: "Artikel", quantity: 1, unitPrice: amount }],
      });
    return res.body.id as number;
  };

  beforeAll(async () => {
    app = await makeApp();
    lea = await loginAs(app, "lea.brandt@ounda.de");
    tobias = await loginAs(app, "tobias.reimann@ounda.de");
    sabine = await loginAs(app, "sabine.krueger@ounda.de");
    markus = await loginAs(app, "markus.vogt@ounda.de");
    jana = await loginAs(app, "jana.weiss@ounda.de");
    dirk = await loginAs(app, "dirk@stader.de");
  });

  it("sets, shows, and clears a delegation", async () => {
    // Sabine already has a seeded delegation (see server/seed.ts) — this call replaces it,
    // so 200 (update), not 201 (create). The 201-on-genuinely-new-delegation path is covered
    // in its own test below, using a delegator with no prior delegation.
    const set = await setDelegation(sabine.token, { delegateId: markus.user.id, note: "Urlaub" });
    expect(set.status).toBe(200);
    expect(set.body.delegation.delegateName).toBe("Markus Vogt");

    const view = await request(app).get("/api/delegations/me").set(...auth(sabine.token));
    expect(view.body.delegation.delegateName).toBe("Markus Vogt");
    expect(view.body.delegation.note).toBe("Urlaub");

    const clear = await setDelegation(sabine.token, { delegateId: null });
    expect(clear.status).toBe(200);
    expect(clear.body.delegation).toBeNull();
  });

  it("rejects self-delegation", async () => {
    const res = await setDelegation(sabine.token, { delegateId: sabine.user.id });
    expect(res.status).toBe(400);
  });

  it("rejects a delegate whose role is not eligible (e.g. requester)", async () => {
    const res = await setDelegation(sabine.token, { delegateId: lea.user.id });
    expect(res.status).toBe(400);
  });

  it("only approver/finance may set a delegation for themselves", async () => {
    const asRequester = await setDelegation(lea.token, { delegateId: sabine.user.id });
    expect(asRequester.status).toBe(403);

    // Purchasing/"Admin" may still be NAMED as someone's delegate (borrowed authority), but
    // canActOnStep never grants "purchasing" any step authority directly — so a purchasing
    // user has nothing of their own to delegate, and setting up their own delegation is
    // rejected outright rather than silently succeeding as an inert no-op.
    const asPurchasing = await setDelegation(jana.token, { delegateId: markus.user.id });
    expect(asPurchasing.status).toBe(403);
  });

  it("reports 201 for a genuinely new delegation (not a replace)", async () => {
    // Dirk (finance) has no seeded delegation, unlike Sabine.
    const set = await setDelegation(dirk.token, { delegateId: markus.user.id });
    expect(set.status).toBe(201);
    await setDelegation(dirk.token, { delegateId: null }); // clean up for other tests
  });

  it("a purchasing (Admin) delegate can decide on behalf of an absent approver — borrowed authority", async () => {
    await setDelegation(sabine.token, { delegateId: jana.user.id, note: "Urlaubsvertretung" });
    const id = await submitRequest(tobias.token, "Vertretungstest 1");

    const decision = await request(app)
      .post(`/api/purchase-requests/${id}/decision`)
      .set(...auth(jana.token))
      .send({ decision: "approved", comment: "Als Vertretung." });
    expect(decision.status).toBe(200);
    expect(decision.body.status).toBe("approved");
    const step = decision.body.approvalSteps[0];
    expect(step.decidedById).toBe(jana.user.id);
    expect(step.decidedOnBehalfOfId).toBe(sabine.user.id);

    await setDelegation(sabine.token, { delegateId: null });
  });

  // A plain "approver" delegate already covers approver-role steps directly (any approver can
  // decide any pending approver step — that's the pre-existing, non-delegation rule), so it
  // doesn't exercise delegation-derived SoD. Use a finance-role step instead: an approver only
  // gets to act on it via delegation from a finance user, which is the genuine "borrowed
  // authority, non-admin" case.
  it("segregation of duties still blocks a non-admin (approver) delegate on the delegator's own finance-step request", async () => {
    const create = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(dirk.token))
      .send({
        costCenterId: 1, title: "Eigenantrag Dirk (Vertretungstest, >5000)", status: "pending_approval",
        lineItems: [{ description: "Artikel", quantity: 1, unitPrice: 6000 }],
      });
    const id = create.body.id;
    // Step 1 (approver) is decided by Sabine directly — she isn't the requester, no delegation involved.
    await request(app).post(`/api/purchase-requests/${id}/decision`).set(...auth(sabine.token)).send({ decision: "approved" });

    await setDelegation(dirk.token, { delegateId: markus.user.id });
    const decision = await request(app)
      .post(`/api/purchase-requests/${id}/decision`)
      .set(...auth(markus.token))
      .send({ decision: "approved" });
    expect(decision.status).toBe(403);

    await setDelegation(dirk.token, { delegateId: null });
  });

  it("a purchasing (Admin) delegate is exempt from segregation of duties on the delegator's own request", async () => {
    await setDelegation(sabine.token, { delegateId: jana.user.id });
    const create = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(sabine.token))
      .send({
        costCenterId: 1, title: "Eigenantrag Sabine (Admin-Ausnahme)", status: "pending_approval",
        lineItems: [{ description: "Artikel", quantity: 1, unitPrice: 100 }],
      });
    const id = create.body.id;

    const decision = await request(app)
      .post(`/api/purchase-requests/${id}/decision`)
      .set(...auth(jana.token))
      .send({ decision: "approved" });
    expect(decision.status).toBe(200);
    expect(decision.body.approvalSteps[0].decidedOnBehalfOfId).toBe(sabine.user.id);

    await setDelegation(sabine.token, { delegateId: null });
  });

  it("a delegation outside its date window is inactive", async () => {
    const past = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    await setDelegation(sabine.token, { delegateId: jana.user.id, endsAt: past });
    const id = await submitRequest(tobias.token, "Vertretungstest (abgelaufen)");

    const decision = await request(app)
      .post(`/api/purchase-requests/${id}/decision`)
      .set(...auth(jana.token))
      .send({ decision: "approved" });
    expect(decision.status).toBe(403);

    await setDelegation(sabine.token, { delegateId: null });
  });

  it("a delegation ending 'today' (bare date, as sent by the date-picker) is still active through the whole day", async () => {
    const today = new Date().toISOString().slice(0, 10);
    await setDelegation(sabine.token, { delegateId: jana.user.id, endsAt: today });
    const id = await submitRequest(tobias.token, "Vertretungstest (endet heute)");

    const decision = await request(app)
      .post(`/api/purchase-requests/${id}/decision`)
      .set(...auth(jana.token))
      .send({ decision: "approved" });
    expect(decision.status).toBe(200);

    await setDelegation(sabine.token, { delegateId: null });
  });

  it("notifications surface pending approvals to the active delegate and clear after deciding", async () => {
    await setDelegation(sabine.token, { delegateId: jana.user.id });
    const id = await submitRequest(tobias.token, "Vertretungstest Notifications");

    const janaBefore = await notify(jana.token);
    expect(janaBefore.some((n: any) => n.id === `approval-${id}`)).toBe(true);

    const leaItems = await notify(lea.token);
    expect(leaItems.some((n: any) => n.id === `approval-${id}`)).toBe(false);

    await request(app).post(`/api/purchase-requests/${id}/decision`).set(...auth(jana.token)).send({ decision: "approved" });
    const janaAfter = await notify(jana.token);
    expect(janaAfter.some((n: any) => n.id === `approval-${id}`)).toBe(false);

    await setDelegation(sabine.token, { delegateId: null });
  });

  it("notifications do not leak the delegator's own request to a non-admin delegate", async () => {
    const create = await request(app)
      .post("/api/purchase-requests")
      .set(...auth(dirk.token))
      .send({
        costCenterId: 1, title: "Eigenantrag Dirk (Notifications, >5000)", status: "pending_approval",
        lineItems: [{ description: "Artikel", quantity: 1, unitPrice: 6000 }],
      });
    const id = create.body.id;
    await request(app).post(`/api/purchase-requests/${id}/decision`).set(...auth(sabine.token)).send({ decision: "approved" });

    await setDelegation(dirk.token, { delegateId: markus.user.id });
    const markusItems = await notify(markus.token);
    expect(markusItems.some((n: any) => n.id === `approval-${id}`)).toBe(false);

    await setDelegation(dirk.token, { delegateId: null });
  });
});
