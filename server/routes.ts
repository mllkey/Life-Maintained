import type { Express } from "express";
import { createServer, type Server } from "node:http";
import { createWorker } from "tesseract.js";

function extractReceiptData(text: string): { date?: string; cost?: string; service?: string; provider?: string } {
  const result: { date?: string; cost?: string; service?: string; provider?: string } = {};

  const datePatterns = [
    /\b(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})\b/,
    /\b(\d{4})[\/\-](\d{2})[\/\-](\d{2})\b/,
    /\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\w*\.?\s+(\d{1,2}),?\s+(\d{4})\b/i,
  ];
  for (const p of datePatterns) {
    const m = text.match(p);
    if (m) {
      if (p === datePatterns[1]) {
        result.date = m[0];
      } else if (p === datePatterns[2]) {
        const months: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };
        const month = months[m[1].toLowerCase().slice(0, 3)];
        const year = m[3];
        const day = m[2].padStart(2, "0");
        result.date = `${year}-${month}-${day}`;
      } else {
        const [mm, dd, yy] = [m[1], m[2], m[3]];
        const year = yy.length === 2 ? `20${yy}` : yy;
        result.date = `${year}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
      }
      break;
    }
  }

  const costPatterns = [
    /total[:\s]+\$?\s*(\d+(?:\.\d{2})?)/i,
    /amount[:\s]+\$?\s*(\d+(?:\.\d{2})?)/i,
    /due[:\s]+\$?\s*(\d+(?:\.\d{2})?)/i,
    /\$\s*(\d+\.\d{2})\b/,
  ];
  for (const p of costPatterns) {
    const m = text.match(p);
    if (m) { result.cost = m[1]; break; }
  }

  const serviceKeywords = ["oil change", "tire rotation", "brake", "air filter", "fluid", "inspection", "transmission", "battery", "alignment", "tune-up", "coolant", "spark plug", "wiper", "filter"];
  for (const kw of serviceKeywords) {
    if (text.toLowerCase().includes(kw)) {
      result.service = kw.replace(/\b\w/g, c => c.toUpperCase());
      break;
    }
  }

  const providerPatterns = [
    /jiffy lube/i, /valvoline/i, /firestone/i, /midas/i, /pep boys/i,
    /autozone/i, /advance auto/i, /napa/i, /goodyear/i, /mavis/i,
  ];
  for (const p of providerPatterns) {
    const m = text.match(p);
    if (m) { result.provider = m[0].replace(/\b\w/g, c => c.toUpperCase()); break; }
  }

  return result;
}

export async function registerRoutes(app: Express): Promise<Server> {
  app.post("/api/ocr", async (req, res) => {
    try {
      const { image } = req.body;
      if (!image) return res.status(400).json({ error: "No image provided" });

      const imageBuffer = Buffer.from(image, "base64");
      const worker = await createWorker("eng");
      const { data: { text } } = await worker.recognize(imageBuffer);
      await worker.terminate();

      const extracted = extractReceiptData(text);
      res.json({ ...extracted, raw: text.slice(0, 500) });
    } catch (err: any) {
      console.error("OCR error:", err);
      res.status(500).json({ error: err.message ?? "OCR failed" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}
