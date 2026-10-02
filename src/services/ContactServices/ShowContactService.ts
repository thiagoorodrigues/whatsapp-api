import Contact from "../../models/Contact";
import AppError from "../../errors/AppError";
import Whatsapp from "../../models/Whatsapp";

const ShowContactService = async (
  id: string | number,
  companyId: number
): Promise<Contact> => {
  const contact = await Contact.findByPk(id, {
    // Included models skip Whatsapp.toJSON: list the safe columns.
    include: ["extraInfo", { model: Whatsapp, as: "whatsapp", attributes: ["id", "name"] }]
  });

  if (contact?.companyId !== companyId) {
    throw new AppError("Não é possível excluir registro de outra empresa");
  }

  if (!contact) {
    throw new AppError("ERR_NO_CONTACT_FOUND", 404);
  }

  return contact;
};

export default ShowContactService;
