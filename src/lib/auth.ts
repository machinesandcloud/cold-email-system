import type { Request, Response, NextFunction } from "express";
import { config } from "./config.js";

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  const token = req.header("x-admin-token");
  if (!config.adminToken || token !== config.adminToken) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  next();
}
