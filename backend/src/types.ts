export type NodeStatus = "idle" | "running" | "done" | "error";

export interface WorkflowGraph {
  id?: string;
  name: string;
  cwd?: string;
  entryNodeId?: string | null;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface WorkflowNode {
  id: string;
  label: string;
  promptId: string;
  promptOverride?: string | null;
  position: { x: number; y: number };
}

export interface WorkflowEdge {
  id: string;
  sourceNodeId: string;
  targetNodeId: string;
}

export interface SystemPromptRow {
  id: string;
  name: string;
  content: string;
  is_builtin: number;
  created_at: string;
  updated_at: string;
}

export interface BoardState {
  boardId: string;
  cwd: string;
  label: string;
  graph?: WorkflowGraph;
  createdAt: number;
}

export interface BoardRow {
  id: string;
  cwd: string;
  label: string;
  graph_data: string | null;
  created_at: string;
  updated_at: string;
}

export interface WsClientMessage {
  type: string;
  [key: string]: unknown;
}

export interface WsServerMessage {
  type: string;
  [key: string]: unknown;
}
