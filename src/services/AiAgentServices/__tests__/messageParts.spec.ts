import { splitReply, splitToolConfig, typingDelay, waitToolConfig } from "../messageParts";
import { buildSystemPrompt, SPLIT_RULE } from "../prompt";

describe("splitReply", () => {
  it("sends one message per paragraph", () => {
    expect(splitReply("Oi, Maria! 😊\n\nO plano custa R$ 49,90.\n \nQuer que eu envie o link?")).toEqual([
      "Oi, Maria! 😊",
      "O plano custa R$ 49,90.",
      "Quer que eu envie o link?"
    ]);
  });

  it("keeps a list and its line breaks in the same message", () => {
    const list = "Temos três planos:\n- Básico\n- Plus\n- Premium";
    expect(splitReply(`${list}\n\nQual te interessa?`)).toEqual([list, "Qual te interessa?"]);
  });

  it("cuts a long single paragraph at sentence ends", () => {
    const sentence = "Essa é uma frase de exemplo com umas oitenta letras para encher o parágrafo todo. ";
    const parts = splitReply(sentence.repeat(8).trim());
    expect(parts.length).toBeGreaterThan(1);
    parts.forEach(p => {
      expect(p.length).toBeLessThanOrEqual(260);
      expect(p.endsWith(".")).toBe(true);
    });
    expect(parts.join(" ")).toBe(sentence.repeat(8).trim());
  });

  it("puts the rest in the last message when there are too many parts", () => {
    const parts = splitReply(["a", "b", "c", "d", "e", "f", "g", "h"].join("\n\n"));
    expect(parts).toHaveLength(6);
    expect(parts[5]).toBe("f\n\ng\n\nh");
  });

  it("returns nothing for an empty reply", () => {
    expect(splitReply("  \n\n ")).toEqual([]);
  });
});

describe("typingDelay", () => {
  it("grows with the text between 1 and 4 seconds", () => {
    expect(typingDelay("oi")).toBe(1000);
    expect(typingDelay("x".repeat(100))).toBe(3000);
    expect(typingDelay("x".repeat(1000))).toBe(4000);
  });

  it("uses the configured seconds for every message", () => {
    expect(typingDelay("oi", 5)).toBe(5000);
    expect(typingDelay("x".repeat(1000), 2)).toBe(2000);
  });
});

describe("splitToolConfig", () => {
  it("keeps the pause between 1 and 30 whole seconds, or automatic", () => {
    expect(splitToolConfig({ enabled: true, delay: "3" })).toEqual({ enabled: true, delay: 3 });
    expect(splitToolConfig({ enabled: true, delay: 90 })).toEqual({ enabled: true, delay: 30 });
    expect(splitToolConfig({ enabled: true, delay: 0.4 })).toEqual({ enabled: true, delay: 1 });
    expect(splitToolConfig({ enabled: true, delay: "" })).toEqual({ enabled: true, delay: null });
    expect(splitToolConfig({ enabled: true, delay: -2 })).toEqual({ enabled: true, delay: null });
    expect(splitToolConfig(undefined)).toEqual({ enabled: false, delay: null });
  });
});

describe("split rule in the prompt", () => {
  it("is added only when the agent splits its messages", () => {
    expect(buildSystemPrompt("Você é a Ana.")).not.toContain(SPLIT_RULE);
    expect(buildSystemPrompt("Você é a Ana.", undefined, true)).toContain(SPLIT_RULE);
  });
});

describe("waitToolConfig", () => {
  it("keeps the wait between 1 and 60 whole seconds", () => {
    expect(waitToolConfig({ enabled: true, seconds: "10" })).toEqual({ enabled: true, seconds: 10 });
    expect(waitToolConfig({ enabled: true, seconds: 600 })).toEqual({ enabled: true, seconds: 60 });
    expect(waitToolConfig({ enabled: true, seconds: "" })).toEqual({ enabled: true, seconds: 3 });
    expect(waitToolConfig(undefined)).toEqual({ enabled: false, seconds: 3 });
  });
});
