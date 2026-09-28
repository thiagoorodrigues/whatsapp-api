import { getMentionedJids, mentionToken } from "../mentions";

describe("getMentionedJids", () => {
  it("reads mentions of an extended text", () => {
    expect(
      getMentionedJids({
        extendedTextMessage: {
          text: "oi @5511999999999 e @140716097450191",
          contextInfo: { mentionedJid: ["5511999999999@s.whatsapp.net", "140716097450191@lid"] }
        }
      })
    ).toEqual(["5511999999999@s.whatsapp.net", "140716097450191@lid"]);
  });

  it("reads mentions in a media caption", () => {
    expect(
      getMentionedJids({ imageMessage: { caption: "@5511999999999", contextInfo: { mentionedJid: ["5511999999999@s.whatsapp.net"] } } })
    ).toEqual(["5511999999999@s.whatsapp.net"]);
  });

  it("reads mentions inside wrapped content (ephemeral / view once / document with caption)", () => {
    expect(
      getMentionedJids({
        ephemeralMessage: {
          message: { extendedTextMessage: { text: "@1", contextInfo: { mentionedJid: ["1@lid"] } } }
        }
      })
    ).toEqual(["1@lid"]);
    expect(
      getMentionedJids({
        documentWithCaptionMessage: {
          message: { documentMessage: { caption: "@2", contextInfo: { mentionedJid: ["2@s.whatsapp.net"] } } }
        }
      })
    ).toEqual(["2@s.whatsapp.net"]);
  });

  it("drops duplicates and ignores missing or invalid input", () => {
    expect(
      getMentionedJids({
        extendedTextMessage: { contextInfo: { mentionedJid: ["1@lid", "1@lid", "", null] } }
      })
    ).toEqual(["1@lid"]);
    expect(getMentionedJids({ conversation: "oi" })).toEqual([]);
    expect(getMentionedJids(null)).toEqual([]);
    expect(getMentionedJids("texto")).toEqual([]);
  });
});

describe("mentionToken", () => {
  it("returns the user digits of a jid", () => {
    expect(mentionToken("5511999999999:3@s.whatsapp.net")).toBe("5511999999999");
    expect(mentionToken("140716097450191@lid")).toBe("140716097450191");
  });
});
