import fs from "node:fs/promises";
import path from "node:path";

const MODELS = ["gemini-3.8-flash", "gemini-3.5-flash-lite", "gemini-flash-lite-latest"];

function isHistoryMessage(value) {
  return (
    value &&
    (value.role === "user" || value.role === "model") &&
    Array.isArray(value.parts) &&
    value.parts.every((part) => part && typeof part.text === "string")
  );
}

export default async function handler(req, res) {
  res.setHeader("Access-Control-Allow-Origin", "https://sithilmaneth.github.io");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  if (req.method === "OPTIONS") return res.status(204).end();
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const { message, history = [] } = req.body || {};
  if (typeof message !== "string" || !message.trim() || message.length > 500) {
    return res.status(400).json({ error: "Message missing or too long" });
  }

  if (!Array.isArray(history)) {
    return res.status(400).json({ error: "Invalid history" });
  }

  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "GEMINI_API_KEY is not configured" });
  }

  try {
    const systemText = await fs.readFile(
      path.join(process.cwd(), "rulebook.txt"),
      "utf8",
    );
    const contents = [
      ...history.filter(isHistoryMessage).slice(-6),
      { role: "user", parts: [{ text: message.trim() }] },
    ];
    let data;
    let response;
    for (const model of MODELS) {
      const url =
        `https://generativelanguage.googleapis.com/v1beta/models/${model}` +
        `:generateContent?key=${encodeURIComponent(apiKey)}`;
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
      console.error(`Gemini ${model} failed:`, response.status, data);
    }
    if (!response?.ok) {
      return res.status(502).json({ error: "Unable to contact the language service" });
    }

    const reply = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (typeof reply !== "string" || !reply.trim()) {
      return res.status(502).json({ error: "The language service returned no answer" });
    }
    return res.status(200).json({ reply });
  } catch (error) {
    console.error("Chat handler failed:", error);
    return res.status(500).json({ error: "Server error. Please try again." });
  }
}
