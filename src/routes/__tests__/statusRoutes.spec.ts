import express from "express";
import request from "supertest";
import statusRoutes from "../statusRoutes";

const { version } = require("../../../package.json");

describe("GET /", () => {
  it("returns the API version and a message", async () => {
    const app = express().use(statusRoutes);
    const res = await request(app).get("/");

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      version,
      message: "API SwEasy OmniChannel em funcionamento.",
      docs: "/api-docs"
    });
  });
});
