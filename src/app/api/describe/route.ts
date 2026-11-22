import { NextRequest, NextResponse } from "next/server";

/**
 * POST /api/describe
 * Accepts multipart form data with an `image` file (jpg/png/webp, <= 10 MB),
 * sends it to Gemini (vision) and returns a bilingual description plus the
 * list of detected objects as JSON.
 *
 * Response (200):
 *   { description_en, description_id, objects, scene, model, latency_ms }
 * Errors (4xx/5xx) always carry a machine-readable `code` and a human
 * readable `error` message so the UI can explain what went wrong.
 */

const MAX_BYTES = 10 * 1024 * 1024;
const ALLOWED_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];
const DEFAULT_MODEL = "gemini-3.5-flash";

const PROMPT = `You are SnapSpeak, a visual search assistant for accessibility and on-the-go learning.
Look at the photo carefully and answer ONLY with a single JSON object (no markdown fences, no extra text) with exactly these keys:
- "description_en": a vivid 2-4 sentence description in English: what is in the photo, who/what is doing what, the setting and the mood.
- "description_id": the same description translated into natural, fluent Bahasa Indonesia (2-4 sentences).
- "objects": an array of 4-10 short object labels visible in the photo, in English, most prominent first (e.g. "red bicycle", "wooden table"). No duplicates.
- "scene": a 2-4 word scene label in English (e.g. "busy street market", "quiet mountain lake").
If the image is unclear, say so inside the descriptions instead of inventing details.`;

type GeminiResult = {
  description_en: string;
  description_id: string;
  objects: string[];
  scene: string;
};

function parseGeminiText(text: string): GeminiResult {
  // Gemini sometimes wraps JSON in ```json fences — strip them.
  let cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```\s*$/, "")
    .trim();
  // Defense in depth: the model occasionally returns the JSON object
  // stringified *inside* its own description field (double-wrapped JSON).
  // Unwrap up to 3 levels until the description is plain prose.
  for (let depth = 0; depth < 3; depth++) {
    const parsed = JSON.parse(cleaned) as Partial<GeminiResult>;
    const description_en = String(parsed.description_en ?? "").trim();
    if (!description_en) throw new Error("Gemini returned an incomplete description.");
    if (description_en.startsWith("{") && description_en.includes('"description_en"')) {
      cleaned = description_en;
      continue;
    }
    const description_id = String(parsed.description_id ?? "").trim();
    if (!description_id) throw new Error("Gemini returned an incomplete description.");
    const objects = Array.isArray(parsed.objects)
      ? parsed.objects.map((o) => String(o).trim()).filter(Boolean).slice(0, 10)
      : [];
    return {
      description_en,
      description_id,
      objects,
      scene: String(parsed.scene ?? "").trim() || "photo",
    };
  }
  throw new Error("Gemini returned a nested description that could not be unwrapped.");
}

export async function POST(req: NextRequest) {
  const started = Date.now();
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    return NextResponse.json(
      {
        code: "MISSING_API_KEY",
        error:
          "No Gemini API key is configured. Copy .env.example to .env.local and set GEMINI_API_KEY (free key from https://aistudio.google.com/apikey), then restart the server.",
      },
      { status: 500 }
    );
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json(
      { code: "INVALID_REQUEST", error: "Could not read the uploaded file. Please try again." },
      { status: 400 }
    );
  }

  const file = form.get("image");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { code: "NO_IMAGE", error: "No photo was uploaded. Choose a photo or try a sample photo." },
      { status: 400 }
    );
  }
  if (!ALLOWED_TYPES.includes(file.type)) {
    return NextResponse.json(
      {
        code: "INVALID_IMAGE",
        error: `That file is not a supported photo (got ${file.type || "unknown type"}). Please upload a JPG, PNG, WebP or GIF image.`,
      },
      { status: 400 }
    );
  }
  if (file.size > MAX_BYTES) {
    return NextResponse.json(
      {
        code: "IMAGE_TOO_LARGE",
        error: `The photo is ${(file.size / 1024 / 1024).toFixed(1)} MB, over the 10 MB limit. Please choose a smaller photo.`,
      },
      { status: 400 }
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const base64 = buffer.toString("base64");
  const model = process.env.GEMINI_MODEL || DEFAULT_MODEL;

  let res: Response;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: PROMPT },
                { inline_data: { mime_type: file.type, data: base64 } },
              ],
            },
          ],
          generationConfig: {
            temperature: 0.4,
            maxOutputTokens: 1024,
            // Ask for strict JSON output so the response parses reliably.
            responseMimeType: "application/json",
          },
        }),
      }
    );
  } catch {
    return NextResponse.json(
      {
        code: "GEMINI_UNREACHABLE",
        error: "Could not reach Gemini. Check your internet connection and try again.",
      },
      { status: 502 }
    );
  }

  if (!res.ok) {
    if (res.status === 429) {
      return NextResponse.json(
        {
          code: "RATE_LIMITED",
          error:
            "Gemini is rate-limited right now (free-tier quota). Please wait a minute and try again.",
        },
        { status: 429 }
      );
    }
    if (res.status === 400 || res.status === 403) {
      return NextResponse.json(
        {
          code: "INVALID_API_KEY",
          error:
            "Gemini rejected the API key. Check GEMINI_API_KEY in .env.local (free key from https://aistudio.google.com/apikey) and restart the server.",
        },
        { status: 502 }
      );
    }
    return NextResponse.json(
      { code: "GEMINI_ERROR", error: `Gemini returned an error (HTTP ${res.status}). Please try again.` },
      { status: 502 }
    );
  }

  const payload = (await res.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  const text = payload.candidates?.[0]?.content?.parts
    ?.map((p) => p.text ?? "")
    .join("")
    .trim();
  if (!text) {
    return NextResponse.json(
      { code: "EMPTY_RESPONSE", error: "Gemini returned an empty description. Please try another photo." },
      { status: 502 }
    );
  }

  let result: GeminiResult;
  try {
    result = parseGeminiText(text);
  } catch {
    // Never show raw model output (it may be a JSON blob) to the user.
    return NextResponse.json(
      {
        code: "PARSE_ERROR",
        error: "Gemini's answer could not be read. Please try again — it usually works on the next attempt.",
      },
      { status: 502 }
    );
  }

  return NextResponse.json({ ...result, model, latency_ms: Date.now() - started });
}
