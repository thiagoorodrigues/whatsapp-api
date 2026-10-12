import fs from "fs";
import os from "os";
import path from "path";

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "qm-"));
jest.mock("../../../config/upload", () => ({ __esModule: true, default: { directory: tmp } }));
jest.mock("../../../models/QuickMessage", () => ({ __esModule: true, default: { findOne: jest.fn() } }));

// eslint-disable-next-line import/first
import QuickMessage from "../../../models/QuickMessage";
// eslint-disable-next-line import/first
import { findCompanyQuickMessage, removeQuickMessageMedia, saveQuickMessageMedia } from "../MediaService";

const record = (values: Record<string, any>) => {
  const data = { ...values };
  return {
    companyId: data.companyId,
    getDataValue: (k: string) => data[k],
    update: jest.fn(async (v: Record<string, any>) => Object.assign(data, v)),
    data
  } as any;
};

const file = (name: string, size = 3) => ({ buffer: Buffer.alloc(size, 1), originalname: name, mimetype: "image/png", size });

afterAll(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("quick message media", () => {
  it("only finds a quick message of the user's company", async () => {
    (QuickMessage.findOne as jest.Mock).mockResolvedValueOnce(null);
    await expect(findCompanyQuickMessage(5, 2)).rejects.toMatchObject({ message: "ERR_NO_QUICKMESSAGE_FOUND", statusCode: 404 });
    expect(QuickMessage.findOne).toHaveBeenCalledWith({ where: { id: 5, companyId: 2 } });
  });

  it("saves in the company folder with a random name and replaces the old file", async () => {
    const r = record({ companyId: 3, mediaPath: null });
    await saveQuickMessageMedia(r, file("cardápio da semana.png"));
    const first = r.data.mediaPath;
    expect(first).toMatch(/^company3\/\d+_[0-9a-f]{12}_cardapio_da_semana\.png$/);
    expect(r.data.mediaName).toBe("cardápio da semana.png");
    expect(fs.existsSync(path.join(tmp, "quickMessage", first))).toBe(true);

    await saveQuickMessageMedia(r, file("outra.png"));
    expect(fs.existsSync(path.join(tmp, "quickMessage", first))).toBe(false);
    expect(fs.existsSync(path.join(tmp, "quickMessage", r.data.mediaPath))).toBe(true);
  });

  it("refuses files over 16 MB", async () => {
    const r = record({ companyId: 3 });
    await expect(saveQuickMessageMedia(r, { ...file("x.png"), size: 17 * 1024 * 1024 })).rejects.toMatchObject({
      message: "ERR_QUICKMESSAGE_MEDIA_TOO_BIG"
    });
  });

  it("never deletes a file outside the quick message folder", async () => {
    const outside = path.join(tmp, "segredo.txt");
    fs.writeFileSync(outside, "x");
    const r = record({ companyId: 3, mediaPath: "../segredo.txt" });
    await removeQuickMessageMedia(r);
    expect(fs.existsSync(outside)).toBe(true);
    expect(r.data.mediaPath).toBeNull();
  });
});
