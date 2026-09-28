import AppError from "../../errors/AppError";
import { getDefaultChannel } from "../../channels";

// Only fails when the number cannot be checked (no connected session or a
// WhatsApp error): the lookup result never blocked contacts and still
// doesn't.
const CheckIsValidContact = async (
  number: string,
  companyId: number
): Promise<void> => {
  const channel = await getDefaultChannel(companyId);

  try {
    await channel.checkNumber(number);
  } catch (err: any) {
    throw new AppError("ERR_WAPP_CHECK_CONTACT");
  }
};

export default CheckIsValidContact;
