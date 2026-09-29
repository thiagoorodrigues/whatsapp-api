import { expiringWhatsapps, transferringWhatsapps } from "../autoTicketRules";

describe("autoTicketRules", () => {
  it("keeps only connections with an expiration in hours", () => {
    const list = [
      { id: 1, expiresTicket: 0 },
      { id: 2, expiresTicket: "" },
      { id: 3, expiresTicket: "2" },
      { id: 4, expiresTicket: null },
      { id: 5, expiresTicket: 24 }
    ];
    expect(expiringWhatsapps(list).map(w => w.id)).toEqual([3, 5]);
  });

  it("keeps only connections with transfer time and target queue", () => {
    const list = [
      { id: 1, timeToTransfer: 0, transferQueueId: 7 },
      { id: 2, timeToTransfer: 10, transferQueueId: null },
      { id: 3, timeToTransfer: 10, transferQueueId: 7 },
      { id: 4, timeToTransfer: null, transferQueueId: null }
    ];
    expect(transferringWhatsapps(list).map(w => w.id)).toEqual([3]);
  });
});
