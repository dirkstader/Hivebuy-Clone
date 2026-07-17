import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import type { Express } from "express";
import { makeApp } from "./test-utils";

describe("auth", () => {
  let app: Express;

  beforeAll(async () => {
    app = await makeApp();
  });

  it("rejects a wrong password", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "dirk@stader.de", password: "wrong" });
    expect(res.status).toBe(401);
  });

  it("logs in with the right password and returns a token + sanitized user", async () => {
    const res = await request(app)
      .post("/api/auth/login")
      .send({ email: "dirk@stader.de", password: "demo1234" });
    expect(res.status).toBe(200);
    expect(res.body.token).toBeTypeOf("string");
    expect(res.body.user.email).toBe("dirk@stader.de");
    expect(res.body.user.password).toBeUndefined();
  });

  it("never leaks the password field from the public user list", async () => {
    const res = await request(app).get("/api/users");
    expect(res.status).toBe(200);
    expect(res.body.length).toBeGreaterThan(0);
    for (const user of res.body) {
      expect(user.password).toBeUndefined();
    }
  });

  it("rejects protected routes without a token", async () => {
    const res = await request(app).get("/api/purchase-requests");
    expect(res.status).toBe(401);
  });

  it("rejects protected routes with a garbage token", async () => {
    const res = await request(app)
      .get("/api/purchase-requests")
      .set("Authorization", "Bearer not-a-real-token");
    expect(res.status).toBe(401);
  });

  it("accepts protected routes with a valid token", async () => {
    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "dirk@stader.de", password: "demo1234" });
    const res = await request(app)
      .get("/api/purchase-requests")
      .set("Authorization", `Bearer ${login.body.token}`);
    expect(res.status).toBe(200);
  });

  it("normalizes a mixed-case email to lowercase on creation, so login (which always "
    + "lowercases first) doesn't permanently lock the new account out", async () => {
    const finance = await request(app)
      .post("/api/auth/login")
      .send({ email: "dirk@stader.de", password: "demo1234" });
    const create = await request(app)
      .post("/api/users")
      .set("Authorization", `Bearer ${finance.body.token}`)
      .send({
        name: "Anna Müller", email: "Anna.Mueller@Firma.de", password: "demo1234",
        role: "requester", department: "", costCenterId: null,
      });
    expect(create.status).toBe(201);
    expect(create.body.email).toBe("anna.mueller@firma.de");

    const login = await request(app)
      .post("/api/auth/login")
      .send({ email: "Anna.Mueller@Firma.de", password: "demo1234" });
    expect(login.status).toBe(200);
    expect(login.body.user.email).toBe("anna.mueller@firma.de");
  });
});
