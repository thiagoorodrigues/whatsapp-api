import path from "path";
import uploadConfig from "../upload";
import {
  engine,
  gatewayConfig,
  isWhatsmeow,
  validateEngineConfig
} from "../whatsappEngine";

const KEYS = [
  "WHATSAPP_ENGINE",
  "GATEWAY_URL",
  "GATEWAY_TOKEN",
  "GATEWAY_MEDIA_ROOT"
];
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  KEYS.forEach(k => {
    saved[k] = process.env[k];
    delete process.env[k];
  });
});

afterEach(() => {
  KEYS.forEach(k => {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  });
});

describe("engine", () => {
  it("padrão é baileys", () => {
    expect(engine()).toBe("baileys");
    expect(isWhatsmeow()).toBe(false);
  });

  it("string vazia vale como padrão", () => {
    process.env.WHATSAPP_ENGINE = "  ";
    expect(engine()).toBe("baileys");
  });

  it("aceita whatsmeow", () => {
    process.env.WHATSAPP_ENGINE = "whatsmeow";
    expect(engine()).toBe("whatsmeow");
    expect(isWhatsmeow()).toBe(true);
  });

  it("valor inválido lança", () => {
    process.env.WHATSAPP_ENGINE = "outro";
    expect(() => engine()).toThrow(/WHATSAPP_ENGINE/);
  });
});

describe("gatewayConfig", () => {
  it("whatsmeow sem URL e token lança citando os dois", () => {
    process.env.WHATSAPP_ENGINE = "whatsmeow";
    expect(() => gatewayConfig()).toThrow(/GATEWAY_URL.*GATEWAY_TOKEN/);
  });

  it("whatsmeow sem token lança", () => {
    process.env.WHATSAPP_ENGINE = "whatsmeow";
    process.env.GATEWAY_URL = "http://localhost:8090";
    expect(() => gatewayConfig()).toThrow(/GATEWAY_TOKEN/);
  });

  it("mediaRoot padrão é a pasta de uploads e a URL perde a barra final", () => {
    process.env.WHATSAPP_ENGINE = "whatsmeow";
    process.env.GATEWAY_URL = "http://localhost:8090/";
    process.env.GATEWAY_TOKEN = "t";
    expect(gatewayConfig()).toEqual({
      url: "http://localhost:8090",
      token: "t",
      mediaRoot: uploadConfig.directory
    });
  });

  it("GATEWAY_MEDIA_ROOT sobrescreve", () => {
    process.env.WHATSAPP_ENGINE = "whatsmeow";
    process.env.GATEWAY_URL = "http://g";
    process.env.GATEWAY_TOKEN = "t";
    process.env.GATEWAY_MEDIA_ROOT = "/data/media";
    expect(gatewayConfig().mediaRoot).toBe(path.resolve("/data/media"));
  });

  it("com baileys não lança mesmo sem variáveis", () => {
    expect(gatewayConfig()).toEqual({
      url: "",
      token: "",
      mediaRoot: uploadConfig.directory
    });
  });
});

describe("validateEngineConfig", () => {
  it("devolve null quando tudo certo", () => {
    expect(validateEngineConfig()).toBeNull();
  });

  it("devolve a mensagem de erro quando inválido", () => {
    process.env.WHATSAPP_ENGINE = "x";
    expect(validateEngineConfig()).toMatch(/WHATSAPP_ENGINE/);
    process.env.WHATSAPP_ENGINE = "whatsmeow";
    expect(validateEngineConfig()).toMatch(/GATEWAY_URL/);
  });
});
