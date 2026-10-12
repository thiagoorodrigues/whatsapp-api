jest.mock("../../controllers/IntegrationController", () => ({
  catalog: jest.fn(), index: jest.fn(), update: jest.fn(), test: jest.fn(), remove: jest.fn(),
  plamevEstados: jest.fn(), plamevCidades: jest.fn(), plamevBairros: jest.fn(), plamevCredenciados: jest.fn()
}));
// eslint-disable-next-line import/first
import integrationRoutes from "../integrationRoutes";

describe("Plamev rede routes", () => {
  it("any logged user of the company can search (plan and connection checked in the service)", () => {
    const byPath = Object.fromEntries(
      (integrationRoutes as any).stack.map((l: any) => [
        `${Object.keys(l.route.methods)[0]} ${l.route.path}`,
        l.route.stack.map((s: any) => s.handle.name)
      ])
    );
    ["get /integrations/plamev/estados", "get /integrations/plamev/cidades", "get /integrations/plamev/bairros", "get /integrations/plamev/credenciados"].forEach(path => {
      expect(byPath[path]?.[0]).toBe("isAuth");
      expect(byPath[path]).not.toContain("isAdmin");
    });
  });
});
