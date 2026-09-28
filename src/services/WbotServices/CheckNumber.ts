import { getDefaultChannel } from "../../channels";

interface IOnWhatsapp {
  jid: string;
  exists: boolean;
}

const CheckContactNumber = async (number: string, companyId: number): Promise<IOnWhatsapp> => {
  const channel = await getDefaultChannel(companyId);
  const result = await channel.checkNumber(number);

  if (!result.exists) {
    throw new Error("ERR_CHECK_NUMBER");
  }
  return { jid: result.jid, exists: true };
};

export default CheckContactNumber;
