import { Op } from "sequelize";
import buildTicketFilters from "../buildTicketFilters";

describe("buildTicketFilters", () => {
  it("returns no conditions when nothing is filtered", () => {
    expect(buildTicketFilters({})).toEqual({});
  });

  it("keeps a single status as an equality", () => {
    expect(buildTicketFilters({ status: "closed" })).toEqual({
      status: "closed"
    });
  });

  it("turns a comma list of statuses into IN (open + pending)", () => {
    expect(buildTicketFilters({ status: "open,pending" })).toEqual({
      status: { [Op.in]: ["open", "pending"] }
    });
  });

  it("ignores blanks inside the status list", () => {
    expect(buildTicketFilters({ status: " open , ,pending " })).toEqual({
      status: { [Op.in]: ["open", "pending"] }
    });
  });

  it("filters groups only", () => {
    expect(buildTicketFilters({ isGroup: "true" })).toEqual({ isGroup: true });
  });

  it("filters contacts only", () => {
    expect(buildTicketFilters({ isGroup: "false" })).toEqual({
      isGroup: false
    });
  });

  it("ignores any other isGroup value", () => {
    expect(buildTicketFilters({ isGroup: "all" })).toEqual({});
  });
});
