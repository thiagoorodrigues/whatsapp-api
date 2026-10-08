import { Table, Column, Model, PrimaryKey, AutoIncrement, CreatedAt, DataType } from "sequelize-typescript";

@Table({ tableName: "SystemLogs", updatedAt: false })
class SystemLog extends Model<SystemLog> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  id: number;

  @CreatedAt
  createdAt: Date;

  @Column(DataType.STRING(8))
  level: string;

  @Column(DataType.STRING(8))
  source: string;

  @Column(DataType.STRING(8))
  protocol: string;

  @Column
  companyId: number;

  @Column
  userId: number;

  @Column(DataType.STRING(8))
  method: string;

  @Column(DataType.STRING(255))
  route: string;

  @Column(DataType.SMALLINT)
  status: number;

  @Column
  durationMs: number;

  @Column(DataType.STRING(80))
  code: string;

  @Column(DataType.TEXT)
  message: string;

  @Column(DataType.TEXT)
  detail: string;

  @Column(DataType.JSONB)
  context: object;
}

export default SystemLog;
