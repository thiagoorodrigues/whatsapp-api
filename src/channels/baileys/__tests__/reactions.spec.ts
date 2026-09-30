// Baileys is ESM; unwrapping as its normalizeMessageContent does.
jest.mock("@whiskeysockets/baileys", () => ({
  normalizeMessageContent: (m: any) => {
    let content = m;
    for (let i = 0; i < 5 && content; i++) {
      const inner = content.ephemeralMessage || content.viewOnceMessage || content.viewOnceMessageV2 || content.editedMessage;
      if (!inner) break;
      content = inner.message;
    }
    return content;
  },
  WAMessageStubType: { REVOKE: 1, E2E_DEVICE_CHANGED: 2, E2E_IDENTITY_CHANGED: 3, CIPHERTEXT: 4 }
}));

// eslint-disable-next-line import/first
import { filterMessages, isReaction } from "../parse";

const key = { id: "R1", remoteJid: "5511999999999@s.whatsapp.net", fromMe: false };
const reactionMessage = { key: { id: "M1", remoteJid: key.remoteJid, fromMe: true }, text: "👍" };

describe("reactions", () => {
  it("drops a reaction", () => {
    const msg: any = { key, message: { reactionMessage } };
    expect(isReaction(msg)).toBe(true);
    expect(filterMessages(msg)).toBe(false);
  });

  it("drops a reaction in a chat with disappearing messages", () => {
    const msg: any = { key, message: { ephemeralMessage: { message: { reactionMessage } } } };
    expect(isReaction(msg)).toBe(true);
    expect(filterMessages(msg)).toBe(false);
  });

  it("keeps a text message", () => {
    const msg: any = { key, message: { conversation: "oi" } };
    expect(isReaction(msg)).toBe(false);
    expect(filterMessages(msg)).toBe(true);
  });
});
