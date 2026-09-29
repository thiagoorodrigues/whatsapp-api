import { KeyRepo, KeyRow, makeSignalKeyStore, parseKey, serializeKey } from "../baileysKeyStore";

const memoryRepo = () => {
  const rows = new Map<string, KeyRow>();
  const k = (type: string, id: string) => `${type}:${id}`;
  const repo: KeyRepo & { rows: Map<string, KeyRow>; finds: number } = {
    rows,
    finds: 0,
    async find(type, ids) {
      repo.finds += 1;
      return ids.map(id => rows.get(k(type, id))).filter(Boolean) as KeyRow[];
    },
    async upsert(list) {
      list.forEach(r => rows.set(k(r.type, r.keyId), r));
    },
    async remove(type, ids) {
      ids.forEach(id => rows.delete(k(type, id)));
    }
  };
  return repo;
};

describe("baileysKeyStore", () => {
  it("round-trips Buffers inside a key value", () => {
    const value = { private: Buffer.from("abc"), public: Buffer.from("xyz"), n: 1 };
    const back = parseKey(serializeKey(value)) as any;
    expect(Buffer.isBuffer(back.private)).toBe(true);
    expect(back.private.toString()).toBe("abc");
    expect(back.n).toBe(1);
    expect(serializeKey(value)).toContain('"type":"Buffer"');
  });

  it("stores only the keys that changed and returns only the ids found", async () => {
    const repo = memoryRepo();
    const store = makeSignalKeyStore(repo);
    await store.set({ "pre-key": { "1": { keyPair: { private: Buffer.from("p") } } as any, "2": { keyPair: {} } as any } });
    expect(repo.rows.size).toBe(2);

    const got = (await store.get("pre-key", ["1", "3"])) as any;
    expect(Object.keys(got)).toEqual(["1"]);
    expect(Buffer.isBuffer(got["1"].keyPair.private)).toBe(true);
  });

  it("removes a key when Baileys sets it to null", async () => {
    const repo = memoryRepo();
    const store = makeSignalKeyStore(repo);
    await store.set({ session: { "a@1": { x: 1 } as any } });
    await store.set({ session: { "a@1": null } });
    expect(repo.rows.size).toBe(0);
  });

  it("does not hit the repository for an empty id list", async () => {
    const repo = memoryRepo();
    const store = makeSignalKeyStore(repo);
    expect(await store.get("session", [])).toEqual({});
    expect(repo.finds).toBe(0);
  });

  it("revives app-state-sync-key values through the given hook", async () => {
    const repo = memoryRepo();
    const revive = jest.fn(v => ({ revived: v }));
    const store = makeSignalKeyStore(repo, { reviveAppStateSyncKey: revive });
    await store.set({ "app-state-sync-key": { k1: { keyData: Buffer.from("d") } as any } });
    const got = (await store.get("app-state-sync-key", ["k1"])) as any;
    expect(revive).toHaveBeenCalledTimes(1);
    expect(got.k1.revived.keyData.toString()).toBe("d");
  });
});
