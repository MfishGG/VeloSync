import type { Node } from "reactflow";

export interface VeloNodeData {
  clientKey: string;
  dbId?: number;
  nodeType: "source" | "filter" | "target";
  account: number | null;
  accountName?: string;
  config: Record<string, unknown>;
  status?: string; // idle / running / done / error
}

export type VNode = Node<VeloNodeData>;
