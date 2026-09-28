const upsertContact = jest.fn();
const findTicket = jest.fn();
const createTicket = jest.fn();
const saveSent = jest.fn();
const readFile = jest.fn();

jest.mock("../../ContactServices/CreateOrUpdateContactService", () => ({ __esModule: true, default: (a: any) => upsertContact(a) }));
jest.mock("../../../models/Ticket", () => ({
  __esModule: true,
  default: { findOne: (...a: any[]) => findTicket(...a), create: (...a: any[]) => createTicket(...a) }
}));
jest.mock("../../MessageServices/SaveSentMessageService", () => ({ __esModule: true, default: (a: any) => saveSent(a) }));
jest.mock("fs", () => ({ promises: { readFile: (...a: any[]) => readFile(...a) } }));

// eslint-disable-next-line import/first
import SaveCampaignMessageService, { campaignText } from "../SaveCampaignMessageService";

const sent = { externalId: "WA1", chatJid: "5511999999999@s.whatsapp.net", raw: {} };
const base = { companyId: 1, whatsappId: 3, number: "5511999999999", name: "Maria", sent, body: "Promoção!" };

beforeEach(() => {
  upsertContact.mockReset().mockResolvedValue({ id: 50 });
  findTicket.mockReset().mockResolvedValue(null);
  createTicket.mockReset().mockImplementation(async (v: any) => ({ id: 70, ...v }));
  saveSent.mockReset();
  readFile.mockReset();
});

describe("SaveCampaignMessageService", () => {
  it("creates the contact and a closed ticket for a contact without one", async () => {
    await SaveCampaignMessageService(base);
    expect(upsertContact).toHaveBeenCalledWith({ name: "Maria", number: "5511999999999", isGroup: false, companyId: 1, whatsappId: 3 });
    expect(createTicket).toHaveBeenCalledWith(expect.objectContaining({ contactId: 50, status: "closed", whatsappId: 3, companyId: 1, isGroup: false }));
    expect(saveSent).toHaveBeenCalledWith({ ticket: expect.objectContaining({ id: 70 }), sent, body: "Promoção!" });
  });

  it("keeps an open or pending ticket as it is", async () => {
    const open = { id: 8, status: "open" };
    findTicket.mockResolvedValueOnce(open);
    await SaveCampaignMessageService(base);
    expect(findTicket.mock.calls[0][0].where).toEqual(expect.objectContaining({ contactId: 50, companyId: 1, whatsappId: 3 }));
    expect(createTicket).not.toHaveBeenCalled();
    expect(saveSent).toHaveBeenCalledWith(expect.objectContaining({ ticket: open }));
  });

  it("uses the latest closed ticket when there is no active one", async () => {
    const closed = { id: 9, status: "closed" };
    findTicket.mockResolvedValueOnce(null).mockResolvedValueOnce(closed);
    await SaveCampaignMessageService(base);
    expect(createTicket).not.toHaveBeenCalled();
    expect(saveSent).toHaveBeenCalledWith(expect.objectContaining({ ticket: closed }));
  });

  it("stores the campaign media", async () => {
    readFile.mockResolvedValue(Buffer.from("img"));
    await SaveCampaignMessageService({ ...base, media: { path: "/public/promo.jpg", fileName: "promo.jpg", mimetype: "image/jpeg" } });
    expect(readFile).toHaveBeenCalledWith("/public/promo.jpg");
    expect(saveSent).toHaveBeenCalledWith(
      expect.objectContaining({ media: { buffer: Buffer.from("img"), fileName: "promo.jpg", mimetype: "image/jpeg" } })
    );
  });
});

describe("campaignText", () => {
  it("drops the U+200C marker of shippings prepared before", () => {
    expect(campaignText("\u200c Promoção!")).toBe("Promoção!");
    expect(campaignText("\u200cPromoção!")).toBe("Promoção!");
    expect(campaignText("Promoção!")).toBe("Promoção!");
    expect(campaignText(null)).toBe("");
  });
});
