import {
  Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement,
  Default, ForeignKey, BelongsTo, DataType
} from "sequelize-typescript";
import Company from "./Company";
import Contact from "./Contact";
import Ticket from "./Ticket";
import FollowUpRule from "./FollowUpRule";

export type EnrollmentStatus = "active" | "completed" | "replied" | "cancelled" | "failed";

// Where one ticket is in a rule. At most one active row per ticket.
@Table({ tableName: "FollowUpEnrollments" })
class FollowUpEnrollment extends Model<FollowUpEnrollment> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @ForeignKey(() => FollowUpRule)
  @Column
  ruleId: number;

  @BelongsTo(() => FollowUpRule)
  rule: FollowUpRule;

  @ForeignKey(() => Ticket)
  @Column
  ticketId: number;

  @ForeignKey(() => Contact)
  @Column(DataType.INTEGER)
  contactId: number | null;

  // Position (1-based) of the next step to send.
  @Default(1)
  @Column
  currentStep: number;

  @Column(DataType.DATE)
  nextRunAt: Date;

  @Default("active")
  @Column(DataType.STRING)
  status: EnrollmentStatus;

  @Column(DataType.STRING)
  stopReason: string | null;

  @Default(0)
  @Column
  attempts: number;

  @Column(DataType.DATE)
  lastSentAt: Date | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default FollowUpEnrollment;
