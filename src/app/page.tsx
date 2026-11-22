"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Result = {
  description_en: string;
  description_id: string;
  objects: string[];
  scene: string;
  model: string;
  latency_ms: number;
};

const SAMPLES = [
  { src: "/samples/desk-laptop.jpg", label: "Laptop workspace", file: "desk-laptop.jpg" },
  { src: "/samples/beach-rock.jpg", label: "Rocky beach", file: "beach-rock.jpg" },
  { src: "/samples/barn-night.jpg", label: "Barn at night", file: "barn-night.jpg" },
];

const MAX_EDGE = 1280;

/** Resize large photos in the browser so uploads stay fast (tie-breaker: latency). */
async function resizeImage(file: File): Promise<File> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  if (scale === 1 && file.type === "image/jpeg") return file;
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.85)
  );
  bitmap.close();
  if (!blob) return file;
  return new File([blob], file.name.replace(/\.[^.]+$/, ".jpg"), { type: "image/jpeg" });
}

export default function Home() {
  const [preview, setPreview] = useState<string | null>(null);
  const [previewName, setPreviewName] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [clientMs, setClientMs] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [speaking, setSpeaking] = useState<"en" | "id" | null>(null);
  const [ttsSupported, setTtsSupported] = useState(true);
  const [copied, setCopied] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTtsSupported("speechSynthesis" in window);
    return () => {
      if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    };
  }, []);

  const describe = useCallback(async (file: File) => {
    setLoading(true);
    setError(null);
    setErrorCode(null);
    setResult(null);
    setClientMs(null);
    setPreviewName(file.name);
    const started = performance.now();
    try {
      const resized = await resizeImage(file);
      setPreview(URL.createObjectURL(resized));
      const form = new FormData();
      form.append("image", resized);
      const res = await fetch("/api/describe", { method: "POST", body: form });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Something went wrong. Please try again.");
        setErrorCode(data.code ?? null);
        return;
      }
      setResult(data as Result);
      setClientMs(Math.round(performance.now() - started));
    } catch {
      setError("Could not reach the server. Check your connection and try again.");
      setErrorCode("NETWORK_ERROR");
    } finally {
      setLoading(false);
    }
  }, []);

  const onFile = useCallback(
    (file: File | undefined | null) => {
      if (!file) return;
      if (!file.type.startsWith("image/")) {
        setError("That file is not a photo. Please choose a JPG, PNG, WebP or GIF image.");
        setErrorCode("INVALID_IMAGE");
        return;
      }
      if (file.size > 10 * 1024 * 1024) {
        setError("That photo is over the 10 MB limit. Please choose a smaller one.");
        setErrorCode("IMAGE_TOO_LARGE");
        return;
      }
      void describe(file);
    },
    [describe]
  );

  const onSample = useCallback(
    async (sample: (typeof SAMPLES)[number]) => {
      setLoading(true);
      setError(null);
      setErrorCode(null);
      setResult(null);
      try {
        const res = await fetch(sample.src);
        const blob = await res.blob();
        await describe(new File([blob], sample.file, { type: blob.type || "image/jpeg" }));
      } catch {
        setError("Could not load the sample photo. Check your connection and try again.");
        setErrorCode("NETWORK_ERROR");
        setLoading(false);
      }
    },
    [describe]
  );

  const speak = useCallback(
    (lang: "en" | "id") => {
      if (!("speechSynthesis" in window) || !result) return;
      const text = lang === "en" ? result.description_en : result.description_id;
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = lang === "en" ? "en-US" : "id-ID";
      const voices = window.speechSynthesis.getVoices();
      const voice =
        voices.find((v) => v.lang.toLowerCase().startsWith(utter.lang.toLowerCase())) ||
        voices.find((v) => v.lang.toLowerCase().startsWith(lang));
      if (voice) utter.voice = voice;
      utter.onend = () => setSpeaking(null);
      utter.onerror = () => setSpeaking(null);
      setSpeaking(lang);
      window.speechSynthesis.speak(utter);
    },
    [result]
  );

  const stopSpeaking = useCallback(() => {
    if ("speechSynthesis" in window) window.speechSynthesis.cancel();
    setSpeaking(null);
  }, []);

  const copyTranscript = useCallback(async () => {
    if (!result) return;
    const text = `SnapSpeak — ${result.scene}\n\nEnglish:\n${result.description_en}\n\nBahasa Indonesia:\n${result.description_id}\n\nObjects: ${result.objects.join(", ")}`;
    await navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [result]);

  return (
    <main className="min-h-screen bg-gradient-to-b from-indigo-50 via-white to-amber-50 text-slate-800">
      <div className="mx-auto max-w-3xl px-4 py-10 sm:px-6">
        {/* Header */}
        <header className="text-center">
          <p className="text-sm font-semibold tracking-widest text-indigo-600 uppercase">
            📸 Image in &rarr; Text + Speech out
          </p>
          <h1 className="mt-2 text-4xl font-extrabold tracking-tight text-slate-900 sm:text-5xl">
            SnapSpeak
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-lg text-slate-600">
            A Visual Search Assistant. Upload a photo — Gemini describes what it
            sees in English and Bahasa Indonesia, and reads it aloud.
          </p>
          <p className="mt-2 text-sm text-slate-500">
            Built for accessibility and on-the-go learning &middot; StackUp November
            Coding Challenge &middot; Theme: From Words to Worlds — Multimodal GenAI
          </p>
        </header>

        {/* Upload */}
        <section
          className={`mt-8 rounded-2xl border-2 border-dashed bg-white p-6 text-center shadow-sm transition ${
            dragOver ? "border-indigo-500 bg-indigo-50" : "border-slate-300"
          }`}
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            onFile(e.dataTransfer.files?.[0]);
          }}
        >
          <p className="text-2xl">🖼️</p>
          <p className="mt-2 font-semibold">
            {dragOver ? "Drop your photo here" : "Drag & drop a photo, or choose one"}
          </p>
          <p className="mt-1 text-sm text-slate-500">
            JPG, PNG, WebP or GIF &middot; up to 10 MB &middot; resized in your
            browser before upload for a faster answer
          </p>
          <button
            onClick={() => inputRef.current?.click()}
            className="mt-4 rounded-full bg-indigo-600 px-6 py-2.5 font-semibold text-white shadow hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-indigo-400"
          >
            Choose a photo
          </button>
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp,image/gif"
            className="hidden"
            onChange={(e) => {
              onFile(e.target.files?.[0]);
              e.target.value = "";
            }}
          />
          <div className="mt-5">
            <p className="text-sm font-medium text-slate-500">
              No photo handy? Try a sample:
            </p>
            <div className="mt-2 flex flex-wrap justify-center gap-2">
              {SAMPLES.map((s) => (
                <button
                  key={s.src}
                  onClick={() => void onSample(s)}
                  disabled={loading}
                  className="rounded-full border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium hover:border-indigo-400 hover:text-indigo-700 disabled:opacity-50"
                >
                  {s.label}
                </button>
              ))}
            </div>
          </div>
        </section>

        {/* Error */}
        {error && (
          <div
            role="alert"
            className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-left"
          >
            <p className="font-semibold text-red-700">⚠️ Couldn&apos;t describe that photo</p>
            <p className="mt-1 text-sm text-red-700">{error}</p>
            {errorCode && (
              <p className="mt-1 font-mono text-xs text-red-500">Error code: {errorCode}</p>
            )}
            {errorCode === "MISSING_API_KEY" && (
              <p className="mt-2 text-sm text-red-700">
                Setup: copy <code className="rounded bg-red-100 px-1">.env.example</code> to{" "}
                <code className="rounded bg-red-100 px-1">.env.local</code>, paste a free Gemini
                key from{" "}
                <a
                  className="underline"
                  href="https://aistudio.google.com/apikey"
                  target="_blank"
                  rel="noreferrer"
                >
                  Google AI Studio
                </a>
                , then restart the server.
              </p>
            )}
          </div>
        )}

        {/* Loading */}
        {loading && (
          <div className="mt-6 rounded-xl border border-indigo-200 bg-indigo-50 p-4 text-center">
            <p className="font-semibold text-indigo-700" aria-live="polite">
              🔍 Gemini is looking at your photo…
            </p>
            <p className="mt-1 text-sm text-indigo-600">
              This usually takes a few seconds.
            </p>
          </div>
        )}

        {/* Preview + result */}
        {preview && (
          <section className="mt-6 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={preview} alt={previewName || "Uploaded photo"} className="max-h-96 w-full object-contain bg-slate-100" />
            {result && (
              <div className="p-5 sm:p-6">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-indigo-100 px-3 py-1 text-xs font-semibold text-indigo-700">
                    Scene: {result.scene}
                  </span>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-600">
                    Model: {result.model}
                  </span>
                  <span className="rounded-full bg-emerald-100 px-3 py-1 text-xs font-medium text-emerald-700">
                    ⚡ {clientMs !== null ? `${(clientMs / 1000).toFixed(1)}s end-to-end` : "done"}
                    {` · ${result.latency_ms}ms server`}
                  </span>
                </div>

                {/* Objects */}
                {result.objects.length > 0 && (
                  <div className="mt-4">
                    <h2 className="text-sm font-semibold tracking-wide text-slate-500 uppercase">
                      Objects detected
                    </h2>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {result.objects.map((o) => (
                        <span
                          key={o}
                          className="rounded-full border border-indigo-200 bg-indigo-50 px-3 py-1 text-sm text-indigo-800"
                        >
                          {o}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* English */}
                <div className="mt-5">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-semibold text-slate-900">🇬🇧 Description — English</h2>
                    <button
                      onClick={() => (speaking === "en" ? stopSpeaking() : speak("en"))}
                      disabled={!ttsSupported}
                      className="rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
                    >
                      {speaking === "en" ? "⏹ Stop" : "🔊 Listen"}
                    </button>
                  </div>
                  <p className="mt-2 leading-relaxed text-slate-700">{result.description_en}</p>
                </div>

                {/* Indonesian */}
                <div className="mt-5 border-t border-slate-100 pt-5">
                  <div className="flex items-center justify-between gap-2">
                    <h2 className="font-semibold text-slate-900">🇮🇩 Deskripsi — Bahasa Indonesia</h2>
                    <button
                      onClick={() => (speaking === "id" ? stopSpeaking() : speak("id"))}
                      disabled={!ttsSupported}
                      className="rounded-full bg-emerald-600 px-4 py-1.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50"
                    >
                      {speaking === "id" ? "⏹ Berhenti" : "🔊 Dengarkan"}
                    </button>
                  </div>
                  <p className="mt-2 leading-relaxed text-slate-700">{result.description_id}</p>
                </div>

                {!ttsSupported && (
                  <p className="mt-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">
                    🔊 Your browser doesn&apos;t support speech synthesis, so the Listen
                    buttons are unavailable — the text transcript above still works.
                  </p>
                )}

                <button
                  onClick={() => void copyTranscript()}
                  className="mt-5 rounded-full border border-slate-300 px-4 py-2 text-sm font-medium hover:border-indigo-400 hover:text-indigo-700"
                >
                  {copied ? "✅ Copied!" : "📋 Copy full transcript"}
                </button>
              </div>
            )}
          </section>
        )}

        {/* How it works */}
        <section className="mt-10 rounded-2xl bg-white p-6 shadow-sm">
          <h2 className="text-lg font-bold text-slate-900">How it works — image in, text + speech out</h2>
          <ol className="mt-3 list-decimal space-y-2 pl-5 text-slate-600">
            <li>
              <strong className="text-slate-800">You upload a photo</strong> (or pick a
              sample). It is resized in your browser to at most 1280px so the upload
              stays fast.
            </li>
            <li>
              <strong className="text-slate-800">Gemini 3.5 Flash sees the photo</strong> and
              writes a description plus the objects in it — in English and Bahasa
              Indonesia.
            </li>
            <li>
              <strong className="text-slate-800">You read or listen.</strong> The transcript
              is shown in both languages; the Listen buttons read it aloud with the
              free Web Speech API (no key, no cost).
            </li>
          </ol>
          <p className="mt-4 text-sm text-slate-500">
            No account, no database, no tracking. Your photo is sent only to Gemini
            to generate the description. A free Gemini API key is required — see the
            README for the 2-minute setup.
          </p>
        </section>

        <footer className="mt-8 text-center text-xs text-slate-400">
          SnapSpeak · StackUp November Coding Challenge · Next.js + Gemini 3.5 Flash +
          Web Speech API · Free tier only
        </footer>
      </div>
    </main>
  );
}
