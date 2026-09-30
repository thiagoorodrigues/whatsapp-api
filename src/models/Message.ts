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
import { publicFileUrl } from "../helpers/mediaStorage";
import Whatsapp from "./Whatsapp";
import User from "./User";

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
    // Files are saved on the server (public/company{id}/).
    const mediaUrl = this.getDataValue("mediaUrl");
    return mediaUrl ? publicFileUrl(mediaUrl) : null;
  }

  @Column
  mediaType: string;

  @Default(false)
 
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

  @Default(false)
  @Column
  isForwarded: boolean;

  /** Internal note: shown to the team only, never sent to WhatsApp. */
  @Default(false)
  @Column
  isPrivate: boolean;

  /** Author of an internal note. */
  @ForeignKey(() => User)
  @Column
  userId: number;

  @BelongsTo(() => User)
  user: User;

  /** Names of the people mentioned; filled by ResolveMentionsService. */
  @Column(DataType.VIRTUAL)
  mentions: { token: string; name: string | null; phone: string | null }[];
}

export default Message;
