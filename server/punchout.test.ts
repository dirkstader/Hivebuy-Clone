import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import http from "node:http";
import type { Express } from "express";
import { makeApp, loginAs } from "./test-utils";
import {
  buildSetupRequestCxml, parseSetupRequestCxml, buildSetupResponseCxml, parseSetupResponseCxml,
  buildOrderMessageCxml, parseOrderMessageCxml,
} from "./punchout-cxml";

function buyerCookieFromStartPageUrl(startPageUrl: string): string {
  return new URL(startPageUrl).hash.split("/").pop() ?? "";
}

describe("Amazon Business Punch-Out (real cXML against the built-in mock supplier)", () => {
  let app: Express;
  let jana: Awaited<ReturnType<typeof loginAs>>; // purchasing
  let lea: Awaited<ReturnType<typeof loginAs>>; // requester

  const auth = (token: string) => ["Authorization", `Bearer ${token}`] as [string, string];

  beforeAll(async () => {
    app = await makeApp();
    jana = await loginAs(app, "jana.weiss@ounda.de");
    lea = await loginAs(app, "lea.brandt@ounda.de");
  });

  it("runs the full happy path: setup -> mock checkout -> callback -> session shows the returned cart", async () => {
    const setup = await request(app).post("/api/punchout/setup").set(...auth(jana.token)).send({});
    expect(setup.status).toBe(201);
    expect(setup.body.startPageUrl).toMatch(/\/#\/punchout\/shop\/[0-9a-f]+$/);
    const buyerCookie = buyerCookieFromStartPageUrl(setup.body.startPageUrl);

    const cart = [
      { sku: "B0C9X9YQ2M", name: "Brillenputztuch", description: "Reinigungstuch", quantity: 2, unitPrice: 24.99 },
      { sku: "B08GYKPD8W", name: "Etikettendrucker", description: "Drucker", quantity: 1, unitPrice: 89.9 },
    ];

    // Unauthenticated by design: no Authorization header on either mock-amazon or callback —
    // a real Amazon Business has no knowledge of our bearer tokens.
    const checkout = await request(app).post("/api/punchout/mock-amazon/checkout").send({ buyerCookie, cart });
    expect(checkout.status).toBe(200);
    expect(typeof checkout.body.cxml).toBe("string");
    expect(checkout.body.cxml).toContain("PunchOutOrderMessage");

    const callback = await request(app).post("/api/punchout/callback").send({ cxml: checkout.body.cxml });
    expect(callback.status).toBe(200);
    const sessionId = callback.body.sessionId;
    expect(sessionId).toBeTruthy();

    const session = await request(app).get(`/api/punchout/sessions/${sessionId}`).set(...auth(jana.token));
    expect(session.status).toBe(200);
    expect(session.body.status).toBe("returned");
    const lines = JSON.parse(session.body.cartJson);
    expect(lines).toHaveLength(2);
    expect(lines[0]).toMatchObject({ sku: "B0C9X9YQ2M", name: "Brillenputztuch", quantity: 2, unitPrice: 24.99 });
  });

  it("404s the mock checkout and the callback for an unknown buyerCookie", async () => {
    const checkout = await request(app)
      .post("/api/punchout/mock-amazon/checkout")
      .send({ buyerCookie: "does-not-exist", cart: [] });
    expect(checkout.status).toBe(404);

    const bogusCxml = buildOrderMessageCxml({ buyerCookie: "does-not-exist", cart: [] });
    const callback = await request(app).post("/api/punchout/callback").send({ cxml: bogusCxml });
    expect(callback.status).toBe(404);
  });

  it("409s a second callback for a session that already returned", async () => {
    const setup = await request(app).post("/api/punchout/setup").set(...auth(jana.token)).send({});
    const buyerCookie = buyerCookieFromStartPageUrl(setup.body.startPageUrl);
    const cxml = buildOrderMessageCxml({ buyerCookie, cart: [] });

    const first = await request(app).post("/api/punchout/callback").send({ cxml });
    expect(first.status).toBe(200);

    const second = await request(app).post("/api/punchout/callback").send({ cxml });
    expect(second.status).toBe(409);
  });

  it("401s POST /api/punchout/setup without a token", async () => {
    const res = await request(app).post("/api/punchout/setup").send({});
    expect(res.status).toBe(401);
  });

  it("403s GET /api/punchout/sessions/:id for a user who doesn't own the session", async () => {
    const setup = await request(app).post("/api/punchout/setup").set(...auth(jana.token)).send({});
    const otherUsersSession = await request(app)
      .get(`/api/punchout/sessions/${await sessionIdFromStartPageUrl(app, setup.body.startPageUrl)}`)
      .set(...auth(lea.token));
    expect(otherUsersSession.status).toBe(403);
  });

  it("uses a real fetch to an external supplier once PUNCHOUT_SUPPLIER_SETUP_URL is configured", async () => {
    const server = http.createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        const { buyerCookie, sharedSecretOk } = parseSetupRequestCxml(body, "demo-shared-secret");
        if (!sharedSecretOk || !buyerCookie) {
          res.writeHead(401);
          res.end();
          return;
        }
        const responseCxml = buildSetupResponseCxml({ startPageUrl: `http://example-supplier.test/shop/${buyerCookie}` });
        res.writeHead(200, { "Content-Type": "text/xml" });
        res.end(responseCxml);
      });
    });
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const port = (server.address() as { port: number }).port;
    process.env.PUNCHOUT_SUPPLIER_SETUP_URL = `http://127.0.0.1:${port}`;
    try {
      const res = await request(app).post("/api/punchout/setup").set(...auth(jana.token)).send({});
      expect(res.status).toBe(201);
      expect(res.body.startPageUrl).toMatch(/^http:\/\/example-supplier\.test\/shop\/[0-9a-f]+$/);
    } finally {
      delete process.env.PUNCHOUT_SUPPLIER_SETUP_URL;
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  });

  // Helper: real code never needs a session's numeric id in isolation like this — it's carried
  // internally end to end — but the ownership test above needs one to hit GET .../:id directly.
  async function sessionIdFromStartPageUrl(app: Express, startPageUrl: string): Promise<number> {
    const buyerCookie = buyerCookieFromStartPageUrl(startPageUrl);
    const cxml = buildOrderMessageCxml({ buyerCookie, cart: [] });
    const callback = await request(app).post("/api/punchout/callback").send({ cxml });
    return callback.body.sessionId;
  }
});

