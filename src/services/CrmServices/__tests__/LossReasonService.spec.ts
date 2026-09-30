import LossReason from "../../../models/LossReason";
import { seedLossReasons, updateLossReason } from "../LossReasonService";

jest.mock("../../../models/LossReason", () => ({
  __esModule: true,
  default: { bulkCreate: jest.fn(), findOne: jest.fn() }
}));

describe("seedLossReasons", () => {
  it("creates the five default reasons for the company", async () => {
    await seedLossReasons(9);
    const rows = (LossReason.bulkCreate as jest.Mock).mock.calls[0][0];
    expect(rows.map((r: any) => r.name)).toEqual(["Preço", "Concorrente", "Sem resposta", "Sem interesse", "Outro"]);
    expect(rows.every((r: any) => r.companyId === 9 && r.active === true)).toBe(true);
  });
});

describe("updateLossReason", () => {
  it("looks the reason up inside the company and 404s otherwise", async () => {
    (LossReason.findOne as jest.Mock).mockResolvedValue(null);
    await expect(updateLossReason(9, 1, { active: false })).rejects.toMatchObject({ statusCode: 404 });
    expect(LossReason.findOne).toHaveBeenCalledWith({ where: { id: 1, companyId: 9 } });
  });
});
