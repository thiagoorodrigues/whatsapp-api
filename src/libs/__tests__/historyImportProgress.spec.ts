const emit = jest.fn();
jest.mock("../socket", () => ({ getIO: () => ({ to: (room: string) => ({ emit: (...a: any[]) => emit(room, ...a) }) }) }));

// eslint-disable-next-line import/first
import { getImportProgress, publishImportProgress } from "../historyImportProgress";

const progress: any = { status: "running", receivedPercent: 40, total: 10, processed: 3, saved: 2 };

describe("historyImportProgress", () => {
  it("keeps the latest progress per connection and tells the company", () => {
    publishImportProgress(4, 3, progress);
    expect(getImportProgress(4, 3)).toEqual(progress);
    expect(emit).toHaveBeenCalledWith("company-3", "company-3-whatsapp", { action: "importProgress", whatsappId: 4, progress });
  });

  it("another company cannot read it", () => {
    publishImportProgress(5, 3, progress);
    expect(getImportProgress(5, 9)).toBeNull();
    expect(getImportProgress(77, 3)).toBeNull();
  });
});
