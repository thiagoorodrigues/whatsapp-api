import {
  getRemotePhoneJid,
  getParticipantPhoneJid,
  resolvePhoneJid,
  getContactJid
} from "../GetPhoneJid";

describe("getRemotePhoneJid", () => {
  it("returns the phone JID untouched when remoteJid is already a phone", () => {
    expect(
      getRemotePhoneJid({ remoteJid: "553191147761@s.whatsapp.net" })
    ).toBe("553191147761@s.whatsapp.net");
  });

  it("resolves a LID remoteJid through senderPn", () => {
    expect(
      getRemotePhoneJid({
        remoteJid: "140716097450191@lid",
        senderPn: "553191147761@s.whatsapp.net"
      })
    ).toBe("553191147761@s.whatsapp.net");
  });

  it("falls back to remoteJidAlt when senderPn is missing", () => {
    expect(
      getRemotePhoneJid({
        remoteJid: "140716097450191@lid",
        remoteJidAlt: "553191147761@s.whatsapp.net"
      })
    ).toBe("553191147761@s.whatsapp.net");
  });

  it("keeps the LID when no phone alias is available", () => {
    expect(getRemotePhoneJid({ remoteJid: "140716097450191@lid" })).toBe(
      "140716097450191@lid"
    );
  });

  it("leaves group JIDs alone", () => {
    expect(getRemotePhoneJid({ remoteJid: "1203630@g.us" })).toBe(
      "1203630@g.us"
    );
  });

  it("returns undefined when there is no remoteJid", () => {
    expect(getRemotePhoneJid({})).toBeUndefined();
  });
});

describe("getParticipantPhoneJid", () => {
  it("resolves a LID participant through participantPn", () => {
    expect(
      getParticipantPhoneJid({
        participant: "99@lid",
        participantPn: "5511999@s.whatsapp.net"
      })
    ).toBe("5511999@s.whatsapp.net");
  });

  it("returns undefined when there is no participant", () => {
    expect(getParticipantPhoneJid({ remoteJid: "1@lid" })).toBeUndefined();
  });
});

describe("resolvePhoneJid", () => {
  const lookupFrom = (map: Record<string, string>) => async (lid: string) =>
    map[lid];

  it("uses senderPn without touching the lookup", async () => {
    const lookup = jest.fn();
    await expect(
      resolvePhoneJid(
        {
          remoteJid: "140716097450191@lid",
          senderPn: "553191147761@s.whatsapp.net"
        },
        lookup
      )
    ).resolves.toBe("553191147761@s.whatsapp.net");
    expect(lookup).not.toHaveBeenCalled();
  });

  it("resolves an outgoing LID (no senderPn) through the known mapping", async () => {
    await expect(
      resolvePhoneJid(
        { remoteJid: "140716097450191@lid", fromMe: true } as any,
        lookupFrom({ "140716097450191@lid": "553191147761@s.whatsapp.net" })
      )
    ).resolves.toBe("553191147761@s.whatsapp.net");
  });

  it("keeps the LID when nothing maps it", async () => {
    await expect(
      resolvePhoneJid({ remoteJid: "999@lid" }, lookupFrom({}))
    ).resolves.toBe("999@lid");
  });

  it("does not look up phone JIDs", async () => {
    const lookup = jest.fn();
    await expect(
      resolvePhoneJid({ remoteJid: "5531@s.whatsapp.net" }, lookup)
    ).resolves.toBe("5531@s.whatsapp.net");
    expect(lookup).not.toHaveBeenCalled();
  });
});

describe("getContactJid", () => {
  it("sends to the LID when the contact already talks through it", () => {
    expect(
      getContactJid({ number: "553191147761", lid: "140716097450191@lid" })
    ).toBe("140716097450191@lid");
  });

  it("sends to the phone JID when there is no LID yet", () => {
    expect(getContactJid({ number: "553191147761", lid: null })).toBe(
      "553191147761@s.whatsapp.net"
    );
  });

  it("ignores a malformed LID", () => {
    expect(getContactJid({ number: "553191147761", lid: "140716097450191" })).toBe(
      "553191147761@s.whatsapp.net"
    );
  });

  it("uses the group JID for groups, whatever the LID", () => {
    expect(
      getContactJid({ number: "120363000000@g.us", lid: "1@lid" }, true)
    ).toBe("120363000000@g.us");
    expect(getContactJid({ number: "120363000000" }, true)).toBe("120363000000@g.us");
  });
});
