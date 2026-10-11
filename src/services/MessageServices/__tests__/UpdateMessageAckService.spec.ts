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

  it("never goes back: a late 'sender' receipt (2) does not undo read (4)", async () => {
    emit.mockClear();
    const message = { ack: 4, ticketId: 8, companyId: 2, update: jest.fn() };
    findOne.mockResolvedValue(message);
    await UpdateMessageAckService("3EB0BB", 2, 4);
    expect(message.update).not.toHaveBeenCalled();
    expect(emit).not.toHaveBeenCalled();
  });

  it("moves forward from delivered to read", async () => {
    const message = { ack: 3, ticketId: 8, companyId: 2, update: jest.fn() };
    findOne.mockResolvedValue(message);
    await UpdateMessageAckService("3EB0CC", 4, 4);
    expect(message.update).toHaveBeenCalledWith({ ack: 4 });
  });
});
