import axios from "axios";
import { deliverWebhook, isWebhook, shouldDeliver, webhookOptionsFrom } from "../webhook";
import QueueIntegrations from "../../../models/QueueIntegrations";
import { encryptSecret, decryptSecret } from "../../../helpers/secretBox";

jest.mock("axios");
jest.mock("../../../helpers/secretBox", () => ({
  encryptSecret: jest.fn((plain: string) => `enc:${plain}`),
  decryptSecret: jest.fn((payload: string) => payload.replace(/^enc:/, "")),
  secretHint: jest.fn((plain: string) => `…${plain.slice(-4)}`)
}));

const base = {
  type: "webhook",
  webhookActive: true,
  webhookOnPending: true,
  webhookOnOpen: false,
  webhookSendBotMessages: false
} as any;

afterEach(() => jest.clearAllMocks());

describe("shouldDeliver", () => {
  it("follows the ticket status options", () => {
    expect(shouldDeliver(base, { status: "pending" } as any, false)).toBe(true);
    expect(shouldDeliver(base, { status: "open" } as any, false)).toBe(false);
    expect(shouldDeliver({ ...base, webhookOnOpen: true }, { status: "open" } as any, false)).toBe(true);
    expect(shouldDeliver({ ...base, webhookOnPending: false }, { status: "pending" } as any, false)).toBe(false);
    expect(shouldDeliver(base, { status: "closed" } as any, false)).toBe(false);
  });

  it("sends our own messages only when asked", () => {
    expect(shouldDeliver(base, { status: "pending" } as any, true)).toBe(false);
    expect(shouldDeliver({ ...base, webhookSendBotMessages: true }, { status: "pending" } as any, true)).toBe(true);
  });

  it("does nothing when off or not a webhook", () => {
    expect(shouldDeliver({ ...base, webhookActive: false }, { status: "pending" } as any, false)).toBe(false);
    expect(shouldDeliver({ ...base, type: "typebot" }, { status: "pending" } as any, false)).toBe(false);
    expect(isWebhook({ type: "n8n" } as any)).toBe(true);
  });
});

describe("webhookOptionsFrom", () => {
  it("keeps booleans and encrypts the token", () => {
    expect(webhookOptionsFrom({ webhookOnOpen: true, webhookSendTags: "yes", webhookToken: " abc123 " })).toEqual({
      webhookOnOpen: true,
      webhookToken: "enc:abc123"
    });
    expect(encryptSecret).toHaveBeenCalledWith("abc123");
  });

  it("removes the token when empty and keeps it when absent", () => {
    expect(webhookOptionsFrom({ webhookToken: "" })).toEqual({ webhookToken: null });
    expect(webhookOptionsFrom({ name: "x" })).toEqual({});
  });
});

describe("deliverWebhook", () => {
  const inbound = { fromMe: false, raw: { key: { id: "M1" } }, chat: {}, sender: {} } as any;
  const ticket = { id: 9, uuid: "u-9", status: "pending", queueId: null } as any;

  it("posts with the Bearer token and the ticket", async () => {
    jest.spyOn(QueueIntegrations, "unscoped").mockReturnValue({ findByPk: jest.fn().mockResolvedValue({ webhookToken: "enc:segredo" }) } as any);
    (axios.post as jest.Mock).mockResolvedValue({ status: 200 });

    await deliverWebhook({ ...base, id: 1, urlN8N: "https://example.com/hook" } as any, inbound, ticket);

    const [url, payload, options] = (axios.post as jest.Mock).mock.calls[0];
    expect(url).toBe("https://example.com/hook");
    expect(payload.ticket).toEqual({ id: 9, uuid: "u-9", status: "pending", fromMe: false });
    expect(payload.key).toEqual({ id: "M1" });
    expect(options.headers.Authorization).toBe("Bearer segredo");
    expect(options.timeout).toBe(10000);
    expect(decryptSecret).toHaveBeenCalled();
  });

  it("does not throw when the URL fails", async () => {
    jest.spyOn(QueueIntegrations, "unscoped").mockReturnValue({ findByPk: jest.fn().mockResolvedValue(null) } as any);
    (axios.post as jest.Mock).mockRejectedValue(new Error("ECONNREFUSED"));

    await expect(
      deliverWebhook({ ...base, id: 1, urlN8N: "https://down.example.com" } as any, inbound, ticket)
    ).resolves.toBeUndefined();
  });

  it("skips filtered messages without calling the URL", async () => {
    await deliverWebhook({ ...base, id: 1, urlN8N: "https://example.com/hook" } as any, inbound, { ...ticket, status: "open" });
    expect(axios.post).not.toHaveBeenCalled();
  });
});
