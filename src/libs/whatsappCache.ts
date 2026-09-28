import NodeCache from "node-cache";
import type { GroupMetadata, WASocket } from "@whiskeysockets/baileys";

// Group metadata and profile pictures were fetched from WhatsApp on every
// message; WhatsApp rate-limits those queries. Keyed by connection, since
// each session sees its own groups.

const groups = new NodeCache({ stdTTL: 10 * 60, useClones: false });
const pictures = new NodeCache({ stdTTL: 60 * 60 });

type Session = WASocket & { id?: number };

const groupKey = (connectionId: number | undefined, jid: string) => `${connectionId}:${jid}`;

export const getGroupMetadata = async (wbot: Session, jid: string): Promise<GroupMetadata> => {
  const key = groupKey(wbot.id, jid);
  const cached = groups.get<GroupMetadata>(key);
  if (cached) return cached;
  const metadata = await wbot.groupMetadata(jid);
  groups.set(key, metadata);
  return metadata;
};

/** For Baileys' cachedGroupMetadata option: sends to groups skip the lookup. */
export const cachedGroupMetadata = (connectionId: number) => async (jid: string) =>
  groups.get<GroupMetadata>(groupKey(connectionId, jid));

export const forgetGroup = (connectionId: number | undefined, jid: string): void => {
  groups.del(groupKey(connectionId, jid));
};

export const getProfilePictureUrl = async (wbot: Session, jid: string): Promise<string> => {
  const key = `${wbot.id}:${jid}`;
  const cached = pictures.get<string>(key);
  if (cached) return cached;
  let url: string;
  try {
    url = (await wbot.profilePictureUrl(jid)) || "";
  } catch (e) {
    // No picture or hidden by privacy settings: not worth asking again soon.
    url = "";
  }
  const result = url || `${process.env.FRONTEND_URL}/nopicture.png`;
  pictures.set(key, result);
  return result;
};
