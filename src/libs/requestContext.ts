import { AsyncLocalStorage } from "async_hooks";
import { Request, Response } from "express";

// The request being handled, for logs written deep inside services.
export const requestContext = new AsyncLocalStorage<{ req: Request; res: Response }>();
