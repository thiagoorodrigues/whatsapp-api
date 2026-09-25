// Pure chatbot flow interpreter: given a flow graph, the ticket's current
// state and the customer's message, returns what to do next. It performs no
// I/O, so it is unit-tested in isolation; RunFlowService executes the actions.

export type FlowNodeType =
  | "start"
  | "message"
  | "menu"
  | "question"
  | "condition"
  | "wait"
  | "transfer"
  | "end";

export type MediaType = "image" | "video" | "audio" | "document";

export interface MenuOption {
  id: string;
  label: string;
}

export interface FlowNodeData {
  text?: string;
  mediaUrl?: string;
  mediaType?: MediaType;
  options?: MenuOption[];
  invalidText?: string;
  variable?: string;
  operator?: "equals" | "contains" | "exists" | "notExists";
  value?: string;
  seconds?: number;
  queueId?: number | null;
  userId?: number | null;
  closeTicket?: boolean;
}

export interface FlowNode {
  id: string;
  type: FlowNodeType;
  data: FlowNodeData;
}

export interface FlowEdge {
  id?: string;
  source: string;
  target: string;
  sourceHandle?: string | null;
}

export interface FlowGraph {
  nodes: FlowNode[];
  edges: FlowEdge[];
}

export interface FlowState {
  nodeId: string | null; // node waiting for the customer's answer
  variables: Record<string, string>;
}

export type FlowAction =
  | { type: "text"; text: string }
  | { type: "media"; url: string; mediaType: MediaType; caption?: string }
  | { type: "wait"; seconds: number }
  | { type: "transfer"; queueId: number | null; userId: number | null }
  | { type: "end"; closeTicket: boolean };

export interface FlowResult {
  actions: FlowAction[];
  state: FlowState;
  finished: boolean; // flow no longer drives the ticket
}

export const MAX_STEPS = 50;
export const MAX_WAIT_SECONDS = 60;
export const DEFAULT_INVALID_TEXT =
  "Não entendi sua resposta. Por favor, escolha uma das opções abaixo.";

// Replaces {{variable}} with collected answers; unknown placeholders are
// kept so the Mustache pass ({{name}}, {{ms}}...) can still fill them.
export const interpolate = (
  text: string,
  variables: Record<string, string>
): string =>
  text.replace(/{{\s*([\w.-]+)\s*}}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(variables, key) ? variables[key] : match
  );

export const menuText = (node: FlowNode): string => {
  const options = (node.data.options || [])
    .map((option, index) => `*${index + 1}* - ${option.label}`)
    .join("\n");
  return [node.data.text || "", options].filter(Boolean).join("\n\n");
};

const normalize = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toLowerCase();

// Customer picks by number ("2") or by the option's text.
export const matchOption = (
  node: FlowNode,
  input: string
): MenuOption | undefined => {
  const options = node.data.options || [];
  const answer = normalize(input || "");
  if (!answer) return undefined;
  if (/^\d+$/.test(answer)) return options[Number(answer) - 1];
  return options.find(option => normalize(option.label) === answer);
};

export const evaluateCondition = (
  node: FlowNode,
  variables: Record<string, string>
): boolean => {
  const { variable = "", operator = "equals", value = "" } = node.data;
  const current = variables[variable];
  switch (operator) {
    case "exists":
      return current !== undefined && current !== "";
    case "notExists":
      return current === undefined || current === "";
    case "contains":
      return normalize(current || "").includes(normalize(value));
    case "equals":
    default:
      return normalize(current || "") === normalize(value);
  }
};

const nextNodeId = (
  graph: FlowGraph,
  nodeId: string,
  handle?: string
): string | null => {
  const edge = graph.edges.find(
    e =>
      e.source === nodeId &&
      (handle === undefined ? !e.sourceHandle : e.sourceHandle === handle)
  );
  // Nodes with a single output may have been wired with a named handle.
  const fallback =
    handle === undefined ? graph.edges.find(e => e.source === nodeId) : undefined;
  return (edge || fallback)?.target ?? null;
};

