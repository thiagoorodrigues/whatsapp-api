import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  AllowNull,
  Default,
  DataType,
  ForeignKey,
  BelongsTo,
  HasMany
} from "sequelize-typescript";
import Company from "./Company";
import Whatsapp from "./Whatsapp";
import type { HttpTool } from "../services/AiAgentServices/httpTools";
import type { McpServer } from "../services/AiAgentServices/mcpTools";

// Settings of the built-in tools an agent may use.
export type AiAgentStatus = "draft" | "active" | "paused";

export interface AiAgentTools {
  transfer?: { enabled: boolean; queueIds?: number[] };
  close?: { enabled: boolean };
  http?: HttpTool[];
  mcp?: McpServer[];
  // Lets the agent register and qualify the contact's deal in one funnel.
  crm?: { enabled: boolean; funnelId: number | null; stageId: number | null; qualifiedStageId: number | null };
}

@Table({ tableName: "AiAgents" })
class AiAgent extends Model<AiAgent> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @AllowNull(false)
  @Column
  name: string;

  // Only "active" agents answer customers; drafts can be tested.
  @Default("draft")
  @Column
  status: AiAgentStatus;

  @AllowNull(false)
  @Column
  provider: string;

  @AllowNull(false)
  @Column
  model: string;

  @Default("")
  @Column(DataType.TEXT)
  prompt: string;

  @Column
  effort: string;


  @Default({})
  @Column({ type: DataType.JSONB })
  tools: AiAgentTools;

  @Column
  maxTokens: number | null;

  @Column(DataType.FLOAT)
  temperature: number | null;

  // Provider API key, encrypted (helpers/secretBox). Never sent to clients:
  // they get `keyHint` (last characters) and `hasKey`.
  @Column(DataType.TEXT)
  apiKeyEncrypted: string | null;

  @Column
  keyHint: string | null;

  @HasMany(() => Whatsapp)
  whatsapps: Whatsapp[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AiAgent;
