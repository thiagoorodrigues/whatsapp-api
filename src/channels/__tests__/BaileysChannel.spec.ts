let socket: any;
jest.mock("../../libs/wbot", () => ({
  getWbot: (id: number) => {
    if (!socket || id !== 7) throw new Error("ERR_WAPP_NOT_INITIALIZED");
    return socket;
  }
}));

// eslint-disable-next-line import/first
import BaileysChannel, { jidOf, toBaileysContent } from "../baileys/BaileysChannel";
// eslint-disable-next-line import/first
import { contentFromFile, contentFromUpload } from "../media";
// eslint-disable-next-line import/first
import { newMessageId, wasSentByPlatform } from "../baileys/sentByPlatform";

const sent = { key: { id: "WA_SENT", fromMe: true, remoteJid: "5511999999999@s.whatsapp.net" } };

beforeEach(() => {
  socket = {
    user: { id: "5511888888888:3@s.whatsapp.net" },
    sendMessage: jest.fn().mockResolvedValue(sent),
    chatModify: jest.fn(),
    readMessages: jest.fn(),
    sendPresenceUpdate: jest.fn(),
    onWhatsApp: jest.fn(),
    profilePictureUrl: jest.fn(),
    groupFetchAllParticipating: jest.fn().mockResolvedValue({ "5511999999999-1611111111@g.us": {}, "120363222@g.us": {} })
  };
});

describe("addresses", () => {
  it("prefers the LID, then the phone, and keeps groups", () => {
    expect(jidOf({ number: "5511999999999" })).toBe("5511999999999@s.whatsapp.net");
    expect(jidOf({ number: "5511999999999", lid: "123@lid" })).toBe("123@lid");
    expect(jidOf({ number: "120363222", isGroup: true })).toBe("120363222@g.us");
    expect(jidOf({ jid: "x@s.whatsapp.net", number: "1" })).toBe("x@s.whatsapp.net");
  });
});

describe("toBaileysContent", () => {
  it("maps each content type", () => {
    const buffer = Buffer.from("x");
    expect(toBaileysContent({ type: "text", text: "oi" })).toEqual({ text: "oi" });
    expect(toBaileysContent({ type: "image", buffer, caption: "c" })).toEqual({ image: buffer, caption: "c" });
    expect(toBaileysContent({ type: "audio", url: "https://a/b.mp3" })).toEqual({
      audio: { url: "https://a/b.mp3" },
      mimetype: "audio/mp4",
      ptt: true
    });
    expect(toBaileysContent({ type: "document", buffer, fileName: "a.pdf", mimetype: "application/pdf" })).toEqual({
      document: buffer,
      caption: undefined,
      fileName: "a.pdf",
      mimetype: "application/pdf"
    });
  });
});

