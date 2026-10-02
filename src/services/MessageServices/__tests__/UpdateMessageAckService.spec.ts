const findOne = jest.fn();
const emit = jest.fn();

jest.mock("../../../models/Message", () => ({ __esModule: true, default: { findOne: (...a: any[]) => findOne(...a) } }));
jest.mock("../../../libs/socket", () => ({ getIO: () => ({ to: () => ({ emit }) }) }));

// eslint-disable-next-line import/first
import UpdateMessageAckService from "../UpdateMessageAckService";

describe("UpdateMessageAckService", () => {
  it("updates the copy of the message on the connection that got the status", async () => {
    const message = { ticketId: 8, companyId: 2, update: jest.fn() };
    findOne.mockResolvedValue(message);
    await UpdateMessageAckService("3EB0AA", 3, 4);
    expect(findOne.mock.calls[0][0].where).toEqual({ messagesWhatsappsId: "3EB0AA", whatsappId: 4 });
    expect(message.update).toHaveBeenCalledWith({ ack: 3 });
  });
});
