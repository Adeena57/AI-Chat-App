import "./App.css";
import { useState, useEffect, useMemo } from "react";
import { OPENROUTER_API_KEY, OPENROUTER_CHAT_URL, OPENROUTER_MODEL, OPENROUTER_MODEL_FALLBACKS, } from "./constants";

const STORAGE_CHATS = "gemini-chats-v1";
const STORAGE_ACTIVE = "gemini-active-chat-id";

function loadChats() {
  try {
    const raw = localStorage.getItem(STORAGE_CHATS);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function truncateTitle(text, max = 44) {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, max)}…`;
}

function truncateJson(value, max = 1200) {
  try {
    const s = typeof value === "string" ? value : JSON.stringify(value);
    return s.length > max ? `${s.slice(0, max)}…` : s;
  } catch {
    return String(value).slice(0, max);
  }
}

/** OpenRouter often returns message "Provider returned error"; real cause is usually in error.metadata.raw */
function formatOpenRouterError(data, httpStatus) {
  const err = data?.error;
  const bits = [];
  if (httpStatus >= 400) bits.push(`HTTP ${httpStatus}`);
  if (err?.code != null) bits.push(`code ${err.code}`);
  if (err?.message) bits.push(err.message);
  const m = err?.metadata;
  if (m?.provider_name) bits.push(`provider: ${m.provider_name}`);
  if (m?.raw != null) bits.push(`upstream: ${truncateJson(m.raw, 1000)}`);
  if (Array.isArray(m?.reasons) && m.reasons.length) bits.push(`moderation: ${m.reasons.join(", ")}`);
  if (!bits.length && data != null) bits.push(truncateJson(data, 900));
  return `[API error] ${bits.join(" — ")}`;
}

function choiceAssistantText(choice) {
  const raw = choice?.message?.content;
  if (typeof raw === "string" && raw.trim()) return raw;
  if (Array.isArray(raw)) {
    const text = raw
      .map((part) => typeof part === "string" ? part : part?.text ?? part?.content ?? "")
      .filter(Boolean)
      .join("");
    if (text.trim()) return text;
  }
  return "";
}

function extractOpenRouterReply(data, response) {
  const choice = data?.choices?.[0];
  const text = choiceAssistantText(choice);
  if (choice?.finish_reason === "error") {
    return formatOpenRouterError(data, response.status);
  }
  if (!response.ok || (data?.error && !text.trim())) {
    return formatOpenRouterError(data, response.status);
  }
  if (text) return text;
  const reason = choice?.finish_reason;
  if (reason && reason !== "stop" && reason !== "length") {
    return `[Stopped] finish_reason: ${reason}`;
  }
  return `[No response] ${truncateJson(data, 600)}`;
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

function isRateLimited(response, data) {
  if (response.status === 429) return true;
  const raw = data?.error?.metadata?.raw;
  const blob = `${data?.error?.message || ""} ${typeof raw === "string" ? raw : JSON.stringify(raw ?? "")}`;
  return /rate.?limit|rate-limited|429/i.test(blob);
}

/** Retries on 429, then cycles through fallback free models (different upstream providers). */
async function openRouterComplete(openaiMessages) {
  const models = [
    OPENROUTER_MODEL,
    ...OPENROUTER_MODEL_FALLBACKS.filter((m) => m && m !== OPENROUTER_MODEL),
  ];
  let lastData = {};
  let lastResponse = null;
  for (const model of models) {
    for (let attempt = 0; attempt < 2; attempt++) {
      lastResponse = await fetch(OPENROUTER_CHAT_URL, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${OPENROUTER_API_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": typeof window !== "undefined" ? window.location.origin : "",
          "X-OpenRouter-Title": "react-ai",
        },
        body: JSON.stringify({ model, messages: openaiMessages }),
      });
      lastData = await lastResponse.json().catch(() => ({}));
      if (lastResponse.status === 401 || lastResponse.status === 402) {
        return extractOpenRouterReply(lastData, lastResponse);
      }
      if (isRateLimited(lastResponse, lastData)) {
        const ra = lastResponse.headers.get("retry-after");
        const waitMs = ra ? Math.min(Number(ra) * 1000, 20000) : Math.min(2500 * (attempt + 1), 12000);
        await sleep(Number.isFinite(waitMs) && waitMs > 0 ? waitMs : 3000);
        continue;
      }
      if (lastResponse.ok) {
        const reply = extractOpenRouterReply(lastData, lastResponse);
        if (!reply.startsWith("[API error]")) return reply;
        break;
      }
      break;
    }
  }
  return extractOpenRouterReply(lastData, lastResponse);
}

function App() {
  const [chats, setChats] = useState(loadChats);
  const [activeChatId, setActiveChatId] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_ACTIVE) || null;
    } catch {
      return null;
    }
  });
  const [question, setQuestion] = useState("");
const [loading, setLoading] = useState(false);
  const [theme, setTheme] = useState(() => {
    try {
      return localStorage.getItem('theme') || 'dark';
    } catch {
      return 'dark';
    }
  });

  useEffect(() => {
    localStorage.setItem(STORAGE_CHATS, JSON.stringify(chats));
  }, [chats]);

  useEffect(() => {
    if (activeChatId) localStorage.setItem(STORAGE_ACTIVE, activeChatId);
    else localStorage.removeItem(STORAGE_ACTIVE);
  }, [activeChatId]);

useEffect(() => {
    if (!activeChatId) return;
    if (!chats.some((c) => c.id === activeChatId)) {
      setActiveChatId(chats[0]?.id ?? null);
    }
  }, [chats, activeChatId]);

  useEffect(() => {
    try {
      localStorage.setItem('theme', theme);
    } catch {
      // Ignore localStorage errors
    }
  }, [theme]);

  const activeChat = useMemo(
    () => chats.find((c) => c.id === activeChatId) ?? null,
    [chats, activeChatId]
  );

  const deleteChat = (id, e) => {
    e?.stopPropagation();
    let nextList = [];
    setChats((prev) => {
      nextList = prev.filter((c) => c.id !== id);
      return nextList;
    });
    setActiveChatId((cur) => (cur === id ? nextList[0]?.id ?? null : cur));
  };

  const deleteAllChats = () => {
    if (!chats.length) return;
    if (!window.confirm("Delete all chats? This cannot be undone.")) return;
    setChats([]);
    setActiveChatId(null);
  };

  const startNewChat = () => {
    setActiveChatId(null);
    setQuestion("");
  };

  const askQuestion = async () => {
    if (!question.trim() || loading) return;
    const q = question.trim();
    setQuestion("");
    const chatId = activeChatId || crypto.randomUUID();
    const isNew = !activeChatId;
    const priorMessages = isNew ? [] : chats.find((c) => c.id === chatId)?.messages ?? [];
    const messagesForApi = [...priorMessages, { role: "user", text: q }];
    if (isNew) {
      setChats((prev) => [
        {
          id: chatId,
          title: truncateTitle(q),
          messages: messagesForApi,
        },
        ...prev,
      ]);
      setActiveChatId(chatId);
    } else {
      setChats((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, messages: messagesForApi } : c))
      );
    }

    if (!OPENROUTER_API_KEY) {
      const hint = "[Setup] Create .env.local in the project root with VITE_OPENROUTER_API_KEY=your_key and restart the dev server.";
      const withError = [
        ...messagesForApi,
        { role: "model", text: hint },
      ];
      setChats((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, messages: withError } : c))
      );
      return;
    }

    const openaiMessages = messagesForApi.map((m) => ({
      role: m.role === "user" ? "user" : "assistant",
      content: m.text,
    }));

    setLoading(true);
    try {
      const reply = await openRouterComplete(openaiMessages);
      const withAnswer = [
        ...messagesForApi,
        { role: "model", text: reply },
      ];
      setChats((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, messages: withAnswer } : c))
      );
    } catch (err) {
      console.error(err);
      const msg =
        err?.message?.includes("fetch") || err?.name === "TypeError"
          ? "Network error — check connection, API key, and browser console (CORS)."
          : `Error: ${err?.message || String(err)}`;
      const withError = [...messagesForApi, { role: "model", text: msg }];
      setChats((prev) =>
        prev.map((c) => (c.id === chatId ? { ...c, messages: withError } : c))
      );
    } finally {
      setLoading(false);
    }
  };

const toggleTheme = () => setTheme((t) => (t === 'dark' ? 'light' : 'dark'));

  const onKeyDown = (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      askQuestion();
    }
  };

  return (
    <div className="App gpt-app flex h-screen overflow-hidden" data-theme={theme}>
      <aside className="gpt-sidebar flex w-[min(100%,260px)] shrink-0 flex-col min-h-0 sm:w-[260px]">
        <div className="shrink-0 flex flex-row gap-2 border-b border-[var(--gpt-border)] p-3">
          <button type="button" onClick={startNewChat} className="gpt-btn-new">
            <span className="text-lg leading-none font-light">+</span>
            New chat
          </button>
          <button
            type="button"
            onClick={toggleTheme}
            className="gpt-theme-toggle"
            aria-label="Toggle theme"
            title="Toggle light/dark mode"
          >
            {theme === 'dark' ? '☀️' : '🌙'}
          </button>
          <button
            type="button"
            onClick={deleteAllChats}
            disabled={!chats.length}
            className="gpt-btn-danger"
          >
            Delete all chats
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden py-2">
          {chats.length === 0 && (
            <p className="gpt-hint-sidebar">No chats yet. Send a message to start.</p>
          )}
          {chats.map((c) => (
            <div
              key={c.id}
              role="button"
              tabIndex={0}
              onClick={() => setActiveChatId(c.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setActiveChatId(c.id);
                }
              }}
              className={`gpt-chat-row ${
                c.id === activeChatId ? "gpt-chat-row-active" : ""
              }`}
            >
              <span className="min-w-0 flex-1 line-clamp-2 break-words text-left">
                {c.title || "Untitled"}
              </span>
              <button
                type="button"
                aria-label="Delete chat"
                onClick={(e) => deleteChat(c.id, e)}
                className="gpt-chat-delete"
              >
                ×
              </button>
            </div>
          ))}
        </div>
      </aside>
      <main className="gpt-main flex min-h-0 min-w-0 flex-1 flex-col">
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
            {!activeChat && (
              <p className="gpt-empty">
                How can I help you today? <br />
                <span className="text-sm opacity-80">
                  Start a new chat or pick one from the sidebar.
                </span>
              </p>
            )}
            {activeChat?.messages?.map((m, i) => (
              <div
                key={`${m.role}-${i}`}
                className={`flex w-full ${
                  m.role === "user" ? "justify-end" : "justify-start"
                }`}
              >
                {m.role === "user" ? (
                  <div className="gpt-msg-user">
                    <pre className="whitespace-pre-wrap font-sans">{m.text}</pre>
                  </div>
                ) : (
                  <div className="gpt-msg-assistant">
                    <pre>{m.text}</pre>
                  </div>
                )}
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="gpt-typing" aria-live="polite">
                  <span className="gpt-typing-dot" />
                  <span className="gpt-typing-dot" />
                  <span className="gpt-typing-dot" />
                </div>
              </div>
            )}
          </div>
        </div>
        <div className="shrink-0 border-t border-[var(--gpt-border)] bg-[var(--gpt-main)] px-4 pb-5 pt-3 sm:px-6">
          <div className="gpt-input-wrap">
            <input
              type="text"
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={onKeyDown}
              disabled={loading}
              className="gpt-input"
              placeholder={activeChatId ? "Message…" : "Ask anything…"}
            />
            <button
              type="button"
              disabled={loading || !question.trim()}
              className="gpt-send"
              onClick={askQuestion}
              aria-label="Send message"
            >
              ↑
            </button>
          </div>
          <p className="mx-auto mt-2 max-w-3xl text-center text-xs text-[var(--gpt-muted)]">
            AI can make mistakes. Check important info.
          </p>
        </div>
      </main>
    </div>
  );
}

export default App;

