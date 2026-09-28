import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  DataType,
  PrimaryKey,
  Default,
  BelongsTo,
  ForeignKey
} from "sequelize-typescript";
import Contact from "./Contact";
import Ticket from "./Ticket";
import Company from "./Company";
import Queue from "./Queue";
import { generateAccessLink } from "../config/uploadAws";
import { publicFileUrl } from "../helpers/mediaStorage";
import Whatsapp from "./Whatsapp";

@Table
class Message extends Model<Message> {
  @PrimaryKey
  @Column
  id: string;

  @Column(DataType.STRING)
  remoteJid: string;

  @Column(DataType.STRING)
  participant: string;

  @Column(DataType.STRING)
  dataJson: string;

  @Default(0)
  @Column
  ack: number;

  @Default(false)
  @Column
  read: boolean;

  @Default(false)
  @Column
  fromMe: boolean;

  @Column(DataType.TEXT)
  body: string;

  @Column(DataType.STRING)
  get mediaUrl(): string | null {
    // Files saved on the server (public/company{id}/); isAws marks older
    // messages whose media is still in S3.
    if (this.getDataValue("mediaUrl") && this.getDataValue('isAws')) {
      return generateAccessLink(this.getDataValue("mediaUrl"));
    }else if(this.getDataValue("mediaUrl") && !this.getDataValue('isAws')){
      return publicFileUrl(this.getDataValue("mediaUrl"));
    }
    return null;
  }

  @Column
  mediaType: string;

  @Default(false)
  @Column
  isAws: string;
 
  @Column(DataType.STRING)
  messagesWhatsappsId: string;

  @Default(false)
  @Column
  isDeleted: boolean;

  @CreatedAt
  @Column(DataType.DATE(6))
  createdAt: Date;

  @UpdatedAt
  @Column(DataType.DATE(6))
  updatedAt: Date;

  @ForeignKey(() => Message)
  @Column
  quotedMsgId: string;

  @BelongsTo(() => Message, "quotedMsgId")
  quotedMsg: Message;

  @ForeignKey(() => Ticket)
  @Column
  ticketId: number;

  @BelongsTo(() => Ticket)
  ticket: Ticket;

  @ForeignKey(() => Contact)
  @Column
  contactId: number;

  @BelongsTo(() => Contact, "contactId")
  contact: Contact;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @BelongsTo(() => Company)
  company: Company;

  @ForeignKey(() => Queue)
  @Column
  queueId: number;

  @BelongsTo(() => Queue)
  queue: Queue;
  
  @Default(false)
  @Column
  isEdited: boolean;
}

export default Message;
