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
import type { MediaToolConfig } from "../services/AiAgentServices/mediaTools";
import type { McpServer } from "../services/AiAgentServices/mcpTools";

// Settings of the built-in tools an agent may use.
export type AiAgentStatus = "draft" | "active" | "paused";

export interface AiAgentTools {
  // Where the agent may hand the conversation, with when to use each; older
  // agents only have queueIds. keepAgent: a queue transfer only changes the
  // queue and the agent goes on answering.
  transfer?: {
    enabled: boolean;
    queueIds?: number[];
    targets?: { kind: "queue" | "user"; id: number; instructions: string }[];
    keepAgent?: boolean;
  };
  close?: { enabled: boolean };
  http?: HttpTool[];
  mcp?: McpServer[];
  // Lets the agent register and qualify the contact's deal in one funnel.
  // moveStages: open columns the agent may move the deal to, with when; older
  // agents have only qualifiedStageId.
  crm?: {
    enabled: boolean;
    funnelId: number | null;
    stageId: number | null;
    qualifiedStageId: number | null;
    moveStages?: { stageId: number; instructions: string }[];
  };
  // Sends the reply as several short messages, with "typing..." before each
  // one for `delay` seconds (null: by the size of the text).
  split?: { enabled: boolean; delay: number | null };
  // Waits this many seconds of silence from the customer before answering,
  // so messages sent in a row are answered together.
  wait?: { enabled: boolean; seconds: number };
  // Tags the agent may put on the ticket (empty: any of the company's), with
  // optional rules for when to use each one.
  tag?: { enabled: boolean; tagIds?: number[]; instructions?: string };
  // Files the agent sends when the conversation asks for them.
  media?: MediaToolConfig;
  // Schedules a message in the Agenda after confirming the date with the customer.
  schedule?: { enabled: boolean; instructions?: string; maxDays?: number };
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
