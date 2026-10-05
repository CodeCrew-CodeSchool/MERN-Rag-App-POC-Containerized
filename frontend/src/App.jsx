import { useEffect, useState } from "react";
import "./App.css";

export default function App() {
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(false);

  /** Fetches the current backend service status. */
  async function refreshStatus() {
    try {
      const response = await fetch("/api/status");
      setStatus(await response.json());
    } catch {
      setStatus({ backend: "unavailable", ollama: "unknown", mongodb: "unknown" });
    }
  }

  useEffect(function loadStatus() {
    refreshStatus();
  }, []);

  /** Sends the current question to the backend RAG API. */
  async function handleSubmit(event) {
    event.preventDefault();
    const question = message.trim();

    if (!question || loading) {
      return;
    }

    setMessages(function addQuestion(current) {
      return [...current, { role: "You", text: question }];
    });
    setMessage("");
    setLoading(true);

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: question }),
      });
      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error || "Request failed");
      }

      setMessages(function addReply(current) {
        return [...current, { role: "RAG", text: data.reply || "No response returned." }];
      });
    } catch (error) {
      setMessages(function addError(current) {
        return [...current, { role: "Error", text: error.message }];
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="app-shell">
      <section className="panel">
        <header>
          <p className="eyebrow">EmbedJS RAG Template</p>
          <h1>React + Node + Ollama</h1>
          <p className="subtitle">
            RAG sources are configured in <code>backend/app.mjs</code>. The client only sends questions.
          </p>
        </header>

        <div className="status-grid" aria-label="Service status">
          <Status name="Backend" value={status?.backend} />
          <Status name="Ollama" value={status?.ollama} />
          <Status name="MongoDB" value={status?.mongodb} />
          <Status name="Vector DB" value={status?.rag?.vectorDatabase} neutral />
        </div>

        <div className="rag-summary">
          <span>LLM: {status?.rag?.model || "checking…"}</span>
          <span>Embeddings: {status?.rag?.embeddingModel || "checking…"}</span>
          <span>Configured sources: {status?.rag?.configuredSources ?? 0}</span>
        </div>

        <div className="messages" aria-live="polite">
          {messages.length === 0 ? (
            <p className="empty-state">Ask a question about the sources configured by the backend developer.</p>
          ) : (
            messages.map(function renderMessage(item, index) {
              return (
                <article className={`message ${item.role.toLowerCase()}`} key={`${item.role}-${index}`}>
                  <strong>{item.role}</strong>
                  <p>{item.text}</p>
                </article>
              );
            })
          )}
        </div>

        <form onSubmit={handleSubmit} className="chat-form">
          <label htmlFor="message">Question</label>
          <div className="input-row">
            <input
              id="message"
              value={message}
              onChange={function updateMessage(event) {
                setMessage(event.target.value);
              }}
              placeholder="Ask a question about the configured sources..."
              autoComplete="off"
            />
            <button type="submit" disabled={loading || !message.trim()}>
              {loading ? "Thinking…" : "Ask"}
            </button>
          </div>
        </form>
      </section>
    </main>
  );
}

/** Displays one service status card. */
function Status({ name, value, neutral = false }) {
  const displayValue = value || "checking…";
  const isHealthy = displayValue === "ok";

  return (
    <div className="status-card">
      <span className={`status-dot ${isHealthy ? "healthy" : ""} ${neutral ? "neutral" : ""}`} />
      <div>
        <span className="status-label">{name}</span>
        <span className="status-value">{displayValue}</span>
      </div>
    </div>
  );
}
