const save = jest.fn();
const send = jest.fn();
const sendWhatsApp = jest.fn();
const aiAgent = jest.fn(async (..._a: any[]) => false);
const runFlow = jest.fn(async (..._a: any[]) => false);
const provider = jest.fn();
const funnelRules = jest.fn();
const integration = jest.fn();
const typebot = jest.fn();
const followUpAgent = jest.fn();
const followUpCustomer = jest.fn();

const ticket: any = {
  id: 8,
  companyId: 1,
  isGroup: false,
  queueId: null,
  queue: null,
  userId: null,
  user: null,
  chatbot: false,
  useIntegration: false,
  contact: { name: "Thiago" },
  update: jest.fn(),
  reload: jest.fn()
};
// Rating pending: an old message with a number would close the ticket and
// send the completion message.
const traking: any = { ratingAt: new Date(), rated: false, update: jest.fn() };
const whatsapp: any = {
  id: 2,
  queues: [],
  greetingMessage: "Olá! Como podemos ajudar?",
  outOfHoursMessage: "Estamos fora do expediente.",
  complationMessage: "Obrigado!",
  integrationId: null,
  flowId: null
};

jest.mock("../../FollowUpServices/hooks", () => ({
  followUpOnAgentMessage: (...a: any[]) => followUpAgent(...a),
  followUpOnCustomerMessage: (...a: any[]) => followUpCustomer(...a)
}));
jest.mock("../SaveInboundMessageService", () => ({ __esModule: true, default: (...a: any[]) => save(...a) }));
jest.mock("../VerifyContactService", () => ({ __esModule: true, default: async () => ({ id: 3, name: "Thiago" }) }));
jest.mock("../../MessageServices/SendTicketMessageService", () => ({ __esModule: true, default: (...a: any[]) => send(...a) }));
jest.mock("../../WbotServices/SendWhatsAppMessage", () => ({ __esModule: true, default: (...a: any[]) => sendWhatsApp(...a) }));
jest.mock("../../AiAgentServices/RunAiAgentService", () => ({ handleAiAgentMessage: (...a: any[]) => aiAgent(...a) }));
jest.mock("../../FlowServices/RunFlowService", () => ({ __esModule: true, default: (...a: any[]) => runFlow(...a) }));
jest.mock("../../WbotServices/providers", () => ({ provider: (...a: any[]) => provider(...a) }));
jest.mock("../../CrmServices/ApplyFunnelRulesService", () => ({ __esModule: true, default: (...a: any[]) => funnelRules(...a) }));
jest.mock("../../QueueIntegrationServices/ShowQueueIntegrationService", () => ({ __esModule: true, default: (...a: any[]) => integration(...a) }));
jest.mock("../../TypebotServices/typebotListener", () => ({ __esModule: true, default: (...a: any[]) => typebot(...a) }));
jest.mock("../../WhatsappService/ShowWhatsAppService", () => ({ __esModule: true, default: async () => whatsapp }));
jest.mock("../../TicketServices/FindOrCreateTicketService", () => ({ __esModule: true, default: async () => ticket }));
jest.mock("../../TicketServices/FindOrCreateATicketTrakingService", () => ({ __esModule: true, default: async () => traking }));
jest.mock("../../TicketServices/UpdateTicketService", () => ({ __esModule: true, default: jest.fn() }));
jest.mock("../../CompanyService/VerifyCurrentSchedule", () => ({ __esModule: true, default: async () => ({ inActivity: false }) }));
jest.mock("../../../models/Setting", () => ({ __esModule: true, default: { findOne: async ({ where }: any) => (where.key === "scheduleType" ? { value: "company" } : null) } }));
jest.mock("../../../models/Message", () => ({ __esModule: true, default: { findOne: async () => null } }));
jest.mock("../../../models/UserRating", () => ({ __esModule: true, default: { create: jest.fn() } }));
jest.mock("../../../libs/cache", () => ({ cacheLayer: { get: async () => "0", set: async () => undefined } }));
jest.mock("../../../libs/socket", () => ({ getIO: () => ({ to: () => ({ emit: jest.fn(), to: () => ({ emit: jest.fn() }) }) }) }));
jest.mock("../../../helpers/Debounce", () => ({ debounce: (fn: () => unknown) => fn }));
["Contact", "Queue", "QueueIntegrations", "Ticket", "TicketTraking"].forEach(m => jest.mock(`../../../models/${m}`, () => ({})));

// eslint-disable-next-line import/first
import ProcessInboundMessage from "../ProcessInboundMessage";

const inbound = (over: any = {}): any => ({
  connectionId: 2,
  companyId: 1,
  externalId: "A1",
  fromMe: false,
  timestamp: 1700000000000,
  chat: { jid: "5531991147761@s.whatsapp.net", isGroup: false },
  sender: { jid: "5531991147761@s.whatsapp.net" },
  kind: "text",
  channelType: "conversation",
  text: "5",
  hasMedia: false,
  mentions: [],
  raw: {},
  ...over
});

beforeEach(() => jest.clearAllMocks());

describe("ProcessInboundMessage", () => {
  it("answers a live message (out of hours here)", async () => {
    traking.ratingAt = null;
    await ProcessInboundMessage(inbound({ text: "Oi" }));
    expect(save).toHaveBeenCalled();
    expect(send).toHaveBeenCalled();
    traking.ratingAt = new Date();
  });

  it("only saves a message imported from the history: nothing is sent", async () => {
    await ProcessInboundMessage(inbound({ history: true }));

    expect(save).toHaveBeenCalledTimes(1);
    expect(send).not.toHaveBeenCalled();
    expect(sendWhatsApp).not.toHaveBeenCalled();
    expect(aiAgent).not.toHaveBeenCalled();
    expect(runFlow).not.toHaveBeenCalled();
    expect(provider).not.toHaveBeenCalled();
    expect(funnelRules).not.toHaveBeenCalled();
    expect(integration).not.toHaveBeenCalled();
    expect(typebot).not.toHaveBeenCalled();
  });

  describe("follow-up", () => {
    it("a customer message stops the follow-up", async () => {
      await ProcessInboundMessage(inbound({ fromMe: false }));

      expect(followUpCustomer).toHaveBeenCalledWith(expect.objectContaining({ id: 8, companyId: 1 }));
      expect(followUpAgent).not.toHaveBeenCalled();
    });

    it("a message typed on the phone starts the follow-up", async () => {
      await ProcessInboundMessage(inbound({ fromMe: true }));

      expect(followUpAgent).toHaveBeenCalledWith(ticket);
      expect(followUpCustomer).not.toHaveBeenCalled();
    });

    it("history imports and groups never touch the follow-up", async () => {
      await ProcessInboundMessage(inbound({ history: true }));
      await ProcessInboundMessage(inbound({ chat: { jid: "120363@g.us", isGroup: true } }));
      await ProcessInboundMessage(inbound({ fromMe: true, chat: { jid: "120363@g.us", isGroup: true } }));

      expect(save).toHaveBeenCalledTimes(3);
      expect(followUpAgent).not.toHaveBeenCalled();
      expect(followUpCustomer).not.toHaveBeenCalled();
    });
  });
});
