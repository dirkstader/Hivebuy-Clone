import express from "express";
import { createServer } from "node:http";
import request from "supertest";
import { registerRoutes } from "./routes";

export async function makeApp() {
  const app = express();
  app.use(express.json());
  const httpServer = createServer(app);
  await registerRoutes(httpServer, app);
  return app;
}

export async function loginAs(app: express.Express, email: string, password = "demo1234") {
  const res = await request(app).post("/api/auth/login").send({ email, password });
  if (res.status !== 200) {
    throw new Error(`login as ${email} failed: ${res.status} ${JSON.stringify(res.body)}`);
  }
  return res.body as { user: { id: number; role: string }; token: string };
}
