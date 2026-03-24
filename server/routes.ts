import type { Express } from "express";
import { createServer, type Server } from "node:http";
import path from "node:path";
export async function registerRoutes(app: Express): Promise<Server> {
  app.get("/terms", (_req, res) => {
    res.sendFile(path.join(__dirname, "templates", "terms.html"));
  });
  app.get("/privacy", (_req, res) => {
    res.sendFile(path.join(__dirname, "templates", "privacy.html"));
  });
  const httpServer = createServer(app);
  return httpServer;
}
