import { Table, Column, CreatedAt, UpdatedAt, Model, PrimaryKey, AutoIncrement, DataType } from "sequelize-typescript";

// The platform's client registration at an OAuth authorization server,
// reused by every MCP server and company behind that server.
@Table({ tableName: "AiOAuthClients" })
class AiOAuthClient extends Model<AiOAuthClient> {
  @PrimaryKey
  @AutoIncrement
  @Column
  id: number;

  @Column(DataType.STRING(1000))
  issuer: string;

  @Column(DataType.STRING(1000))
  redirectUri: string;

  @Column(DataType.STRING(1000))
  clientId: string;

  @Column(DataType.TEXT)
  clientSecretEncrypted: string | null;

  @Column
  authMethod: string | null;

  @CreatedAt
  createdAt: Date;

  @UpdatedAt
  updatedAt: Date;
}

export default AiOAuthClient;
