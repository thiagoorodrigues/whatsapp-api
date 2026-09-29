// Signal key store do Baileys sobre um repositório de linhas (type, keyId, value).
// Não importa o pacote do Baileys (ESM) para poder ser testado no Jest.

export type KeyRow = { type: string; keyId: string; value: string };

export interface KeyRepo {
  find(type: string, ids: string[]): Promise<KeyRow[]>;
  upsert(rows: KeyRow[]): Promise<void>;
  remove(type: string, ids: string[]): Promise<void>;
}

// Mesmo formato do BufferJSON do Baileys: { type: "Buffer", data: "<base64>" }.
export const bufferJson = {
  replacer: (_: string, value: any): unknown => {
    if (Buffer.isBuffer(value) || value instanceof Uint8Array || value?.type === "Buffer") {
      return { type: "Buffer", data: Buffer.from(value?.data || value).toString("base64") };
    }
    return value;
  },
  reviver: (_: string, value: any): unknown => {
    if (typeof value === "object" && value !== null && value.type === "Buffer" && typeof value.data === "string") {
      return Buffer.from(value.data, "base64");
    }
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      const keys = Object.keys(value);
      if (keys.length > 0 && keys.every(k => !Number.isNaN(parseInt(k, 10)))) {
        const values = Object.values(value);
        if (values.every(v => typeof v === "number")) return Buffer.from(values as number[]);
      }
    }
    return value;
  }
};

export const serializeKey = (value: unknown): string => JSON.stringify(value, bufferJson.replacer);
export const parseKey = (value: string): unknown => JSON.parse(value, bufferJson.reviver);

type KeyData = { [type: string]: { [id: string]: unknown } };

export interface SignalKeyStoreLike {
  get(type: string, ids: string[]): Promise<{ [id: string]: any }>;
  set(data: KeyData): Promise<void>;
}

export const makeSignalKeyStore = (
  repo: KeyRepo,
  options: { reviveAppStateSyncKey?: (value: unknown) => unknown } = {}
): SignalKeyStoreLike => ({
  get: async (type, ids) => {
    if (!ids.length) return {};
    const rows = await repo.find(type, ids);
    const out: { [id: string]: unknown } = {};
    for (const row of rows) {
      let value = parseKey(row.value);
      if (type === "app-state-sync-key" && options.reviveAppStateSyncKey) {
        value = options.reviveAppStateSyncKey(value);
      }
      out[row.keyId] = value;
    }
    return out;
  },
  set: async data => {
    const upserts: KeyRow[] = [];
    const removals: { [type: string]: string[] } = {};
    for (const type of Object.keys(data)) {
      const entries = data[type] || {};
      for (const keyId of Object.keys(entries)) {
        const value = entries[keyId];
        if (value === null || value === undefined) {
          (removals[type] = removals[type] || []).push(keyId);
        } else {
          upserts.push({ type, keyId, value: serializeKey(value) });
        }
      }
    }
    if (upserts.length) await repo.upsert(upserts);
    for (const type of Object.keys(removals)) await repo.remove(type, removals[type]);
  }
});
