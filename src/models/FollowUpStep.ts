import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  Default, ForeignKey, DataType
} from "sequelize-typescript";
import FollowUpRule from "./FollowUpRule";

export type FollowUpStepMode = "text" | "ai";

@Table({ tableName: "FollowUpSteps" })
class FollowUpStep extends Model<FollowUpStep> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => FollowUpRule)
  @Column
  ruleId: number;

  @Column
  order: number;

  // Wait after the previous send (step 1: after our last message).
  @Column
  delayMinutes: number;

  @Default("text")
  @Column(DataType.STRING)
  mode: FollowUpStepMode;

  // Fixed text; in AI mode it is what goes out when the AI fails.
  @Column(DataType.TEXT)
  body: string;

  @Column(DataType.STRING)
  mediaPath: string | null;

  @Column(DataType.STRING)
  mediaName: string | null;

  @Column(DataType.TEXT)
  aiInstruction: string | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default FollowUpStep;
