import React, { useEffect, useMemo, useState } from "react";
import Sidebar from "./components/Sidebar";
import WorkspaceTabs from "./components/WorkspaceTabs";
import "./ChatPage.css";
import withAuth from "./utils/withauth";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";

const num = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const formatClock = (sec) => {
  const s = Math.max(0, num(sec, 0));
  const mins = Math.floor(s / 60);
  const rest = s - mins * 60;
  return `${String(mins).padStart(2, "0")}:${rest.toFixed(2).padStart(5, "0")}`;
};

const buildContextFromEvent = (event) => {
  if (!event || typeof event !== "object") {
    return {};
  }

  const clipId = event.clipId || null;
  const score = num(event.score, 0);
  const timestamp = num(event.clipTimestampSec, 0);
  const frameCaptions = Array.isArray(event.frameCaptions)
    ? event.frameCaptions.map((fc) => ({
        clipId,
        timestamp: num(fc?.timestampSec, timestamp),
        score,
        text: fc?.caption || "",
      }))
    : [];

  const descriptionParts = [];
  if (event.caption) descriptionParts.push(`Caption: ${event.caption}`);
  if (event.description) descriptionParts.push(`Description: ${event.description}`);

  const topAnomaly = {
    id: event.videoClipId || event.clipId || "clip",
    videoName: event.videoName || null,
    score,
    classification: event.classification || event.eventName || "Unknown",
    timestamp,
    start_frame: event.startFrame ?? 0,
    end_frame: event.endFrame ?? 0,
    caption: event.caption || null,
    description: event.description || null,
    object_detection_summary: event.objectDetectionSummary || {},
    temporal_context: event.temporalContext || null,
  };

  return {
    lastVideo: {
      type: "historique",
      id: event.videoClipId || event.clipId || "historique",
      filename: event.videoName || null,
      videoUrl: null,
    },
    selectedClip: {
      id: event.videoClipId || event.clipId || "clip",
      videoName: event.videoName || null,
      score,
      classification: event.classification || event.eventName || "Unknown",
      timestamp,
      caption: event.caption || null,
      description: event.description || null,
      object_detection_summary: event.objectDetectionSummary || {},
      temporal_context: event.temporalContext || null,
    },
    topAnomalies: [topAnomaly],
    frameDescriptions: [
      ...(descriptionParts.length
        ? [
            {
              clipId: event.videoClipId || clipId || "clip",
              timestamp,
              score,
              text: descriptionParts.join(" | "),
            },
          ]
        : []),
      ...frameCaptions.filter((item) => item.text),
    ],
    allDetectedClips: [topAnomaly],
    videoMetadata: {
      fps: num(event.fps, 0),
      total_frames: num(event.videoTotalFrames, 0),
      duration: num(event.videoDurationSec, 0),
      width: 0,
      height: 0,
    },
  };
};

const renderEvidenceFrames = (frames, keyPrefix = "ev") => {
  if (!Array.isArray(frames) || frames.length === 0) return null;

  return (
    <div
      style={{
        marginTop: 8,
        display: "grid",
        gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
        gap: 8,
      }}
    >
      {frames.map((frame, idx) => (
        <a
          key={`${keyPrefix}-${idx}`}
          href={frame.frameUrl}
          target="_blank"
          rel="noreferrer"
          style={{
            textDecoration: "none",
            color: "#111827",
            border: "1px solid #e5e7eb",
            borderRadius: 10,
            overflow: "hidden",
            backgroundColor: "#fff",
          }}
        >
          <img
            src={frame.frameUrl}
            alt={`frame-${idx}`}
            style={{ width: "100%", height: 92, objectFit: "cover", display: "block" }}
          />
          <div style={{ padding: 8, fontSize: 11, lineHeight: 1.35 }}>
            <div style={{ color: "#4b5563" }}>{frame.videoClipId || frame.clipId || "clip"}</div>
            <div><strong>{frame.classification || "Unknown"}</strong></div>
            <div>t={num(frame.timestampSec, 0).toFixed(2)}s</div>
            <div>score={num(frame.score, 0).toFixed(2)}</div>
          </div>
        </a>
      ))}
    </div>
  );
};

