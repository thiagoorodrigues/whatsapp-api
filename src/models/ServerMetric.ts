import { Table, Column, Model, PrimaryKey, AutoIncrement, CreatedAt, DataType } from "sequelize-typescript";

@Table({ tableName: "ServerMetrics", updatedAt: false })
class ServerMetric extends Model<ServerMetric> {
  @PrimaryKey
  @AutoIncrement
  @Column(DataType.BIGINT)
  id: number;

  @CreatedAt
  createdAt: Date;

  @Column(DataType.FLOAT)
  cpuPercent: number;

  @Column(DataType.FLOAT)
  load1: number;

  @Column(DataType.FLOAT)
  load5: number;

  @Column(DataType.FLOAT)
  load15: number;

  @Column(DataType.BIGINT)
  memUsedBytes: number;

  @Column(DataType.BIGINT)
  memTotalBytes: number;

  @Column(DataType.BIGINT)
  apiMemBytes: number;

  @Column(DataType.BIGINT)
  diskUsedBytes: number;

  @Column(DataType.BIGINT)
  diskTotalBytes: number;
}

export default ServerMetric;
