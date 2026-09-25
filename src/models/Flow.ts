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
import { FlowEdge, FlowNode } from "../services/FlowServices/FlowEngine";

// Chatbot flow drawn in the flow builder (React Flow nodes/edges).
@Table
class Flow extends Model<Flow> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @AllowNull(false)
  @Column
  name: string;

  @Default([])
  @Column({ type: DataType.JSONB })
  nodes: (FlowNode & { position?: { x: number; y: number } })[];

  @Default([])
  @Column({ type: DataType.JSONB })
  edges: FlowEdge[];

  @Default(true)
  @Column
  isActive: boolean;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @HasMany(() => Whatsapp)
  whatsapps: Whatsapp[];

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default Flow;
