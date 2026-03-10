/**
 * ChatWindow - Composant principal de la fenêtre de chat avec gestion de vidéos,
 * clips, timeline et notifications.
 *
 * Fonctionnalités principales :
 * - Affichage et gestion des messages texte, segments, vidéos, clips et livestream.
 * - Lecture et contrôle d'une vidéo avec timeline interactive.
 * - Sélection et affichage des détails d'un clip vidéo.
 * - Gestion du redimensionnement dynamique de la partie basse (timeline + détails).
 * - Téléchargement des images de clips.
 * - Notifications des clips dans une colonne latérale.
 *
 * Structure :
 * - États locaux pour messages, vidéo, timeline, clips, sélection, etc.
 * - Références DOM pour accès direct aux vidéos, timeline, conteneurs.
 * - Effets pour scroll automatique vers la dernière vidéo et gestion du resizing.
 *
 * Props :
 * - Aucun prop direct, mais intègre MessageInput (pour envoyer des messages) et Notifications.
 *
 * Utilisation :
 * - Intégrer dans l'application comme interface principale de chat / vidéo.
 * - Envoyer des messages via handleSend pour ajouter du contenu dynamique.
 *
 */
import React, { useState, useRef, useEffect, useCallback } from "react";
import MessageInput from "./MessageInput";
import Notifications from "./Notifications";
import { motion } from "framer-motion";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";
const RECENT_ANALYSES_STORAGE_KEY = "anomalens_recent_analyses_v1";
const CLIP_REVIEW_STORAGE_KEY = "anomalens_clip_review_v1";

const readJsonStorage = (key, fallback) => {
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
};

const writeJsonStorage = (key, value) => {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // ignore localStorage failures
  }
};

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

const toNumber = (value, fallback = 0) => {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
};

const inferClipSegmentKey = (clip) => {
  const id = String(clip?.id || "");
  const match = id.match(/^segment_(\d+)_clip_/i);
  if (match) return `segment_${match[1]}`;
  const startFrame = toNumber(clip?.start_frame, -1);
  if (startFrame >= 0) return `segment_${startFrame}`;
  return "segment_unknown";
};

