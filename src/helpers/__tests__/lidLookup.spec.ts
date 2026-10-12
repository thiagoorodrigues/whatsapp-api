const contactFindOne = jest.fn();
const messageFindOne = jest.fn();
jest.mock("../../models/Contact", () => ({ __esModule: true, default: { findOne: (...a: any[]) => contactFindOne(...a) } }));
jest.mock("../../models/Message", () => ({ __esModule: true, default: { findOne: (...a: any[]) => messageFindOne(...a) } }));

// eslint-disable-next-line import/first
import { lookupPhoneJidByLid } from "../lidLookup";

beforeEach(() => {
  contactFindOne.mockReset();
  messageFindOne.mockReset();
});

describe("lookupPhoneJidByLid", () => {
  it("usa o contato que guardou o LID", async () => {
    contactFindOne.mockResolvedValue({ number: "5511999999999" });
    expect(await lookupPhoneJidByLid("1@lid", 2)).toBe("5511999999999@s.whatsapp.net");
    expect(contactFindOne.mock.calls[0][0].where).toEqual({ lid: "1@lid", companyId: 2 });
    expect(messageFindOne).not.toHaveBeenCalled();
  });

  it("cai para uma mensagem recebida antes desse LID", async () => {
    contactFindOne.mockResolvedValue(null);
    messageFindOne.mockResolvedValue({ contact: { number: "5511888888888" } });
    expect(await lookupPhoneJidByLid("1@lid")).toBe("5511888888888@s.whatsapp.net");
  });

  it("devolve undefined quando não conhece o LID", async () => {
    contactFindOne.mockResolvedValue(null);
    messageFindOne.mockResolvedValue(null);
    expect(await lookupPhoneJidByLid("1@lid")).toBeUndefined();
  });
});
