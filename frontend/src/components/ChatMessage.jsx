/**
 * ChatMessage Component
 * 
 * Composant React pour afficher différents types de messages dans une interface de chat
 * dédiée à la surveillance vidéo et à la détection d'anomalies.
 * 
 * Types de messages gérés :
 * 1. "clip" : affiche un aperçu visuel (image base64) d'un clip vidéo, accompagné d'un score
 *    d'anomalie avec couleur et emoji indicateurs, un bouton de téléchargement, et un timestamp.
 * 2. "clip_info" : affiche des informations textuelles complémentaires (caption et description)
 *    associées à un clip vidéo.
 * 3. "log" : affiche des messages système ou de progression avec icône contextuelle.
 * 4. "result" : affiche un message de résultat global avec style distinct.
 * 5. Messages standards (pas de type spécifique) : affichage simple, différenciant les messages
 *    envoyés par l'utilisateur ou par le système (différentes couleurs et alignements).
 * 
 * Fonctionnalités principales :
 * - Animation d'entrée fluide avec framer-motion pour chaque type de message.
 * - Coloration dynamique du score d'anomalie avec seuils et emojis associés.
 * - Formatage du timestamp en mm:ss.
 * - Bouton de téléchargement du preview du clip (image base64).
 * - Adaptation du style et de l'alignement selon l'expéditeur.
 * 
 * Props :
 * - msg : objet message contenant au minimum un champ "type" et selon les cas :
 *    - clip : { id, preview (base64), score (float), timestamp (seconds) }
 *    - clip_info : { caption, description }
 *    - log : { text }
 *    - result : { text }
 *    - message classique : { text, sender }
 * - onDownload : fonction callback appelée lors du clic sur le bouton de téléchargement,
 *   reçoit en paramètres (preview, id).
 * 
 * 
 */
import React from "react";
import { motion } from "framer-motion";

const ChatMessage = ({ msg, onDownload }) => {
  if (msg.type === "clip") {
  let scoreColor = "green", emoji = "✅", tooltip = "Normal activity";
  if (msg.score >= 0.5 && msg.score <= 0.7) {
    scoreColor = "orange"; emoji = "⚠️"; tooltip = "Moderate anomaly";
  } else if (msg.score > 0.7) {
    scoreColor = "red"; emoji = "🔴"; tooltip = "Severe anomaly";
  }

  // Format timestamp as mm:ss
  const formatTime = (seconds) => {
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.95 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.4 }}
      style={{
        background: "#fff", border: `2px solid ${scoreColor}`, borderRadius: "16px",
        padding: "12px", maxWidth: "320px", boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
        alignSelf: "flex-start"
      }}
    >
      <img
        src={`data:image/jpeg;base64,${msg.preview}`}
        alt={`Clip ${msg.id}`}
        style={{ width: "100%", borderRadius: "12px" }}
      />
      <div style={{ marginTop: "8px", fontWeight: "bold", fontSize: "14px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span title={tooltip} style={{ cursor: "help", display: "flex", gap: "6px", alignItems: "center" }}>
          {emoji} Clip {msg.id}
        </span>
        <button
          onClick={() => onDownload(msg.preview, msg.id)}
          style={{ background: "none", border: "none", cursor: "pointer", fontSize: "18px", color: "#666" }}
          title="Download image"
        >
          ⬇️
        </button>
      </div>
      <div style={{ color: scoreColor, fontWeight: "bold", fontSize: "14px" }}>
        Score: {msg.score.toFixed(2)}
      </div>
      {msg.timestamp !== undefined && (
        <div style={{ fontSize: "13px", marginTop: "4px", color: "#666" }}>
          🕒 Timestamp: {formatTime(msg.timestamp)}
        </div>
      )}
    </motion.div>
  );
}


  if (msg.type === "clip_info") {
    return (
      <motion.div
        initial={{ opacity: 0, translateY: 10 }}
        animate={{ opacity: 1, translateY: 0 }}
        transition={{ duration: 0.3 }}
        style={{
          alignSelf: "flex-start", background: "#f5f5f5", borderRadius: "16px",
          padding: "12px 16px", maxWidth: "70%", boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
          display: "flex", flexDirection: "column", gap: "8px", fontSize: "15px"
        }}
      >
        {msg.caption && (
          <div style={{ fontStyle: "italic", color: "#555" }}>📝 {msg.caption}</div>
        )}
        {msg.description && (
          <div style={{ backgroundColor: "#fff", border: "1px solid #ddd", padding: "10px", borderRadius: "10px", color: "#333" }}>
            📦 <strong>Description:</strong> {msg.description}
          </div>
        )}
      </motion.div>
    );
  }

  if (msg.type === "log") {
    return (
      <div
        style={{
          alignSelf: "flex-start", backgroundColor: "#f5f3ff", color: "#4c1d95",
          padding: "12px 16px", borderRadius: "16px", border: "1px solid #c084fc",
          display: "flex", alignItems: "center", gap: "10px", maxWidth: "75%",
          fontSize: "15px", boxShadow: "0 2px 8px rgba(76, 29, 149, 0.1)"
        }}
      >
        <span style={{ fontSize: "18px" }}>
          {msg.text.includes("envoyée") ? "🚀" :
            msg.text.includes("Extraction") ? "⚙️" :
              msg.text.includes("Clip") ? "🎞️" : "💡"}
        </span>
        <span>{msg.text}</span>
      </div>
    );
  }

  if (msg.type === "result") {
    return (
      <div
        style={{
          alignSelf: "center", backgroundColor: "#e6f4ea", color: "#0a6640",
          padding: "12px 18px", borderRadius: "20px", fontWeight: "bold",
          fontSize: "16px", border: "2px solid #8fd3b0", maxWidth: "90%", textAlign: "center"
        }}
      >
        {msg.text}
      </div>
    );
  }

  const isUser = msg.sender?.toLowerCase() === "utilisateur";
  return (
    <div
      style={{
        alignSelf: isUser ? "flex-end" : "flex-start",
        backgroundColor: isUser ? "#4b0082" : "#f1f1f1",
        color: isUser ? "white" : "black",
        padding: "12px 16px", borderRadius: "20px",
        maxWidth: "70%", fontSize: "16px", boxShadow: "0 1px 4px rgba(0,0,0,0.1)"
      }}
    >
      {msg.text}
    </div>
  );
};

export default ChatMessage;
