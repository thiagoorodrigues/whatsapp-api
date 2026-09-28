import { getMentionedJids, mentionToken, mentionsToText, previewWithMentions } from "../mentions";

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

describe("mentionsToText", () => {
  it("writes the name, then the formatted phone, then keeps the digits", () => {
    expect(
      mentionsToText("oi @1 @2 @3", [
        { token: "1", name: "Maria", phone: "5511999999999" },
        { token: "2", name: null, phone: "5531991147761" },
        { token: "3", name: null, phone: null }
      ])
    ).toBe("oi @Maria @+55 (31) 99114-7761 @3");
  });

  it("leaves digits that are not a mention and longer numbers alone", () => {
    expect(mentionsToText("@12 @123 @9", [{ token: "12", name: "Ana", phone: null }])).toBe("@Ana @123 @9");
  });

  it("keeps $ patterns literally and ignores empty tokens", () => {
    expect(mentionsToText("@1 a@b.com", [{ token: "1", name: "Ze $&", phone: null }, { token: "", name: "X", phone: null }])).toBe(
      "@Ze $& a@b.com"
    );
  });

  it("returns the text unchanged without mentions", () => {
    expect(mentionsToText("oi", [])).toBe("oi");
    expect(mentionsToText("", undefined)).toBe("");
  });
});

describe("previewWithMentions", () => {
  const mentions = [{ token: "1", name: "Maria", phone: null }];

  it("rewrites the ticket preview when it is this message's text", () => {
    expect(previewWithMentions("oi @1", "oi @1", mentions)).toBe("oi @Maria");
  });

  it("leaves a preview that belongs to another message", () => {
    expect(previewWithMentions("outra mensagem", "oi @1", mentions)).toBeNull();
  });

  it("does nothing when no mention is known by name or phone", () => {
    expect(previewWithMentions("oi @1", "oi @1", [{ token: "1", name: null, phone: null }])).toBeNull();
    expect(previewWithMentions("oi", "oi", [])).toBeNull();
  });
});
