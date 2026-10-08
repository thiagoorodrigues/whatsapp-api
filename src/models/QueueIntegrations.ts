import {
    Table,
    Column,
    CreatedAt,
    UpdatedAt,
    Model,
    DataType,
    PrimaryKey,
    HasMany,
    AutoIncrement,
    BelongsTo,
    ForeignKey,
    Default,
    DefaultScope
} from "sequelize-typescript";
import Queue from "./Queue";
import Company from "./Company";

// The webhook token never leaves the API, even inside other models' includes.
@DefaultScope(() => ({ attributes: { exclude: ["webhookToken"] } }))
@Table
class QueueIntegrations extends Model<QueueIntegrations> {
    @PrimaryKey
    @AutoIncrement
    @Column
    id: number;

    @Column(DataType.TEXT)
    type: string;

    @Column(DataType.TEXT)
    name: string;
    
    @Column(DataType.TEXT)
    projectName: string;
    
    @Column(DataType.TEXT)
    jsonContent: string;

    @Column(DataType.TEXT)
    urlN8N: string;

    @Column(DataType.TEXT)
    language: string;

    @CreatedAt
    @Column(DataType.DATE(6))
    createdAt: Date;

    @UpdatedAt
    @Column(DataType.DATE(6))
    updatedAt: Date;

    @ForeignKey(() => Company)
    @Column
    companyId: number;
  
    @BelongsTo(() => Company)
    company: Company;
  
    @Column
    typebotSlug: string;

    @Default(0)
    @Column
    typebotExpires: number;

    @Column
    typebotKeywordFinish: string;

    @Column
    typebotUnknownMessage: string;

    @Default(1000)
    @Column
    typebotDelayMessage: number

    @Column
    typebotKeywordRestart: string;

    @Column
    typebotRestartMessage: string;

    // Webhook options (services/QueueIntegrationServices/webhook.ts).
    @Default(true)
    @Column
    webhookActive: boolean;

    @Default(true)
    @Column
    webhookOnPending: boolean;

    @Default(false)
    @Column
    webhookOnOpen: boolean;

    @Default(false)
    @Column
    webhookSendTags: boolean;

    @Default(false)
    @Column
    webhookSendQueue: boolean;

    @Default(false)
    @Column
    webhookSendBotMessages: boolean;

    // Encrypted; never sent to the panel (see publicIntegration).
    @Column(DataType.TEXT)
    webhookToken: string;
}

export default QueueIntegrations;