import type { Express } from "express";
import { createServer, type Server } from "node:http";

export async function registerRoutes(app: Express): Promise<Server> {
  const httpServer = createServer(app);
  return httpServer;
}