export const findStartNode = (graph: FlowGraph): FlowNode | undefined =>
  graph.nodes.find(node => node.type === "start");

// Advances from `fromNodeId` (not yet executed) until a node needs an
// answer, the flow ends, or there is nowhere left to go.
const runFrom = (
  graph: FlowGraph,
  fromNodeId: string | null,
  variables: Record<string, string>,
  actions: FlowAction[]
): FlowResult => {
  const byId = new Map(graph.nodes.map(node => [node.id, node]));
  let currentId = fromNodeId;

  for (let step = 0; step < MAX_STEPS && currentId; step += 1) {
    const node = byId.get(currentId);
    if (!node) break;
    const { data } = node;

    switch (node.type) {
      case "start":
        currentId = nextNodeId(graph, node.id);
        break;

      case "message":
        if (data.mediaUrl) {
          actions.push({
            type: "media",
            url: data.mediaUrl,
            mediaType: data.mediaType || "image",
            caption: data.text ? interpolate(data.text, variables) : undefined
          });
        } else if (data.text) {
          actions.push({ type: "text", text: interpolate(data.text, variables) });
        }
        currentId = nextNodeId(graph, node.id);
        break;

      case "menu":
        actions.push({ type: "text", text: interpolate(menuText(node), variables) });
        return { actions, state: { nodeId: node.id, variables }, finished: false };

      case "question":
        if (data.text) {
          actions.push({ type: "text", text: interpolate(data.text, variables) });
        }
        return { actions, state: { nodeId: node.id, variables }, finished: false };

      case "condition":
        currentId = nextNodeId(
          graph,
          node.id,
          evaluateCondition(node, variables) ? "true" : "false"
        );
        break;

      case "wait": {
        const seconds = Math.min(Math.max(Number(data.seconds) || 0, 0), MAX_WAIT_SECONDS);
        if (seconds > 0) actions.push({ type: "wait", seconds });
        currentId = nextNodeId(graph, node.id);
        break;
      }

      case "transfer":
        if (data.text) {
          actions.push({ type: "text", text: interpolate(data.text, variables) });
        }
        actions.push({
          type: "transfer",
          queueId: data.queueId ?? null,
          userId: data.userId ?? null
        });
        return { actions, state: { nodeId: null, variables }, finished: true };

      case "end":
        if (data.text) {
          actions.push({ type: "text", text: interpolate(data.text, variables) });
        }
        actions.push({ type: "end", closeTicket: !!data.closeTicket });
        return { actions, state: { nodeId: null, variables }, finished: true };

      default:
        currentId = null;
    }
  }

  // Ran out of edges (or hit the loop guard): hand the ticket to humans.
  return { actions, state: { nodeId: null, variables }, finished: true };
};

export const startFlow = (graph: FlowGraph): FlowResult => {
  const start = findStartNode(graph);
  return runFrom(graph, start ? start.id : null, {}, []);
};

// Resumes a flow that is waiting on `state.nodeId` with the customer's
// answer `input`.
export const continueFlow = (
  graph: FlowGraph,
  state: FlowState,
  input: string
): FlowResult => {
  const node = graph.nodes.find(n => n.id === state.nodeId);
  const variables = { ...(state.variables || {}) };

  if (!node) return startFlow(graph);

  if (node.type === "menu") {
    const option = matchOption(node, input);
    if (!option) {
      return {
        actions: [
          { type: "text", text: node.data.invalidText || DEFAULT_INVALID_TEXT },
          { type: "text", text: interpolate(menuText(node), variables) }
        ],
        state: { nodeId: node.id, variables },
        finished: false
      };
    }
    if (node.data.variable) variables[node.data.variable] = option.label;
    return runFrom(graph, nextNodeId(graph, node.id, option.id), variables, []);
  }

  if (node.type === "question") {
    if (node.data.variable) variables[node.data.variable] = (input || "").trim();
    return runFrom(graph, nextNodeId(graph, node.id), variables, []);
  }

  // A node that does not wait for answers: continue after it.
  return runFrom(graph, nextNodeId(graph, node.id), variables, []);
};