const buildTimestampRefs = (frames) => {
  if (!Array.isArray(frames) || frames.length === 0) return [];
  return Array.from(
    new Set(
      frames
        .map((frame) => num(frame?.timestampSec, NaN))
        .filter((value) => Number.isFinite(value))
        .map((value) => `${value.toFixed(2)}s`)
    )
  ).slice(0, 8);
};

const SUGGESTED_QUESTIONS = [
  "Pourquoi c’est anormal ?",
  "Quels objets sont présents ?",
  "Décris l’évolution temporelle",
  "Quels indices visuels soutiennent cette conclusion ?",
];

const ChatPage = () => {
  const [selectedEvent, setSelectedEvent] = useState(null);
  const [llmMessages, setLlmMessages] = useState([
    {
      role: "assistant",
      content:
        "Bonjour, je suis prêt pour la discussion LLM. Sélectionnez un événement dans l'historique puis posez votre question.",
    },
  ]);
  const [llmInput, setLlmInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [backendRuntime, setBackendRuntime] = useState(null);

  const selectedContext = useMemo(
    () => ({
      ...buildContextFromEvent(selectedEvent),
      backendRuntime: backendRuntime
        ? {
            openrouterApiKeyConfigured: !!backendRuntime.openrouterApiKeyConfigured,
            captionProvider: backendRuntime.captionProvider || null,
            captionModel: backendRuntime.captionModel || null,
            routes: backendRuntime.routes || {},
          }
        : undefined,
    }),
    [selectedEvent, backendRuntime]
  );

  useEffect(() => {
    let cancelled = false;
    const loadBackendRuntime = async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/api/runtime_status`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled && data && typeof data === "object") {
          setBackendRuntime(data);
        }
      } catch {
        // optional diagnostics only
      }
    };
    loadBackendRuntime();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleSubmit = async (e) => {
    e.preventDefault();
    const prompt = llmInput.trim();
    if (!prompt || isLoading) return;

    const historyForApi = llmMessages.map((msg) => ({
      role: msg.role,
      content: msg.content,
    }));

    setError("");
    setLlmInput("");
    setLlmMessages((prev) => [...prev, { role: "user", content: prompt }]);
    setIsLoading(true);

    try {
      const response = await fetch(`${BACKEND_URL}/chat_llm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: prompt,
          history: historyForApi,
          context: selectedContext,
          videoName: selectedEvent?.videoName || undefined,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data?.error || "Erreur de requête LLM");
      }

      setLlmMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: data.response || "Réponse vide du modèle.",
          evidenceFrames: Array.isArray(data.evidence_frames) ? data.evidence_frames : [],
          fallback: !!data.fallback,
          usedMultimodal: !!data.used_multimodal,
          model: data.model || null,
        },
      ]);
    } catch (err) {
      const msg = err?.message || "Impossible de contacter le backend LLM.";
      setError(msg);
      setLlmMessages((prev) => [...prev, { role: "assistant", content: `Erreur: ${msg}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="app-container">
      <Sidebar onSelectEvent={setSelectedEvent} />
      <div className="main-content" style={{ position: "relative", background: "#f6f7fb" }}>
        <WorkspaceTabs active="chat" right={24} zIndex={1000} />

        <div
          style={{
            flex: 1,
            minWidth: 0,
            display: "grid",
            gridTemplateRows: "auto auto 1fr auto",
            height: "100vh",
            padding: "16px 16px 12px 16px",
            boxSizing: "border-box",
            gap: 12,
          }}
        >
          <div
            style={{
              background: "linear-gradient(135deg, #ffffff 0%, #f3f4f6 100%)",
              border: "1px solid #e5e7eb",
              borderRadius: 16,
              padding: "16px 18px",
              boxShadow: "0 8px 24px rgba(17,24,39,0.06)",
            }}
          >
            <h2 style={{ margin: 0, fontSize: 22, color: "#111827" }}>Discussion LLM</h2>
            <div style={{ marginTop: 6, color: "#6b7280", fontSize: 14 }}>
              Le chat est maintenant séparé du Dashboard et de la Nouvelle analyse vidéo.
              Cette page utilise l’événement sélectionné + le RAG sur l’historique persisté.
            </div>
            <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  borderRadius: 999,
                  padding: "4px 8px",
                  background: backendRuntime?.openrouterApiKeyConfigured ? "#ecfdf5" : "#fef2f2",
                  color: backendRuntime?.openrouterApiKeyConfigured ? "#166534" : "#991b1b",
                }}
              >
                API key {backendRuntime?.openrouterApiKeyConfigured ? "OK" : "absente"}
              </span>
              {backendRuntime?.captionModel && (
                <span
                  style={{
                    fontSize: 11,
                    fontWeight: 700,
                    borderRadius: 999,
                    padding: "4px 8px",
                    background: "#eef2ff",
                    color: "#3730a3",
                  }}
                >
                  Caption: {backendRuntime.captionModel}
                </span>
              )}
            </div>
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: "12px 14px",
              boxShadow: "0 4px 14px rgba(17,24,39,0.05)",
            }}
          >
            {selectedEvent ? (
              <div style={{ display: "grid", gridTemplateColumns: "130px 1fr", gap: 12, alignItems: "start" }}>
                <div>
                  {(selectedEvent.frameUrls?.[0] || selectedEvent.previewBase64) ? (
                    <img
                      src={
                        selectedEvent.frameUrls?.[0] ||
                        `data:image/jpeg;base64,${selectedEvent.previewBase64}`
                      }
                      alt="selected-event"
                      style={{ width: "100%", height: 90, objectFit: "cover", borderRadius: 10, border: "1px solid #eee" }}
                    />
                  ) : (
                    <div
                      style={{
                        width: "100%",
                        height: 90,
                        borderRadius: 10,
                        border: "1px dashed #d1d5db",
                        display: "grid",
                        placeItems: "center",
                        color: "#9ca3af",
                        fontSize: 12,
                      }}
                    >
                      No image
                    </div>
                  )}
                </div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                    <div style={{ fontWeight: 700, color: "#111827", marginBottom: 4 }}>
                      {selectedEvent.videoClipId || selectedEvent.clipId || "clip"}
                    </div>
                    <button
                      type="button"
                      onClick={() => setSelectedEvent(null)}
                      style={{
                        border: "1px solid #d1d5db",
                        background: "#fff",
                        color: "#374151",
                        borderRadius: 999,
                        padding: "4px 8px",
                        fontSize: 11,
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Retirer le contexte
                    </button>
                  </div>
                  <div style={{ fontSize: 13, color: "#4b5563", marginBottom: 4 }}>
                    {selectedEvent.videoName || "Vidéo inconnue"}
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8, fontSize: 12 }}>
                    <span style={{ background: "#eef2ff", color: "#3730a3", padding: "4px 8px", borderRadius: 999 }}>
                      {selectedEvent.classification || selectedEvent.eventName || "Unknown"}
                    </span>
                    <span style={{ background: "#ecfeff", color: "#0f766e", padding: "4px 8px", borderRadius: 999 }}>
                      score {(num(selectedEvent.score, 0) * 100).toFixed(0)}%
                    </span>
                    <span style={{ background: "#f3f4f6", color: "#374151", padding: "4px 8px", borderRadius: 999 }}>
                      t={formatClock(selectedEvent.clipTimestampSec || 0)}
                    </span>
                  </div>
                  {selectedEvent.caption && (
                    <div style={{ fontSize: 13, marginTop: 8, color: "#374151" }}>
                      <strong>Caption:</strong> {selectedEvent.caption}
                    </div>
                  )}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 14, color: "#6b7280" }}>
                Sélectionnez un événement dans l’historique (sidebar) pour guider le chat sur une vidéo précise.
              </div>
            )}
          </div>

          <div
            style={{
              overflowY: "auto",
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              background: "#ffffff",
              padding: 14,
              boxShadow: "0 6px 18px rgba(17,24,39,0.04)",
            }}
          >
            {llmMessages.map((msg, idx) => (
              <div
                key={`${msg.role}-${idx}`}
                style={{
                  marginBottom: 12,
                  display: "flex",
                  justifyContent: msg.role === "user" ? "flex-end" : "flex-start",
                }}
              >
                <div style={{ maxWidth: "85%" }}>
                  <div
                    style={{
                      background: msg.role === "user" ? "#4b0082" : "#f3f4f6",
                      color: msg.role === "user" ? "#fff" : "#111827",
                      borderRadius: 14,
                      padding: "10px 12px",
                      fontSize: 14,
                      lineHeight: 1.45,
                      whiteSpace: "pre-wrap",
                      border: msg.role === "user" ? "none" : "1px solid #e5e7eb",
                    }}
                  >
                    {msg.content}
                  </div>
                  {msg.model && (
                    <div style={{ marginTop: 4, fontSize: 11, color: "#6b7280" }}>
                      modèle: {msg.model}
                      {msg.fallback ? " | fallback" : ""}
                      {msg.usedMultimodal ? " | multimodal" : ""}
                    </div>
                  )}
                  {(() => {
                    const refs = buildTimestampRefs(msg.evidenceFrames);
                    if (refs.length === 0) return null;
                    return (
                      <div style={{ marginTop: 4, fontSize: 11, color: "#4b5563" }}>
                        références temporelles: {refs.join(", ")}
                      </div>
                    );
                  })()}
                  {renderEvidenceFrames(msg.evidenceFrames, `msg-${idx}`)}
                </div>
              </div>
            ))}
            {isLoading && (
              <div style={{ color: "#6b7280", fontSize: 13 }}>Le modèle écrit...</div>
            )}
          </div>

          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 10,
              boxShadow: "0 4px 14px rgba(17,24,39,0.05)",
            }}
          >
            {selectedEvent && (
              <div style={{ marginBottom: 10, display: "flex", flexWrap: "wrap", gap: 8 }}>
                {SUGGESTED_QUESTIONS.map((question) => (
                  <button
                    key={question}
                    type="button"
                    onClick={() => setLlmInput(question)}
                    style={{
                      border: "1px solid #d1d5db",
                      background: "#fff",
                      color: "#374151",
                      borderRadius: 999,
                      padding: "6px 10px",
                      fontSize: 12,
                      cursor: "pointer",
                    }}
                  >
                    {question}
                  </button>
                ))}
              </div>
            )}
            <form onSubmit={handleSubmit} style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <input
                type="text"
                value={llmInput}
                onChange={(e) => setLlmInput(e.target.value)}
                placeholder={
                  selectedEvent
                    ? "Ex: Décris cette scène et dis si elle semble normale."
                    : "Posez une question (sélectionnez d'abord un événement pour cibler une vidéo)..."
                }
                style={{
                  flex: 1,
                  border: "1px solid #d1d5db",
                  borderRadius: 10,
                  padding: "10px 12px",
                  fontSize: 14,
                  outline: "none",
                }}
              />
              <button
                type="submit"
                disabled={isLoading || !llmInput.trim()}
                style={{
                  border: "none",
                  borderRadius: 10,
                  padding: "10px 14px",
                  background: isLoading || !llmInput.trim() ? "#d1d5db" : "#4b0082",
                  color: "#fff",
                  fontWeight: 600,
                  cursor: isLoading || !llmInput.trim() ? "not-allowed" : "pointer",
                }}
              >
                Envoyer
              </button>
            </form>
            {error && (
              <div style={{ marginTop: 8, color: "#b00020", fontSize: 13 }}>
                {error}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default withAuth(ChatPage, ["admin", "user"]);
