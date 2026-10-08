import { Op } from "sequelize";
import ContactListItem from "../../models/ContactListItem";
import AppError from "../../errors/AppError";

// Only the company's own contacts: an id from another company is not found.
const DeleteService = async (id: string | number, companyId: number): Promise<void> => {
  const record = await ContactListItem.findOne({
    where: { id, companyId }
  });

  if (!record) {
    throw new AppError("ERR_NO_CONTACTLISTITEM_FOUND", 404);
  }

  await record.destroy();
};

const MAX_BULK = 1000;

/** Deletes several contacts of the company at once; returns the ids removed. */
export const DeleteManyService = async (ids: unknown, companyId: number): Promise<number[]> => {
  const wanted = Array.isArray(ids)
    ? [...new Set(ids.map(Number).filter(n => Number.isInteger(n) && n > 0))]
    : [];
  if (!wanted.length) throw new AppError("ERR_NO_CONTACTLISTITEM_SELECTED", 400);
  if (wanted.length > MAX_BULK) throw new AppError("ERR_TOO_MANY_CONTACTLISTITEMS", 400);

  const records = await ContactListItem.findAll({
    where: { id: { [Op.in]: wanted }, companyId },
    attributes: ["id"]
  });
  const found = records.map(record => record.id);
  if (found.length) {
    await ContactListItem.destroy({ where: { id: { [Op.in]: found }, companyId } });
  }
  return found;
};

export default DeleteService;
