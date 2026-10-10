jest.mock("../../controllers/WhatsAppController", () => new Proxy({}, { get: () => jest.fn() }));
// eslint-disable-next-line import/first
import whatsappRoutes from "../whatsappRoutes";

describe("import progress route", () => {
  it("any logged user of the company reads the progress", () => {
    const layer = (whatsappRoutes as any).stack.find((l: any) => l.route?.path === "/whatsapp/:whatsappId/import-progress");
    expect(layer).toBeDefined();
    expect(Object.keys(layer.route.methods)).toEqual(["get"]);
    expect(layer.route.stack[0].handle.name).toBe("isAuth");
  });
});
