import { getDefaultChannel } from "../../channels";

const GetProfilePicUrl = async (
  number: string,
  companyId: number
): Promise<string> => {
  const channel = await getDefaultChannel(companyId);
  const profilePicUrl = await channel.profilePictureUrl({ number });
  return profilePicUrl || `${process.env.FRONTEND_URL}/nopicture.png`;
};

export default GetProfilePicUrl;
