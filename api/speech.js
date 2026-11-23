import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";
import { Readable } from "node:stream";

const VOICE_ID = "JBFqnCBsd6RMkjVDRZzb";

export default async function handler(req, res) {
  if (req.method !== "POST") {
    return res.status(405).json({ error: "Use POST" });
  }

  const { text } = req.body || {};
  if (typeof text !== "string" || !text.trim() || text.length > 3000) {
    return res.status(400).json({ error: "Text missing or too long" });
  }

  if (!process.env.ELEVENLABS_API_KEY) {
    return res.status(500).json({ error: "ELEVENLABS_API_KEY is not configured" });
  }

  try {
    const client = new ElevenLabsClient();
    const audio = await client.textToSpeech.convert(VOICE_ID, {
      text: text.trim(),
      modelId: "eleven_flash_v2_5",
      outputFormat: "mp3_44100_128",
      voiceSettings: {
        stability: 0.4,
        similarityBoost: 0.75,
      },
    });
    const stream = Readable.fromWeb(audio);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    res.setHeader("Content-Type", "audio/mpeg");
    res.setHeader("Cache-Control", "no-store");
    return res.status(200).send(Buffer.concat(chunks));
  } catch (error) {
    console.error("ElevenLabs request failed:", error);
    return res.status(502).json({ error: "Unable to generate speech" });
  }
}
