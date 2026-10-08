import { Op } from "sequelize";

const destroy = jest.fn();
jest.mock("../../../models/SystemLog", () => ({ __esModule: true, default: { destroy: (...a: any[]) => destroy(...a) } }));
// eslint-disable-next-line import/first
import PurgeSystemLogsService from "../PurgeSystemLogsService";

it("keeps info 7 days and warn/error 30 days", async () => {
  destroy.mockResolvedValueOnce(100).mockResolvedValueOnce(5);
  const now = new Date("2026-10-08T06:30:00Z");
  expect(await PurgeSystemLogsService(now)).toBe(105);
  expect(destroy.mock.calls[0][0].where).toEqual({ level: "info", createdAt: { [Op.lt]: new Date("2026-10-01T06:30:00Z") } });
  expect(destroy.mock.calls[1][0].where).toEqual({ level: { [Op.in]: ["warn", "error"] }, createdAt: { [Op.lt]: new Date("2026-09-08T06:30:00Z") } });
});
