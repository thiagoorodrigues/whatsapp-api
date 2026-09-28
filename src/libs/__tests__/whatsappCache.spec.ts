import { cachedGroupMetadata, cachedProfilePicture, forgetGroup, getGroupMetadata } from "../whatsappCache";

const socket = (id: number): any => ({
  id,
  groupMetadata: jest.fn(async (jid: string) => ({ id: jid, subject: `Grupo ${id}` })),
  profilePictureUrl: jest.fn()
});

describe("whatsappCache", () => {
  it("asks WhatsApp for a group once per connection until it changes", async () => {
    const a = socket(1);
    const b = socket(2);
    await getGroupMetadata(a, "120363001@g.us");
    await getGroupMetadata(a, "120363001@g.us");
    expect(a.groupMetadata).toHaveBeenCalledTimes(1);
    expect((await getGroupMetadata(b, "120363001@g.us")).subject).toBe("Grupo 2");
    expect(await cachedGroupMetadata(1)("120363001@g.us")).toEqual({ id: "120363001@g.us", subject: "Grupo 1" });

    forgetGroup(1, "120363001@g.us");
    await getGroupMetadata(a, "120363001@g.us");
    expect(a.groupMetadata).toHaveBeenCalledTimes(2);
  });

  it("caches profile pictures, including 'no picture'", async () => {
    const fetch = jest.fn().mockRejectedValue(new Error("item-not-found"));
    expect(await cachedProfilePicture(3, "5511999999999@s.whatsapp.net", fetch)).toBe("");
    expect(await cachedProfilePicture(3, "5511999999999@s.whatsapp.net", fetch)).toBe("");
    expect(fetch).toHaveBeenCalledTimes(1);
    const other = jest.fn().mockResolvedValue("https://pps.whatsapp.net/a.jpg");
    expect(await cachedProfilePicture(4, "5511999999999@s.whatsapp.net", other)).toBe("https://pps.whatsapp.net/a.jpg");
  });
});
