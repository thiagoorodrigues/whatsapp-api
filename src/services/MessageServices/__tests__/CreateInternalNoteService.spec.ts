const create = jest.fn(async ({ messageData }: any) => ({ ...messageData }));

jest.mock("../CreateMessageService", () => ({ __esModule: true, default: (args: any) => create(args) }));
jest.mock("uuid", () => ({ v4: () => "uuid-note" }));

// eslint-disable-next-line import/first
import CreateInternalNoteService from "../CreateInternalNoteService";

const ticket: any = { id: 7, contactId: 3, companyId: 1 };

beforeEach(() => create.mockClear());

describe("CreateInternalNoteService", () => {
  it("saves a private note by the user, with no WhatsApp id", async () => {
    await CreateInternalNoteService({ ticket, body: "  cliente pediu retorno amanhã ", userId: 5 });
    expect(create).toHaveBeenCalledWith({
      companyId: 1,
      messageData: {
        id: "uuid-note",
        ticketId: 7,
        contactId: 3,
        body: "cliente pediu retorno amanhã",
        fromMe: true,
        read: true,
        ack: 0,
        mediaType: "internalNote",
        isPrivate: true,
        userId: 5
      }
    });
  });

  it("refuses an empty note", async () => {
    await expect(CreateInternalNoteService({ ticket, body: "   ", userId: 5 })).rejects.toThrow("ERR_INTERNAL_NOTE_EMPTY");
    expect(create).not.toHaveBeenCalled();
  });
});
