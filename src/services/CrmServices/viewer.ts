import UserQueue from "../../models/UserQueue";
import { Viewer } from "./visibility";

// The request user plus their queues, which decide what CRM data they see.
export const getViewer = async (user: { id: string | number; profile: string; companyId: number }): Promise<Viewer> => {
  const id = Number(user.id);
  const rows = await UserQueue.findAll({ where: { userId: id }, attributes: ["queueId"] });
  return { id, profile: user.profile, companyId: user.companyId, queueIds: rows.map(r => r.queueId) };
};
