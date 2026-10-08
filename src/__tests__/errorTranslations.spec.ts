import fs from "fs";
import path from "path";

// Todo código de erro da API precisa de texto no painel (senão o usuário vê
// só "Erro: ERR_X"). Pula quando o repo do painel não está ao lado.
const ptPath = path.resolve(__dirname, "../../../whatsapp-app/src/translate/languages/pt.js");
const maybe = fs.existsSync(ptPath) ? describe : describe.skip;

const walk = (dir: string): string[] =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === "__tests__" ? [] : walk(full);
    return full.endsWith(".ts") ? [full] : [];
  });

maybe("error translations", () => {
  it("has a Portuguese text for every AppError code", () => {
    const pt = fs.readFileSync(ptPath, "utf8");
    const codes = new Set<string>();
    walk(path.resolve(__dirname, "..")).forEach(file => {
      const source = fs.readFileSync(file, "utf8");
      for (const m of source.matchAll(/AppError\(\s*["'`]([A-Z][A-Z0-9_]{2,})["'`:]/g)) codes.add(m[1]);
    });
    codes.add("ERR_INTERNAL");
    const missing = [...codes].filter(code => !new RegExp(`^\\s*${code}:`, "m").test(pt));
    expect(missing).toEqual([]);
  });
});
