import {
  Table,
  Column,
  CreatedAt,
  Model,
  DataType,
  PrimaryKey,
  UpdatedAt,
  AutoIncrement,
} from "sequelize-typescript";

@Table
class MensagensDisparos extends Model<MensagensDisparos> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: string;

  @Column(DataType.STRING)
  numero: string;

  @Column(DataType.STRING)
  message: string;

  @CreatedAt
  @Column(DataType.DATE(6))
  createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(6))
  updatedAt: Date;
}

export default MensagensDisparos;
