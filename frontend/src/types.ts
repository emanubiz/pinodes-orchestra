export type NodeStatus = "idle" | "running" | "done" | "error";

export interface SystemPrompt {
  id: string;
  name: string;
  content: string;
  is_builtin: number;
}

export interface WorkflowNodeData extends Record<string, unknown> {
  label: string;
  promptId: string;
  status: NodeStatus;
  promptOverride?: string;
  isEntry?: boolean;
  error?: string;
}

export interface ChatLine {
  id: string;
  nodeId: string;
  kind: "user" | "agent" | "system" | "stream" | "tool" | "thinking";
  text: string;
  ts: number;
}

export interface WorkflowGraph {
  id?: string;
  name: string;
  cwd?: string;
  entryNodeId?: string | null;
  nodes: Array<{
    id: string;
    label: string;
    promptId: string;
    promptOverride?: string | null;
    position: { x: number; y: number };
  }>;
  edges: Array<{
    id: string;
    sourceNodeId: string;
    targetNodeId: string;
  }>;
}

export interface BoardSnapshot {
  nodes: Array<{
    id: string;
    type: string;
    position: { x: number; y: number };
    data: WorkflowNodeData;
  }>;
  edges: Array<{
    id: string;
    source: string;
    target: string;
  }>;
}

export interface Board {
  id: string;
  label: string;
  cwd: string;
  workflowName: string;
  workflowId: string | null;
  entryNodeId: string | null;
  snapshot: BoardSnapshot;
}

export interface SavedWorkflowListItem {
  id: string;
  name: string;
  updated_at: string;
}
