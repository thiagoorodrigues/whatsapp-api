import fs from "fs";
import os from "os";
import path from "path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "media-"));
jest.mock("../../config/upload", () => ({ __esModule: true, default: { directory: root } }));

// eslint-disable-next-line import/first
import { companyFolder, publicFileUrl, saveCompanyMedia } from "../mediaStorage";

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("saveCompanyMedia", () => {
  it("writes into the company's folder with an unguessable safe name", async () => {
    const stored = await saveCompanyMedia(7, Buffer.from("pdf"), "Boleto de Março (1).pdf", "application/pdf");
    expect(stored).toMatch(/^company7\/\d+_[0-9a-f]{12}_Boleto_de_Marco_1_\.pdf$/);
    expect(fs.readFileSync(path.join(root, stored)).toString()).toBe("pdf");
    expect(companyFolder(7)).toBe(path.join(root, "company7"));
  });

  it("keeps companies apart and never leaves the folder", async () => {
    const stored = await saveCompanyMedia(8, Buffer.from("x"), "../../../etc/passwd", "text/plain");
    expect(stored.startsWith("company8/")).toBe(true);
    expect(stored).not.toContain("..");
  });

  it("uses the mimetype when the name has no extension", async () => {
    expect(await saveCompanyMedia(7, Buffer.from("x"), "", "image/jpeg")).toMatch(/\.jpeg$/);
  });
});

describe("publicFileUrl", () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });

  it("does not repeat the port already in BACKEND_URL", () => {
    process.env.BACKEND_URL = "http://localhost:3001";
    process.env.PROXY_PORT = "3001";
    expect(publicFileUrl("company1/a b.pdf")).toBe("http://localhost:3001/public/company1/a%20b.pdf");
  });

  it("adds PROXY_PORT when BACKEND_URL has none", () => {
    process.env.BACKEND_URL = "http://api.local";
    process.env.PROXY_PORT = "8080";
    expect(publicFileUrl("x.png")).toBe("http://api.local:8080/public/x.png");
    process.env.BACKEND_URL = "https://api.exemplo.com";
    process.env.PROXY_PORT = "443";
    expect(publicFileUrl("x.png")).toBe("https://api.exemplo.com/public/x.png");
  });
});
