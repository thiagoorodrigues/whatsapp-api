const update = jest.fn();
const emit = jest.fn();
const to = jest.fn(() => ({ emit }));

jest.mock("../../../models/Whatsapp", () => ({ __esModule: true, default: { update: (...a: any[]) => update(...a) } }));
jest.mock("../ShowWhatsAppService", () => ({ __esModule: true, default: async (id: number) => ({ id, importMessages: false }) }));
jest.mock("../../../libs/socket", () => ({ getIO: () => ({ emit, to }) }));

// eslint-disable-next-line import/first
import FinishHistoryImportService from "../FinishHistoryImportService";

beforeEach(() => {
  update.mockReset();
  emit.mockClear();
  to.mockClear();
});

describe("FinishHistoryImportService", () => {
  it("switches the import off and tells the screen", async () => {
    update.mockResolvedValue([1]);
    await FinishHistoryImportService(2, 1);
    expect(update).toHaveBeenCalledWith(
      { importMessages: false },
      { where: { id: 2, companyId: 1, importMessages: true } }
    );
    expect(to).toHaveBeenCalledWith("company-1");
    expect(emit).toHaveBeenCalledWith("company-1-whatsapp", { action: "update", whatsapp: { id: 2, importMessages: false } });
  });

  it("does nothing when the option was already off", async () => {
    update.mockResolvedValue([0]);
    await FinishHistoryImportService(2, 1);
    expect(emit).not.toHaveBeenCalled();
  });
});
