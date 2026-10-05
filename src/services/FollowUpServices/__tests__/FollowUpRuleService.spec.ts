const transaction = { id: "t" };
jest.mock("../../../database", () => ({ __esModule: true, default: { transaction: (fn: any) => fn(transaction), query: jest.fn() } }));
jest.mock("../../../models/FollowUpRule", () => ({ __esModule: true, default: { findAll: jest.fn(), findOne: jest.fn(), create: jest.fn() } }));
jest.mock("../../../models/FollowUpStep", () => ({ __esModule: true, default: { bulkCreate: jest.fn(), destroy: jest.fn() } }));
jest.mock("../../../models/FollowUpEnrollment", () => ({ __esModule: true, default: {} }));
jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/Queue", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/Tag", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../models/AiAgent", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../../helpers/mediaStorage", () => ({ saveCompanyMedia: jest.fn(async () => "company4/123_ab_foto.jpg") }));

// eslint-disable-next-line import/first
import FollowUpRule from "../../../models/FollowUpRule";
// eslint-disable-next-line import/first
import FollowUpStep from "../../../models/FollowUpStep";
// eslint-disable-next-line import/first
import Whatsapp from "../../../models/Whatsapp";
// eslint-disable-next-line import/first
import Queue from "../../../models/Queue";
// eslint-disable-next-line import/first
import Tag from "../../../models/Tag";
// eslint-disable-next-line import/first
import AiAgent from "../../../models/AiAgent";
// eslint-disable-next-line import/first
import { createRule, updateRule, saveStepMedia } from "../FollowUpRuleService";

const step = (over: any = {}) => ({ delayMinutes: 60, mode: "text", body: "Oi {{firstName}}", ...over });
const saved = { id: 10, update: jest.fn(), reload: jest.fn() };

beforeEach(() => {
  jest.clearAllMocks();
  (Whatsapp.findOne as jest.Mock).mockResolvedValue({ id: 2 });
  (Queue.findOne as jest.Mock).mockResolvedValue({ id: 3 });
  (Tag.findOne as jest.Mock).mockResolvedValue({ id: 12 });
  (AiAgent.findOne as jest.Mock).mockResolvedValue({ id: 5 });
  (FollowUpRule.create as jest.Mock).mockResolvedValue(saved);
  (FollowUpRule.findOne as jest.Mock).mockResolvedValue(saved);
});

describe("createRule", () => {
  it("saves the rule and its steps in order, in one transaction", async () => {
    await createRule(4, {
      name: " Orçamento ", whatsappId: 2, queueId: "" as any,
      finalActions: { closeTicket: true, tagId: 12 },
      steps: [step(), step({ delayMinutes: 1440, body: "Segue?" })]
    });
    expect(FollowUpRule.create).toHaveBeenCalledWith(
      expect.objectContaining({
        companyId: 4, name: "Orçamento", whatsappId: 2, queueId: null, trigger: "no_reply",
        respectBusinessHours: true, active: true, aiAgentId: null,
        finalActions: { closeTicket: true, tagId: 12 }
      }),
      { transaction }
    );
    expect(FollowUpStep.bulkCreate).toHaveBeenCalledWith(
      [
        expect.objectContaining({ ruleId: 10, order: 1, delayMinutes: 60, mode: "text", body: "Oi {{firstName}}" }),
        expect.objectContaining({ ruleId: 10, order: 2, delayMinutes: 1440, body: "Segue?" })
      ],
      { transaction }
    );
  });
  it("checks every id against the company", async () => {
    (Tag.findOne as jest.Mock).mockResolvedValue(null);
    await expect(createRule(4, { name: "X", finalActions: { tagId: 99 }, steps: [step()] })).rejects.toMatchObject({
      message: "ERR_FOLLOWUP_INVALID", statusCode: 400
    });
    expect(Tag.findOne).toHaveBeenCalledWith({ where: { id: 99, companyId: 4 } });
    expect(FollowUpRule.create).not.toHaveBeenCalled();
  });
  it("refuses no name, no steps, a zero delay, an empty text and an AI step without instruction or agent", async () => {
    const bad = [
      { name: "", steps: [step()] },
      { name: "X", steps: [] },
      { name: "X", steps: [step({ delayMinutes: 0 })] },
      { name: "X", steps: [step({ body: "  " })] },
      { name: "X", aiAgentId: 5, steps: [step({ mode: "ai", aiInstruction: "" })] },
      { name: "X", steps: [step({ mode: "ai", aiInstruction: "Retome" })] },
      { name: "X", steps: [step({ mode: "robot" })] }
    ];
    for (const input of bad) {
      // eslint-disable-next-line no-await-in-loop
      await expect(createRule(4, input as any)).rejects.toMatchObject({ message: "ERR_FOLLOWUP_INVALID" });
    }
    expect(FollowUpRule.create).not.toHaveBeenCalled();
  });
  it("refuses media outside the company folder", async () => {
    await expect(
      createRule(4, { name: "X", steps: [step({ mediaPath: "company9/x.jpg", mediaName: "x.jpg" })] })
    ).rejects.toMatchObject({ message: "ERR_FOLLOWUP_INVALID" });
  });
});

describe("updateRule", () => {
  it("only touches this company's rule and replaces its steps", async () => {
    await updateRule(4, 10, { name: "Novo", steps: [step()] });
    expect(FollowUpRule.findOne).toHaveBeenCalledWith(expect.objectContaining({ where: { id: 10, companyId: 4 } }));
    expect(FollowUpStep.destroy).toHaveBeenCalledWith({ where: { ruleId: 10 }, transaction });
    expect(FollowUpStep.bulkCreate).toHaveBeenCalled();
  });
  it("can toggle active without resending steps", async () => {
    await updateRule(4, 10, { active: false });
    expect(saved.update).toHaveBeenCalledWith({ active: false }, { transaction });
    expect(FollowUpStep.destroy).not.toHaveBeenCalled();
  });
  it("answers 404 for another company's rule", async () => {
    (FollowUpRule.findOne as jest.Mock).mockResolvedValue(null);
    await expect(updateRule(4, 10, { active: false })).rejects.toMatchObject({ message: "ERR_FOLLOWUP_NOT_FOUND", statusCode: 404 });
  });
});

describe("saveStepMedia", () => {
  it("stores the file in the company folder", async () => {
    const out = await saveStepMedia(4, { buffer: Buffer.from("x"), originalname: "foto.jpg", mimetype: "image/jpeg" } as any);
    expect(out).toEqual({ mediaPath: "company4/123_ab_foto.jpg", mediaName: "foto.jpg" });
  });
});
