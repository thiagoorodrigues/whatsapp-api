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
  return err.kind === "auth"
    ? new AppError("ERR_INTEGRATION_TOKEN_REJECTED", 400)
    : new AppError("ERR_INTEGRATION_UNREACHABLE", 502);
};

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
  const clean = typeof token === "string" ? token.trim() : "";
  if (!clean) throw new AppError("ERR_INTEGRATION_TOKEN_REQUIRED", 400);

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

  try {
    await provider.testConnection(decryptSecret(row.tokenEncrypted));
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
