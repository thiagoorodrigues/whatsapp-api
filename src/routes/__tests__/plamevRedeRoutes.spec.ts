jest.mock("../../controllers/IntegrationController", () => ({
  catalog: jest.fn(), index: jest.fn(), update: jest.fn(), test: jest.fn(), remove: jest.fn(),
  plamevEstados: jest.fn(), plamevCidades: jest.fn(), plamevBairros: jest.fn(), plamevCep: jest.fn(), plamevImagem: jest.fn(), plamevPlanos: jest.fn(), plamevPlanoImagem: jest.fn(), plamevRacas: jest.fn(), plamevCampanhas: jest.fn(), plamevTabelas: jest.fn(), plamevSimular: jest.fn(), plamevCotacaoImagem: jest.fn(), plamevCredenciados: jest.fn(), plamevProximidade: jest.fn()
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
    ["get /integrations/plamev/estados", "get /integrations/plamev/cidades", "get /integrations/plamev/bairros", "get /integrations/plamev/cep", "post /integrations/plamev/rede-imagem", "get /integrations/plamev/planos", "post /integrations/plamev/plano-imagem", "get /integrations/plamev/racas", "get /integrations/plamev/campanhas", "get /integrations/plamev/tabelas", "post /integrations/plamev/cotacao/simular", "post /integrations/plamev/cotacao-imagem", "get /integrations/plamev/credenciados", "get /integrations/plamev/proximidade"].forEach(path => {
      expect(byPath[path]?.[0]).toBe("isAuth");
      expect(byPath[path]).not.toContain("isAdmin");
    });
  });
});
