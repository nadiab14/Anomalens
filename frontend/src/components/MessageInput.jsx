import React, { useState, useRef, useEffect, useCallback } from "react";
import './MessageInput.css';

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL || "http://localhost:5000";
/**
 * MessageInput - Composant React pour capturer ou importer une vidéo,
 * enregistrer localement, uploader vers un backend, et gérer la réception
 * de résultats via SSE (Server-Sent Events).
 * 
 * Fonctionnalités principales :
 * - Capture vidéo via caméra (getUserMedia).
 * - Enregistrement vidéo via MediaRecorder avec gestion des chunks.
 * - Import de fichier vidéo depuis l’ordinateur.
 * - Envoi de la vidéo vers le serveur backend via POST.
 * - Ouverture d’une connexion SSE pour recevoir les mises à jour de traitement.
 * - Affichage vidéo en direct lors de la capture.
 * - Gestion des erreurs et alertes utilisateur.
 * 
 * Props :
 * - onSend (fonction) : callback pour envoyer des messages ou objets vers le parent
 *   avec signature : onSend(message | objet, type?, source?)
 */
const MessageInput = ({ onSend, showInlinePreview = true }) => {
  const [showCamera, setShowCamera] = useState(false);
  const [recording, setRecording] = useState(false);
  const [mediaRecorder, setMediaRecorder] = useState(null);
  const [pendingFile, setPendingFile] = useState(null);
  const [isDragOver, setIsDragOver] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const fileInputRef = useRef(null);
  const videoRef = useRef(null);
  const streamRef = useRef(null);
  const recordedChunksRef = useRef([]);
  const eventSourceRef = useRef(null);
  const startTimeRef = useRef(null);
  const onSendRef = useRef(onSend);

  useEffect(() => {
    onSendRef.current = onSend;
  }, [onSend]);

  const openSSEConnection = (filename) => {
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }

    const url = `${BACKEND_URL}/stream_results?filename=${encodeURIComponent(filename)}`;
    const eventSource = new EventSource(url);

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.error && !data.type) {
          onSend(`❌ Error: ${data.error}`, "log");
        } else {
          switch (data.type) {
            case "video_metadata":
              onSend(data, "video_metadata");
              break;
            case "segment_progress":
              onSend(data, "analysis_progress");
              break;
            case "segment_start":
              onSend(data, "analysis_stage_event");
              onSend(
                {
                  text: `▶️ Starting processing segment frames ${data.segment_start} - ${data.segment_end}`,
                  segmentNumber: Math.floor(data.segment_time / 30) + 1,
                  startTime: data.segment_time.toFixed(1),
                  endTime: (data.segment_time + (data.segment_end - data.segment_start) / data.fps).toFixed(1),
                },
                "segment_header"
              );
              break;
            case "clips_extracted":
              onSend(data, "analysis_stage_event");
              onSend(`📸 Extracted ${data.count} clips in segment starting at frame ${data.segment_start}`, "log");
              break;
            case "clip_scored":
              onSend(data, "analysis_stage_event");
              onSend(
                {
                  id: data.clip_id,
                  video_clip_id: data.video_clip_id,
                  score: data.score,
                  score_source: data.score_source,
                  timestamp: data.timestamp,
                  frame_index: data.frame_index,
                  start_frame: data.start_frame,
                  end_frame: data.end_frame,
                  fps: data.fps,
                }, "clip",
                "system");
              break;
            case "clips_scored":
              onSend(data, "analysis_stage_event");
              onSend(`✅ Scored all ${data.count} clips in segment starting at frame ${data.segment_start}`, "log");
              break;
            case "top_clips_selected":
              onSend(data, "analysis_stage_event");
              onSend(`🎯 Selected ${data.count} top clips in segment starting at frame ${data.segment_start}`, "log");
              break;
            case "clip_processed":
              onSend(data, "analysis_stage_event");
              onSend(
                {
                  id: data.clip_id,
                  video_clip_id: data.video_clip_id,
                  score: data.score,
                  score_source: data.score_source,
                  classification: data.classification,
                  caption: data.caption,
                  description: data.description,
                  imageUrl: data.image_url,
                  preview_base64: data.preview_base64,
                  timestamp: data.timestamp,
                  frame_index: data.frame_index,
                  start_frame: data.start_frame,
                  end_frame: data.end_frame,
                  frame_paths: data.frame_paths,
                  frame_captions: data.frame_captions,
                  object_detections: data.object_detections,
                  bounding_boxes: data.bounding_boxes,
                  object_detection_summary: data.object_detection_summary,
                  temporal_context: data.temporal_context,
                  fps: data.fps,
                },
                "clip",
                "system"
              );
              break;
            case "segment_done":
              onSend(data, "analysis_stage_event");
              onSend(`✔️ Finished segment frames ${data.segment_start} - ${data.segment_end}`, "log");
              break;
            case "analysis_complete":
              onSend(data, "analysis_complete");
              onSend(
                `✅ Analyse terminée (${data.processed_segments || 0}/${data.total_segments || 0} segments, ${data.processed_clips || 0} clips).`,
                "log"
              );
              if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
              }
              break;
            case "analysis_error":
              onSend(data, "analysis_error");
              onSend(`❌ Analysis error: ${data.error || "unknown error"}`, "log");
              if (eventSourceRef.current) {
                eventSourceRef.current.close();
                eventSourceRef.current = null;
              }
              break;
            default:
              onSend(`ℹ️ Unknown event type: ${data.type}`, "log");
          }
        }
      } catch (e) {
        onSend(`⚠️ Error parsing SSE message: ${e.message}`, "log");
      }
    };

    eventSource.onopen = () => {
      onSend("🔗 SSE connection established.", "log");
    };

    eventSource.onerror = () => {
      const isClosed =
        typeof window !== "undefined" &&
        typeof window.EventSource !== "undefined" &&
        eventSource.readyState === window.EventSource.CLOSED;

      onSend(
        isClosed
          ? "⚠️ SSE connection closed."
          : "⚠️ SSE connection error: interrupted. Reconnexion automatique en cours...",
        "log"
      );

      if (isClosed && eventSourceRef.current === eventSource) {
        eventSourceRef.current = null;
      }
    };

    eventSourceRef.current = eventSource;
  };

  const queueVideoFile = (file) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      onSend("❌ Invalid file type. Please upload a video.", "log");
      alert("Invalid file type. Please upload a video.");
      return;
    }
    setPendingFile(file);
    onSend(`📁 Video selected: ${file.name} (${(file.size / (1024 * 1024)).toFixed(2)} MB)`, "log");
  };

  const handleStartCapture = async () => {
    try {
      if (!navigator.mediaDevices || typeof navigator.mediaDevices.getUserMedia !== "function") {
        const secureHint =
          window.location.protocol !== "https:" && window.location.hostname !== "localhost"
            ? " (utilisez HTTPS ou localhost pour la caméra)"
            : "";
        throw new Error(`getUserMedia indisponible${secureHint}`);
      }
      onSend("🎥 Demande d'accès à la caméra...", "log");
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      streamRef.current = stream;
      setShowCamera(true);
      setRecording(false);
      recordedChunksRef.current = [];
      onSend({ stream }, "live_video");
      onSend("📹 Camera started successfully.", "log");
    } catch (error) {
      console.error("Camera access error:", error);
      onSend(`❌ Camera access error: ${error.message}`, "log");
      alert("Camera access error: " + error.message);
    }
  };

  const handleStartRecording = () => {
    if (!streamRef.current) {
      onSend("❌ Start the camera first!", "log");
      alert("Start the camera first!");
      return;
    }
    if (typeof window.MediaRecorder === "undefined") {
      onSend("❌ MediaRecorder non supporté par ce navigateur/contexte.", "log");
      alert("MediaRecorder n'est pas supporté par ce navigateur.");
      return;
    }
    recordedChunksRef.current = [];
    const mimeTypes = [
      "video/mp4; codecs=h264",
      "video/webm; codecs=vp8",
      "video/webm; codecs=vp9",
      "video/webm",
      "video/mp4",
    ];
    let selectedMimeType = null;

    for (const mimeType of mimeTypes) {
      if (window.MediaRecorder.isTypeSupported(mimeType)) {
        selectedMimeType = mimeType;
        break;
      }
    }

    if (!selectedMimeType) {
      onSend("❌ No supported video format found.", "log");
      alert("No supported video format found. Try a different browser.");
      return;
    }

    let recorder;
    try {
      recorder = new window.MediaRecorder(streamRef.current, { mimeType: selectedMimeType });
    } catch (e) {
      console.error("MediaRecorder error:", e);
      onSend(`❌ MediaRecorder error: ${e.message}`, "log");
      alert("MediaRecorder error: " + e.message);
      return;
    }

    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        recordedChunksRef.current.push(event.data);
        console.log(`Chunk received: ${event.data.size} bytes`);
      }
    };

    recorder.onstop = async () => {
      console.log(`Total chunks: ${recordedChunksRef.current.length}, Total size: ${recordedChunksRef.current.reduce((sum, chunk) => sum + chunk.size, 0)} bytes`);
      
      if (recordedChunksRef.current.length === 0) {
        onSend("❌ No video data recorded.", "log");
        alert("No video data recorded. Try recording for longer or check camera settings.");
        cleanupCamera();
        return;
      }

      const blob = new Blob(recordedChunksRef.current, { type: selectedMimeType });
      console.log(`Blob created: ${blob.size} bytes, type: ${blob.type}`);
      
      const videoUrl = URL.createObjectURL(blob);
      const tempVideo = document.createElement("video");
      tempVideo.src = videoUrl;

      try {
        await new Promise((resolve, reject) => {
          tempVideo.onloadedmetadata = () => {
            console.log(`Video metadata: duration=${tempVideo.duration}s, videoWidth=${tempVideo.videoWidth}, videoHeight=${tempVideo.videoHeight}`);
            // Relax duration check for large files
            if ((tempVideo.duration === Infinity || isNaN(tempVideo.duration)) && blob.size > 500000) {
              onSend("⚠️ Video duration reported as invalid, but file size is sufficient. Proceeding with upload.", "log");
              resolve();
            } else if (tempVideo.duration < 1) {
              onSend("⚠️ Video duration too short (<1s).", "log");
              alert("Video duration too short. Record for at least 1 second.");
              reject(new Error("Short duration"));
            } else {
              resolve();
            }
          };
          tempVideo.onerror = () => {
            console.error("Video load error");
            onSend("❌ Recorded video is unplayable.", "log");
            alert("Recorded video is unplayable. Try a different browser or format.");
            reject(new Error("Unplayable video"));
          };
          // Trigger metadata loading
          tempVideo.load();
        });

        // Fallback duration check by playing briefly
        if (tempVideo.duration === Infinity || isNaN(tempVideo.duration)) {
          await new Promise((resolve, reject) => {
            tempVideo.currentTime = Number.MAX_SAFE_INTEGER;
            tempVideo.ontimeupdate = () => {
              if (tempVideo.duration > 1) {
                console.log(`Fallback duration: ${tempVideo.duration}s`);
                resolve();
              } else {
                onSend("⚠️ Fallback duration check failed.", "log");
                reject(new Error("Invalid duration after playback"));
              }
            };
            tempVideo.onerror = () => {
              reject(new Error("Playback error"));
            };
          });
        }

        await sendVideoBlob(blob);
      } catch (e) {
        console.error("Video validation error:", e);
      } finally {
        cleanupCamera();
        URL.revokeObjectURL(videoUrl);
      }
    };

    recorder.onerror = (event) => {
      console.error("Recorder error:", event.error);
      onSend(`❌ Recorder error: ${event.error.message}`, "log");
      alert("Recorder error: " + event.error.message);
    };

    recorder.start(1000); // Timeslice every 1 second
    setMediaRecorder(recorder);
    setRecording(true);
    startTimeRef.current = Date.now();
    onSend(`⏺️ Recording started (MIME: ${selectedMimeType}).`, "log");
  };

  const handleStopRecording = () => {
    if (mediaRecorder && recording) {
      const elapsed = (Date.now() - startTimeRef.current) / 1000;
      if (elapsed < 1) {
        onSend("⚠️ Recording too short (<1s). Please record longer.", "log");
        alert("Please record for at least 1 second.");
        return;
      }
      mediaRecorder.stop();
      setRecording(false);
      onSend("⏹️ Recording stopped.", "log");
    }
  };

  const cleanupCamera = useCallback(() => {
    const hadStream = !!streamRef.current;
    const hadPreviewStream = !!videoRef.current?.srcObject;

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(track => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject = null;
    }

    setShowCamera(false);
    setRecording(false);
    setMediaRecorder(null);

    if (hadStream || hadPreviewStream) {
      onSendRef.current?.(null, "live_video_closed");
      onSendRef.current?.("📹 Camera closed.", "log");
    }
  }, []);

  const handleCancelCapture = () => {
    if (recording) {
      handleStopRecording();
    } else {
      cleanupCamera();
    }
  };

  const handleImportVideo = () => {
    if (recording) {
      onSend("❌ Stop recording before uploading a file.", "log");
      alert("Stop recording before uploading a file.");
      return;
    }
    fileInputRef.current.click();
  };

  const handleFileChange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    if (!file.type.startsWith("video/")) {
      onSend("❌ Invalid file type. Please upload a video.", "log");
      alert("Invalid file type. Please upload a video.");
      return;
    }
    queueVideoFile(file);
    e.target.value = null;
  };

  useEffect(() => {
    if (!showCamera) return;
    const videoEl = videoRef.current;
    const stream = streamRef.current;
    if (!videoEl || !stream) return;
    if (videoEl.srcObject !== stream) {
      videoEl.srcObject = stream;
      const playPromise = videoEl.play();
      if (playPromise && typeof playPromise.catch === "function") {
        playPromise.catch(() => {});
      }
    }
  }, [showCamera]);

  const handleLaunchPendingAnalysis = async () => {
    if (!pendingFile || isUploading) return;
    await sendVideoBlob(pendingFile);
    setPendingFile(null);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    if (recording) {
      onSend("❌ Stop recording before dropping a file.", "log");
      return;
    }
    const file = e.dataTransfer?.files?.[0];
    if (file) queueVideoFile(file);
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!recording) setIsDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  };

  const sendVideoBlob = async (blob) => {
    onSend("📤 Uploading video to server. Processing will begin shortly...", "log");
    setIsUploading(true);

    const formData = new FormData();
    const extension = blob.type.split("/")[1].split(";")[0];
    const filename = blob.name || `recorded_video.${extension === "webm" ? "webm" : "mp4"}`;
    formData.append("video", blob, filename);
    onSend(
      {
        type: "analysis_run_started",
        filename,
        startedAt: new Date().toISOString(),
        source: blob.name ? "file" : "camera",
      },
      "analysis_run_started"
    );

    try {
      const response = await fetch(`${BACKEND_URL}/upload`, {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error);
      }

      const filename = data.filename;
      const videoUrl = data.video_url;

      onSend(
        {
          filename: filename,
          video_url: `${BACKEND_URL}${videoUrl}`,
        },
        "video",
        "system"
      );

      onSend("✅ Upload successful, starting segment-by-segment processing...", "log");
      openSSEConnection(filename);
    } catch (error) {
      console.error("Upload failed:", error);
      onSend(`❌ Failed to upload video: ${error.message}`, "log");
      onSend(
        {
          type: "analysis_error",
          success: false,
          error: error.message,
          filename,
        },
        "analysis_error"
      );
    } finally {
      setIsUploading(false);
    }
  };

  useEffect(() => {
    console.log(`Browser: ${navigator.userAgent}`);
    const supportedMimes = ["video/mp4; codecs=h264", "video/webm; codecs=vp8", "video/webm; codecs=vp9", "video/webm", "video/mp4"];
    if (typeof window.MediaRecorder !== "undefined" && typeof window.MediaRecorder.isTypeSupported === "function") {
      supportedMimes.forEach(mime => {
        console.log(`MIME ${mime} supported: ${window.MediaRecorder.isTypeSupported(mime)}`);
      });
    } else {
      console.warn("MediaRecorder not available in this browser/context");
    }
    return () => {
      cleanupCamera();
      if (eventSourceRef.current) {
        eventSourceRef.current.close();
        eventSourceRef.current = null;
      }
    };
  }, [cleanupCamera]);

  return (
    <div className="input-box">
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => !recording && !showCamera && fileInputRef.current?.click()}
        style={{
          border: `1px dashed ${isDragOver ? "#4b0082" : "#d1d5db"}`,
          background: isDragOver ? "#f5f3ff" : "#fafafa",
          borderRadius: 12,
          padding: "10px 12px",
          marginBottom: 10,
          cursor: recording || showCamera ? "default" : "pointer",
          transition: "all 0.2s ease",
        }}
      >
        <div style={{ fontSize: 13, color: "#374151", fontWeight: 600 }}>
          {pendingFile ? "Vidéo prête" : "Glissez-déposez une vidéo ici"}
        </div>
        <div style={{ fontSize: 12, color: "#6b7280", marginTop: 2 }}>
          {pendingFile
            ? `${pendingFile.name} • ${(pendingFile.size / (1024 * 1024)).toFixed(2)} MB`
            : "ou cliquez pour sélectionner un fichier"}
        </div>
        {pendingFile && (
          <div style={{ marginTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                handleLaunchPendingAnalysis();
              }}
              disabled={isUploading}
              style={{
                border: "none",
                background: isUploading ? "#d1d5db" : "#4b0082",
                color: "#fff",
                borderRadius: 999,
                padding: "7px 12px",
                fontSize: 12,
                fontWeight: 700,
                cursor: isUploading ? "not-allowed" : "pointer",
              }}
            >
              {isUploading ? "Upload..." : "Lancer l’analyse"}
            </button>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                setPendingFile(null);
              }}
              disabled={isUploading}
              style={{
                border: "1px solid #d1d5db",
                background: "#fff",
                color: "#374151",
                borderRadius: 999,
                padding: "7px 12px",
                fontSize: 12,
                fontWeight: 600,
                cursor: isUploading ? "not-allowed" : "pointer",
              }}
            >
              Annuler
            </button>
          </div>
        )}
      </div>
      <div className="input-actions">
        {!showCamera && !recording && (
          <>
            <span className="icon" onClick={handleStartCapture} title="Start camera capture">🎥</span>
            <span className="icon" onClick={handleImportVideo} title="Import video">📁</span>
          </>
        )}

        {showCamera && !recording && (
          <>
            <span className="icon" onClick={handleStartRecording} title="Start recording" style={{ color: "green" }}>🔴</span>
            <span className="icon" onClick={handleCancelCapture} title="Cancel capture">❌</span>
          </>
        )}

        {recording && (
          <>
            <span className="icon" onClick={handleStopRecording} title="Stop recording" style={{ color: "red" }}>⏹️</span>
            <span className="icon" onClick={handleCancelCapture} title="Cancel capture">❌</span>
          </>
        )}

        <input
          type="file"
          accept="video/*"
          ref={fileInputRef}
          style={{ display: "none" }}
          onChange={handleFileChange}
          disabled={recording}
        />
      </div>

      {showCamera && showInlinePreview && (
        <div style={{ marginTop: "10px", width: "100%", display: "flex", justifyContent: "flex-start" }}>
          <video
            ref={videoRef}
            autoPlay
            muted
            playsInline
            style={{ width: "100%", maxWidth: "360px", borderRadius: "8px", border: "1px solid #ccc" }}
          />
        </div>
      )}
    </div>
  );
};

export default MessageInput;
