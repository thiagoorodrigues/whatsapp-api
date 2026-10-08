jest.mock("../../controllers/SystemLogController", () => ({ index: jest.fn(), summary: jest.fn(), client: jest.fn() }));
// eslint-disable-next-line import/first
import systemLogRoutes from "../systemLogRoutes";

const layers = () =>
  (systemLogRoutes as any).stack.map((l: any) => ({
    path: `${Object.keys(l.route.methods)[0]} ${l.route.path}`,
    names: l.route.stack.map((s: any) => s.handle.name)
  }));

describe("systemLogRoutes", () => {
  it("only super users read the logs", () => {
    const byPath = Object.fromEntries(layers().map((l: any) => [l.path, l.names]));
    expect(byPath["get /system-logs"].slice(0, 2)).toEqual(["isAuth", "isSuper"]);
    expect(byPath["get /system-logs/summary"].slice(0, 2)).toEqual(["isAuth", "isSuper"]);
  });
  it("any logged user can report a browser error", () => {
    const byPath = Object.fromEntries(layers().map((l: any) => [l.path, l.names]));
    expect(byPath["post /system-logs/client"][0]).toBe("isAuth");
    expect(byPath["post /system-logs/client"]).not.toContain("isSuper");
  });
  it("declares /summary before any parametrized route", () => {
    expect(layers().map((l: any) => l.path)).toEqual(["get /system-logs", "get /system-logs/summary", "post /system-logs/client"]);
  });
});