describe("BaileysChannel", () => {
  it("fails like getWbot when the connection has no session", () => {
    expect(() => new BaileysChannel(99)).toThrow("ERR_WAPP_NOT_INITIALIZED");
  });

  it("reports readiness", () => {
    const channel = new BaileysChannel(7);
    expect(channel.isReady()).toBe(true);
    socket.user = undefined;
    expect(channel.isReady()).toBe(false);
  });

  it("uses the current socket after a reconnect", async () => {
    const channel = new BaileysChannel(7);
    const replaced = { ...socket, sendMessage: jest.fn().mockResolvedValue(sent) };
    socket = replaced;
    await channel.send({ number: "5511999999999" }, { type: "text", text: "oi" });
    expect(replaced.sendMessage).toHaveBeenCalled();
  });

  it("sends text quoting the stored message", async () => {
    const quotedRaw = { key: { id: "WA_Q", fromMe: false, remoteJid: "5511999999999@s.whatsapp.net" }, message: { conversation: "antes" } };
    const result = await new BaileysChannel(7).send(
      { number: "5511999999999" },
      { type: "text", text: "oi" },
      { quoted: { externalId: "WA_Q", raw: JSON.stringify(quotedRaw) } }
    );
    expect(socket.sendMessage).toHaveBeenCalledWith(
      "5511999999999@s.whatsapp.net",
      { text: "oi" },
      { messageId: expect.stringMatching(/^3EB0[0-9A-F]{18}$/), quoted: quotedRaw }
    );
    expect(result).toEqual({ externalId: "WA_SENT", chatJid: "5511999999999@s.whatsapp.net", raw: sent });
  });

  it("marks what it sends so the echo is skipped, except when asked", async () => {
    socket.sendMessage.mockImplementation(async (jid: string, content: any, options: any) => ({
      key: { id: options.messageId, fromMe: true, remoteJid: jid }
    }));
    const channel = new BaileysChannel(7);
    const own = await channel.send({ number: "5511999999999" }, { type: "text", text: "oi" });
    expect(wasSentByPlatform(own.externalId)).toBe(true);
    const campaign = await channel.send({ number: "5511999999999" }, { type: "text", text: "oi" }, { processEcho: true });
    expect(wasSentByPlatform(campaign.externalId)).toBe(false);
    expect(wasSentByPlatform("3EB0TYPEDONTHEPHONE")).toBe(false);
    expect(newMessageId()).not.toBe(newMessageId());
  });

  it("sends to current group ids as stored", async () => {
    await new BaileysChannel(7).send({ number: "120363222", isGroup: true }, { type: "text", text: "oi" });
    expect(socket.sendMessage.mock.calls[0][0]).toBe("120363222@g.us");
    expect(socket.groupFetchAllParticipating).not.toHaveBeenCalled();
  });

  it("resolves old group ids stored without the dash", async () => {
    await new BaileysChannel(7).send({ number: "55119999999991611111111", isGroup: true }, { type: "text", text: "oi" });
    expect(socket.sendMessage.mock.calls[0][0]).toBe("5511999999999-1611111111@g.us");
    await expect(
      new BaileysChannel(7).send({ number: "999", isGroup: true }, { type: "text", text: "oi" })
    ).rejects.toThrow("Group not found");
  });

  it("deletes a message in its original chat", async () => {
    await new BaileysChannel(7).deleteMessage(
      { number: "5511999999999" },
      { externalId: "WA1", chatJid: "123@lid", fromMe: true, participant: null }
    );
    expect(socket.sendMessage).toHaveBeenCalledWith("123@lid", {
      delete: { id: "WA1", remoteJid: "123@lid", participant: undefined, fromMe: true }
    });
  });

  it("sends read receipts for received messages only", async () => {
    const channel = new BaileysChannel(7);
    const raw = { key: { id: "WA1", fromMe: false, remoteJid: "123@lid" } };
    await channel.markRead({ number: "5511999999999" }, [
      { externalId: "WA1", raw: JSON.stringify(raw) },
      { externalId: "WA2", chatJid: "5511999999999@s.whatsapp.net", fromMe: false },
      { externalId: "WA3", fromMe: true }
    ]);
    expect(socket.readMessages).toHaveBeenCalledWith([
      { remoteJid: "123@lid", id: "WA1", participant: undefined, fromMe: false },
      { remoteJid: "5511999999999@s.whatsapp.net", id: "WA2", participant: undefined, fromMe: false }
    ]);
    expect(socket.chatModify).not.toHaveBeenCalled();
    socket.readMessages.mockClear();
    await channel.markRead({ number: "1" }, []);
    expect(socket.readMessages).not.toHaveBeenCalled();
  });

  it("checks numbers and presence with the account's own id", async () => {
    const channel = new BaileysChannel(7);
    socket.onWhatsApp.mockResolvedValue([{ exists: true, jid: "5511999999999@s.whatsapp.net" }]);
    expect(await channel.checkNumber("(11) 99999-9999")).toEqual({ exists: true, jid: "5511999999999@s.whatsapp.net" });
    expect(socket.onWhatsApp).toHaveBeenCalledWith("11999999999@s.whatsapp.net");
    socket.onWhatsApp.mockResolvedValue([]);
    expect(await channel.checkNumber("1")).toEqual({ exists: false });
    await channel.setPresence("available");
    expect(socket.sendPresenceUpdate).toHaveBeenCalledWith("available", "5511888888888:3@s.whatsapp.net");
  });

  it("returns null when there is no profile picture", async () => {
    socket.profilePictureUrl.mockRejectedValue(new Error("item-not-found"));
    expect(await new BaileysChannel(7).profilePictureUrl({ number: "1" })).toBeNull();
  });
});

describe("media content", () => {
  it("builds content from files like the old getMessageOptions", () => {
    expect(contentFromFile("v.mp4", "/tmp/v.mp4", "oi")).toEqual({ type: "video", path: "/tmp/v.mp4", caption: "oi", fileName: "v.mp4" });
    expect(contentFromFile("a.ogg", "/tmp/a.ogg")).toEqual({ type: "audio", path: "/tmp/a.ogg", mimetype: "audio/mp4", voice: true });
    expect(contentFromFile("d.pdf", "/tmp/d.pdf", "")).toEqual({
      type: "document",
      path: "/tmp/d.pdf",
      caption: undefined,
      fileName: "d.pdf",
      mimetype: "application/pdf"
    });
    expect(contentFromFile("i.png", "/tmp/i.png", "c")).toEqual({ type: "image", path: "/tmp/i.png", caption: "c" });
    expect(() => contentFromFile("x", "/tmp/sem-extensao")).toThrow("Invalid mimetype");
  });

  it("builds content from uploads", () => {
    const buffer = Buffer.from("x");
    expect(contentFromUpload({ buffer, mimetype: "text/plain", originalname: "a.txt" }, "c")).toEqual({
      type: "document",
      buffer,
      caption: "c",
      fileName: "a.txt",
      mimetype: "text/plain"
    });
  });
});
