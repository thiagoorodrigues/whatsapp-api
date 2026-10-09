import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  Default,
  DataType,
  ForeignKey
} from "sequelize-typescript";
import Company from "./Company";
import AiAgent from "./AiAgent";

export type KnowledgeStatus = "pending" | "processing" | "ready" | "error";
export type EmbeddingStatus = "none" | "processing" | "ready" | "error";

// A document of an agent's knowledge base (its text is split into
// AiKnowledgeChunks for search).
@Table({ tableName: "AiKnowledgeDocuments" })
class AiKnowledgeDocument extends Model<AiKnowledgeDocument> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @ForeignKey(() => AiAgent)
  @Column
  agentId: number;

  @Column(DataType.STRING(200))
  title: string;

  @Column(DataType.STRING(500))
  description: string | null;

  @Default("file")
  @Column
  sourceType: "file" | "text";

  @Column(DataType.STRING(300))
  fileName: string | null;

  @Column
  mimeType: string | null;

  @Default("pending")
  @Column
  status: KnowledgeStatus;

  @Column(DataType.TEXT)
  error: string | null;

  @Default(false)
  @Column
  alwaysInclude: boolean;

  @Default(true)
  @Column
  isActive: boolean;

  @Column(DataType.TEXT)
  content: string | null;

  @Default(0)
  @Column
  charCount: number;

  @Default(0)
  @Column
  chunkCount: number;

  // Model that produced the current chunk vectors (null = none).
  @Column
  embeddingModel: string | null;

  @Default("none")
  @Column
  embeddingStatus: EmbeddingStatus;

  @Column(DataType.TEXT)
  embeddingError: string | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AiKnowledgeDocument;
