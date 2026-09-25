import { Op, WhereOptions } from "sequelize";

interface TicketFilterInput {
  // A single status ("closed") or a comma list ("open,pending").
  status?: string;
  // "true" = groups only, "false" = contacts only, anything else = both.
  isGroup?: string;
}

const buildTicketFilters = ({
  status,
  isGroup
}: TicketFilterInput): WhereOptions => {
  const where: { [key: string]: unknown } = {};

  if (status) {
    const statuses = status
      .split(",")
      .map(s => s.trim())
      .filter(Boolean);
    if (statuses.length === 1) {
      [where.status] = statuses;
    } else if (statuses.length > 1) {
      where.status = { [Op.in]: statuses };
    }
  }

  if (isGroup === "true") where.isGroup = true;
  if (isGroup === "false") where.isGroup = false;

  return where as WhereOptions;
};

export default buildTicketFilters;
