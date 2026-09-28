const findContacts = jest.fn();
const findSynced = jest.fn();
const findConnections = jest.fn();

jest.mock("../../../models/Contact", () => ({ __esModule: true, default: { findAll: (...a: any[]) => findContacts(...a) } }));
jest.mock("../../../models/WhatsappContact", () => ({ __esModule: true, default: { findAll: (...a: any[]) => findSynced(...a) } }));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: { findAll: (...a: any[]) => findConnections(...a) } }));
jest.mock("../../../models/Message", () => ({}));

// eslint-disable-next-line import/first
import ResolveMentionsService from "../ResolveMentionsService";

const msg = (mentioned: string[]): any => ({
  dataJson: JSON.stringify({
    key: { id: "X" },
    message: { extendedTextMessage: { text: "oi", contextInfo: { mentionedJid: mentioned } } }
  })
});

beforeEach(() => {
  findContacts.mockReset().mockResolvedValue([]);
  findSynced.mockReset().mockResolvedValue([]);
  findConnections.mockReset().mockResolvedValue([]);
});

describe("ResolveMentionsService", () => {
  it("uses the platform contact found by phone or by LID", async () => {
    findContacts.mockResolvedValue([
      { name: "Maria", number: "5511999999999", lid: null },
      { name: "João", number: "5521988887777", lid: "222@lid" }
    ]);
    const m = msg(["5511999999999@s.whatsapp.net", "222@lid"]);
    await ResolveMentionsService([m], 1);
    expect(m.mentions).toEqual([
      { token: "5511999999999", name: "Maria", phone: "5511999999999" },
      { token: "222", name: "João", phone: "5521988887777" }
    ]);
  });

  it("falls back to WhatsApp names when the contact is named after its number", async () => {
    findContacts.mockResolvedValue([{ name: "5511999999999", number: "5511999999999", lid: null }]);
    findSynced.mockResolvedValue([{ jid: "5511999999999@s.whatsapp.net", lid: null, number: "5511999999999", name: null, verifiedName: null, notify: "Mari" }]);
    const m = msg(["5511999999999@s.whatsapp.net"]);
    await ResolveMentionsService([m], 1);
    expect(m.mentions).toEqual([{ token: "5511999999999", name: "Mari", phone: "5511999999999" }]);
  });

  it("prefers the address book name over the profile name", async () => {
    findSynced.mockResolvedValue([{ jid: "9@lid", lid: "9@lid", number: "5531900000000", name: "Ana Agenda", verifiedName: null, notify: "Aninha" }]);
    const m = msg(["9@lid"]);
    await ResolveMentionsService([m], 1);
    expect(m.mentions).toEqual([{ token: "9", name: "Ana Agenda", phone: "5531900000000" }]);
  });

  it("merges every WhatsApp row of a LID mention (address book row wins over the thin LID row)", async () => {
    findSynced.mockResolvedValue([
      { jid: "9@lid", lid: "9@lid", number: null, name: null, verifiedName: null, notify: "Aninha" },
      { jid: "5531900000000@s.whatsapp.net", lid: "9@lid", number: "5531900000000", name: "Ana Agenda", verifiedName: null, notify: null }
    ]);
    const m = msg(["9@lid"]);
    await ResolveMentionsService([m], 1);
    expect(m.mentions).toEqual([{ token: "9", name: "Ana Agenda", phone: "5531900000000" }]);
  });

  it("names the connected account itself", async () => {
    findConnections.mockResolvedValue([{ name: "Loja", number: "5511888888888" }]);
    const m = msg(["5511888888888@s.whatsapp.net"]);
    await ResolveMentionsService([m], 1);
    expect(m.mentions).toEqual([{ token: "5511888888888", name: "Loja", phone: "5511888888888" }]);
  });

  it("keeps only the token when nothing is known", async () => {
    const m = msg(["777@lid"]);
    await ResolveMentionsService([m], 1);
    expect(m.mentions).toEqual([{ token: "777", name: null, phone: null }]);
  });

  it("queries once for the whole page and skips messages without mentions", async () => {
    const a = msg(["1@lid"]);
    const b = msg(["2@lid"]);
    const c: any = { dataJson: null };
    const d: any = { dataJson: "not json" };
    await ResolveMentionsService([a, b, c, d], 1);
    expect(findContacts).toHaveBeenCalledTimes(1);
    expect(findSynced).toHaveBeenCalledTimes(1);
    expect(c.mentions).toEqual([]);
    expect(d.mentions).toEqual([]);
  });

  it("does not query when no message has mentions", async () => {
    const m: any = { dataJson: JSON.stringify({ message: { conversation: "oi" } }) };
    await ResolveMentionsService([m], 1);
    expect(findContacts).not.toHaveBeenCalled();
    expect(m.mentions).toEqual([]);
  });

  it("never throws: a failed lookup leaves the mentions unnamed", async () => {
    findContacts.mockRejectedValue(new Error("db down"));
    const m = msg(["1@lid"]);
    await expect(ResolveMentionsService([m], 1)).resolves.toBeUndefined();
    expect(m.mentions).toEqual([{ token: "1", name: null, phone: null }]);
  });
});
