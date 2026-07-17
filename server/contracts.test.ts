import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeApp, loginAs } from "./test-utils";

describe("contracts (Vertragsmanagement)", () => {
  let app: Express;
  let lea: Awaited<ReturnType<typeof loginAs>>; // requester
  let jana: Awaited<ReturnType<typeof loginAs>>; // purchasing

  const auth = (token: string) => ["Authorization", `Bearer ${token}`] as [string, string];
  const daysFromNow = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

  beforeAll(async () => {
    app = await makeApp();
    lea = await loginAs(app, "lea.brandt@ounda.de");
    jana = await loginAs(app, "jana.weiss@ounda.de");
  });

  it("blocks a requester from listing, reading, or creating contracts", async () => {
    const list = await request(app).get("/api/contracts").set(...auth(lea.token));
    expect(list.status).toBe(403);

    const create = await request(app)
      .post("/api/contracts")
      .set(...auth(lea.token))
      .send({ title: "Unbefugter Test", supplierId: 1, value: 100, startDate: daysFromNow(0) });
    expect(create.status).toBe(403);
  });

  it("creates a contract with an auto-generated contract number and defaults", async () => {
    const res = await request(app)
      .post("/api/contracts")
      .set(...auth(jana.token))
      .send({ title: "Rahmenvertrag Test", supplierId: 1, value: 12000, startDate: daysFromNow(-30) });
    expect(res.status).toBe(201);
    expect(res.body.contractNumber).toMatch(/^VTR-/);
    expect(res.body.status).toBe("active");
    expect(res.body.autoRenew).toBe(false);
    expect(res.body.noticePeriodDays).toBe(90); // schema default
    // No endDate -> unbefristet, always plain "active" regardless of how far in the past it started.
    expect(res.body.effectiveStatus).toBe("active");
    expect(res.body.supplierName).toBeTruthy();

    const detail = await request(app).get(`/api/contracts/${res.body.id}`).set(...auth(jana.token));
    expect(detail.status).toBe(200);
    expect(detail.body.contractNumber).toBe(res.body.contractNumber);
  });

  it("flags a contract as 'notice_due_soon' once inside the 60-day reminder window, but not before", async () => {
    // noticeDeadline = endDate - noticePeriodDays. endDate +40d, notice 10d -> deadline ~30d out:
    // comfortably inside the 60-day window regardless of what time of day this test runs.
    const insideWindow = await request(app)
      .post("/api/contracts")
      .set(...auth(jana.token))
      .send({ title: "Bald-Fällig-Test", supplierId: 1, value: 500, startDate: daysFromNow(-100), endDate: daysFromNow(40), noticePeriodDays: 10 });
    expect(insideWindow.body.effectiveStatus).toBe("notice_due_soon");

    // endDate +200d, notice 10d -> deadline in 190d: comfortably outside the 60-day window.
    const outsideWindow = await request(app)
      .post("/api/contracts")
      .set(...auth(jana.token))
      .send({ title: "Weit-Weg-Test", supplierId: 1, value: 500, startDate: daysFromNow(-10), endDate: daysFromNow(200), noticePeriodDays: 10 });
    expect(outsideWindow.body.effectiveStatus).toBe("active");
  });

  it("past the notice deadline: flags 'expiring' unless autoRenew, in which case it stays 'active'", async () => {
    // endDate +5d, notice 30d -> deadline was 25 days ago: past the notice deadline, contract not yet ended.
    const noAutoRenew = await request(app)
      .post("/api/contracts")
      .set(...auth(jana.token))
      .send({ title: "Läuft-Aus-Test", supplierId: 1, value: 500, startDate: daysFromNow(-300), endDate: daysFromNow(5), noticePeriodDays: 30, autoRenew: false });
    expect(noAutoRenew.body.effectiveStatus).toBe("expiring");

    const withAutoRenew = await request(app)
      .post("/api/contracts")
      .set(...auth(jana.token))
      .send({ title: "Auto-Verlängert-Test", supplierId: 1, value: 500, startDate: daysFromNow(-300), endDate: daysFromNow(5), noticePeriodDays: 30, autoRenew: true });
    expect(withAutoRenew.body.effectiveStatus).toBe("active");
  });

  it("flags a contract past its end date as 'expired', and a bare end-date-of-today is still valid through the day", async () => {
    const past = await request(app)
      .post("/api/contracts")
      .set(...auth(jana.token))
      .send({ title: "Abgelaufen-Test", supplierId: 1, value: 500, startDate: daysFromNow(-400), endDate: daysFromNow(-5), noticePeriodDays: 10 });
    expect(past.body.effectiveStatus).toBe("expired");

    // A bare "YYYY-MM-DD" end date of literally today must not read as already-expired —
    // mirrors the same fix already applied to delegation windows (endOfDayIfDateOnly).
    const today = await request(app)
      .post("/api/contracts")
      .set(...auth(jana.token))
      .send({ title: "Endet-Heute-Test", supplierId: 1, value: 500, startDate: daysFromNow(-300), endDate: daysFromNow(0), noticePeriodDays: 0 });
    expect(today.body.effectiveStatus).not.toBe("expired");
  });

  it("cancels a contract and reports 'cancelled' regardless of its dates", async () => {
    const create = await request(app)
      .post("/api/contracts")
      .set(...auth(jana.token))
      .send({ title: "Kündigungs-Test", supplierId: 1, value: 500, startDate: daysFromNow(-10), endDate: daysFromNow(300) });
    expect(create.body.effectiveStatus).toBe("active");

    const cancel = await request(app)
      .patch(`/api/contracts/${create.body.id}`)
      .set(...auth(jana.token))
      .send({ status: "cancelled" });
    expect(cancel.status).toBe(200);
    expect(cancel.body.status).toBe("cancelled");
    expect(cancel.body.effectiveStatus).toBe("cancelled");
    expect(cancel.body.cancelledAt).toBeTruthy();
  });

  it("supports uploading, downloading, and deleting a contract attachment via the shared attachments system", async () => {
    const create = await request(app)
      .post("/api/contracts")
      .set(...auth(jana.token))
      .send({ title: "Anhang-Test", supplierId: 1, value: 500, startDate: daysFromNow(0) });
    const contractId = create.body.id;

    const upload = await request(app)
      .post(`/api/contracts/${contractId}/attachments`)
      .set(...auth(jana.token))
      .attach("file", Buffer.from("%PDF-1.4 test"), { filename: "vertrag.pdf", contentType: "application/pdf" });
    expect(upload.status).toBe(201);

    const forbiddenUpload = await request(app)
      .post(`/api/contracts/${contractId}/attachments`)
      .set(...auth(lea.token))
      .attach("file", Buffer.from("%PDF-1.4"), { filename: "x.pdf", contentType: "application/pdf" });
    expect(forbiddenUpload.status).toBe(403);

    const download = await request(app).get(`/api/attachments/${upload.body.id}/download`).set(...auth(jana.token));
    expect(download.status).toBe(200);
    expect(download.headers["content-disposition"]).toContain("vertrag.pdf");

    const forbiddenList = await request(app).get(`/api/contracts/${contractId}/attachments`).set(...auth(lea.token));
    expect(forbiddenList.status).toBe(403);

    const del = await request(app).delete(`/api/attachments/${upload.body.id}`).set(...auth(jana.token));
    expect(del.status).toBe(204);
  });

  it("surfaces an expiring contract as a notification for purchasing/finance", async () => {
    const create = await request(app)
      .post("/api/contracts")
      .set(...auth(jana.token))
      .send({ title: "Notification-Test", supplierId: 1, value: 500, startDate: daysFromNow(-100), endDate: daysFromNow(45), noticePeriodDays: 10 });
    expect(create.body.effectiveStatus).toBe("notice_due_soon");

    const notifications = await request(app).get("/api/notifications").set(...auth(jana.token));
    expect(notifications.body.some((n: any) => n.id === `contract-${create.body.id}`)).toBe(true);
  });
});
