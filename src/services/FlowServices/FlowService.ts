import { Op } from "sequelize";
import AppError from "../../errors/AppError";
import Flow from "../../models/Flow";
import Whatsapp from "../../models/Whatsapp";
import validateGraph from "./validateGraph";

interface FlowData {
  name?: string;
  nodes?: unknown;
  edges?: unknown;
  isActive?: boolean;
}

const connectionAttributes = ["id", "name", "status"];

export const listFlows = async (companyId: number): Promise<Flow[]> =>
  Flow.findAll({
    where: { companyId },
    attributes: ["id", "name", "isActive", "updatedAt"],
    include: [{ model: Whatsapp, attributes: connectionAttributes }],
    order: [["name", "ASC"]]
  });

export const showFlow = async (id: number | string, companyId: number): Promise<Flow> => {
  const flow = await Flow.findOne({
    where: { id, companyId },
    include: [{ model: Whatsapp, attributes: connectionAttributes }]
  });
  if (!flow) throw new AppError("ERR_FLOW_NOT_FOUND", 404);
  return flow;
};

// New flows start with a single "Início" block.
const initialGraph = () => ({
  nodes: [{ id: "start", type: "start", position: { x: 80, y: 80 }, data: {} }],
  edges: []
});

export const createFlow = async (data: FlowData, companyId: number): Promise<Flow> => {
  const name = (data.name || "").trim();
  if (!name) throw new AppError("ERR_FLOW_NAME_REQUIRED");

  const graph =
    data.nodes === undefined ? initialGraph() : validateGraph(data.nodes, data.edges || []);

  return Flow.create({ name, ...graph, isActive: data.isActive ?? true, companyId } as any);
};

export const updateFlow = async (
  id: number | string,
  data: FlowData,
  companyId: number
): Promise<Flow> => {
  const flow = await showFlow(id, companyId);
  const changes: Record<string, unknown> = {};

  if (data.name !== undefined) {
    const name = data.name.trim();
    if (!name) throw new AppError("ERR_FLOW_NAME_REQUIRED");
    changes.name = name;
  }
  if (data.nodes !== undefined) {
    Object.assign(changes, validateGraph(data.nodes, data.edges || []));
  }
  if (data.isActive !== undefined) changes.isActive = !!data.isActive;

  await flow.update(changes);
  return showFlow(id, companyId);
};

export const duplicateFlow = async (id: number | string, companyId: number): Promise<Flow> => {
  const flow = await showFlow(id, companyId);
  return Flow.create({
    name: `${flow.name} (cópia)`,
    nodes: flow.nodes,
    edges: flow.edges,
    isActive: false,
    companyId
  } as any);
};

export const deleteFlow = async (id: number | string, companyId: number): Promise<void> => {
  const flow = await showFlow(id, companyId);
  await Whatsapp.update({ flowId: null } as any, { where: { flowId: flow.id, companyId } });
  await flow.destroy();
};

// Sets which connections answer with this flow (a connection has at most
// one flow, so choosing it here moves it from any other flow).
export const setFlowConnections = async (
  id: number | string,
  whatsappIds: number[],
  companyId: number
): Promise<Flow> => {
  const flow = await showFlow(id, companyId);
  const ids = (whatsappIds || []).map(Number).filter(Boolean);

  await Whatsapp.update({ flowId: null } as any, {
    where: { flowId: flow.id, companyId, id: { [Op.notIn]: ids.length ? ids : [0] } }
  });
  if (ids.length) {
    await Whatsapp.update({ flowId: flow.id } as any, { where: { id: ids, companyId } });
  }
  return showFlow(id, companyId);
};
