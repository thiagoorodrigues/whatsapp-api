import AppError from "../../errors/AppError";
import { getDefaultChannel } from "../../channels";

/**
 * Checks that the number has WhatsApp and returns it as WhatsApp knows it
 * (digits only; e.g. Brazilian numbers may come back without the 9th digit).
 */
const CheckIsValidContact = async (number: string, companyId: number): Promise<string> => {
  const channel = await getDefaultChannel(companyId);

  let result;
  try {
    result = await channel.checkNumber(number);
  } catch (err: any) {
    throw new AppError("ERR_WAPP_CHECK_CONTACT");
  }

  if (!result.exists) throw new AppError("ERR_WAPP_INVALID_CONTACT");
  return (result.jid || number).split("@")[0].replace(/\D/g, "");
};

export default CheckIsValidContact;
