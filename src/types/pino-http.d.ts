declare module "pino-http" {
  import type { RequestHandler } from "express";
  const pinoHttp: (options?: unknown) => RequestHandler;
  export default pinoHttp;
}
