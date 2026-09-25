import {
  ENTRY_DATE_SQL,
  trackingStatus,
  closingUserId,
  buildDashboardFilter,
  toTicketReportRow
} from "../trackingRules";

describe("trackingStatus", () => {
  it("is closed once finished", () => {
    expect(trackingStatus({ startedAt: new Date(), finishedAt: new Date() })).toBe("closed");
    expect(trackingStatus({ startedAt: null, finishedAt: new Date() })).toBe("closed");
  });

  it("is open when started and not finished", () => {
    expect(trackingStatus({ startedAt: new Date(), finishedAt: null })).toBe("open");
  });

  it("is pending when never started", () => {
    expect(trackingStatus({ startedAt: null, finishedAt: null })).toBe("pending");
  });
});

describe("closingUserId", () => {
  it("keeps the ticket attendant when there is one", () => {
    expect(closingUserId({ ticketUserId: 2, trackingUserId: 3, closerUserId: 4 })).toBe(2);
  });

  it("falls back to the attendant already on the tracking (ticket returned to queue)", () => {
    expect(closingUserId({ ticketUserId: null, trackingUserId: 3, closerUserId: 4 })).toBe(3);
  });

  it("credits whoever closed it when nobody attended (closed from the queue)", () => {
    expect(closingUserId({ ticketUserId: null, trackingUserId: null, closerUserId: 4 })).toBe(4);
  });

  it("returns null when there is no one to credit", () => {
    expect(closingUserId({})).toBeNull();
  });
});

describe("buildDashboardFilter", () => {
  it("always filters by company", () => {
    expect(buildDashboardFilter(1, {})).toEqual({
      where: 'where tt."companyId" = ?',
      replacements: [1]
    });
  });

  it("filters the period by entry date, not by queue date", () => {
    const { where, replacements } = buildDashboardFilter(1, {
      date_from: "2026-09-01",
      date_to: "2026-09-30"
    });
    expect(where).toContain(`${ENTRY_DATE_SQL} >= ?`);
    expect(where).toContain(`${ENTRY_DATE_SQL} <= ?`);
    expect(where).not.toContain('"finishedAt" <=');
    expect(replacements).toEqual([1, "2026-09-01 00:00:00", "2026-09-30 23:59:59"]);
  });

  it("supports the last N days", () => {
    const { where, replacements } = buildDashboardFilter(1, { days: 7 });
    expect(where).toContain(`${ENTRY_DATE_SQL} >= (now() - ?::interval)`);
    expect(replacements).toEqual([1, "7 days"]);
  });

  it("passes userId as a bound value, never inline", () => {
    const { where, replacements } = buildDashboardFilter(1, { userId: "5 or 1=1" as any });
    expect(where).toContain('tt."userId" = ?');
    expect(where).not.toContain("or 1=1");
    expect(replacements).toEqual([1, 5]);
  });

  it("ignores a non-numeric userId", () => {
    const { where } = buildDashboardFilter(1, { userId: "abc" as any });
    expect(where).not.toContain("userId");
  });
});

describe("toTicketReportRow", () => {
  const ticket = {
    id: 6,
    uuid: "abc",
    contact: { name: "Thiago" },
    queue: { name: "Vendas" },
    tags: [],
    whatsapp: { name: "Conexão antiga" }
  };

  it("reports one row per attendance with that attendance's attendant", () => {
    const row = toTicketReportRow({
      id: 42,
      queuedAt: new Date("2026-09-24T10:00:00Z"),
      startedAt: new Date("2026-09-24T10:05:00Z"),
      finishedAt: new Date("2026-09-24T10:30:00Z"),
      createdAt: new Date("2026-09-24T09:59:00Z"),
      user: { id: 1, name: "Admin" },
      whatsapp: { name: "Teste" },
      ticket
    });
    expect(row).toMatchObject({
      id: 6,
      uuid: "abc",
      rowKey: 42,
      user: { id: 1, name: "Admin" },
      whatsapp: { name: "Teste" },
      contact: { name: "Thiago" },
      queue: { name: "Vendas" },
      status: "closed"
    });
    expect(row.createdAt).toEqual(new Date("2026-09-24T10:00:00Z"));
    expect(row.updatedAt).toEqual(new Date("2026-09-24T10:30:00Z"));
  });

  it("opens at startedAt/createdAt when queuedAt is missing and has no close date while running", () => {
    const row = toTicketReportRow({
      id: 43,
      queuedAt: null,
      startedAt: null,
      finishedAt: null,
      createdAt: new Date("2026-09-24T11:00:00Z"),
      user: null,
      whatsapp: null,
      ticket
    });
    expect(row.status).toBe("pending");
    expect(row.createdAt).toEqual(new Date("2026-09-24T11:00:00Z"));
    expect(row.updatedAt).toBeNull();
    expect(row.whatsapp).toEqual({ name: "Conexão antiga" });
  });
});
