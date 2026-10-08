import Whatsapp from "../../models/Whatsapp";
import Company from "../../models/Company";
import { ConnectionsStatus } from "./alerts";

// Conexões de todas as empresas. "since" é o updatedAt: a última mudança,
// que para uma conexão caída costuma ser a queda.
export const listConnectionsStatus = async (): Promise<ConnectionsStatus> => {
  const rows: any[] = await Whatsapp.findAll({
    attributes: ["id", "name", "status", "companyId", "updatedAt"],
    include: [{ model: Company, attributes: ["id", "name"] }],
    order: [["companyId", "ASC"], ["name", "ASC"]]
  });
  const down = rows
    .filter(w => w.status !== "CONNECTED")
    .map(w => ({
      id: w.id,
      name: w.name,
      companyId: w.companyId,
      companyName: w.company ? w.company.name : null,
      status: w.status,
      since: w.updatedAt
    }));
  return { total: rows.length, connected: rows.length - down.length, down };
};
