import { Table, Column, Model, PrimaryKey, AutoIncrement, DataType, ForeignKey } from "sequelize-typescript";
import AiKnowledgeDocument from "./AiKnowledgeDocument";

// A piece of a knowledge document. The table also has "searchVector", a
// generated tsvector (Portuguese, accents ignored) used for search.
@Table({ tableName: "AiKnowledgeChunks", timestamps: false })
class AiKnowledgeChunk extends Model<AiKnowledgeChunk> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => AiKnowledgeDocument)
  @Column
  documentId: number;

  @Column
  companyId: number;

  @Column
  agentId: number;

  @Column
  position: number;

  @Column(DataType.TEXT)
  content: string;
}

export default AiKnowledgeChunk;
