import Deal from "../../models/Deal";

// One deal registration at a time per contact and funnel, across tickets,
// processes and callers (AI agent, automatic rules), so two quick messages
// cannot create two deals.
export const lockContactFunnel = (companyId: number, contactId: number, funnelId: number, transaction: any) =>
  Deal.sequelize!.query("SELECT pg_advisory_xact_lock(:a, :b)", {
    replacements: { a: companyId, b: (contactId * 1000003 + funnelId) % 2147483647 },
    transaction
  });

export const findOpenDeal = (companyId: number, funnelId: number, contactId: number, transaction?: any) =>
  Deal.findOne({
    where: { companyId, funnelId, contactId, status: "open" },
    order: [["updatedAt", "DESC"]],
    ...(transaction ? { transaction, lock: true } : {})
  });
