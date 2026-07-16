import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeApp, loginAs } from "./test-utils";

describe("attachments (Datei-Anhänge)", () => {
  let app: Express;
  let lea: Awaited<ReturnType<typeof loginAs>>; // requester
  let jana: Awaited<ReturnType<typeof loginAs>>; // purchasing

  const auth = (token: string) => ["Authorization", `Bearer ${token}`] as [string, string];

  beforeAll(async () => {
    app = await makeApp();
    lea = await loginAs(app, "lea.brandt@ounda.de");
    jana = await loginAs(app, "jana.weiss@ounda.de");
  });

  it("uploads a PDF to a request, lists it, and logs an activity entry", async () => {
    const upload = await request(app)
      .post("/api/purchase-requests/1/attachments")
      .set(...auth(lea.token))
      .attach("file", Buffer.from("%PDF-1.4 test"), { filename: "angebot.pdf", contentType: "application/pdf" });
    expect(upload.status).toBe(201);
    expect(upload.body.filename).toBe("angebot.pdf");
    expect(upload.body.uploadedById).toBe(lea.user.id);

    const list = await request(app).get("/api/purchase-requests/1/attachments").set(...auth(lea.token));
    expect(list.body.some((a: any) => a.id === upload.body.id)).toBe(true);

    const activity = await request(app).get("/api/purchase-requests/1").set(...auth(lea.token));
    expect(activity.body.activity.some((a: any) => a.action === "attachment_added")).toBe(true);
  });

  it("rejects a disallowed file type", async () => {
    const res = await request(app)
      .post("/api/purchase-requests/1/attachments")
      .set(...auth(lea.token))
      .attach("file", Buffer.from("hello"), { filename: "notes.txt", contentType: "text/plain" });
    expect(res.status).toBe(400);
  });

  it("404s when the parent request doesn't exist", async () => {
    const res = await request(app)
      .post("/api/purchase-requests/9999/attachments")
      .set(...auth(lea.token))
      .attach("file", Buffer.from("%PDF-1.4"), { filename: "x.pdf", contentType: "application/pdf" });
    expect(res.status).toBe(404);
  });

  it("downloads an uploaded attachment with the original filename", async () => {
    const upload = await request(app)
      .post("/api/invoices/1/attachments")
      .set(...auth(jana.token))
      .attach("file", Buffer.from("image-bytes"), { filename: "beleg.png", contentType: "image/png" });
    expect(upload.status).toBe(201);

    const download = await request(app).get(`/api/attachments/${upload.body.id}/download`).set(...auth(jana.token));
    expect(download.status).toBe(200);
    expect(download.headers["content-disposition"]).toContain("beleg.png");
  });

  it("only the uploader or purchasing/finance may delete an attachment", async () => {
    const upload = await request(app)
      .post("/api/purchase-requests/1/attachments")
      .set(...auth(lea.token))
      .attach("file", Buffer.from("%PDF-1.4"), { filename: "eigene-datei.pdf", contentType: "application/pdf" });

    const forbidden = await request(app)
      .delete(`/api/attachments/${upload.body.id}`)
      .set(...auth((await loginAs(app, "markus.vogt@ounda.de")).token));
    expect(forbidden.status).toBe(403);

    const asPurchasing = await request(app).delete(`/api/attachments/${upload.body.id}`).set(...auth(jana.token));
    expect(asPurchasing.status).toBe(204);

    const listAfter = await request(app).get("/api/purchase-requests/1/attachments").set(...auth(lea.token));
    expect(listAfter.body.some((a: any) => a.id === upload.body.id)).toBe(false);
  });

  it("the uploader may delete their own attachment even without purchasing/finance role", async () => {
    const upload = await request(app)
      .post("/api/purchase-requests/1/attachments")
      .set(...auth(lea.token))
      .attach("file", Buffer.from("%PDF-1.4"), { filename: "eigene-datei-2.pdf", contentType: "application/pdf" });

    const res = await request(app).delete(`/api/attachments/${upload.body.id}`).set(...auth(lea.token));
    expect(res.status).toBe(204);
  });

  it("a requester with no relation to an invoice cannot list, upload to, or download its attachments", async () => {
    const list = await request(app).get("/api/invoices/1/attachments").set(...auth(lea.token));
    expect(list.status).toBe(403);

    const upload = await request(app)
      .post("/api/invoices/1/attachments")
      .set(...auth(lea.token))
      .attach("file", Buffer.from("%PDF-1.4"), { filename: "fremde-rechnung.pdf", contentType: "application/pdf" });
    expect(upload.status).toBe(403);

    const asPurchasing = await request(app)
      .post("/api/invoices/1/attachments")
      .set(...auth(jana.token))
      .attach("file", Buffer.from("%PDF-1.4"), { filename: "beleg.pdf", contentType: "application/pdf" });
    expect(asPurchasing.status).toBe(201);

    const download = await request(app).get(`/api/attachments/${asPurchasing.body.id}/download`).set(...auth(lea.token));
    expect(download.status).toBe(403);
  });

  it("a requester with no relation to a purchase order cannot list or upload to its attachments", async () => {
    const list = await request(app).get("/api/purchase-orders/1/attachments").set(...auth(lea.token));
    expect(list.status).toBe(403);

    const upload = await request(app)
      .post("/api/purchase-orders/1/attachments")
      .set(...auth(lea.token))
      .attach("file", Buffer.from("%PDF-1.4"), { filename: "fremde-bestellung.pdf", contentType: "application/pdf" });
    expect(upload.status).toBe(403);
  });

  it("request attachments stay broadly viewable, matching how requests themselves are readable app-wide", async () => {
    // Markus has no relation to Lea's request 1 (not the requester, not purchasing) — this
    // mirrors the existing convention that GET /api/purchase-requests/:id has no role gate.
    const markus = await loginAs(app, "markus.vogt@ounda.de");
    const list = await request(app).get("/api/purchase-requests/1/attachments").set(...auth(markus.token));
    expect(list.status).toBe(200);
  });

  it("only the requester (or purchasing/finance) may upload to a request — not an unrelated colleague", async () => {
    const markus = await loginAs(app, "markus.vogt@ounda.de");
    const upload = await request(app)
      .post("/api/purchase-requests/1/attachments")
      .set(...auth(markus.token))
      .attach("file", Buffer.from("%PDF-1.4"), { filename: "unbeteiligt.pdf", contentType: "application/pdf" });
    expect(upload.status).toBe(403);
  });
});
