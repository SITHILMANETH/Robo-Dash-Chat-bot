import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

const root = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(root, "public");
const port = Number(process.env.PORT || 3000);
const GEMINI_MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"];

async function readJson(req) {
  let body = "";
  for await (const chunk of req) body += chunk;
  if (!body) return {};
  return JSON.parse(body);
}

function sendJson(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(value));
}

async function chat(req, res) {
  try {
    const { message, history = [] } = await readJson(req);
    if (typeof message !== "string" || !message.trim() || message.length > 500) {
      return sendJson(res, 400, { error: "Message missing or too long" });
    }
    if (!Array.isArray(history)) {
      return sendJson(res, 400, { error: "Invalid history" });
    }
    if (!process.env.GEMINI_API_KEY) {
      return sendJson(res, 500, { error: "GEMINI_API_KEY is not configured" });
    }

    const systemText = await fs.readFile(path.join(root, "rulebook.txt"), "utf8");
    const validHistory = history.filter((item) =>
      item &&
      (item.role === "user" || item.role === "model") &&
      Array.isArray(item.parts) &&
      item.parts.every((part) => part && typeof part.text === "string"),
    ).slice(-6);
    const contents = [
      ...validHistory,
      { role: "user", parts: [{ text: message.trim() }] },
    ];
    let data;
    let response;
    for (const model of GEMINI_MODELS) {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}` +
        `:generateContent?key=${encodeURIComponent(process.env.GEMINI_API_KEY)}`;
      response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: systemText }] },
          contents,
          generationConfig: { temperature: 0.2, maxOutputTokens: 600 },
        }),
      });
      data = await response.json();
      if (response.ok) break;
      console.error(`Gemini ${model} failed:`, response.status, data.error?.message || "");
    }
    if (!response?.ok) {
      return sendJson(res, 502, { error: "Unable to contact the language service" });
    }
    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof reply !== "string" || !reply.trim()) {
      return sendJson(res, 502, { error: "The language service returned no answer" });
    }
    return sendJson(res, 200, { reply });
  } catch (error) {
    console.error("Chat handler failed:", error);
    return sendJson(res, 500, { error: "Server error. Please try again." });
  }
}

async function speech(req, res) {
  try {
    const { text } = await readJson(req);
    if (typeof text !== "string" || !text.trim() || text.length > 3000) {
      return sendJson(res, 400, { error: "Text missing or too long" });
    }
    if (!process.env.ELEVENLABS_API_KEY) {
      return sendJson(res, 500, { error: "ELEVENLABS_API_KEY is not configured" });
    }
    const client = new ElevenLabsClient();
    const audio = await client.textToSpeech.convert("JBFqnCBsd6RMkjVDRZzb", {
      text: text.trim(),
      modelId: "eleven_flash_v2_5",
      outputFormat: "mp3_44100_128",
      voiceSettings: { stability: 0.4, similarityBoost: 0.75 },
    });
    const chunks = [];
    for await (const chunk of audio) chunks.push(Buffer.from(chunk));
    res.writeHead(200, {
      "Content-Type": "audio/mpeg",
      "Cache-Control": "no-store",
    });
    res.end(Buffer.concat(chunks));
  } catch (error) {
    console.error("ElevenLabs request failed:", error);
    return sendJson(res, 502, { error: "Unable to generate speech" });
  }
}

async function serveStatic(req, res) {
  const requested = req.url === "/" ? "/index.html" : req.url.split("?")[0];
  const filePath = path.resolve(publicDir, "." + requested);
  if (!filePath.startsWith(publicDir + path.sep)) {
    res.writeHead(403).end("Forbidden");
    return;
  }
  try {
    const body = await fs.readFile(filePath);
    const extension = path.extname(filePath);
    const types = {
      ".html": "text/html; charset=utf-8",
      ".gif": "image/gif",
      ".css": "text/css; charset=utf-8",
      ".js": "text/javascript; charset=utf-8",
    };
    res.writeHead(200, { "Content-Type": types[extension] || "application/octet-stream" });
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
}

const server = http.createServer(async (req, res) => {
  if (req.method === "POST" && req.url === "/api/chat") return chat(req, res);
  if (req.method === "POST" && req.url === "/api/speech") return speech(req, res);
  if (req.method === "GET") return serveStatic(req, res);
  sendJson(res, 405, { error: "Method not allowed" });
});

server.listen(port, "127.0.0.1", () => {
  console.log(`RoboDash is running at http://127.0.0.1:${port}`);
});
