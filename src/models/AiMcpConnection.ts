import {
  Table,
  Column,
  CreatedAt,
  UpdatedAt,
  Model,
  PrimaryKey,
  AutoIncrement,
  Default,
  DataType,
  ForeignKey
} from "sequelize-typescript";
import Company from "./Company";
import AiAgent from "./AiAgent";

export type McpConnectionStatus = "pending" | "connected" | "error";

// The account authorized (OAuth) for one MCP server of an agent. Tokens are
// encrypted (helpers/secretBox) and never sent to clients.
@Table({ tableName: "AiMcpConnections" })
class AiMcpConnection extends Model<AiMcpConnection> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @ForeignKey(() => Company)
  @Column
  companyId: number;

  @ForeignKey(() => AiAgent)
  @Column
  agentId: number | null;

  @Column
  serverId: string;

  @Column(DataType.STRING(2000))
  serverUrl: string;

  @Default("pending")
  @Column
  status: McpConnectionStatus;

  @Column(DataType.STRING(1000))
  issuer: string | null;

  @Column(DataType.STRING(2000))
  tokenEndpoint: string | null;

  @Column(DataType.STRING(2000))
  resource: string | null;

  @Column(DataType.TEXT)
  scope: string | null;

  @Column(DataType.STRING(1000))
  clientId: string | null;

  @Column(DataType.TEXT)
  clientSecretEncrypted: string | null;

  @Column
  authMethod: string | null;

  @Column(DataType.TEXT)
  accessTokenEncrypted: string | null;

  @Column(DataType.TEXT)
  refreshTokenEncrypted: string | null;

  @Column
  expiresAt: Date | null;

  @Column
  state: string | null;

  @Column(DataType.TEXT)
  codeVerifierEncrypted: string | null;

  @Column
  stateExpiresAt: Date | null;

  @Column(DataType.TEXT)
  lastError: string | null;

  @Column
  connectedAt: Date | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AiMcpConnection;
