import {
    Table,
    Column,        
    Model,    
    PrimaryKey,
    BelongsTo,
    ForeignKey,
    CreatedAt,
    UpdatedAt,
    AutoIncrement
} from "sequelize-typescript";
import Contact from "./Contact";
import Ticket from "./Ticket";
import Company from "./Company";
import User from "./User";

@Table
class Logs extends Model<Logs> {
    @PrimaryKey
    @AutoIncrement
    @Column
    id: string;

    @Column
    observation: string;

    @ForeignKey(() => Contact)
    @Column
    contactId: number;
    
    @BelongsTo(() => Contact)
    contact: Contact;

    @ForeignKey(() => User)
    @Column
    userId: number;

    @BelongsTo(() => User)
    user: User;

    @ForeignKey(() => Ticket)
    @Column
    ticketId: number;

    @BelongsTo(() => Ticket)
    ticket: Ticket;

    @ForeignKey(() => Company)
    @Column
    companyId: number;

    @BelongsTo(() => Company)
    company: Company;

    @CreatedAt
    createdAt: Date;
  
    @UpdatedAt
    updatedAt: Date;
}

export default Logs;
