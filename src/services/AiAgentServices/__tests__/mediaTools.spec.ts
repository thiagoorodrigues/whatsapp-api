import fs from "fs";
import os from "os";
import path from "path";
import {
  contentFor,
  kindOf,
  mediaPath,
  removeOrphanMedia,
  sanitizeMediaTool,
  saveAgentMedia
} from "../mediaTools";
import { buildToolSet } from "../tools";
import uploadConfig from "../../../config/upload";

const file = {
  id: "0b0e9c3a-6f2d-4a43-9d2e-1f2a3b4c5d6e",
  ext: ".pdf",
  name: "Folder dos planos",
  description: "quando pedir a tabela de preços",
  caption: "Nossos planos",
  fileName: "folder.pdf",
  mimetype: "application/pdf",
  size: 1234
};

describe("sanitizeMediaTool", () => {
  it("keeps valid files and their texts", () => {
    const tool = sanitizeMediaTool({ enabled: true, files: [{ ...file, path: "/etc/passwd" }] });
    expect(tool.enabled).toBe(true);
    expect(tool.files).toEqual([file]);
  });

  it("drops files with an unsafe id or extension and repeated names", () => {
    const tool = sanitizeMediaTool({
      enabled: true,
      files: [file, { ...file, id: "../../x" }, { ...file, id: "1f0e9c3a-6f2d-4a43-9d2e-1f2a3b4c5d6e", ext: "/../a" }, { ...file, id: "2f0e9c3a-6f2d-4a43-9d2e-1f2a3b4c5d6e" }]
    });
    expect(tool.files.map(f => f.id)).toEqual([file.id]);
  });

  it("is off without files", () => {
    expect(sanitizeMediaTool({ enabled: true, files: [] })).toEqual({ enabled: false, files: [] });
    expect(sanitizeMediaTool(undefined)).toEqual({ enabled: false, files: [] });
  });
});

describe("media paths and content", () => {
  it("builds the path inside the agent folder from the id", () => {
    expect(mediaPath(3, 5, file)).toBe(
      path.join(uploadConfig.directory, "company3", "ai-agents", "5", `${file.id}.pdf`)
    );
  });

  it("sends each kind as WhatsApp expects", () => {
    expect(kindOf("image/png")).toBe("image");
    expect(kindOf("image/gif")).toBe("document");
    expect(kindOf("video/mp4")).toBe("video");
    expect(kindOf("audio/mpeg")).toBe("audio");
    expect(kindOf("application/pdf")).toBe("document");
    expect(contentFor(file, "/x/a.pdf")).toEqual({
      type: "document",
      path: "/x/a.pdf",
      caption: "Nossos planos",
      fileName: "folder.pdf",
      mimetype: "application/pdf"
    });
    expect(contentFor({ ...file, mimetype: "image/jpeg" }, "/x/a.jpg")).toEqual({ type: "image", path: "/x/a.jpg", caption: "Nossos planos" });
  });
});

describe("saving and cleaning files", () => {
  const original = uploadConfig.directory;
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "media-"));
    (uploadConfig as any).directory = dir;
  });
  afterEach(() => {
    (uploadConfig as any).directory = original;
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("saves an upload and removes the files left out", async () => {
    const saved = await saveAgentMedia(3, 5, { originalname: "Tabela de Preços.PDF", mimetype: "application/pdf", size: 4, buffer: Buffer.from("%PDF") });
    expect(saved).toMatchObject({ name: "Tabela de Preços", ext: ".pdf", fileName: "Tabela de Preços.PDF", size: 4 });
    expect(fs.existsSync(mediaPath(3, 5, saved))).toBe(true);
    await removeOrphanMedia(3, 5, [saved], []);
    expect(fs.existsSync(mediaPath(3, 5, saved))).toBe(false);
  });
});

describe("enviar_midia", () => {
  const queues: { id: number; name: string }[] = [];
  const media = { enabled: true, files: [file, { ...file, id: "3f0e9c3a-6f2d-4a43-9d2e-1f2a3b4c5d6e", name: "Vídeo" }] };

  it("lists the files with when to send each", () => {
    const [def] = buildToolSet({ media }, { queues }).definitions;
    expect(def.name).toBe("enviar_midia");
    expect((def.parameters as any).properties.arquivo.enum).toEqual(["Folder dos planos", "Vídeo"]);
    expect(def.description).toContain("Folder dos planos: quando pedir a tabela de preços");
  });

  it("queues known files, at most three per reply", async () => {
    const sendMedia = jest.fn().mockResolvedValue({ ok: true, message: "ok" });
    const set = buildToolSet({ media }, { queues, sendMedia });
    expect((await set.execute("enviar_midia", { arquivo: "Outro" })).error).toBe(true);
    for (let i = 0; i < 3; i += 1) await set.execute("enviar_midia", { arquivo: "Vídeo" });
    expect((await set.execute("enviar_midia", { arquivo: "Vídeo" })).error).toBe(true);
    expect(sendMedia).toHaveBeenCalledTimes(3);
    expect(sendMedia.mock.calls[0][0].name).toBe("Vídeo");
  });

  it("only simulates in the test console", async () => {
    const set = buildToolSet({ media }, { queues });
    expect((await set.execute("enviar_midia", { arquivo: "Vídeo" })).result).toContain("Simulação");
  });
});
