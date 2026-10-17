jest.mock("../../controllers/IntegrationController", () => ({
  catalog: jest.fn(), index: jest.fn(), update: jest.fn(), test: jest.fn(), remove: jest.fn(),
  plamevEstados: jest.fn(), plamevCidades: jest.fn(), plamevBairros: jest.fn(), plamevCep: jest.fn(),
  plamevImagem: jest.fn(), plamevPlanos: jest.fn(), plamevPlanoImagem: jest.fn(), plamevRacas: jest.fn(),
  plamevCampanhas: jest.fn(), plamevTabelas: jest.fn(), plamevSimular: jest.fn(), plamevCotacaoImagem: jest.fn(),
  plamevCredenciados: jest.fn(), plamevProximidade: jest.fn(), plamevLocais: jest.fn()
}));
// eslint-disable-next-line import/first
import integrationRoutes from "../integrationRoutes";

const byPath = () =>
  Object.fromEntries(
    (integrationRoutes as any).stack.map((l: any) => [
      `${Object.keys(l.route.methods)[0]} ${l.route.path}`,
      l.route.stack.map((s: any) => s.handle.name)
    ])
  );

describe("integrationRoutes", () => {
  it("catalog is super only", () => {
    expect(byPath()["get /integrations/catalog"].slice(0, 2)).toEqual(["isAuth", "isSuper"]);
  });
  it("any logged user lists the company integrations", () => {
    expect(byPath()["get /integrations"][0]).toBe("isAuth");
    expect(byPath()["get /integrations"]).not.toContain("isAdmin");
    expect(byPath()["get /integrations"]).not.toContain("isSuper");
  });
  it("only admins change the token", () => {
    const p = byPath();
    ["put /integrations/:provider", "post /integrations/:provider/test", "delete /integrations/:provider"].forEach(path =>
      expect(p[path].slice(0, 2)).toEqual(["isAuth", "isAdmin"])
    );
  });
  it("every Plamev tool needs a logged user", () => {
    const p = byPath();
    const plamev = Object.keys(p).filter(k => k.includes("/integrations/plamev/"));
    expect(plamev.length).toBe(15);
    plamev.forEach(k => expect(p[k][0]).toBe("isAuth"));
  });
  it("declares /catalog before /:provider", () => {
    const paths = (integrationRoutes as any).stack.map((l: any) => l.route.path);
    expect(paths.indexOf("/integrations/catalog")).toBeLessThan(paths.indexOf("/integrations/:provider"));
  });
});
