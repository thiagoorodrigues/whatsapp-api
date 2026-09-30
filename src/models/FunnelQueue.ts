import { Table, Column, CreatedAt, UpdatedAt, Model, ForeignKey, PrimaryKey } from "sequelize-typescript";
import Funnel from "./Funnel";
import Queue from "./Queue";

@Table({ tableName: "FunnelQueues" })
class FunnelQueue extends Model<FunnelQueue> {
  @PrimaryKey
  @ForeignKey(() => Funnel)
  @Column
  funnelId: number;

  @PrimaryKey
  @ForeignKey(() => Queue)
  @Column
  queueId: number;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default FunnelQueue;