describe("punchout-cxml pure functions (build/parse round-trip)", () => {
  it("round-trips a PunchOutSetupRequest", () => {
    const xml = buildSetupRequestCxml({
      buyerCookie: "cookie-abc",
      callbackUrl: "http://localhost:5001/api/punchout/callback",
      userEmail: "test&user@ounda.de",
      sharedSecret: "secret1",
      ourIdentity: "OUNDA-PROCURE",
    });
    const parsed = parseSetupRequestCxml(xml, "secret1");
    expect(parsed).toEqual({
      buyerCookie: "cookie-abc",
      browserFormPostUrl: "http://localhost:5001/api/punchout/callback",
      sharedSecretOk: true,
    });
    expect(parseSetupRequestCxml(xml, "wrong-secret").sharedSecretOk).toBe(false);
  });

  it("round-trips a PunchOutSetupResponse", () => {
    const xml = buildSetupResponseCxml({ startPageUrl: "http://localhost:5001/#/punchout/shop/cookie-abc" });
    expect(parseSetupResponseCxml(xml)).toEqual({ startPageUrl: "http://localhost:5001/#/punchout/shop/cookie-abc" });
  });

  it("round-trips a PunchOutOrderMessage with multiple lines, escaping special characters", () => {
    const cart = [
      { sku: "A1", name: "Kabelbinder & Clips", description: "x", quantity: 3, unitPrice: 9.99 },
      { sku: "A2", name: "Ordner <Premium>", description: "y", quantity: 1, unitPrice: 12.5 },
    ];
    const xml = buildOrderMessageCxml({ buyerCookie: "cookie-xyz", cart });
    const { buyerCookie, lines } = parseOrderMessageCxml(xml);
    expect(buyerCookie).toBe("cookie-xyz");
    expect(lines).toEqual([
      { sku: "A1", name: "Kabelbinder & Clips", description: "Kabelbinder & Clips", quantity: 3, unitPrice: 9.99 },
      { sku: "A2", name: "Ordner <Premium>", description: "Ordner <Premium>", quantity: 1, unitPrice: 12.5 },
    ]);
  });

  it("round-trips an empty cart", () => {
    const xml = buildOrderMessageCxml({ buyerCookie: "cookie-empty", cart: [] });
    expect(parseOrderMessageCxml(xml)).toEqual({ buyerCookie: "cookie-empty", lines: [] });
  });
});
