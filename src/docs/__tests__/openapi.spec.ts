import fs from "fs";
import path from "path";
import express from "express";
import request from "supertest";
import openapi from "../openapi";
import docsRoutes from "../../routes/docsRoutes";

// Paths actually registered with tokenAuth in messageRoutes.ts.
const registeredApiRoutes = (): string[] => {
  const src = fs.readFileSync(
    path.resolve(__dirname, "../../routes/messageRoutes.ts"),
    "utf8"
  );
  return [...src.matchAll(/messageRoutes\.post\("(\/api\/[^"]+)",\s*tokenAuth/g)].map(
    m => m[1]
  );
};

describe("OpenAPI document", () => {
  it("is OpenAPI 3 with the connection token as bearer auth", () => {
    expect(openapi.openapi).toMatch(/^3\./);
    expect(openapi.components.securitySchemes.connectionToken).toMatchObject({
      type: "http",
      scheme: "bearer"
    });
  });

  it("documents every token-protected route, and only those", () => {
    const documented = Object.keys(openapi.paths).sort();
    expect(documented).toEqual(registeredApiRoutes().sort());
  });

  it("requires the token and a number on every operation", () => {
    Object.entries(openapi.paths).forEach(([p, item]: [string, any]) => {
      const op = item.post;
      expect(op).toBeDefined();
      expect(op.security).toEqual([{ connectionToken: [] }]);
      const content = op.requestBody.content;
      const raw = (content["application/json"] || content["multipart/form-data"]).schema;
      // Follow "#/components/schemas/X" references to the real schema.
      const schema = raw.$ref
        ? (openapi.components.schemas as any)[raw.$ref.split("/").pop()]
        : raw;
      expect(schema.required).toContain("number");
      expect(op.responses["401"]).toBeDefined();
    });
  });
});

describe("docs routes", () => {
  const app = express();
  app.use(docsRoutes);

  it("serves the raw document as JSON", async () => {
    const res = await request(app).get("/api-docs.json");
    expect(res.status).toBe(200);
    expect(res.body.info.title).toBeDefined();
    expect(Object.keys(res.body.paths)).toHaveLength(Object.keys(openapi.paths).length);
  });

  it("serves the Swagger UI page", async () => {
    const res = await request(app).get("/api-docs/");
    expect(res.status).toBe(200);
    expect(res.text).toContain("swagger-ui");
  });
});
