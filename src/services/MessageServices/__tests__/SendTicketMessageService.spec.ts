import fs from "fs";
import os from "os";
import path from "path";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "send-"));
const send = jest.fn(async () => ({ externalId: "3EB0X", chatJid: "1@s.whatsapp.net", raw: {} }));
const save = jest.fn(async (args: any) => args);
const fetchMock = jest.fn();

jest.mock("../../../config/upload", () => ({ __esModule: true, default: { directory: root }, MAX_UPLOAD_BYTES: 1000 }));
jest.mock("../../../channels", () => ({
  getTicketChannel: async () => ({ send }),
  ticketAddress: () => ({ number: "5511999999999" })
}));
jest.mock("../../../helpers/mediaStorage", () => ({ publicFileUrl: (p: string) => `http://localhost:3001/public/${p}` }));
jest.mock("../SaveSentMessageService", () => ({ __esModule: true, default: (args: any) => save(args) }));
jest.mock("../../AiAgentServices/httpTools", () => ({ publicFetch: (...args: any[]) => fetchMock(...args) }));
jest.mock("../../../models/Message", () => ({}));
jest.mock("../../../models/Ticket", () => ({}));

// eslint-disable-next-line import/first
import SendTicketMessageService from "../SendTicketMessageService";

const ticket: any = { id: 1 };

beforeEach(() => {
  send.mockClear();
  save.mockClear();
  fetchMock.mockReset();
});

afterAll(() => fs.rmSync(root, { recursive: true, force: true }));

describe("SendTicketMessageService", () => {
  it("sends text and saves it with the text as body", async () => {
    await SendTicketMessageService(ticket, { type: "text", text: "Olá" }, { quotedMsgId: "q" });
    expect(send).toHaveBeenCalledWith({ number: "5511999999999" }, { type: "text", text: "Olá" }, {});
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ body: "Olá", media: undefined, quotedMsgId: "q" }));
  });

  it("reads files from our own /public instead of fetching them", async () => {
    fs.mkdirSync(path.join(root, "flow"), { recursive: true });
    fs.writeFileSync(path.join(root, "flow", "menu.pdf"), "pdf");
    await SendTicketMessageService(ticket, { type: "document", url: "http://localhost:3001/public/flow/menu.pdf" });
    expect(fetchMock).not.toHaveBeenCalled();
    const content = (send.mock.calls[0] as any)[1];
    expect(content.buffer.toString()).toBe("pdf");
    expect(content.url).toBeUndefined();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({ body: "menu.pdf", media: expect.objectContaining({ mimetype: "application/pdf", fileName: "menu.pdf" }) })
    );
  });

  it("downloads external media once and sends what it saved", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      headers: { get: (k: string) => ({ "content-type": "image/png", "content-length": "3" }[k]) },
      arrayBuffer: async () => Buffer.from("png")
    });
    await SendTicketMessageService(ticket, { type: "image", url: "https://cdn.exemplo.com/a.png", caption: "Foto" });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect((send.mock.calls[0] as any)[1].buffer.toString()).toBe("png");
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ body: "Foto", media: expect.objectContaining({ mimetype: "image/png" }) }));
  });

  it("sends the URL as is and saves without the file when it can't be fetched", async () => {
    fetchMock.mockRejectedValue(new Error("endereço interno não permitido"));
    await SendTicketMessageService(ticket, { type: "image", url: "http://10.0.0.1/a.png" });
    expect((send.mock.calls[0] as any)[1]).toEqual({ type: "image", url: "http://10.0.0.1/a.png" });
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ media: undefined }));
  });

  it("refuses files over the upload limit", async () => {
    fetchMock.mockResolvedValue({
      status: 200,
      headers: { get: (k: string) => ({ "content-length": "5000" }[k]) },
      arrayBuffer: async () => Buffer.alloc(5000)
    });
    await SendTicketMessageService(ticket, { type: "video", url: "https://cdn.exemplo.com/v.mp4" });
    expect((send.mock.calls[0] as any)[1].url).toBe("https://cdn.exemplo.com/v.mp4");
  });
});
