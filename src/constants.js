/** https://openrouter.ai/api/v1/chat/completions */
export const OPENROUTER_CHAT_URL =
  "https://openrouter.ai/api/v1/chat/completions";

/** Set `VITE_OPENROUTER_API_KEY` in `.env.local` (project root), then restart `npm run dev`. */
export const OPENROUTER_API_KEY =
  import.meta.env.VITE_OPENROUTER_API_KEY?.trim() || "";

/**
 * Any model id from https://openrouter.ai/models — free models often end with `:free`.
 * Override with `VITE_OPENROUTER_MODEL` in `.env.local`.
 */
export const OPENROUTER_MODEL =
  import.meta.env.VITE_OPENROUTER_MODEL?.trim() ||
  "qwen/qwen3.6-plus:free";

/**
 * If the primary model hits 429 / upstream rate limits, we retry with backoff then try these (different providers).
 * Override with comma-separated `VITE_OPENROUTER_MODEL_FALLBACKS` in `.env.local`.
 */
function parseFallbacksFromEnv() {
  const raw = import.meta.env.VITE_OPENROUTER_MODEL_FALLBACKS?.trim();
  if (!raw) return null;
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const OPENROUTER_MODEL_FALLBACKS =
  parseFallbacksFromEnv() ?? [
    "meta-llama/llama-3.3-70b-instruct:free",
    "openai/gpt-oss-120b:free",
    "google/gemini-2.0-flash-exp:free",
  ];
