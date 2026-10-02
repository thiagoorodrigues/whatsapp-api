const findOne = jest.fn();
jest.mock("../../models/User", () => ({ __esModule: true, default: { findOne: (...a: any[]) => findOne(...a) } }));
jest.mock("../../models/Ticket", () => ({ __esModule: true, default: { findOne: jest.fn() } }));
jest.mock("../../config/auth", () => ({ __esModule: true, default: { secret: "test-secret" } }));

/* eslint-disable import/first */
import { sign } from "jsonwebtoken";
import { authenticateSocket, initIO } from "../socket";
/* eslint-enable import/first */

describe("authenticateSocket", () => {
  it("accepts a valid access token and keeps id, company and profile", () => {
    const token = sign({ id: 5, companyId: 2, profile: "user" }, "test-secret");
    expect(authenticateSocket(token)).toEqual({ id: 5, companyId: 2, profile: "user" });
  });

  it("refuses no token, a token signed with another secret and an expired one", () => {
    expect(authenticateSocket(undefined)).toBeNull();
    expect(authenticateSocket("")).toBeNull();
    expect(authenticateSocket(sign({ id: 1, companyId: 1 }, "mysecret"))).toBeNull();
    expect(authenticateSocket(sign({ id: 1, companyId: 1, exp: 1 }, "test-secret"))).toBeNull();
    expect(authenticateSocket(sign({ id: 1 }, "test-secret"))).toBeNull();
  });
});

describe("connection", () => {
  it("joins the company room and attaches the join handlers before any await", async () => {
    findOne.mockReturnValue(new Promise(() => undefined)); // never resolves
    const handlers: Record<string, any> = {};
    let onConnection: any;
    const server: any = require("http").createServer();
    const io = initIO(server);
    (io as any).sockets.listeners("connection").forEach((fn: any) => { onConnection = fn; });
    const socket: any = { user: { id: 1, companyId: 7 }, join: jest.fn(), on: (ev: string, fn: any) => { handlers[ev] = fn; } };
    onConnection(socket);
    expect(socket.join).toHaveBeenCalledWith("company-7");
    expect(Object.keys(handlers).sort()).toEqual(["joinChatBox", "joinNotification", "joinTickets"]);
    handlers.joinNotification();
    handlers.joinTickets("open");
    handlers.joinTickets("../x");
    expect(socket.join).toHaveBeenCalledWith("company-7-notification");
    expect(socket.join).toHaveBeenCalledWith("company-7-status-open");
    expect(socket.join).toHaveBeenCalledTimes(3);
    io.close();
  });
});
