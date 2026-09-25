import AppError from "../../errors/AppError";
import { FlowEdge, FlowNode, FlowNodeType } from "./FlowEngine";

const NODE_TYPES: FlowNodeType[] = [
  "start",
  "message",
  "menu",
  "question",
  "condition",
  "wait",
  "transfer",
  "end"
];

// Rejects graphs the engine cannot run; returns them trimmed to the fields
// the builder and the engine use.
const validateGraph = (nodes: unknown, edges: unknown): { nodes: FlowNode[]; edges: FlowEdge[] } => {
  if (!Array.isArray(nodes) || !Array.isArray(edges)) {
    throw new AppError("ERR_FLOW_INVALID_GRAPH");
  }

  const cleanNodes = nodes.map((node: any) => {
    if (!node || typeof node.id !== "string" || !NODE_TYPES.includes(node.type)) {
      throw new AppError("ERR_FLOW_INVALID_NODE");
    }
    return {
      id: node.id,
      type: node.type,
      position: {
        x: Number(node.position?.x) || 0,
        y: Number(node.position?.y) || 0
      },
      data: node.data && typeof node.data === "object" ? node.data : {}
    };
  });

  const starts = cleanNodes.filter(node => node.type === "start").length;
  if (starts !== 1) {
    throw new AppError("ERR_FLOW_NEEDS_ONE_START");
  }

  const ids = new Set(cleanNodes.map(node => node.id));
  const cleanEdges = edges
    .filter((edge: any) => edge && ids.has(edge.source) && ids.has(edge.target))
    .map((edge: any) => ({
      id: typeof edge.id === "string" ? edge.id : `${edge.source}-${edge.target}`,
      source: edge.source,
      target: edge.target,
      sourceHandle: edge.sourceHandle || null
    }));

  return { nodes: cleanNodes as FlowNode[], edges: cleanEdges };
};

export default validateGraph;