const normalizePublicAssetUrl = (pathOrUrl) => {
  if (!pathOrUrl || typeof pathOrUrl !== "string") return null;
  const value = pathOrUrl.trim();
  if (!value) return null;
  if (value.startsWith("http://") || value.startsWith("https://") || value.startsWith("data:image/")) {
    return value;
  }
  let rel = value.replace(/\\/g, "/").replace(/^\.?\//, "");
  rel = rel.replace(/^backend_python\//, "");
  const outputIdx = rel.indexOf("output_clips/");
  const uploadIdx = rel.indexOf("uploads/");
  if (outputIdx >= 0) rel = rel.slice(outputIdx);
  else if (uploadIdx >= 0) rel = rel.slice(uploadIdx);
  return `${BACKEND_URL}/${rel}`;
};

const formatLocalDateTime = (isoOrDate) => {
  const date = new Date(isoOrDate);
  if (Number.isNaN(date.getTime())) return "n/a";
  return date.toLocaleString();
};

const formatDurationShort = (ms) => {
  const totalSec = Math.max(0, Math.round(toNumber(ms, 0) / 1000));
  const mins = Math.floor(totalSec / 60);
  const secs = totalSec % 60;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
};

const StreamPreviewVideo = ({ stream, ...props }) => {
  const streamVideoRef = useRef(null);

  useEffect(() => {
    const el = streamVideoRef.current;
    if (!el) return;
    if (el.srcObject !== stream) {
      el.srcObject = stream || null;
    }
    const playPromise = el.play?.();
    if (playPromise && typeof playPromise.catch === "function") {
      playPromise.catch(() => {});
    }
  }, [stream]);

  return <video ref={streamVideoRef} {...props} />;
};

const clipReviewKey = (clip) =>
  String(clip?.video_clip_id || clip?.videoClipId || clip?.id || clip?.clipId || "clip");

const ChatWindow = ({ showLlmPanel = true, interfaceMode = "full", externalSelectedEvent = null }) => {
  const [messages, setMessages] = useState([
    { sender: "Admin", text: "Bienvenue sur AnomaLens, where u see the unseen !" },
  ]);
  const playbackVideoRef = useRef(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [selectedClip, setSelectedClip] = useState(null);
  const [showClipDetails, setShowClipDetails] = useState(false);
  const [videoMetadata, setVideoMetadata] = useState(null);
  const timelineRef = useRef(null);
  const messagesContainerRef = useRef(null);
  const [representativeClips, setRepresentativeClips] = useState([]);
  const [bottomHeight, setBottomHeight] = useState(28);
  const resizeRef = useRef(null);
  const isResizing = useRef(false);
  const initialMouseY = useRef(0);
  const initialHeight = useRef(30);
  const [llmMessages, setLlmMessages] = useState([
    {
      role: "assistant",
      content: "Bonjour, je suis prêt à répondre à vos questions sur la vidéo et les clips.",
    },
  ]);
  const [llmInput, setLlmInput] = useState("");
  const [isLlmLoading, setIsLlmLoading] = useState(false);
  const [llmError, setLlmError] = useState("");
  const [analysisProgress, setAnalysisProgress] = useState({
    status: "idle",
    phase: "idle",
    currentStep: "Idle",
    progressPercent: 0,
    progressRatio: 0,
    segmentIndex: 0,
    totalSegments: 0,
    processedSegments: 0,
    processedClips: 0,
    anomalousClips: 0,
    startedAt: null,
    completedAt: null,
    filename: null,
    error: null,
    vlmMode: "unknown",
    vlmInfo: "",
    sseStatus: "idle",
    activeSegmentStart: null,
    activeSegmentEnd: null,
    segmentClipsExtracted: 0,
    segmentClipsScored: 0,
    segmentTopClips: 0,
    segmentClipsProcessed: 0,
    lastStageEvent: null,
  });
  const [recentAnalyses, setRecentAnalyses] = useState(() => {
    const stored = readJsonStorage(RECENT_ANALYSES_STORAGE_KEY, []);
    return Array.isArray(stored) ? stored : [];
  });
  const [reviewStatusByClip, setReviewStatusByClip] = useState(() =>
    readJsonStorage(CLIP_REVIEW_STORAGE_KEY, {})
  );
  const [scoreThresholdFilter, setScoreThresholdFilter] = useState(0);
  const [clipSort, setClipSort] = useState("score_desc");
  const [segmentFilter, setSegmentFilter] = useState("all");
  const [objectFilter, setObjectFilter] = useState("all");
  const [timelineZoomPxPerSec, setTimelineZoomPxPerSec] = useState(20);
  const [showYoloOverlay, setShowYoloOverlay] = useState(true);
  const [showTopKPanel, setShowTopKPanel] = useState(true);
  const [topKLimitLive, setTopKLimitLive] = useState(8);
  const [backendRuntime, setBackendRuntime] = useState(null);
/**
   * Scroll automatique vers la dernière vidéo ajoutée dans le chat.
   * Assure que la vidéo est visible avec un scroll fluide ou instantané
   * selon la distance.
   */
  const scrollToLatestVideo = useCallback(() => {
    const scrollContainer = messagesContainerRef.current;
    if (!scrollContainer) return;

    const videoMessages = messages.filter(msg => msg.type === "video" || msg.type === "live_video");
    if (videoMessages.length === 0) return;

    const latestVideo = videoMessages[videoMessages.length - 1];
    const videoElement = document.getElementById(latestVideo.id);
    
    if (videoElement) {
      const containerRect = scrollContainer.getBoundingClientRect();
      const videoRect = videoElement.getBoundingClientRect();
      const distance = Math.abs(videoRect.top - containerRect.top);
      
      if (distance > containerRect.height * 2) {
        videoElement.scrollIntoView({ block: "nearest" });
      } else {
        videoElement.scrollIntoView({ block: "nearest", behavior: "smooth" });
      }
    }
  }, [messages]);
/**
   * Réinitialise la timeline et l'état vidéo.
   * Pause la vidéo, remet temps/durée/clips à zéro.
   */
  const resetTimeline = () => {
    setCurrentTime(0);
    setDuration(0);
    setRepresentativeClips([]);
    setSelectedClip(null);
    setShowClipDetails(false);
    if (playbackVideoRef.current) {
      playbackVideoRef.current.pause();
      setIsPlaying(false);
    }
  };

  useEffect(() => {
    scrollToLatestVideo();
  }, [scrollToLatestVideo]);

  useEffect(() => {
    if (!externalSelectedEvent || typeof externalSelectedEvent !== "object") return;

    const frameUrls = Array.isArray(externalSelectedEvent.frameUrls)
      ? externalSelectedEvent.frameUrls.filter(Boolean)
      : Array.isArray(externalSelectedEvent.framePaths)
      ? externalSelectedEvent.framePaths.map(normalizePublicAssetUrl).filter(Boolean)
      : [];

    const mappedClip = {
      id:
        externalSelectedEvent.videoClipId ||
        externalSelectedEvent.clipId ||
        externalSelectedEvent._id ||
        `event-${Date.now()}`,
      video_clip_id: externalSelectedEvent.videoClipId || externalSelectedEvent.clipId || externalSelectedEvent._id,
      score: toNumber(externalSelectedEvent.score, 0),
      score_source: externalSelectedEvent.scoreSource || "historique",
      preview: externalSelectedEvent.previewBase64 || null,
      imageUrl: frameUrls[0] || null,
      image_url: frameUrls[0] || null,
      imageUrlResolved: frameUrls[0] || (externalSelectedEvent.previewBase64 ? `data:image/jpeg;base64,${externalSelectedEvent.previewBase64}` : null),
      classification: externalSelectedEvent.classification || externalSelectedEvent.eventName || null,
      timestamp: toNumber(externalSelectedEvent.clipTimestampSec, 0),
      start_frame: toNumber(externalSelectedEvent.startFrame, 0),
      end_frame: toNumber(externalSelectedEvent.endFrame, 0),
      fps: toNumber(externalSelectedEvent.fps, 30),
      caption: externalSelectedEvent.caption || null,
      description: externalSelectedEvent.description || null,
      frame_urls: frameUrls,
      frame_paths: Array.isArray(externalSelectedEvent.framePaths) ? externalSelectedEvent.framePaths : [],
      frame_captions: Array.isArray(externalSelectedEvent.frameCaptions) ? externalSelectedEvent.frameCaptions : [],
      object_detections: Array.isArray(externalSelectedEvent.objectDetections) ? externalSelectedEvent.objectDetections : [],
      bounding_boxes: Array.isArray(externalSelectedEvent.boundingBoxes) ? externalSelectedEvent.boundingBoxes : [],
      object_detection_summary:
        externalSelectedEvent.objectDetectionSummary ||
        externalSelectedEvent.object_detection_summary ||
        {},
      temporal_context:
        externalSelectedEvent.temporalContext ||
        externalSelectedEvent.temporal_context ||
        null,
    };

    setSelectedClip(mappedClip);
    setShowClipDetails(true);
  }, [externalSelectedEvent]);

  useEffect(() => {
    writeJsonStorage(RECENT_ANALYSES_STORAGE_KEY, recentAnalyses.slice(0, 12));
  }, [recentAnalyses]);

  useEffect(() => {
    writeJsonStorage(CLIP_REVIEW_STORAGE_KEY, reviewStatusByClip || {});
  }, [reviewStatusByClip]);

  useEffect(() => {
    let cancelled = false;
    const loadBackendRuntime = async () => {
      try {
        const response = await fetch(`${BACKEND_URL}/api/runtime_status`);
        if (!response.ok) return;
        const data = await response.json();
        if (!cancelled && data && typeof data === "object") {
          setBackendRuntime(data);
          setAnalysisProgress((prev) => {
            if (prev.vlmMode !== "unknown") return prev;
            const hasApiKey = !!data.openrouterApiKeyConfigured;
            const vlmEnabled = !!data.vlmScoringEnabled && hasApiKey;
            return {
              ...prev,
              vlmMode: vlmEnabled ? "vlm" : "local",
              vlmInfo: vlmEnabled
                ? "VLM activable sur ce backend"
                : hasApiKey
                ? "VLM désactivé ou fallback local"
                : "OpenRouter indisponible: API key absente",
            };
          });
        }
      } catch {
        // keep UI functional without runtime diagnostics
      }
    };
    loadBackendRuntime();
    const intervalId = window.setInterval(loadBackendRuntime, 10000);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, []);

  const upsertRecentAnalysis = (entry) => {
    if (!entry) return;
    setRecentAnalyses((prev) => {
      const key = String(entry.runId || entry.filename || entry.startedAt || Date.now());
      const next = [...prev];
      const idx = next.findIndex(
        (item) =>
          String(item.runId || item.filename || item.startedAt) === key ||
          (item.filename && entry.filename && item.filename === entry.filename && item.status === "running")
      );
      if (idx >= 0) {
        next[idx] = { ...next[idx], ...entry, runId: key };
      } else {
        next.unshift({ ...entry, runId: key });
      }
      return next.slice(0, 12);
    });
  };

  const setClipReviewStatus = (clip, status) => {
    const key = clipReviewKey(clip);
    setReviewStatusByClip((prev) => ({ ...(prev || {}), [key]: status }));
  };

  const downloadTextFile = (filename, content, mime = "text/plain;charset=utf-8") => {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const exportSelectedClipJson = () => {
    if (!selectedClip) return;
    const payload = {
      ...selectedClip,
      reviewStatus: reviewStatusByClip[clipReviewKey(selectedClip)] || "en_revue",
      exportedAt: new Date().toISOString(),
    };
    downloadTextFile(
      `${clipReviewKey(selectedClip)}.json`,
      JSON.stringify(payload, null, 2),
      "application/json;charset=utf-8"
    );
  };

  const exportSelectedClipReport = () => {
    if (!selectedClip) return;
    const tc = selectedClip.temporal_context || {};
    const objectSummary = selectedClip.object_detection_summary || {};
    const lines = [
      `Clip: ${selectedClip.video_clip_id || selectedClip.id || "n/a"}`,
      `Score: ${toNumber(selectedClip.score, 0).toFixed(4)} (${selectedClip.score_source || "unknown"})`,
      `Classification: ${selectedClip.classification || "n/a"}`,
      `Timestamp: ${toNumber(selectedClip.timestamp, 0).toFixed(2)}s`,
      `Frames: ${selectedClip.start_frame ?? "n/a"} -> ${selectedClip.end_frame ?? "n/a"}`,
      `Review status: ${reviewStatusByClip[clipReviewKey(selectedClip)] || "en_revue"}`,
      "",
      `Caption: ${selectedClip.caption || "n/a"}`,
      "",
      `Description: ${selectedClip.description || "n/a"}`,
      "",
      "Temporal context:",
      JSON.stringify(tc, null, 2),
      "",
      "Object summary:",
      JSON.stringify(objectSummary, null, 2),
    ];
    downloadTextFile(`${clipReviewKey(selectedClip)}_report.txt`, lines.join("\n"));
  };

  const handleSend = (textOrClip, type = "chat", sender = "system") => {
    if (type === "video_metadata" && typeof textOrClip === "object") {
      setVideoMetadata(textOrClip);
      setAnalysisProgress((prev) => ({
        ...prev,
        totalSegments: toNumber(textOrClip.total_segments, prev.totalSegments),
      }));
      return;
    }

    if (type === "analysis_run_started" && typeof textOrClip === "object") {
      const startedAt = textOrClip.startedAt || new Date().toISOString();
      setAnalysisProgress((prev) => ({
        ...prev,
        status: "running",
        phase: "started",
        currentStep: "Extraction",
        progressPercent: 0,
        progressRatio: 0,
        segmentIndex: 0,
        processedSegments: 0,
        processedClips: 0,
        anomalousClips: 0,
        startedAt,
        completedAt: null,
        filename: textOrClip.filename || null,
        error: null,
        sseStatus: "connecting",
        activeSegmentStart: null,
        activeSegmentEnd: null,
        segmentClipsExtracted: 0,
        segmentClipsScored: 0,
        segmentTopClips: 0,
        segmentClipsProcessed: 0,
        lastStageEvent: "Initialisation de l'analyse...",
      }));
      upsertRecentAnalysis({
        filename: textOrClip.filename || "video",
        startedAt,
        status: "running",
        source: textOrClip.source || "file",
      });
      return;
    }

    if (type === "analysis_progress" && typeof textOrClip === "object") {
      const phase = String(textOrClip.phase || "running");
      const progressPercent = clamp(toNumber(textOrClip.progress_percent, 0), 0, 100);
      const step =
        phase === "completed"
          ? "Save"
          : phase === "started"
          ? "Extraction"
          : phase === "postprocess"
          ? "Postprocess"
          : phase === "embeddings"
          ? "Embeddings"
          : "Scoring";
      setAnalysisProgress((prev) => ({
        ...prev,
        status: "running",
        phase,
        currentStep: step,
        progressPercent,
        progressRatio: clamp(toNumber(textOrClip.progress_ratio, 0), 0, 1),
        segmentIndex: toNumber(textOrClip.segment_index, prev.segmentIndex),
        totalSegments: toNumber(textOrClip.total_segments, prev.totalSegments),
        processedSegments: toNumber(textOrClip.processed_segments, prev.processedSegments),
        processedClips: toNumber(textOrClip.processed_clips, prev.processedClips),
        anomalousClips: toNumber(textOrClip.anomalous_clips, prev.anomalousClips),
        sseStatus: prev.sseStatus === "error" ? "error" : "connected",
      }));
      return;
    }

    if (type === "analysis_stage_event" && typeof textOrClip === "object") {
      const eventType = String(textOrClip.type || "");
      setAnalysisProgress((prev) => {
        const next = { ...prev, status: prev.status === "idle" ? "running" : prev.status, sseStatus: "connected" };

        if (eventType === "segment_start") {
          next.currentStep = "Extraction";
          next.activeSegmentStart = toNumber(textOrClip.segment_start, prev.activeSegmentStart ?? 0);
          next.activeSegmentEnd = toNumber(textOrClip.segment_end, prev.activeSegmentEnd ?? 0);
          next.segmentClipsExtracted = 0;
          next.segmentClipsScored = 0;
          next.segmentTopClips = 0;
          next.segmentClipsProcessed = 0;
          next.lastStageEvent = `Segment ${next.activeSegmentStart}-${next.activeSegmentEnd} démarré`;
        } else if (eventType === "clips_extracted") {
          next.currentStep = "Embeddings";
          next.segmentClipsExtracted = toNumber(textOrClip.count, prev.segmentClipsExtracted);
          next.activeSegmentStart = toNumber(textOrClip.segment_start, prev.activeSegmentStart ?? 0);
          next.activeSegmentEnd = toNumber(textOrClip.segment_end, prev.activeSegmentEnd ?? 0);
          next.lastStageEvent = `${next.segmentClipsExtracted} clips extraits`;
        } else if (eventType === "clip_scored") {
          next.currentStep = "Scoring";
          next.segmentClipsScored = (toNumber(prev.segmentClipsScored, 0) || 0) + 1;
          next.lastStageEvent = `Scoring clip ${next.segmentClipsScored}/${Math.max(next.segmentClipsExtracted || 0, next.segmentClipsScored || 0)}`;
        } else if (eventType === "clips_scored") {
          next.currentStep = "Scoring";
          next.segmentClipsScored = toNumber(textOrClip.count, prev.segmentClipsScored);
          next.activeSegmentStart = toNumber(textOrClip.segment_start, prev.activeSegmentStart ?? 0);
          next.activeSegmentEnd = toNumber(textOrClip.segment_end, prev.activeSegmentEnd ?? 0);
          next.lastStageEvent = `${next.segmentClipsScored} clips scorés`;
        } else if (eventType === "top_clips_selected") {
          next.currentStep = "Postprocess";
          next.segmentTopClips = toNumber(textOrClip.count, prev.segmentTopClips);
          next.activeSegmentStart = toNumber(textOrClip.segment_start, prev.activeSegmentStart ?? 0);
          next.activeSegmentEnd = toNumber(textOrClip.segment_end, prev.activeSegmentEnd ?? 0);
          next.lastStageEvent = `${next.segmentTopClips} clips retenus (Top-K)`;
        } else if (eventType === "clip_processed") {
          next.currentStep = "Postprocess";
          next.segmentClipsProcessed = (toNumber(prev.segmentClipsProcessed, 0) || 0) + 1;
          next.lastStageEvent = `Post-traitement clip ${next.segmentClipsProcessed}/${Math.max(next.segmentTopClips || 0, next.segmentClipsProcessed || 0)}`;
        } else if (eventType === "segment_done") {
          next.currentStep = "Save";
          next.activeSegmentStart = toNumber(textOrClip.segment_start, prev.activeSegmentStart ?? 0);
          next.activeSegmentEnd = toNumber(textOrClip.segment_end, prev.activeSegmentEnd ?? 0);
          next.lastStageEvent = `Segment ${next.activeSegmentStart}-${next.activeSegmentEnd} terminé`;
        }

        return next;
      });
      return;
    }

    if (type === "analysis_complete" && typeof textOrClip === "object") {
      const completedAt = new Date().toISOString();
      setAnalysisProgress((prev) => {
        const vlmActive = !!textOrClip.vlm_scoring_active_final;
        const vlmFailures = toNumber(textOrClip.vlm_failures, 0);
        const next = {
          ...prev,
          status: textOrClip.success === false ? "error" : "completed",
          phase: "completed",
          currentStep: "Save",
          progressPercent: textOrClip.success === false ? prev.progressPercent : 100,
          progressRatio: textOrClip.success === false ? prev.progressRatio : 1,
          processedSegments: toNumber(textOrClip.processed_segments, prev.processedSegments),
          totalSegments: toNumber(textOrClip.total_segments, prev.totalSegments),
          processedClips: toNumber(textOrClip.processed_clips, prev.processedClips),
          anomalousClips: toNumber(textOrClip.anomalous_clips, prev.anomalousClips),
          completedAt,
          error: textOrClip.error || null,
          vlmMode: vlmActive ? "vlm" : "local",
          vlmInfo: vlmActive
            ? `VLM actif${vlmFailures > 0 ? ` (${vlmFailures} échecs)` : ""}`
            : "VLM désactivé ou fallback local",
          sseStatus: textOrClip.success === false ? "error" : "closed",
          lastStageEvent:
            textOrClip.success === false
              ? `Erreur: ${textOrClip.error || "inconnue"}`
              : "Analyse terminée",
        };
        const startMs = next.startedAt ? new Date(next.startedAt).getTime() : NaN;
        const endMs = new Date(completedAt).getTime();
        const durationMs = Number.isFinite(startMs) ? Math.max(0, endMs - startMs) : null;
        upsertRecentAnalysis({
          filename: textOrClip.video_name || next.filename || "video",
          startedAt: next.startedAt || completedAt,
          completedAt,
          status: next.status,
          durationMs,
          processedSegments: next.processedSegments,
          totalSegments: next.totalSegments,
          processedClips: next.processedClips,
          anomalousClips: next.anomalousClips,
          vlmMode: next.vlmMode,
          vlmInfo: next.vlmInfo,
          error: next.error,
        });
        return next;
      });
      return;
    }

    if (type === "analysis_error" && typeof textOrClip === "object") {
      const completedAt = new Date().toISOString();
      setAnalysisProgress((prev) => ({
        ...prev,
        status: "error",
        phase: "failed",
        currentStep: "Error",
        completedAt,
        error: textOrClip.error || "Unknown analysis error",
        sseStatus: "error",
        lastStageEvent: `Erreur: ${textOrClip.error || "Unknown analysis error"}`,
      }));
      upsertRecentAnalysis({
        filename: textOrClip.filename || analysisProgress.filename || "video",
        startedAt: analysisProgress.startedAt || completedAt,
        completedAt,
        status: "error",
        error: textOrClip.error || "Unknown analysis error",
      });
      return;
    }

    if (type === "clip" && typeof textOrClip === "object") {
      const frameUrls = Array.isArray(textOrClip.frame_paths)
        ? textOrClip.frame_paths.map(normalizePublicAssetUrl).filter(Boolean)
        : [];
      const normalizedClip = {
        sender,
        type: "clip",
        id: textOrClip.id,
        video_clip_id: textOrClip.video_clip_id,
        score: textOrClip.score,
        score_source: textOrClip.score_source,
        score_meta: textOrClip.score_meta,
        preview: textOrClip.preview_base64,
        imageUrl: textOrClip.imageUrl,
        image_url: textOrClip.imageUrl,
        imageUrlResolved: textOrClip.imageUrl || (textOrClip.preview_base64 ? `data:image/jpeg;base64,${textOrClip.preview_base64}` : null),
        classification: textOrClip.classification,
        timestamp: textOrClip.timestamp || 0,
        frame_index: textOrClip.frame_index,
        start_frame: textOrClip.start_frame || 0,
        end_frame: textOrClip.end_frame || 0,
        fps: textOrClip.fps || 30,
        caption: textOrClip.caption,
        description: textOrClip.description,
        frame_paths: textOrClip.frame_paths || [],
        frame_urls: frameUrls,
        frame_captions: textOrClip.frame_captions || [],
        object_detections: textOrClip.object_detections || [],
        bounding_boxes: textOrClip.bounding_boxes || [],
        object_detection_summary: textOrClip.object_detection_summary || {},
        temporal_context: textOrClip.temporal_context || null,
      };
      setMessages((prev) => [
        ...prev,
        normalizedClip,
      ]);

      setRepresentativeClips((prev) => {
        const existingIndex = prev.findIndex((clip) => clip.id === textOrClip.id);
        if (existingIndex >= 0) {
          const updated = [...prev];
          updated[existingIndex] = {
            ...updated[existingIndex],
            ...normalizedClip,
          };
          return updated;
        }
        return [...prev, normalizedClip];
      });
      setAnalysisProgress((prev) => ({
        ...prev,
        currentStep: normalizedClip.description ? "Postprocess" : "Scoring",
        vlmMode:
          normalizedClip.score_source && String(normalizedClip.score_source).toLowerCase().includes("vlm")
            ? "vlm"
            : normalizedClip.score_source
            ? "local"
            : prev.vlmMode,
        vlmInfo:
          normalizedClip.score_source && String(normalizedClip.score_source).toLowerCase().includes("vlm")
            ? "VLM actif (scoring)"
            : normalizedClip.score_source
            ? "VLM indisponible/désactivé → scoring local"
            : prev.vlmInfo,
      }));
    } else if (type === "segment_header" && typeof textOrClip === "object") {
      setAnalysisProgress((prev) => ({
        ...prev,
        status: prev.status === "idle" ? "running" : prev.status,
        currentStep: "Extraction",
      }));
      setMessages((prev) => [
        ...prev,
        {
          sender,
          type: "segment_header",
          segmentNumber: textOrClip.segmentNumber,
          startTime: textOrClip.startTime,
          endTime: textOrClip.endTime,
        },
      ]);
    } else if (type === "video" && typeof textOrClip === "object") {
      resetTimeline();
      setMessages((prev) => [
        ...prev,
        {
          sender,
          type: "video",
          videoUrl: textOrClip.video_url,
          filename: textOrClip.filename,
          id: `video-${Date.now()}`,
        },
      ]);
    } else if (type === "live_video") {
      resetTimeline();
      setMessages((prev) => [
        ...prev.filter((msg) => msg.type !== "live_video"),
        {
          sender,
          type: "live_video",
          stream: textOrClip.stream,
          id: `live-${Date.now()}`,
        },
      ]);
    } else if (type === "live_video_closed") {
      setMessages((prev) => prev.filter((msg) => msg.type !== "live_video"));
    } else {
      if (type === "log" && typeof textOrClip === "string") {
        if (textOrClip.includes("SSE connection established")) {
          setAnalysisProgress((prev) => ({
            ...prev,
            sseStatus: "connected",
            lastStageEvent: "Flux SSE connecté",
          }));
        } else if (textOrClip.includes("SSE connection closed")) {
          setAnalysisProgress((prev) => ({
            ...prev,
            sseStatus: prev.status === "completed" ? "closed" : "error",
            lastStageEvent: "Flux SSE fermé",
          }));
        } else if (textOrClip.includes("SSE connection error")) {
          setAnalysisProgress((prev) => ({
            ...prev,
            sseStatus: "error",
            lastStageEvent: "Erreur de connexion SSE",
          }));
        } else {
          setAnalysisProgress((prev) => ({
            ...prev,
            lastStageEvent:
              prev.status === "running" && typeof textOrClip === "string"
                ? textOrClip
                : prev.lastStageEvent,
          }));
        }
      }
      setMessages((prev) => [
        ...prev,
        {
          sender,
          type,
          text: textOrClip,
        },
      ]);
    }
  };

  const handleDownload = (imageUrl, id) => {
    const link = document.createElement("a");
    link.href = imageUrl;
    link.download = `clip_${id}.jpg`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const syncPlaybackTimelineState = useCallback(() => {
    const el = playbackVideoRef.current;
    if (!el) return;
    const nextCurrentTime = Number.isFinite(el.currentTime) ? el.currentTime : 0;
    const nextDuration = Number.isFinite(el.duration) ? el.duration : 0;
    setCurrentTime(nextCurrentTime);
    setDuration(nextDuration);
    setIsPlaying(!el.paused && !el.ended);
  }, []);

  const handleSeek = (time) => {
    if (!playbackVideoRef.current) return;
    const el = playbackVideoRef.current;
    const maxDuration = Number.isFinite(el.duration) ? el.duration : null;
    const nextTime =
      maxDuration != null ? Math.min(Math.max(0, time), maxDuration) : Math.max(0, time);
    el.currentTime = nextTime;
    setCurrentTime(nextTime);
  };

  const handlePlayPause = () => {
    if (!playbackVideoRef.current) return;
    const el = playbackVideoRef.current;
    if (!el.paused && !el.ended) {
      el.pause();
    } else {
      const playPromise = el.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    }
    syncPlaybackTimelineState();
  };

  const handleTimeUpdate = () => {
    syncPlaybackTimelineState();
  };

  const handleLoadedMetadata = () => {
    syncPlaybackTimelineState();
  };

  const getClipStartSec = (clip) => {
    if (!clip || typeof clip !== "object") return 0;
    const fps = toNumber(clip.fps, 0);
    const startFrame = toNumber(clip.start_frame, NaN);
    if (fps > 0 && Number.isFinite(startFrame)) {
      return Math.max(0, startFrame / fps);
    }
    return Math.max(0, toNumber(clip.timestamp, 0));
  };

  const getClipEndSec = (clip) => {
    if (!clip || typeof clip !== "object") return getClipStartSec(clip);
    const fps = toNumber(clip.fps, 0);
    const endFrame = toNumber(clip.end_frame, NaN);
    if (fps > 0 && Number.isFinite(endFrame)) {
      return Math.max(getClipStartSec(clip), endFrame / fps);
    }
    return Math.max(getClipStartSec(clip), toNumber(clip.timestamp, 0));
  };

  const buildLlmContext = () => {
    const clipsById = new Map();
    messages
      .filter((msg) => msg.type === "clip")
      .forEach((clip) => {
        const clipId = clip.id || `clip-${Date.now()}`;
        const previous = clipsById.get(clipId) || {};
        clipsById.set(clipId, {
          id: clipId,
          score:
            typeof clip.score === "number"
              ? Number(clip.score.toFixed(4))
              : previous.score ?? null,
          classification: clip.classification || previous.classification || null,
          timestamp: clip.timestamp ?? previous.timestamp ?? 0,
          start_frame: clip.start_frame ?? previous.start_frame ?? 0,
          end_frame: clip.end_frame ?? previous.end_frame ?? 0,
          fps: clip.fps ?? previous.fps ?? 30,
          caption: clip.caption || previous.caption || null,
          description: clip.description || previous.description || null,
          object_detection_summary:
            clip.object_detection_summary || previous.object_detection_summary || {},
          temporal_context: clip.temporal_context || previous.temporal_context || null,
        });
      });
    const clips = Array.from(clipsById.values());

    const segmentHeaders = messages
      .filter((msg) => msg.type === "segment_header")
      .map((segment) => ({
        segmentNumber: segment.segmentNumber,
        startTime: segment.startTime,
        endTime: segment.endTime,
      }));

    const logs = messages
      .filter((msg) => msg.type === "log")
      .slice(-30)
      .map((log) => log.text);

    const anomalyStats = {
      totalClips: clips.length,
      severe: clips.filter((c) => typeof c.score === "number" && c.score > 0.7).length,
      moderate: clips.filter((c) => typeof c.score === "number" && c.score >= 0.5 && c.score <= 0.7).length,
      normal: clips.filter((c) => typeof c.score === "number" && c.score < 0.5).length,
      maxScore:
        clips.length > 0
          ? Math.max(...clips.map((c) => (typeof c.score === "number" ? c.score : 0)))
          : 0,
    };

    const topAnomalies = [...clips]
      .filter((c) => typeof c.score === "number")
      .sort((a, b) => b.score - a.score)
      .slice(0, 10);

    const frameDescriptions = clips
      .map((clip) => {
        const parts = [];
        if (clip.caption) parts.push(`Caption: ${clip.caption}`);
        if (clip.description) parts.push(`Description: ${clip.description}`);
        if (parts.length === 0) return null;
        return {
          clipId: clip.id,
          timestamp: clip.timestamp,
          score: clip.score,
          text: parts.join(" | "),
        };
      })
      .filter(Boolean);

    const lastVideoMessage = [...messages]
      .reverse()
      .find((msg) => msg.type === "video" || msg.type === "live_video");

    return {
      backendRuntime: backendRuntime
        ? {
            openrouterApiKeyConfigured: !!backendRuntime.openrouterApiKeyConfigured,
            captionProvider: backendRuntime.captionProvider || null,
            captionModel: backendRuntime.captionModel || null,
            routes: backendRuntime.routes || {},
          }
        : undefined,
      videoMetadata,
      timelineState: {
        currentTime,
        duration,
        isPlaying,
      },
      selectedClip: selectedClip
        ? {
            id: selectedClip.id,
            score: selectedClip.score,
            classification: selectedClip.classification,
            timestamp: selectedClip.timestamp,
            caption: selectedClip.caption,
            description: selectedClip.description,
            object_detection_summary: selectedClip.object_detection_summary || {},
            temporal_context: selectedClip.temporal_context || null,
          }
        : null,
      lastVideo: lastVideoMessage
        ? {
            type: lastVideoMessage.type,
            id: lastVideoMessage.id,
            filename: lastVideoMessage.filename || null,
            videoUrl: lastVideoMessage.videoUrl || null,
          }
        : null,
      segmentHeaders,
      anomalyStats,
      topAnomalies,
      frameDescriptions,
      allDetectedClips: clips,
      latestLogs: logs,
    };
  };

  const buildLlmContextDigest = (context) => {
    const lines = ["CONTEXTE VIDEO ANOMALENS"];

    if (context.videoMetadata) {
      const meta = context.videoMetadata;
      lines.push(
        `Meta: duration=${meta.duration || 0}s, fps=${meta.fps || 0}, total_frames=${meta.total_frames || 0}, resolution=${meta.width || 0}x${meta.height || 0}`
      );
    }

    if (context.backendRuntime) {
      const rt = context.backendRuntime;
      lines.push(
        `Backend runtime: api_key=${rt.openrouterApiKeyConfigured ? "configured" : "missing"}, caption_provider=${rt.captionProvider || "n/a"}, caption_model=${rt.captionModel || "n/a"}`
      );
      if (rt.routes) {
        lines.push(
          `Routes backend: upload=${rt.routes.upload || "n/a"}, stream=${rt.routes.streamResults || "n/a"}, chat=${rt.routes.chatLlm || "n/a"}`
        );
      }
    }

    if (context.lastVideo) {
      lines.push(
        `Derniere video: type=${context.lastVideo.type}, id=${context.lastVideo.id}, filename=${context.lastVideo.filename || "N/A"}`
      );
    }

    if (context.anomalyStats) {
      const stats = context.anomalyStats;
      lines.push(
        `Stats anomalies: total=${stats.totalClips}, severe=${stats.severe}, moderate=${stats.moderate}, normal=${stats.normal}, maxScore=${stats.maxScore}`
      );
    }

    if (context.selectedClip) {
      const clip = context.selectedClip;
      lines.push(
        `Clip selectionne: id=${clip.id}, score=${clip.score}, class=${clip.classification}, t=${clip.timestamp}s`
      );
    }

    if (context.topAnomalies?.length) {
      lines.push("Top anomalies:");
      context.topAnomalies.slice(0, 10).forEach((clip) => {
        lines.push(
          `- ${clip.id} | score=${clip.score} | class=${clip.classification} | t=${clip.timestamp}s | frames=${clip.start_frame}->${clip.end_frame}`
        );
        const objectClasses = clip.object_detection_summary?.classes || {};
        const entries = Object.entries(objectClasses);
        if (entries.length > 0) {
          lines.push(`  objects: ${entries.map(([k, v]) => `${k}:${v}`).join(", ")}`);
        }
      });
    }

    if (context.frameDescriptions?.length) {
      lines.push("Descriptions visuelles des frames/clips:");
      context.frameDescriptions.slice(0, 20).forEach((frame) => {
        lines.push(`- ${frame.clipId} @${frame.timestamp}s (score=${frame.score}): ${frame.text}`);
      });
    }

    if (context.latestLogs?.length) {
      lines.push("Derniers logs:");
      context.latestLogs.slice(-10).forEach((log) => lines.push(`- ${log}`));
    }

    lines.push(
      "Instruction: reponds a partir de ces donnees detectees. N'indique pas 'pas d'information' si des clips sont presents."
    );
    return lines.join("\n");
  };

  const handleLlmSubmit = async (e) => {
    e.preventDefault();
    const prompt = llmInput.trim();
    if (!prompt || isLlmLoading) return;

    const context = buildLlmContext();
    const contextDigest = buildLlmContextDigest(context);
    const historyForRequest = [...llmMessages, { role: "user", content: prompt }];
    const requestHistory = [
      ...llmMessages,
      { role: "system", content: contextDigest },
      { role: "user", content: prompt },
    ];
    setLlmInput("");
    setLlmError("");
    setLlmMessages(historyForRequest);
    setIsLlmLoading(true);

    try {
      const response = await fetch(`${BACKEND_URL}/chat_llm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: prompt,
          history: requestHistory,
          context,
          contextDigest,
        }),
      });

      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || "Erreur lors de la réponse LLM");
      }

      const assistantMessage =
        data.response || data.message || "Le modèle n'a pas renvoyé de texte.";
      setLlmMessages((prev) => [
        ...prev,
        {
          role: "assistant",
          content: assistantMessage,
          evidenceFrames: Array.isArray(data.evidence_frames) ? data.evidence_frames : [],
          usedMultimodal: !!data.used_multimodal,
          fallback: !!data.fallback,
          model: data.model || null,
        },
      ]);
    } catch (error) {
      const errorText = error?.message || "Impossible de contacter le backend LLM.";
      setLlmError(errorText);
      setLlmMessages((prev) => [
        ...prev,
        { role: "assistant", content: `Erreur: ${errorText}` },
      ]);
    } finally {
      setIsLlmLoading(false);
    }
  };

  const handleClipClick = (clip) => {
    const clipSeekTime = getClipStartSec(clip);
    if (selectedClip && selectedClip.id === clip.id) {
      setShowClipDetails(!showClipDetails);
    } else {
      setSelectedClip(clip);
      setShowClipDetails(true);
    }

    if (playbackVideoRef.current) {
      handleSeek(clipSeekTime);
    } else {
      setCurrentTime(clipSeekTime);
    }

    if (timelineRef.current) {
      const markerPosition = calculateMarkerPosition(clipSeekTime);
      const timelineWidth = timelineRef.current.offsetWidth;
      const scrollableWidth = timelineRef.current.scrollWidth;
      const markerPixelPosition = (markerPosition / 100) * scrollableWidth;
      const scrollPosition = markerPixelPosition - timelineWidth / 2;

      timelineRef.current.scrollTo({
        left: Math.max(0, scrollPosition),
        behavior: "smooth",
      });
    }
  };

  const clipNotifications = messages.filter((msg) => msg.type === "clip");

  const calculateMarkerPosition = (timestamp) => {
    if (!effectiveTimelineDuration) return 0;
    return Math.min(100, Math.max(0, (timestamp / effectiveTimelineDuration) * 100));
  };

  const formatTime = (seconds) => {
    if (isNaN(seconds)) return "00:00";
    const mins = Math.floor(seconds / 60);
    const secs = Math.floor(seconds % 60);
    return `${mins.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  useEffect(() => {
    const handleMouseMove = (e) => {
      if (!isResizing.current) return;
      e.preventDefault();
      const windowHeight = window.innerHeight;
      const deltaY = initialMouseY.current - e.clientY;
      const deltaHeight = (deltaY / windowHeight) * 100;
      const newHeight = initialHeight.current + deltaHeight;
      setBottomHeight(Math.max(26, Math.min(65, newHeight)));
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = "default";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    const handleMouseDown = (e) => {
      e.preventDefault();
      isResizing.current = true;
      initialMouseY.current = e.clientY;
      initialHeight.current = bottomHeight;
      document.body.style.cursor = "ns-resize";
      document.addEventListener("mousemove", handleMouseMove);
      document.addEventListener("mouseup", handleMouseUp);
    };

    const resizeHandle = resizeRef.current;
    if (resizeHandle) {
      resizeHandle.addEventListener("mousedown", handleMouseDown);
    }

    return () => {
      if (resizeHandle) {
        resizeHandle.removeEventListener("mousedown", handleMouseDown);
      }
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
      document.body.style.cursor = "default";
    };
  }, [bottomHeight]);

  const timelineHeight = Math.max(60, (bottomHeight / 3) * window.innerHeight / 100);
  const clipListThreshold = clamp(scoreThresholdFilter, 0, 1);
  const allClipsForDashboard = [...representativeClips];
  const recentLogLines = messages
    .filter((msg) => msg.type === "log" && typeof msg.text === "string")
    .slice(-8)
    .map((msg) => msg.text);
  const analysisLiveLogLines = recentLogLines.slice(-5);
  const objectLabelOptions = Array.from(
    new Set(
      allClipsForDashboard.flatMap((clip) =>
        Object.keys((clip && clip.object_detection_summary && clip.object_detection_summary.classes) || {})
      )
    )
  ).sort((a, b) => a.localeCompare(b));
  const segmentOptions = Array.from(
    new Set(allClipsForDashboard.map((clip) => inferClipSegmentKey(clip)))
  ).sort((a, b) => a.localeCompare(b));

  const dashboardFilteredClips = allClipsForDashboard.filter((clip) => {
    const score = toNumber(clip?.score, 0);
    if (score < clipListThreshold) return false;
    if (segmentFilter !== "all" && inferClipSegmentKey(clip) !== segmentFilter) return false;
    if (objectFilter !== "all") {
      const classes = (clip?.object_detection_summary?.classes) || {};
      if (!Object.prototype.hasOwnProperty.call(classes, objectFilter)) return false;
    }
    return true;
  });

  const sortedFilteredClips = [...dashboardFilteredClips].sort((a, b) => {
    if (clipSort === "time_asc") return toNumber(a.timestamp, 0) - toNumber(b.timestamp, 0);
    if (clipSort === "time_desc") return toNumber(b.timestamp, 0) - toNumber(a.timestamp, 0);
    if (clipSort === "score_asc") return toNumber(a.score, 0) - toNumber(b.score, 0);
    return toNumber(b.score, 0) - toNumber(a.score, 0);
  });

  const liveTopKClips = sortedFilteredClips.slice(0, Math.max(1, topKLimitLive));
  const timelineClips = dashboardFilteredClips;
  const clipDerivedDurationSec = allClipsForDashboard.reduce((maxSec, clip) => {
    const fps = toNumber(clip?.fps, 0);
    const endFrame = toNumber(clip?.end_frame, NaN);
    const ts = toNumber(clip?.timestamp, 0);
    const endSec = fps > 0 && Number.isFinite(endFrame) ? endFrame / fps : ts;
    return Math.max(maxSec, endSec);
  }, 0);
  const effectiveTimelineDuration = Math.max(
    0,
    toNumber(duration, 0),
    toNumber(videoMetadata?.duration, 0),
    clipDerivedDurationSec
  );
  const timelineScaleWidth = `${effectiveTimelineDuration ? Math.max(100, effectiveTimelineDuration * timelineZoomPxPerSec) : 100}%`;
  const selectedClipReview = selectedClip ? reviewStatusByClip[clipReviewKey(selectedClip)] || "en_revue" : "en_revue";
  const timelineClipsHiddenByFilters = allClipsForDashboard.length > 0 && timelineClips.length === 0;

  const latestVideoMessage = [...messages]
    .reverse()
    .find((msg) => msg.type === "video");
  const latestVideoUrl = latestVideoMessage?.videoUrl || null;
  const latestLiveVideoMessage = [...messages]
    .reverse()
    .find((msg) => msg.type === "live_video");
  const latestLiveStream = latestLiveVideoMessage?.stream || null;
  const hasTimelinePlaybackVideo = !!latestVideoUrl && !latestLiveStream;

  const isDashboardMode = interfaceMode === "dashboard";
  const isAnalysisMode = interfaceMode === "analysis";
  const showTopOverviewPanel = true;
  const showMessagesPanel = !isDashboardMode;
  const showBottomDashboardPanel = true;
  const showInputPanel = !isDashboardMode;
  const showTopInputPanel = showInputPanel && isAnalysisMode;
  const showBottomInputPanel = showInputPanel && !isAnalysisMode;
  const showResizeHandle = showMessagesPanel && showBottomDashboardPanel;
  const showNotificationsPanel = true;
  const showTopKDashboardCard = !isAnalysisMode;
  const showRecentAnalysesCard = !isAnalysisMode;
  const mainGridRows = [
    "auto",
    showTopInputPanel ? "auto" : null,
    showTopOverviewPanel ? "auto" : null,
    showMessagesPanel ? (isAnalysisMode ? "minmax(180px, 1fr)" : "minmax(0, 1fr)") : null,
    showResizeHandle ? "auto" : null,
    showBottomDashboardPanel ? (showMessagesPanel ? "auto" : "minmax(0, 1fr)") : null,
    showBottomInputPanel ? "auto" : null,
  ]
    .filter(Boolean)
    .join(" ");

  const selectedClipFirstFrameUrl =
    (selectedClip?.frame_urls && selectedClip.frame_urls[0]) ||
    selectedClip?.imageUrlResolved ||
    selectedClip?.imageUrl ||
    (selectedClip?.preview ? `data:image/jpeg;base64,${selectedClip.preview}` : null);
  const selectedClipFirstFrameBoxes = Array.isArray(selectedClip?.bounding_boxes)
    ? selectedClip.bounding_boxes.filter((box) => toNumber(box.frameIndex, -1) === 0)
    : [];
  const selectedClipPreviewUrl = selectedClipFirstFrameUrl;

  useEffect(() => {
    if (latestLiveStream) {
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
      return;
    }
    if (!latestVideoUrl) {
      setIsPlaying(false);
      setCurrentTime(0);
      setDuration(0);
    }
  }, [latestLiveStream, latestVideoUrl]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: showNotificationsPanel ? "minmax(0, 1fr) 300px" : "minmax(0, 1fr)",
        height: "100vh",
        overflow: "hidden",
        width: "100%",
        minWidth: 0,
      }}
    >
      <div
        className="chat-window"
        style={{
          flexGrow: 1,
          display: "grid",
          gridTemplateRows: mainGridRows,
          height: "100%",
          width: "100%",
          marginRight: 0,
          minWidth: 0,
        }}
      >
        <div
          className="chat-header"
          style={{
            padding: "20px 16px",
            borderBottom: "1px solid #ccc",
            display: "flex",
            justifyContent: "center",
            alignItems: "center",
            backgroundColor: "#fff",
            position: "sticky",
            top: 0,
            zIndex: 10,
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: "24px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
            }}
          >
            <span
              style={{
                fontSize: "32px",
                lineHeight: "1",
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                width: "40px",
                height: "40px",
                borderRadius: "50%",
                backgroundColor: "#f0f0f0",
                padding: "4px",
              }}
            >
              🧠
            </span>
            ANOMALENS
          </h2>
        </div>

        {showTopInputPanel && (
        <div
          className="message-input-container"
          style={{
            borderBottom: "1px solid #ccc",
            backgroundColor: "#fff",
            padding: "8px 10px",
            boxSizing: "border-box",
            display: "block",
            overflow: "visible",
            flexShrink: 0,
          }}
        >
          <MessageInput onSend={handleSend} showInlinePreview={false} />
        </div>
        )}

        {showTopOverviewPanel && (
        <div
          style={{
            background: "linear-gradient(180deg, #ffffff 0%, #f9fafb 100%)",
            borderBottom: "1px solid #e5e7eb",
            padding: "16px",
            display: "grid",
            gridTemplateColumns: isAnalysisMode
              ? "repeat(auto-fit, minmax(280px, 1fr))"
              : "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "16px",
            alignItems: "stretch",
            minWidth: 0,
          }}
        >
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 16,
              background: "linear-gradient(180deg, #ffffff 0%, #eef2ff 100%)",
              boxShadow: "0 8px 20px rgba(15, 23, 42, 0.06)",
              minHeight: isAnalysisMode ? 190 : 240,
              maxHeight: isAnalysisMode ? 250 : "none",
              overflowY: isAnalysisMode ? "auto" : "visible",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
              <div>
                <div style={{ fontSize: 14, color: "#1f2937", fontWeight: 800 }}>Analyse en cours</div>
                <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
                  {analysisProgress.filename || "Aucune vidéo en cours"}
                </div>
              </div>
              <div
                style={{
                  borderRadius: 999,
                  padding: "6px 12px",
                  fontSize: 12,
                  fontWeight: 700,
                  background:
                    analysisProgress.status === "completed"
                      ? "#ecfdf5"
                      : analysisProgress.status === "error"
                      ? "#fef2f2"
                      : analysisProgress.status === "running"
                      ? "#eef2ff"
                      : "#f3f4f6",
                  color:
                    analysisProgress.status === "completed"
                      ? "#065f46"
                      : analysisProgress.status === "error"
                      ? "#991b1b"
                      : analysisProgress.status === "running"
                      ? "#3730a3"
                      : "#4b5563",
                }}
              >
                {analysisProgress.status === "running"
                  ? "RUNNING"
                  : analysisProgress.status === "completed"
                  ? "DONE"
                  : analysisProgress.status === "error"
                  ? "ERROR"
                  : "IDLE"}
              </div>
            </div>

            <div style={{ marginTop: 10 }}>
              <div
                style={{
                  height: 12,
                  borderRadius: 999,
                  background: "#e5e7eb",
                  overflow: "hidden",
                }}
              >
                <div
                  style={{
                    width: `${clamp(toNumber(analysisProgress.progressPercent, 0), 0, 100)}%`,
                    height: "100%",
                    background:
                      analysisProgress.status === "error"
                        ? "#ef4444"
                        : "linear-gradient(90deg, #4b0082 0%, #2563eb 100%)",
                    transition: "width 180ms ease",
                  }}
                />
              </div>
              <div style={{ marginTop: 8, display: "flex", justifyContent: "space-between", fontSize: 13, color: "#4b5563" }}>
                <span>
                  {analysisProgress.currentStep || "Idle"}
                  {analysisProgress.segmentIndex && analysisProgress.totalSegments
                    ? ` • segment ${analysisProgress.segmentIndex}/${analysisProgress.totalSegments}`
                    : ""}
                </span>
                <span>{clamp(toNumber(analysisProgress.progressPercent, 0), 0, 100).toFixed(0)}%</span>
              </div>
            </div>

            <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "repeat(5, minmax(0,1fr))", gap: 8 }}>
              {["Extraction", "Embeddings", "Scoring", "Postprocess", "Save"].map((step, idx) => {
                const stepOrder = { Extraction: 0, Embeddings: 1, Scoring: 2, Postprocess: 3, Save: 4 };
                const currentIdx = stepOrder[analysisProgress.currentStep] ?? (analysisProgress.status === "completed" ? 4 : -1);
                const state =
                  idx < currentIdx ? "done" : idx === currentIdx ? "active" : "todo";
                return (
                  <div
                    key={step}
                    style={{
                      borderRadius: 10,
                      padding: "8px 6px",
                      textAlign: "center",
                      fontSize: 11,
                      fontWeight: 700,
                      border: "1px solid " + (state === "active" ? "#c7d2fe" : state === "done" ? "#bbf7d0" : "#e5e7eb"),
                      background: state === "active" ? "#eef2ff" : state === "done" ? "#f0fdf4" : "#fff",
                      color: state === "active" ? "#3730a3" : state === "done" ? "#166534" : "#6b7280",
                    }}
                  >
                    {step}
                  </div>
                );
              })}
            </div>

            <div style={{ marginTop: 12, display: "flex", flexWrap: "wrap", gap: 10, alignItems: "center" }}>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  borderRadius: 999,
                  padding: "6px 10px",
                  background:
                    analysisProgress.sseStatus === "connected"
                      ? "#ecfdf5"
                      : analysisProgress.sseStatus === "error"
                      ? "#fef2f2"
                      : analysisProgress.sseStatus === "connecting"
                      ? "#eef2ff"
                      : "#f3f4f6",
                  color:
                    analysisProgress.sseStatus === "connected"
                      ? "#166534"
                      : analysisProgress.sseStatus === "error"
                      ? "#991b1b"
                      : analysisProgress.sseStatus === "connecting"
                      ? "#3730a3"
                      : "#4b5563",
                }}
              >
                SSE:{" "}
                {analysisProgress.sseStatus === "connected"
                  ? "connecté"
                  : analysisProgress.sseStatus === "error"
                  ? "erreur"
                  : analysisProgress.sseStatus === "connecting"
                  ? "connexion..."
                  : "idle"}
              </span>
              <span
                style={{
                  fontSize: 12,
                  fontWeight: 700,
                  borderRadius: 999,
                  padding: "6px 10px",
                  background:
                    analysisProgress.vlmMode === "vlm"
                      ? "#ecfeff"
                      : analysisProgress.vlmMode === "local"
                      ? "#fff7ed"
                      : "#f3f4f6",
                  color:
                    analysisProgress.vlmMode === "vlm"
                      ? "#0f766e"
                      : analysisProgress.vlmMode === "local"
                      ? "#9a3412"
                      : "#4b5563",
                }}
                title={analysisProgress.vlmInfo || ""}
              >
                {analysisProgress.vlmMode === "vlm"
                  ? "VLM actif"
                  : analysisProgress.vlmMode === "local"
                  ? "VLM désactivé/fallback local"
                  : "VLM inconnu"}
              </span>
	              <span
	                style={{
	                  fontSize: 12,
	                  fontWeight: 700,
	                  borderRadius: 999,
	                  padding: "6px 10px",
	                  background:
	                    backendRuntime == null
	                      ? "#f3f4f6"
	                      : backendRuntime.openrouterApiKeyConfigured
	                      ? "#ecfdf5"
	                      : "#fef2f2",
	                  color:
	                    backendRuntime == null
	                      ? "#4b5563"
	                      : backendRuntime.openrouterApiKeyConfigured
	                      ? "#166534"
	                      : "#991b1b",
	                }}
	                title={backendRuntime?.captionModel || ""}
	              >
	                API key{" "}
	                {backendRuntime == null
	                  ? "inconnue"
	                  : backendRuntime.openrouterApiKeyConfigured
	                  ? "OK"
	                  : "absente"}
	              </span>
              <span style={{ fontSize: 12, color: "#4b5563" }}>
                Clips traités: {toNumber(analysisProgress.processedClips, 0)} • Anormaux:{" "}
                {toNumber(analysisProgress.anomalousClips, 0)}
              </span>
                {analysisProgress.error && (
                <span style={{ fontSize: 12, color: "#b91c1c" }}>{analysisProgress.error}</span>
              )}
            </div>
            {backendRuntime?.captionModel && (
              <div style={{ marginTop: 8, fontSize: 11, color: "#6b7280" }}>
                Caption model: {backendRuntime.captionProvider || "n/a"} • {backendRuntime.captionModel}
              </div>
            )}

            <div
              style={{
                marginTop: 12,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(110px, 1fr))",
                gap: 8,
              }}
            >
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "8px 10px", background: "#fff" }}>
                <div style={{ fontSize: 11, color: "#6b7280" }}>Segment actif</div>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", marginTop: 2 }}>
                  {analysisProgress.activeSegmentStart != null && analysisProgress.activeSegmentEnd != null
                    ? `${analysisProgress.activeSegmentStart} → ${analysisProgress.activeSegmentEnd}`
                    : "en attente"}
                </div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "8px 10px", background: "#fff" }}>
                <div style={{ fontSize: 11, color: "#6b7280" }}>Extraction</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", marginTop: 2 }}>
                  {toNumber(analysisProgress.segmentClipsExtracted, 0)} clips
                </div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "8px 10px", background: "#fff" }}>
                <div style={{ fontSize: 11, color: "#6b7280" }}>Scoring</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", marginTop: 2 }}>
                  {toNumber(analysisProgress.segmentClipsScored, 0)} scorés
                </div>
              </div>
              <div style={{ border: "1px solid #e5e7eb", borderRadius: 10, padding: "8px 10px", background: "#fff" }}>
                <div style={{ fontSize: 11, color: "#6b7280" }}>Postprocess</div>
                <div style={{ fontSize: 13, fontWeight: 800, color: "#111827", marginTop: 2 }}>
                  {toNumber(analysisProgress.segmentClipsProcessed, 0)} / {toNumber(analysisProgress.segmentTopClips, 0)}
                </div>
              </div>
            </div>

            <div
              style={{
                marginTop: 12,
                border: "1px solid #e5e7eb",
                borderRadius: 10,
                background: "#fff",
                padding: 10,
              }}
            >
              <div style={{ display: "flex", justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#111827" }}>Journal live (pipeline)</div>
                <div style={{ fontSize: 11, color: "#6b7280" }}>{analysisLiveLogLines.length}</div>
              </div>
              {analysisProgress.lastStageEvent && (
                <div style={{ marginTop: 6, fontSize: 11, color: "#4b5563" }}>
                  Étape: {analysisProgress.lastStageEvent}
                </div>
              )}
              <div
                style={{
                  marginTop: 8,
                  maxHeight: isAnalysisMode ? 96 : 72,
                  overflowY: "auto",
                  display: "grid",
                  gap: 6,
                }}
              >
                {analysisLiveLogLines.length === 0 && (
                  <div style={{ fontSize: 11, color: "#6b7280" }}>
                    {analysisProgress.status === "running"
                      ? "En attente des événements SSE (extraction/scoring/postprocess)..."
                      : "Aucun log pour le moment."}
                  </div>
                )}
                {analysisLiveLogLines.map((line, idx) => (
                  <div
                    key={`${idx}-${line}`}
                    style={{
                      fontSize: 11,
                      color: "#374151",
                      borderRadius: 8,
                      background: "#f9fafb",
                      border: "1px solid #f3f4f6",
                      padding: "6px 8px",
                      lineHeight: 1.3,
                    }}
                  >
                    {line}
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 16,
              background: "#fff",
              boxShadow: "0 8px 20px rgba(15, 23, 42, 0.06)",
              minHeight: isAnalysisMode ? 190 : 240,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>Aperçu vidéo</div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>
                {analysisProgress.status === "running" ? "en cours" : "idle"}
              </div>
            </div>
            {latestLiveStream ? (
              <StreamPreviewVideo
                stream={latestLiveStream}
                autoPlay
                muted
                playsInline
                style={{
                  width: "100%",
                  maxHeight: 240,
                  borderRadius: 12,
                  background: "#000",
                  objectFit: "contain",
                }}
              />
            ) : latestVideoUrl ? (
              <video
                ref={playbackVideoRef}
                src={latestVideoUrl}
                controls
                muted
                onTimeUpdate={handleTimeUpdate}
                onLoadedMetadata={handleLoadedMetadata}
                onDurationChange={handleLoadedMetadata}
                onSeeked={handleTimeUpdate}
                onPlay={handleTimeUpdate}
                onPause={handleTimeUpdate}
                onEnded={handleTimeUpdate}
                style={{
                  width: "100%",
                  maxHeight: 240,
                  borderRadius: 12,
                  background: "#000",
                  objectFit: "contain",
                }}
              />
            ) : selectedClipPreviewUrl ? (
              <div
                style={{
                  width: "100%",
                  maxHeight: 240,
                  borderRadius: 12,
                  overflow: "hidden",
                  border: "1px solid #e5e7eb",
                  background: "#111827",
                  position: "relative",
                }}
              >
                <img
                  src={selectedClipPreviewUrl}
                  alt="clip-preview"
                  style={{ width: "100%", maxHeight: 240, objectFit: "contain", display: "block" }}
                />
                <div
                  style={{
                    position: "absolute",
                    right: 8,
                    bottom: 8,
                    borderRadius: 999,
                    padding: "4px 8px",
                    fontSize: 11,
                    fontWeight: 700,
                    background: "rgba(17,24,39,0.86)",
                    color: "#fff",
                  }}
                >
                  {formatTime(getClipStartSec(selectedClip))}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 12, color: "#6b7280" }}>Aucune vidéo chargée.</div>
            )}
          </div>

          {showRecentAnalysesCard && (
          <div
            style={{
              border: "1px solid #e5e7eb",
              borderRadius: 14,
              padding: 16,
              background: "#fff",
              boxShadow: "0 8px 20px rgba(15, 23, 42, 0.06)",
              minHeight: 240,
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
              <div style={{ fontSize: 14, fontWeight: 800, color: "#111827" }}>Dernières analyses</div>
              <div style={{ fontSize: 12, color: "#6b7280" }}>{recentAnalyses.length}</div>
            </div>
            <div style={{ maxHeight: 180, overflowY: "auto", display: "grid", gap: 8 }}>
              {recentAnalyses.length === 0 && (
                <div style={{ fontSize: 12, color: "#6b7280" }}>Aucune analyse enregistrée localement.</div>
              )}
              {recentAnalyses.map((run, idx) => (
                <div
                  key={`${run.runId || run.filename || idx}`}
                  style={{
                    border: "1px solid #f0f0f0",
                    borderRadius: 12,
                    padding: "10px 10px",
                    background: "linear-gradient(180deg, #ffffff 0%, #f8fafc 100%)",
                  }}
                >
                  <div style={{ fontSize: 13, fontWeight: 700, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                    {run.filename || "video"}
                  </div>
                  <div style={{ fontSize: 12, color: "#6b7280", marginTop: 4 }}>
                    {formatLocalDateTime(run.startedAt)}
                    {run.durationMs ? ` • ${formatDurationShort(run.durationMs)}` : ""}
                  </div>
                  <div style={{ fontSize: 12, marginTop: 4, color: run.status === "error" ? "#991b1b" : "#374151" }}>
                    {String(run.status || "unknown").toUpperCase()}
                    {run.totalSegments ? ` • ${run.processedSegments || 0}/${run.totalSegments} seg` : ""}
                    {run.processedClips ? ` • ${run.processedClips} clips` : ""}
                  </div>
                </div>
              ))}
            </div>
            <div style={{ marginTop: 10, fontSize: 12, color: "#6b7280" }}>
              Journal live: {recentLogLines.length ? recentLogLines[recentLogLines.length - 1] : "en attente..."}
            </div>
          </div>
          )}
        </div>
        )}

        {showMessagesPanel && (
        <div
          className="top-section"
          ref={messagesContainerRef}
          style={{
            overflowY: "auto",
            padding: "12px",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
            backgroundColor: "#fafafa",
            minHeight: 0,
          }}
        >
          {messages.map((msg, idx) => {
            if (msg.type === "segment_header") {
              return (
                <div
                  key={idx}
                  style={{
                    alignSelf: "center",
                    backgroundColor: "#d0e6ff",
                    color: "#003366",
                    padding: "8px 16px",
                    borderRadius: "12px",
                    fontWeight: "bold",
                    fontSize: "16px",
                    margin: "20px 0 10px 0",
                    boxShadow: "0 2px 6px rgba(0,102,204,0.15)",
                  }}
                >
                  🎬 Processing Segment {msg.segmentNumber} (from {msg.startTime}s to {msg.endTime}s)
                </div>
              );
            }
            if (msg.type === "video") {
              if (isAnalysisMode) {
                return null;
              }
              return (
                <motion.div
                  key={idx}
                  id={msg.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4 }}
                  style={{
                    background: "#f9f9f9",
                    border: "1px solid #e0e0e0",
                    borderRadius: "12px",
                    padding: "10px",
                    width: "100%",
                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
                    alignSelf: "flex-start",
                    margin: "10px 0",
                  }}
                >
                  <video
                    src={msg.videoUrl}
                    controls
                  style={{
                    width: "100%",
                      maxHeight: isAnalysisMode ? "300px" : "220px",
                    borderRadius: "8px",
                    objectFit: "contain",
                    backgroundColor: "#000",
                    }}
                    onTimeUpdate={handleTimeUpdate}
                    onLoadedMetadata={handleLoadedMetadata}
                    onError={(e) => {
                      console.error(`Erreur de chargement de la vidéo : ${msg.videoUrl}`, e);
                      alert("Impossible de charger la vidéo. Vérifiez l'URL ou le serveur.");
                    }}
                  />
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: "bold",
                      color: "#333",
                      marginTop: "8px",
                      textAlign: "center",
                    }}
                  >
                    📹 Téléchargée avec succès
                  </div>
                </motion.div>
              );
            }
            if (msg.type === "live_video") {
              if (isAnalysisMode) {
                return null;
              }
              return (
                <motion.div
                  key={idx}
                  id={msg.id}
                  initial={{ opacity: 0, scale: 0.95 }}
                  animate={{ opacity: 1, scale: 1 }}
                  transition={{ duration: 0.4 }}
                  style={{
                    background: "#f9f9f9",
                    border: "1px solid #e0e0e0",
                    borderRadius: "12px",
                    padding: "10px",
                    width: "100%",
                    boxShadow: "0 4px 12px rgba(0, 0, 0, 0.1)",
                    alignSelf: "flex-start",
                    margin: "10px 0",
                  }}
                >
                  <StreamPreviewVideo
                    stream={msg.stream}
                    autoPlay
                    muted
                    playsInline
                    style={{
                      width: "100%",
                      maxHeight: isAnalysisMode ? "300px" : "220px",
                      borderRadius: "8px",
                      objectFit: "contain",
                      backgroundColor: "#000",
                    }}
                  />
                  <div
                    style={{
                      fontSize: "14px",
                      fontWeight: "bold",
                      color: "#333",
                      marginTop: "8px",
                      textAlign: "center",
                    }}
                  >
                    🎥 Live Stream
                  </div>
                </motion.div>
              );
            }
            if (msg.type === "clip") {
              let scoreColor = "green";
              let emoji = "✅";
              let tooltip = "Normal activity";

              if (msg.score >= 0.5 && msg.score <= 0.7) {
                scoreColor = "orange";
                emoji = "⚠️";
                tooltip = "Moderate anomaly";
              } else if (msg.score > 0.7) {
                scoreColor = "red";
                emoji = "🔴";
                tooltip = "Severe anomaly";
              }

              return (
                msg.imageUrl && (
                  <motion.div
                    key={idx}
                    initial={{ opacity: 0, scale: 0.95 }}
                    animate={{ opacity: 1, scale: 1 }}
                    transition={{ duration: 0.4 }}
                    style={{
                      background: "#fff",
                      border: `2px solid ${scoreColor}`,
                      borderRadius: "16px",
                      padding: "12px",
                      maxWidth: "320px",
                      boxShadow: "0 2px 6px rgba(0,0,0,0.1)",
                      alignSelf: "flex-start",
                      cursor: "pointer",
                    }}
                    onClick={() => handleClipClick(msg)}
                  >
                    <img
                      src={
                        msg.imageUrl ||
                        (msg.preview ? `data:image/png;base64,${msg.preview}` : "/fallback.jpg")
                      }
                      alt={`Clip ${msg.id || "unknown"}`}
                      style={{ width: "100%", borderRadius: "12px" }}
                    />
                    <div
                      style={{
                        marginTop: "8px",
                        fontWeight: "bold",
                        fontSize: "14px",
                        display: "flex",
                        alignItems: "center",
                        gap: "6px",
                        justifyContent: "space-between",
                      }}
                    >
                      <span
                        title={tooltip}
                        style={{ cursor: "help", display: "flex", alignItems: "center", gap: "6px" }}
                      >
                        <span>{emoji}</span> Clip {msg.id || "N/A"}
                      </span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          if (msg.imageUrl) {
                            handleDownload(msg.imageUrl, msg.id || "clip");
                          } else {
                            alert("Image non disponible.");
                          }
                        }}
                        disabled={!msg.imageUrl}
                        style={{
                          backgroundColor: "transparent",
                          border: "none",
                          padding: 0,
                          cursor: msg.imageUrl ? "pointer" : "not-allowed",
                          fontSize: "18px",
                          lineHeight: 1,
                          color: msg.imageUrl ? "#666" : "#aaa",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "center",
                        }}
                      >
                        ⬇️
                      </button>
                    </div>
                    <div style={{ color: scoreColor, fontWeight: "bold", fontSize: "14px" }}>
                      Score: {(msg.score || 0).toFixed(2)}
                    </div>
                    {msg.classification && (
                      <div style={{ marginTop: "6px", fontSize: "14px", color: "#333" }}>
                        🧠 <strong>Classification:</strong> {msg.classification}
                      </div>
                    )}
                    {msg.timestamp && (
                      <div style={{ marginTop: "6px", fontSize: "12px", color: "#666" }}>
                        ⏱️ Timestamp: {formatTime(msg.timestamp)}
                      </div>
                    )}
                  </motion.div>
                )
              );
            }
            if (msg.type === "log") {
              return (
                <div
                  key={idx}
                  style={{
                    alignSelf: "flex-start",
                    backgroundColor: "#f5f3ff",
                    color: "#4c1d95",
                    padding: "12px 16px",
                    borderRadius: "16px",
                    border: "1px solid #c084fc",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    maxWidth: "75%",
                    fontFamily: "'Segoe UI', sans-serif",
                    fontSize: "15px",
                    boxShadow: "0 2px 8px rgba(76, 29, 149, 0.1)",
                    animation: "fadeInUp 0.4s ease",
                  }}
                >
                  <span style={{ fontSize: "18px" }}>
                    {msg.text.includes("envoyée")
                      ? "🚀"
                      : msg.text.includes("Extraction")
                      ? "⚙️"
                      : msg.text.includes("Clip")
                      ? "🎞️"
                      : "💡"}
                  </span>
                  <span>{msg.text}</span>
                </div>
              );
            }
            if (msg.type === "result") {
              return (
                <div
                  key={idx}
                  style={{
                    alignSelf: "center",
                    backgroundColor: "#e6f4ea",
                    color: "#0a6640",
                    padding: "12px 18px",
                    borderRadius: "20px",
                    fontWeight: "bold",
                    fontSize: "16px",
                    border: "2px solid #8fd3b0",
                    maxWidth: "90%",
                    textAlign: "center",
                    animation: "fadeIn 0.5s ease",
                  }}
                >
                  {msg.text}
                </div>
              );
            }
            const isUser = msg.sender?.toLowerCase() === "utilisateur";
            return (
              <div
                key={idx}
                style={{
                  alignSelf: isUser ? "flex-end" : "flex-start",
                  backgroundColor: isUser ? "#4b0082" : "#f1f1f1",
                  color: isUser ? "white" : "black",
                  padding: "12px 16px",
                  borderRadius: "20px",
                  maxWidth: "70%",
                  width: "fit-content",
                  wordBreak: "break-word",
                  fontSize: "16px",
                  boxShadow: "0 1px 4px rgba(0,0,0,0.1)",
                  animation: "fadeIn 0.5s ease",
                }}
              >
                {msg.text}
              </div>
            );
          })}
        </div>
        )}

        {showResizeHandle && (
        <div
          ref={resizeRef}
          style={{
            height: "5px",
            backgroundColor: "#ccc",
            cursor: "ns-resize",
            width: "100%",
            zIndex: 30,
            position: "relative",
          }}
        />
        )}

        {showBottomDashboardPanel && (
        <div
          className="bottom-section"
          style={{
            overflowY: "auto",
            padding: "12px",
            backgroundColor: "#f9f9f9",
            borderTop: "1px solid #ccc",
            height: showMessagesPanel
              ? (isAnalysisMode
                  ? `clamp(190px, ${Math.max(bottomHeight, 26)}vh, 68vh)`
                  : `clamp(260px, ${bottomHeight}vh, 65vh)`)
              : "100%",
            minHeight: showMessagesPanel ? (isAnalysisMode ? 190 : 260) : 0,
          }}
        >
          {showTopKDashboardCard && (
          <div
            style={{
              background: "#fff",
              border: "1px solid #e5e7eb",
              borderRadius: 12,
              padding: 10,
              marginBottom: 10,
              boxShadow: "0 1px 6px rgba(0,0,0,0.04)",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
              <h4 style={{ margin: 0, color: "#111827" }}>Dashboard clips (Top-K live)</h4>
              <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => setShowTopKPanel((v) => !v)}
                  style={{
                    border: "1px solid #d1d5db",
                    background: "#fff",
                    color: "#374151",
                    borderRadius: 8,
                    padding: "4px 8px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  {showTopKPanel ? "Masquer" : "Afficher"}
                </button>
                <label style={{ fontSize: 12, color: "#4b5563", display: "flex", alignItems: "center", gap: 6 }}>
                  Top-K
                  <input
                    type="number"
                    min="1"
                    max="20"
                    value={topKLimitLive}
                    onChange={(e) => setTopKLimitLive(clamp(toNumber(e.target.value, 8), 1, 20))}
                    style={{ width: 56, padding: "4px 6px", border: "1px solid #d1d5db", borderRadius: 6 }}
                  />
                </label>
              </div>
            </div>

            <div
              style={{
                marginTop: 8,
                display: "grid",
                gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))",
                gap: 8,
              }}
            >
              <label style={{ fontSize: 12, color: "#4b5563", display: "grid", gap: 4 }}>
                Seuil score
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={clipListThreshold}
                    onChange={(e) => setScoreThresholdFilter(toNumber(e.target.value, 0.5))}
                    style={{ flex: 1 }}
                  />
                  <span style={{ fontWeight: 700, color: "#111827", minWidth: 34 }}>
                    {clipListThreshold.toFixed(2)}
                  </span>
                </div>
              </label>

              <label style={{ fontSize: 12, color: "#4b5563", display: "grid", gap: 4 }}>
                Tri
                <select
                  value={clipSort}
                  onChange={(e) => setClipSort(e.target.value)}
                  style={{ padding: "7px 8px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff" }}
                >
                  <option value="score_desc">Score décroissant</option>
                  <option value="score_asc">Score croissant</option>
                  <option value="time_asc">Temps croissant</option>
                  <option value="time_desc">Temps décroissant</option>
                </select>
              </label>

              <label style={{ fontSize: 12, color: "#4b5563", display: "grid", gap: 4 }}>
                Segment
                <select
                  value={segmentFilter}
                  onChange={(e) => setSegmentFilter(e.target.value)}
                  style={{ padding: "7px 8px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff" }}
                >
                  <option value="all">Tous</option>
                  {segmentOptions.map((seg) => (
                    <option key={seg} value={seg}>
                      {seg}
                    </option>
                  ))}
                </select>
              </label>

              <label style={{ fontSize: 12, color: "#4b5563", display: "grid", gap: 4 }}>
                Objet détecté
                <select
                  value={objectFilter}
                  onChange={(e) => setObjectFilter(e.target.value)}
                  style={{ padding: "7px 8px", borderRadius: 8, border: "1px solid #d1d5db", background: "#fff" }}
                >
                  <option value="all">Tous</option>
                  {objectLabelOptions.map((label) => (
                    <option key={label} value={label}>
                      {label}
                    </option>
                  ))}
                </select>
              </label>
            </div>

            {showTopKPanel && (
              <div
                style={{
                  marginTop: 10,
                  display: "grid",
                  gridTemplateColumns: "repeat(auto-fill, minmax(220px, 1fr))",
                  gap: 10,
                }}
              >
                {liveTopKClips.length === 0 && (
                  <div style={{ fontSize: 12, color: "#6b7280" }}>
                    Aucun clip ne correspond aux filtres actuels.
                  </div>
                )}
                {liveTopKClips.map((clip) => {
                  const score = toNumber(clip.score, 0);
                  const previewSrc =
                    clip.imageUrlResolved ||
                    clip.imageUrl ||
                    (clip.preview ? `data:image/jpeg;base64,${clip.preview}` : null) ||
                    (Array.isArray(clip.frame_urls) && clip.frame_urls[0]) ||
                    null;
                  const review = reviewStatusByClip[clipReviewKey(clip)] || "en_revue";
                  const objectClasses = Object.entries((clip.object_detection_summary && clip.object_detection_summary.classes) || {});
                  return (
                    <button
                      key={clip.id}
                      type="button"
                      onClick={() => handleClipClick(clip)}
                      style={{
                        textAlign: "left",
                        border: "1px solid #e5e7eb",
                        background: "#fff",
                        borderRadius: 12,
                        padding: 0,
                        overflow: "hidden",
                        cursor: "pointer",
                        boxShadow: "0 2px 8px rgba(0,0,0,0.04)",
                      }}
                    >
                      <div style={{ position: "relative", height: 110, background: "#f3f4f6" }}>
                        {previewSrc ? (
                          <img
                            src={previewSrc}
                            alt={clip.id}
                            style={{ width: "100%", height: "100%", objectFit: "cover", display: "block" }}
                          />
                        ) : (
                          <div style={{ width: "100%", height: "100%", display: "grid", placeItems: "center", color: "#9ca3af", fontSize: 12 }}>
                            preview en attente
                          </div>
                        )}
                        <div
                          style={{
                            position: "absolute",
                            top: 6,
                            left: 6,
                            background: "rgba(17,24,39,0.86)",
                            color: "#fff",
                            borderRadius: 999,
                            padding: "3px 8px",
                            fontSize: 11,
                            fontWeight: 700,
                          }}
                        >
                          {score.toFixed(2)}
                        </div>
                      </div>
                      <div style={{ padding: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, color: "#111827", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                          {clip.video_clip_id || clip.id}
                        </div>
                        <div style={{ marginTop: 3, fontSize: 11, color: "#6b7280" }}>
                          {formatTime(toNumber(clip.timestamp, 0))} • {clip.classification || "Unknown"}
                        </div>
                        <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                          <span style={{ fontSize: 10, background: "#eef2ff", color: "#3730a3", borderRadius: 999, padding: "3px 6px" }}>
                            {inferClipSegmentKey(clip)}
                          </span>
                          <span
                            style={{
                              fontSize: 10,
                              background: review === "true_positive" ? "#ecfdf5" : review === "false_positive" ? "#fef2f2" : "#f3f4f6",
                              color: review === "true_positive" ? "#166534" : review === "false_positive" ? "#991b1b" : "#4b5563",
                              borderRadius: 999,
                              padding: "3px 6px",
                            }}
                          >
                            {review}
                          </span>
                          <span style={{ fontSize: 10, background: "#f9fafb", color: "#374151", borderRadius: 999, padding: "3px 6px" }}>
                            {String(clip.score_source || "local")}
                          </span>
                        </div>
                        {objectClasses.length > 0 && (
                          <div style={{ marginTop: 6, fontSize: 10, color: "#4b5563", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                            objets: {objectClasses.map(([k, v]) => `${k}:${v}`).join(", ")}
                          </div>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
          )}

          <div
            className="timeline-container"
            style={{
              position: "relative",
              backgroundColor: "#f9f9f9",
              zIndex: 20,
              padding: "0 12px 12px 12px",
              borderTop: "1px solid #ccc",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
              <h3 style={{ marginTop: 0, marginBottom: 0 }}>Video Timeline</h3>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <label style={{ fontSize: 12, color: "#4b5563", display: "flex", alignItems: "center", gap: 6 }}>
                  Seuil
                  <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    value={clipListThreshold}
                    onChange={(e) => setScoreThresholdFilter(toNumber(e.target.value, 0.5))}
                  />
                  <span style={{ minWidth: 32, fontWeight: 700, color: "#111827" }}>
                    {clipListThreshold.toFixed(2)}
                  </span>
                </label>
                <label style={{ fontSize: 12, color: "#4b5563", display: "flex", alignItems: "center", gap: 6 }}>
                  Zoom
                  <input
                    type="range"
                    min="10"
                    max="80"
                    step="2"
                    value={timelineZoomPxPerSec}
                    onChange={(e) => setTimelineZoomPxPerSec(clamp(toNumber(e.target.value, 20), 10, 80))}
                  />
                  <span style={{ minWidth: 44, fontWeight: 700, color: "#111827" }}>
                    {timelineZoomPxPerSec}px/s
                  </span>
                </label>
              </div>
            </div>
            <div
              ref={timelineRef}
              style={{
                width: "100%",
                height: `${timelineHeight}px`,
                position: "relative",
                border: "1px solid #ddd",
                borderRadius: "4px",
                overflowX: "auto",
                backgroundColor: "#f0f0f0",
              }}
            >
                <div
                  style={{
                    position: "absolute",
                    height: "100%",
                    width: timelineScaleWidth,
                    minWidth: "100%",
                    display: "flex",
                    alignItems: "center",
                }}
              >
                <div
                  style={{
                    position: "absolute",
                    width: "100%",
                    height: "4px",
                    backgroundColor: "#ccc",
                    top: "50%",
                    transform: "translateY(-50%)",
                  }}
                />
                {effectiveTimelineDuration > 0 && (
                  <div
                    style={{
                      position: "absolute",
                      left: `${calculateMarkerPosition(currentTime)}%`,
                      height: "100%",
                      width: "2px",
                      backgroundColor: "red",
                      zIndex: 10,
                    }}
                  />
                )}
                {timelineClips.map((clip, idx) => {
                  const clipStartSec = getClipStartSec(clip);
                  const clipEndSec = getClipEndSec(clip);
                  const leftPct = calculateMarkerPosition(clipStartSec);
                  const endPct = calculateMarkerPosition(clipEndSec);
                  const widthPct = Math.max(0.4, endPct - leftPct);
                  const hasRichDetails = !!clip.description;
                  return (
                  <div
                    key={idx}
                    onClick={() => handleClipClick(clip)}
                    style={{
                      position: "absolute",
                      left: `${leftPct}%`,
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      zIndex: 5,
                      cursor: "pointer",
                    }}
                    title={`Clip ${clip.id}\nScore: ${toNumber(clip.score, 0).toFixed(2)}\nStart: ${formatTime(clipStartSec)}\nEnd: ${formatTime(clipEndSec)}`}
                  >
                    <div
                      style={{
                        width: `max(6px, ${widthPct}%)`,
                        minWidth: hasRichDetails ? "18px" : "6px",
                        height: hasRichDetails ? "12px" : "6px",
                        backgroundColor: clip.score > 0.7 ? "red" : clip.score > 0.5 ? "orange" : "green",
                        border: "2px solid white",
                        boxShadow: "0 0 0 2px #333",
                        borderRadius: hasRichDetails ? "999px" : "2px",
                        transform: "none",
                      }}
                    />
                    <div
                      style={{
                        fontSize: "10px",
                        fontWeight: "bold",
                        marginTop: "4px",
                        backgroundColor: "rgba(0,0,0,0.7)",
                        color: "white",
                        padding: "2px 4px",
                        borderRadius: "4px",
                      }}
                    >
                      {toNumber(clip.score, 0).toFixed(2)}
                    </div>
                  </div>
                )})}
                {timelineClips.length === 0 && (
                  <div
                    style={{
                      position: "absolute",
                      inset: 0,
                      display: "grid",
                      placeItems: "center",
                      color: "#6b7280",
                      fontSize: 12,
                      textAlign: "center",
                      padding: 12,
                      pointerEvents: "none",
                    }}
                  >
                    {timelineClipsHiddenByFilters
                      ? `Aucun clip visible avec le seuil actuel (${clipListThreshold.toFixed(2)}).`
                      : "Aucun clip reçu pour le moment."}
                  </div>
                )}
              </div>
            </div>
            {timelineClipsHiddenByFilters && (
              <div style={{ marginTop: 8, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 12, color: "#6b7280" }}>
                  {allClipsForDashboard.length} clips détectés sont masqués par les filtres.
                </span>
                <button
                  type="button"
                  onClick={() => setScoreThresholdFilter(0)}
                  style={{
                    border: "1px solid #d1d5db",
                    background: "#fff",
                    borderRadius: 8,
                    padding: "4px 8px",
                    fontSize: 12,
                    cursor: "pointer",
                  }}
                >
                  Réinitialiser le seuil
                </button>
              </div>
            )}
            <div style={{ display: "flex", alignItems: "center", gap: "10px", marginTop: "10px" }}>
              <button
                onClick={handlePlayPause}
                disabled={!hasTimelinePlaybackVideo}
                style={{
                  padding: "5px 10px",
                  backgroundColor: hasTimelinePlaybackVideo ? "#4b0082" : "#9ca3af",
                  color: "white",
                  border: "none",
                  borderRadius: "4px",
                  cursor: hasTimelinePlaybackVideo ? "pointer" : "not-allowed",
                }}
              >
                {isPlaying ? "⏸️ Pause" : "▶️ Play"}
              </button>
              <span style={{ fontSize: "14px" }}>
                {formatTime(currentTime)} / {formatTime(effectiveTimelineDuration)}
              </span>
              <input
                type="range"
                min="0"
                max={effectiveTimelineDuration || 100}
                value={currentTime}
                onChange={(e) => handleSeek(parseFloat(e.target.value))}
                disabled={!hasTimelinePlaybackVideo}
                style={{ flexGrow: 1 }}
              />
            </div>
            {!hasTimelinePlaybackVideo && (
              <div style={{ marginTop: 6, fontSize: 11, color: "#6b7280" }}>
                Timeline synchronisée avec la vidéo uploadée/recordée. Indisponible pendant l’aperçu webcam live.
              </div>
            )}
          </div>

          {showClipDetails && selectedClip && (
            <div
              style={{
                backgroundColor: "#fff",
                border: "1px solid #ddd",
                borderRadius: "8px",
                padding: "10px",
                marginBottom: "10px",
                boxShadow: "0 2px 8px rgba(0,0,0,0.1)",
              }}
            >
              <h4 style={{ marginTop: 0, color: "#4b0082" }}>Selected Clip Details</h4>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 8 }}>
                <span
                  style={{
                    fontSize: 11,
                    borderRadius: 999,
                    padding: "4px 8px",
                    background:
                      selectedClipReview === "true_positive"
                        ? "#ecfdf5"
                        : selectedClipReview === "false_positive"
                        ? "#fef2f2"
                        : "#f3f4f6",
                    color:
                      selectedClipReview === "true_positive"
                        ? "#166534"
                        : selectedClipReview === "false_positive"
                        ? "#991b1b"
                        : "#4b5563",
                  }}
                >
                  statut: {selectedClipReview}
                </span>
                <span style={{ fontSize: 11, borderRadius: 999, padding: "4px 8px", background: "#eef2ff", color: "#3730a3" }}>
                  score source: {selectedClip.score_source || "n/a"}
                </span>
                <span style={{ fontSize: 11, borderRadius: 999, padding: "4px 8px", background: "#f9fafb", color: "#374151" }}>
                  {inferClipSegmentKey(selectedClip)}
                </span>
              </div>

              {selectedClipFirstFrameUrl && (
                <div style={{ marginBottom: 10 }}>
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
                    <strong>Frame preview / YOLO overlay</strong>
                    <label style={{ fontSize: 12, color: "#4b5563", display: "flex", alignItems: "center", gap: 6 }}>
                      <input
                        type="checkbox"
                        checked={showYoloOverlay}
                        onChange={(e) => setShowYoloOverlay(e.target.checked)}
                      />
                      Overlay bbox
                    </label>
                  </div>
                  <div
                    style={{
                      position: "relative",
                      width: "100%",
                      maxWidth: 420,
                      borderRadius: 10,
                      overflow: "hidden",
                      border: "1px solid #e5e7eb",
                      background: "#111827",
                    }}
                  >
                    <img
                      src={selectedClipFirstFrameUrl}
                      alt="selected-clip-frame"
                      style={{ width: "100%", display: "block", objectFit: "contain" }}
                    />
                    {showYoloOverlay &&
                      selectedClipFirstFrameBoxes.map((box, boxIdx) => {
                        const n = Array.isArray(box?.bboxNormalized) ? box.bboxNormalized : null;
                        if (!n || n.length !== 4) return null;
                        const [x1, y1, x2, y2] = n.map((v) => clamp(toNumber(v, 0), 0, 1));
                        const left = x1 * 100;
                        const top = y1 * 100;
                        const width = Math.max(0.5, (x2 - x1) * 100);
                        const height = Math.max(0.5, (y2 - y1) * 100);
                        return (
                          <div
                            key={`bbox-${boxIdx}`}
                            style={{
                              position: "absolute",
                              left: `${left}%`,
                              top: `${top}%`,
                              width: `${width}%`,
                              height: `${height}%`,
                              border: "2px solid #22c55e",
                              boxShadow: "0 0 0 1px rgba(255,255,255,0.35) inset",
                              pointerEvents: "none",
                            }}
                            title={`${box.className || "obj"} ${(toNumber(box.confidence, 0)).toFixed(2)}`}
                          >
                            <div
                              style={{
                                position: "absolute",
                                top: -18,
                                left: 0,
                                background: "#22c55e",
                                color: "#052e16",
                                fontSize: 10,
                                fontWeight: 700,
                                padding: "1px 4px",
                                borderRadius: 4,
                                whiteSpace: "nowrap",
                              }}
                            >
                              {box.className || "obj"} {toNumber(box.confidence, 0).toFixed(2)}
                            </div>
                          </div>
                        );
                      })}
                  </div>
                </div>
              )}

              <div style={{ marginBottom: "8px" }}>
                <strong>Score:</strong>{" "}
                <span
                  style={{
                    color: selectedClip.score > 0.7 ? "red" : selectedClip.score > 0.5 ? "orange" : "green",
                    fontWeight: "bold",
                  }}
                >
                  {selectedClip.score.toFixed(4)}
                </span>
              </div>
              {selectedClip.classification && (
                <div style={{ marginBottom: "8px" }}>
                  <strong>Classification:</strong>{" "}
                  <span style={{ fontWeight: "bold" }}>{selectedClip.classification}</span>
                </div>
              )}
              {selectedClip.caption && (
                <div style={{ marginBottom: "8px" }}>
                  <strong>Caption:</strong> {selectedClip.caption}
                </div>
              )}
              {selectedClip.description && (
                <div style={{ marginBottom: "8px" }}>
                  <strong>Description:</strong> {selectedClip.description}
                </div>
              )}
              <div style={{ marginBottom: "8px" }}>
                <strong>Timestamp:</strong> {formatTime(selectedClip.timestamp)}
              </div>

              <div style={{ marginBottom: "8px" }}>
                <strong>Timecodes:</strong>{" "}
                {formatTime(
                  toNumber(selectedClip.fps, 0) > 0
                    ? toNumber(selectedClip.start_frame, 0) / toNumber(selectedClip.fps, 1)
                    : toNumber(selectedClip.timestamp, 0)
                )}{" "}
                →{" "}
                {formatTime(
                  toNumber(selectedClip.fps, 0) > 0
                    ? toNumber(selectedClip.end_frame, 0) / toNumber(selectedClip.fps, 1)
                    : toNumber(selectedClip.timestamp, 0)
                )}
              </div>

              {selectedClip.temporal_context && (
                <div style={{ marginBottom: "8px", background: "#f9fafb", border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                  <strong>Contexte temporel (avant / pendant / après)</strong>
                  <div style={{ marginTop: 6, fontSize: 12, color: "#374151", lineHeight: 1.5 }}>
                    <div>
                      Avant: {toNumber(selectedClip.temporal_context.beforeContextSec?.start, 0).toFixed(2)}s →{" "}
                      {toNumber(selectedClip.temporal_context.beforeContextSec?.end, 0).toFixed(2)}s
                    </div>
                    <div>
                      Pendant: {toNumber(selectedClip.temporal_context.clipWindowSec?.start, 0).toFixed(2)}s →{" "}
                      {toNumber(selectedClip.temporal_context.clipWindowSec?.end, 0).toFixed(2)}s
                    </div>
                    <div>
                      Après: {toNumber(selectedClip.temporal_context.afterContextSec?.start, 0).toFixed(2)}s →{" "}
                      {toNumber(selectedClip.temporal_context.afterContextSec?.end, 0).toFixed(2)}s
                    </div>
                  </div>
                </div>
              )}

              {!!selectedClip.object_detection_summary && (
                <div style={{ marginBottom: "8px", background: "#f8fafc", border: "1px solid #e5e7eb", borderRadius: 8, padding: 8 }}>
                  <strong>Objets détectés</strong>
                  <div style={{ marginTop: 4, fontSize: 12, color: "#374151" }}>
                    total: {toNumber(selectedClip.object_detection_summary.totalDetections, 0)}
                  </div>
                  <div style={{ marginTop: 4, display: "flex", gap: 6, flexWrap: "wrap" }}>
                    {Object.entries(selectedClip.object_detection_summary.classes || {}).map(([k, v]) => (
                      <span key={k} style={{ fontSize: 11, background: "#e0f2fe", color: "#075985", borderRadius: 999, padding: "4px 8px" }}>
                        {k}: {v}
                      </span>
                    ))}
                    {Object.keys(selectedClip.object_detection_summary.classes || {}).length === 0 && (
                      <span style={{ fontSize: 11, color: "#6b7280" }}>Aucun objet détecté</span>
                    )}
                  </div>
                </div>
              )}

              {Array.isArray(selectedClip.frame_captions) && selectedClip.frame_captions.length > 0 && (
                <div style={{ marginBottom: 8 }}>
                  <strong>Frames / captions</strong>
                  <div
                    style={{
                      marginTop: 6,
                      display: "grid",
                      gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))",
                      gap: 8,
                    }}
                  >
                    {selectedClip.frame_captions.slice(0, 6).map((fc, idx) => {
                      const frameUrl = Array.isArray(selectedClip.frame_urls) ? selectedClip.frame_urls[idx] : null;
                      return (
                        <div key={`fc-${idx}`} style={{ border: "1px solid #e5e7eb", borderRadius: 8, overflow: "hidden", background: "#fff" }}>
                          {frameUrl ? (
                            <img src={frameUrl} alt={`frame-${idx}`} style={{ width: "100%", height: 84, objectFit: "cover", display: "block" }} />
                          ) : (
                            <div style={{ height: 84, display: "grid", placeItems: "center", color: "#9ca3af", background: "#f9fafb", fontSize: 12 }}>
                              Frame {idx}
                            </div>
                          )}
                          <div style={{ padding: 6, fontSize: 11, lineHeight: 1.35 }}>
                            <div style={{ color: "#6b7280" }}>t={toNumber(fc?.timestampSec, 0).toFixed(2)}s</div>
                            <div>{fc?.caption || "n/a"}</div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
                <button
                  type="button"
                  onClick={exportSelectedClipJson}
                  style={{ border: "1px solid #d1d5db", background: "#fff", borderRadius: 8, padding: "7px 10px", fontSize: 12, cursor: "pointer" }}
                >
                  Exporter JSON
                </button>
                <button
                  type="button"
                  onClick={exportSelectedClipReport}
                  style={{ border: "1px solid #d1d5db", background: "#fff", borderRadius: 8, padding: "7px 10px", fontSize: 12, cursor: "pointer" }}
                >
                  Exporter rapport
                </button>
                <button
                  type="button"
                  onClick={() => setClipReviewStatus(selectedClip, "true_positive")}
                  style={{ border: "none", background: "#ecfdf5", color: "#166534", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                >
                  Vrai positif
                </button>
                <button
                  type="button"
                  onClick={() => setClipReviewStatus(selectedClip, "false_positive")}
                  style={{ border: "none", background: "#fef2f2", color: "#991b1b", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                >
                  Faux positif
                </button>
                <button
                  type="button"
                  onClick={() => setClipReviewStatus(selectedClip, "en_revue")}
                  style={{ border: "none", background: "#f3f4f6", color: "#374151", borderRadius: 8, padding: "7px 10px", fontSize: 12, fontWeight: 700, cursor: "pointer" }}
                >
                  En revue
                </button>
              </div>
            </div>
          )}

          {showLlmPanel && (
          <div
            style={{
              backgroundColor: "#fff",
              border: "1px solid #ddd",
              borderRadius: "8px",
              padding: "12px",
              boxShadow: "0 2px 8px rgba(0,0,0,0.08)",
            }}
          >
            <h4 style={{ marginTop: 0, color: "#4b0082" }}>Chat avec le modèle LLM</h4>
            <div
              style={{
                maxHeight: "180px",
                overflowY: "auto",
                border: "1px solid #eee",
                borderRadius: "8px",
                padding: "10px",
                backgroundColor: "#fafafa",
                marginBottom: "10px",
              }}
            >
              {llmMessages.map((msg, index) => (
                <div
                  key={`${msg.role}-${index}`}
                  style={{
                    marginBottom: "8px",
                    textAlign: msg.role === "user" ? "right" : "left",
                  }}
                >
                  <span
                    style={{
                      display: "inline-block",
                      maxWidth: "90%",
                      backgroundColor: msg.role === "user" ? "#4b0082" : "#f1f1f1",
                      color: msg.role === "user" ? "white" : "#111",
                      padding: "8px 10px",
                      borderRadius: "12px",
                      fontSize: "14px",
                      whiteSpace: "pre-wrap",
                    }}
                  >
                    {msg.content}
                  </span>
                  {Array.isArray(msg.evidenceFrames) && msg.evidenceFrames.length > 0 && (
                    <div
                      style={{
                        marginTop: "8px",
                        display: "grid",
                        gridTemplateColumns: "repeat(auto-fill, minmax(120px, 1fr))",
                        gap: "8px",
                        maxWidth: "560px",
                      }}
                    >
                      {msg.evidenceFrames.map((frame, fIdx) => (
                        <a
                          key={`ev-${index}-${fIdx}`}
                          href={frame.frameUrl}
                          target="_blank"
                          rel="noreferrer"
                          style={{
                            textDecoration: "none",
                            color: "#111",
                            background: "#fff",
                            border: "1px solid #ddd",
                            borderRadius: "8px",
                            overflow: "hidden",
                          }}
                        >
                          <img
                            src={frame.frameUrl}
                            alt={`frame-${fIdx}`}
                            style={{
                              width: "100%",
                              height: "84px",
                              objectFit: "cover",
                              display: "block",
                            }}
                          />
                          <div style={{ padding: "6px", fontSize: "11px", lineHeight: 1.3 }}>
                            <div style={{ color: "#444" }}>
                              {frame.videoClipId || frame.clipId || frame.videoName || "clip"}
                            </div>
                            <div><strong>{frame.classification || "Unknown"}</strong></div>
                            <div>t={Number(frame.timestampSec || 0).toFixed(2)}s</div>
                            <div>score={Number(frame.score || 0).toFixed(2)}</div>
                          </div>
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              ))}
              {isLlmLoading && (
                <div style={{ fontSize: "13px", color: "#666" }}>Le modèle écrit...</div>
              )}
            </div>
            <form onSubmit={handleLlmSubmit} style={{ display: "flex", gap: "8px" }}>
              <input
                type="text"
                value={llmInput}
                onChange={(e) => setLlmInput(e.target.value)}
                placeholder="Posez une question au modèle..."
                style={{
                  flexGrow: 1,
                  padding: "8px 10px",
                  borderRadius: "8px",
                  border: "1px solid #ccc",
                  fontSize: "14px",
                }}
              />
              <button
                type="submit"
                disabled={isLlmLoading || !llmInput.trim()}
                style={{
                  padding: "8px 14px",
                  border: "none",
                  borderRadius: "8px",
                  backgroundColor: "#4b0082",
                  color: "#fff",
                  cursor: isLlmLoading || !llmInput.trim() ? "not-allowed" : "pointer",
                }}
              >
                Envoyer
              </button>
            </form>
            {llmError && (
              <div style={{ marginTop: "8px", color: "#b00020", fontSize: "13px" }}>
                {llmError}
              </div>
            )}
          </div>
          )}
        </div>
        )}

        {showBottomInputPanel && (
        <div
          className="message-input-container"
          style={{
            borderTop: "1px solid #ccc",
            backgroundColor: "#fff",
            padding: "8px 10px",
            boxSizing: "border-box",
            display: "block",
            overflow: "visible",
            flexShrink: 0,
          }}
        >
          <MessageInput onSend={handleSend} />
        </div>
        )}
      </div>

      {showNotificationsPanel && (
      <div
        style={{
          width: "300px",
          height: "100%",
          position: "relative",
          overflowY: "hidden",
          backgroundColor: "#fff",
          borderLeft: "1px solid #ccc",
          zIndex: 50,
        }}
      >
        <Notifications notifications={clipNotifications} />
      </div>
      )}
    </div>
  );
};

export default ChatWindow;
