import AppError from "../../errors/AppError";
import { assertIntegration, companyIntegrations } from "../../helpers/integrationAccess";
import { decryptSecret, encryptSecret, secretHint } from "../../helpers/secretBox";
import CompanyIntegration from "../../models/CompanyIntegration";
import { availableProviders, getProvider, IntegrationError, IntegrationProvider, IntegrationTool } from "./providers";

export interface IntegrationView {
  key: string;
  name: string;
  description: string;
  tools: IntegrationTool[];
  connected: boolean;
  status: "connected" | "error" | null;
  tokenHint: string | null;
  lastCheckedAt: Date | null;
  lastError: string | null;
}

const view = (provider: IntegrationProvider, row?: CompanyIntegration | null): IntegrationView => ({
  key: provider.key,
  name: provider.name,
  description: provider.description,
  tools: provider.tools,
  connected: !!row,
  status: row ? (row.status as "connected" | "error") : null,
  tokenHint: row?.tokenHint ?? null,
  lastCheckedAt: row?.lastCheckedAt ?? null,
  lastError: row?.lastError ?? null
});

const asAppError = (err: unknown): unknown => {
  if (!(err instanceof IntegrationError)) return err;
  if (err.kind === "auth") return new AppError("ERR_INTEGRATION_TOKEN_REJECTED", 400);
  // O motivo da Plamev vai como está (o app mostra o texto que não é código).
  if (err.kind === "rejected") return new AppError(err.message, 400);
  return new AppError("ERR_INTEGRATION_UNREACHABLE", 502);
};

// Tokens are pasted from e-mails, PDFs and chats: drop whitespace and
// zero-width characters anywhere. What is left must fit in an HTTP header.
const cleanToken = (token: unknown): string => {
  const clean = typeof token === "string" ? token.replace(/[\s\u200b-\u200d\u2060\ufeff]/g, "") : "";
  if (!clean) throw new AppError("ERR_INTEGRATION_TOKEN_REQUIRED", 400);
  if (/[^\x21-\x7e]/.test(clean)) throw new AppError("ERR_INTEGRATION_TOKEN_INVALID", 400);
  return clean;
};

const UNREADABLE_TOKEN = "O token salvo não pôde ser lido. Cole o token de novo.";

const findRow = (companyId: number, provider: string) =>
  CompanyIntegration.unscoped().findOne({ where: { companyId, provider } });

// Catalog for the plan form (super only).
export const listCatalog = (): { key: string; name: string }[] =>
  availableProviders().map(p => ({ key: p.key, name: p.name }));

export const listForCompany = async (companyId: number): Promise<IntegrationView[]> => {
  const keys = await companyIntegrations(companyId);
  const providers = keys.map(getProvider).filter((p): p is IntegrationProvider => !!p && p.isAvailable());
  if (!providers.length) return [];
  const rows = await CompanyIntegration.findAll({ where: { companyId, provider: providers.map(p => p.key) } });
  return providers.map(p => view(p, rows.find(r => r.provider === p.key)));
};

// Tests the token first; nothing is stored when the partner refuses it.
export const connect = async (companyId: number, key: string, token: unknown): Promise<IntegrationView> => {
  const provider = await assertIntegration(companyId, key);
  const clean = cleanToken(token);

  try {
    await provider.testConnection(clean);
  } catch (err) {
    throw asAppError(err);
  }

  const data = {
    tokenEncrypted: encryptSecret(clean),
    tokenHint: secretHint(clean),
    status: "connected",
    lastCheckedAt: new Date(),
    lastError: null
  };
  const existing = await findRow(companyId, key);
  const row = existing ? await existing.update(data) : await CompanyIntegration.create({ companyId, provider: key, ...data } as any);
  return view(provider, row);
};

// Re-tests the saved token; a refusal is recorded, not thrown.
export const testSaved = async (companyId: number, key: string): Promise<IntegrationView> => {
  const provider = await assertIntegration(companyId, key);
  const row = await findRow(companyId, key);
  if (!row) throw new AppError("ERR_INTEGRATION_NOT_CONNECTED", 404);

  let token: string;
  try {
    token = decryptSecret(row.tokenEncrypted);
  } catch {
    // SECRETS_KEY changed or the payload is damaged: the user must paste it again.
    await row.update({ status: "error", lastCheckedAt: new Date(), lastError: UNREADABLE_TOKEN });
    return view(provider, row);
  }

  try {
    await provider.testConnection(token);
    await row.update({ status: "connected", lastCheckedAt: new Date(), lastError: null });
  } catch (err) {
    if (!(err instanceof IntegrationError)) throw err;
    await row.update({ status: "error", lastCheckedAt: new Date(), lastError: err.message });
  }
  return view(provider, row);
};

export const disconnect = async (companyId: number, key: string): Promise<void> => {
  await assertIntegration(companyId, key);
  const row = await findRow(companyId, key);
  if (row) await row.destroy();
};

// Runs a partner call with the company's saved token (server side only). A
// refused or unreadable token marks the connection as error, so the admin
// sees it in Settings.
export const withSavedToken = async <T>(companyId: number, key: string, fn: (token: string) => Promise<T>): Promise<T> => {
  await assertIntegration(companyId, key);
  const row = await findRow(companyId, key);
  if (!row) throw new AppError("ERR_INTEGRATION_NOT_CONNECTED", 404);

  let token: string;
  try {
    token = decryptSecret(row.tokenEncrypted);
  } catch {
    await row.update({ status: "error", lastCheckedAt: new Date(), lastError: UNREADABLE_TOKEN });
    throw new AppError("ERR_INTEGRATION_TOKEN_UNREADABLE", 400);
  }

  try {
    return await fn(token);
  } catch (err) {
    if (err instanceof IntegrationError && err.kind === "auth") {
      await row.update({ status: "error", lastCheckedAt: new Date(), lastError: err.message });
    }
    throw asAppError(err);
  }
};
