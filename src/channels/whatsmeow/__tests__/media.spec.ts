import fs from "fs";
import os from "os";
import path from "path";
import axios from "axios";
import { stageOutgoing, loadIncoming } from "../media";

jest.mock("axios");
jest.mock("../../../config/whatsappEngine", () => ({
  gatewayConfig: () => ({ url: "x", token: "t", mediaRoot: (global as any).__root })
}));

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "media-spec-"));
  (global as any).__root = root;
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
  jest.resetAllMocks();
});

const outFiles = () => {
  const dir = path.join(root, ".gateway", "out");
  return fs.existsSync(dir) ? fs.readdirSync(dir) : [];
};

describe("stageOutgoing", () => {
  it("grava buffer em .gateway/out e apaga no cleanup", async () => {
    const staged = await stageOutgoing({ buffer: Buffer.from("abc") }, ".jpg");
    expect(staged.path).toMatch(/^\.gateway\/out\/[^/]+\.jpg$/);
    expect(fs.readFileSync(path.join(root, staged.path), "utf8")).toBe("abc");
    await staged.cleanup();
    expect(outFiles()).toEqual([]);
  });

  it("copia arquivo de dentro de public e nunca apaga o original", async () => {
    const original = path.join(root, "campanha.png");
    fs.writeFileSync(original, "img");
    const staged = await stageOutgoing({ path: original }, ".png");
    expect(fs.readFileSync(path.join(root, staged.path), "utf8")).toBe("img");
    await staged.cleanup();
    expect(fs.existsSync(original)).toBe(true);
    expect(outFiles()).toEqual([]);
  });

  it("copia arquivo de fora da pasta de mídia", async () => {
    const other = fs.mkdtempSync(path.join(os.tmpdir(), "outside-"));
    const original = path.join(other, "a.pdf");
    fs.writeFileSync(original, "pdf");
    const staged = await stageOutgoing({ path: original }, ".pdf");
    expect(fs.readFileSync(path.join(root, staged.path), "utf8")).toBe("pdf");
    await staged.cleanup();
    expect(fs.existsSync(original)).toBe(true);
    fs.rmSync(other, { recursive: true, force: true });
  });

  it("baixa url com axios", async () => {
    (axios.get as jest.Mock).mockResolvedValue({ data: Buffer.from("remote") });
    const staged = await stageOutgoing({ url: "https://x.test/a.mp4" }, ".mp4");
    expect((axios.get as jest.Mock).mock.calls[0][1]).toMatchObject({
      responseType: "arraybuffer",
      maxContentLength: 100 * 1024 * 1024,
      timeout: 60000,
      maxRedirects: 5
    });
    expect(fs.readFileSync(path.join(root, staged.path), "utf8")).toBe("remote");
    await staged.cleanup();
    expect(outFiles()).toEqual([]);
  });

  it("nomes são únicos e extensão inválida é descartada", async () => {
    const a = await stageOutgoing({ buffer: Buffer.from("1") }, ".png");
    const b = await stageOutgoing({ buffer: Buffer.from("2") }, ".png");
    expect(a.path).not.toBe(b.path);
    const c = await stageOutgoing({ buffer: Buffer.from("3") }, "/../../x");
    expect(path.dirname(path.join(root, c.path))).toBe(path.join(root, ".gateway", "out"));
  });
});

describe("loadIncoming", () => {
  const client = (value: unknown) => ({ downloadMedia: jest.fn().mockResolvedValue(value) } as any);
  const inDir = () => {
    const d = path.join(root, ".gateway", "in");
    fs.mkdirSync(d, { recursive: true });
    return d;
  };

  it("lê o arquivo e apaga", async () => {
    fs.writeFileSync(path.join(inDir(), "x.jpg"), "data");
    const c = client({ path: ".gateway/in/x.jpg", mimetype: "image/jpeg", fileName: "x.jpg" });
    const res = await loadIncoming(c, 7, { m: 1 });
    expect(c.downloadMedia).toHaveBeenCalledWith(7, { m: 1 });
    expect(res?.data.toString()).toBe("data");
    expect(res).toMatchObject({ mimetype: "image/jpeg", fileName: "x.jpg" });
    expect(fs.readdirSync(inDir())).toEqual([]);
  });

  it("devolve null quando o gateway devolve null", async () => {
    expect(await loadIncoming(client(null), 1, {})).toBeNull();
  });

  it("recusa caminho fora de .gateway/in e não lê nem apaga", async () => {
    const secret = path.join(root, "segredo.txt");
    fs.writeFileSync(secret, "s");
    await expect(
      loadIncoming(client({ path: "../segredo.txt", mimetype: "a/b", fileName: "f" }), 1, {})
    ).rejects.toThrow();
    await expect(
      loadIncoming(client({ path: ".gateway/in/../../segredo.txt", mimetype: "a/b", fileName: "f" }), 1, {})
    ).rejects.toThrow();
    await expect(
      loadIncoming(client({ path: secret, mimetype: "a/b", fileName: "f" }), 1, {})
    ).rejects.toThrow();
    expect(fs.existsSync(secret)).toBe(true);
  });

  it("erro de leitura não deixa arquivo (diretório no lugar do arquivo)", async () => {
    const d = inDir();
    fs.mkdirSync(path.join(d, "sub"));
    fs.writeFileSync(path.join(d, "sub", "f"), "x");
    await expect(
      loadIncoming(client({ path: ".gateway/in/sub", mimetype: "a/b", fileName: "f" }), 1, {})
    ).rejects.toThrow();
    expect(fs.existsSync(path.join(d, "sub"))).toBe(false);
  });
});
