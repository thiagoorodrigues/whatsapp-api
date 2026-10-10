export type IntegrationErrorKind = "auth" | "unreachable";

// Failure talking to a partner API. The message never carries the token.
export class IntegrationError extends Error {
  constructor(public kind: IntegrationErrorKind, message: string) {
    super(message);
    this.name = "IntegrationError";
  }
}

export interface IntegrationTool {
  key: string;
  label: string;
}

export interface IntegrationProvider {
  key: string;
  name: string;
  description: string;
  tools: IntegrationTool[];
  // False when the server lacks what the integration needs (e.g. API URL).
  isAvailable(): boolean;
  // Resolves when the partner accepts the token; throws IntegrationError.
  testConnection(token: string): Promise<void>;
}
