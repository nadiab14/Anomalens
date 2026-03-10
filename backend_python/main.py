
"""
main.py – Backend Flask pour une application de surveillance intelligente avec détection d’anomalies

Ce serveur permet :
- L’upload de vidéos par les utilisateurs
- Le traitement automatique segmenté de la vidéo
- L’extraction de clips et le scoring d’anomalies avec un modèle PyTorch
- La génération de captions via VLM (LLaVA/OpenRouter) avec fallback BLIP
- L’enrichissement sémantique via OpenRouter (LLaMA 3.2)
- La diffusion des résultats en temps réel (SSE)
- L’enregistrement des événements anormaux dans un backend Node.js

Votre architecture permet d’ajouter :
- Tracking multi-objets
- Calibration adaptative de seuil
- Indexation FAISS
- RAG vidéo avancé
- Apprentissage actif (feedback humain)

👉 Fonction assurée :
Évolutivité vers un système de surveillance IA avancé.
"""
from flask import Flask, request, jsonify, Response, stream_with_context, has_request_context
from flask import send_from_directory
from flask_cors import CORS, cross_origin
import os
import uuid
import torch
from io import BytesIO
import base64
from PIL import Image
import requests
import json
import re
from urllib.parse import urlparse, unquote
from transformers import BlipProcessor, BlipForConditionalGeneration
from frame_extractor import FrameExtractor
from feature_extractor import FeatureExtractor
from clip_selector import ClipSelector
from anomaly_detector import load_model, compute_anomaly_score
from classification import GuaranteedClassifier
from object_detect import ObjectDetector
import subprocess
from paramsController import insert_clip_parameters, initialize_database, fetch_clip_parameters
from datetime import datetime, timezone
from chat_multiagent import ChatAgentConfig, ChatAgentDeps, ChatOrchestrator
from pipeline_multiagent import PipelineAgentConfig, PipelineAgentDeps, VideoPipelineOrchestrator
try:
    from dotenv import load_dotenv
except Exception:
    load_dotenv = None

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
PROJECT_ROOT = os.path.dirname(BASE_DIR)


def _load_env_file_fallback(path, override=False):
    """
    Minimal .env loader fallback when python-dotenv is unavailable.
    Supports KEY=VALUE lines and ignores comments/empty lines.
    """
    if not path or not os.path.exists(path):
        return
    try:
        with open(path, "r", encoding="utf-8") as env_file:
            for raw_line in env_file:
                line = raw_line.strip()
                if not line or line.startswith("#") or "=" not in line:
                    continue
                key, value = line.split("=", 1)
                key = key.strip()
                if not key:
                    continue
                value = value.strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in {"'", '"'}:
                    value = value[1:-1]
                if override or key not in os.environ:
                    os.environ[key] = value
    except Exception as exc:
        print(f"⚠️ Unable to parse env file {path}: {exc}")


if load_dotenv:
    # Load backend-local `.env` first, then project-root `.env` as fallback.
    load_dotenv(os.path.join(BASE_DIR, ".env"), override=False)
    load_dotenv(os.path.join(PROJECT_ROOT, ".env"), override=False)
else:
    print("⚠️ python-dotenv not found; using builtin .env loader fallback.")

# Always apply fallback parser so env values are still loaded if python-dotenv
# is missing in the active runtime environment.
_load_env_file_fallback(os.path.join(BASE_DIR, ".env"), override=False)
_load_env_file_fallback(os.path.join(PROJECT_ROOT, ".env"), override=False)

DEFAULT_FFMPEG = r"C:\Users\Nadia Bali\ffmpeg\bin\ffmpeg.exe" if os.name == "nt" else "ffmpeg"
DEFAULT_FFPROBE = r"C:\Users\Nadia Bali\ffmpeg\bin\ffprobe.exe" if os.name == "nt" else "ffprobe"
FFMPEG = os.getenv("FFMPEG", DEFAULT_FFMPEG)
FFPROBE = os.getenv("FFPROBE", DEFAULT_FFPROBE)

# ====== Initialisation de l'application Flask ======
app = Flask(__name__)
CORS(app)
initialize_database()
# ======Configuration des chemins ======
UPLOAD_FOLDER = os.getenv("UPLOAD_FOLDER", os.path.join(BASE_DIR, "uploads"))
ANOMALY_MODEL_FALLBACK_PATH = (
    os.getenv(
        "ANOMALY_MODEL_FALLBACK_PATH",
        os.path.join(BASE_DIR, "detector3.pth"),
    ).strip()
    or None
)
OUTPUT_CLIP_FOLDER = os.getenv("OUTPUT_CLIP_FOLDER", os.path.join(BASE_DIR, "output_clips"))

NODE_BACKEND_URL = os.getenv("NODE_BACKEND_URL", "http://localhost:5001/api/historique")
PUBLIC_BACKEND_BASE_URL = os.getenv(
    "PUBLIC_BACKEND_BASE_URL",
    "https://vanda-ungazing-nonengrossingly.ngrok-free.dev",
).rstrip("/")

os.makedirs(UPLOAD_FOLDER, exist_ok=True)
os.makedirs(OUTPUT_CLIP_FOLDER, exist_ok=True)
 #======Configuration du matériel ======
device = "cuda" if torch.cuda.is_available() else "cpu"
#========Chargement du fallback BLIP pour le captioning ======
blip_processor = BlipProcessor.from_pretrained("Salesforce/blip-image-captioning-base")
blip_model = BlipForConditionalGeneration.from_pretrained("Salesforce/blip-image-captioning-base").to(device)

OPENROUTER_API_KEY = os.getenv("OPENROUTER_API_KEY", "").strip()
OPENROUTER_BASE_URL = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1")
ANOMALY_MODEL_REF = os.getenv("ANOMALY_MODEL_REF", "abhi26/video-anomaly-detection")
_env_models = [m.strip() for m in os.getenv("OPENROUTER_MODELS", "").split(",") if m.strip()]
OPENROUTER_MODELS = _env_models or [
    os.getenv("OPENROUTER_MODEL", "mistralai/mistral-small-3.1-24b-instruct:free"),
    "google/gemma-3-12b-it:free",
    "nvidia/nemotron-nano-12b-v2-vl:free",
    "qwen/qwen3-vl-30b-a3b-thinking",
]
_env_vlm_scoring_models = [m.strip() for m in os.getenv("VLM_SCORING_MODELS", "").split(",") if m.strip()]
VLM_SCORING_MODELS = _env_vlm_scoring_models or OPENROUTER_MODELS
VLM_SCORING_ENABLED = os.getenv("VLM_SCORING_ENABLED", "1") == "1"
VLM_SCORING_MAX_FRAMES = max(1, int(os.getenv("VLM_SCORING_MAX_FRAMES", "3")))
VLM_SCORING_TIMEOUT_SEC = max(8, int(os.getenv("VLM_SCORING_TIMEOUT_SEC", "35")))
VLM_SCORING_FAIL_LIMIT = max(1, int(os.getenv("VLM_SCORING_FAIL_LIMIT", "4")))
VLM_SCORING_TEMPERATURE = float(os.getenv("VLM_SCORING_TEMPERATURE", "0.0"))
VLM_SCORING_FALLBACK_LOCAL = os.getenv("VLM_SCORING_FALLBACK_LOCAL", "1") == "1"
_env_vlm_caption_models = [m.strip() for m in os.getenv("VLM_CAPTION_MODELS", "").split(",") if m.strip()]
VLM_CAPTION_MODELS = _env_vlm_caption_models or [
    os.getenv("VLM_CAPTION_MODEL", "llava-hf/llava-1.5-7b-hf"),
    "openrouter/auto",
    "qwen/qwen3-vl-30b-a3b-thinking",
    "google/gemma-3-12b-it:free",
]
VLM_CAPTION_TIMEOUT_SEC = max(8, int(os.getenv("VLM_CAPTION_TIMEOUT_SEC", "35")))
VLM_CAPTION_TEMPERATURE = float(os.getenv("VLM_CAPTION_TEMPERATURE", "0.1"))
VLM_CAPTION_MAX_TOKENS = max(16, int(os.getenv("VLM_CAPTION_MAX_TOKENS", "96")))
VLM_CAPTION_FALLBACK_BLIP = os.getenv("VLM_CAPTION_FALLBACK_BLIP", "1") == "1"
ANOMALY_THRESHOLD = float(os.getenv("ANOMALY_THRESHOLD", "0.5"))
DEBUG_PIPELINE = os.getenv("DEBUG_PIPELINE", "0") == "1"
PERSIST_PREVIEW_BASE64 = os.getenv("PERSIST_PREVIEW_BASE64", "0") == "1"
PERSIST_FRAME_BASE64_SAMPLES = os.getenv("PERSIST_FRAME_BASE64_SAMPLES", "1") == "1"
FRAME_BASE64_SAMPLE_COUNT = int(os.getenv("FRAME_BASE64_SAMPLE_COUNT", "2"))
LLM_DB_CONTEXT_LIMIT = int(os.getenv("LLM_DB_CONTEXT_LIMIT", "20"))
RAG_TOP_K = int(os.getenv("RAG_TOP_K", "8"))
RAG_CANDIDATE_LIMIT = int(os.getenv("RAG_CANDIDATE_LIMIT", "80"))
RAG_IMAGE_TOP_K = int(os.getenv("RAG_IMAGE_TOP_K", "3"))
FRAME_CAPTION_SAMPLE_COUNT = int(os.getenv("FRAME_CAPTION_SAMPLE_COUNT", "4"))
LLM_EVIDENCE_MAX_EVENTS = int(os.getenv("LLM_EVIDENCE_MAX_EVENTS", "3"))
LLM_EVIDENCE_MAX_FRAMES_PER_EVENT = int(os.getenv("LLM_EVIDENCE_MAX_FRAMES_PER_EVENT", "1"))
LLM_MANUAL_IMAGE_URLS = int(os.getenv("LLM_MANUAL_IMAGE_URLS", "3"))
MAX_USER_IMAGE_BYTES = int(os.getenv("MAX_USER_IMAGE_BYTES", "12000000"))
YOLO_ENABLED = os.getenv("YOLO_ENABLED", "1") == "1"
YOLO_MODEL = os.getenv("YOLO_MODEL", "yolov8n.pt")
YOLO_CONF = float(os.getenv("YOLO_CONF", "0.25"))
YOLO_IOU = float(os.getenv("YOLO_IOU", "0.45"))

POSSIBLE_CLASSES = [
    "Abuse",
    "Arrest",
    "Arson",
    "Assault",
    "Burglary",
    "Explosion",
    "Fighting",
    "Normal",
    "RoadAccident",
    "Robbery",
    "Shooting",
    "Shoplifting",
    "Stealing",
    "Vandalism",
]
#==========Encodage d'image en base64 ======
def encode_image(image):
    buffer = BytesIO()
    image.save(buffer, format="JPEG")
    return base64.b64encode(buffer.getvalue()).decode("utf-8")


def _get_public_backend_base_url():
    """
    Resolve the best public base URL for frame links.
    Priority:
    1) Incoming forwarded host/proto (ngrok/reverse proxy),
    2) Non-local request host,
    3) PUBLIC_BACKEND_BASE_URL env/static value.
    """
    configured = (PUBLIC_BACKEND_BASE_URL or "").strip().rstrip("/")
    if configured and "localhost" not in configured and "127.0.0.1" not in configured:
        return configured

    if has_request_context():
        forwarded_host = (request.headers.get("X-Forwarded-Host") or "").strip()
        if forwarded_host:
            forwarded_proto = (request.headers.get("X-Forwarded-Proto") or "https").strip()
            return f"{forwarded_proto}://{forwarded_host}".rstrip("/")

        current_host = (request.host or "").strip()
        if current_host and not current_host.lower().startswith(("localhost", "127.0.0.1")):
            return f"{request.scheme}://{current_host}".rstrip("/")

    return (PUBLIC_BACKEND_BASE_URL or "http://localhost:5000").rstrip("/")


def _to_public_url(path_or_url, base_url=None):
    if not isinstance(path_or_url, str):
        return path_or_url
    value = path_or_url.strip()
    if not value:
        return value
    if value.startswith("data:image/"):
        return value
    base = (base_url or _get_public_backend_base_url()).rstrip("/")

    if value.startswith(("http://", "https://")):
        try:
            parsed = urlparse(value)
        except Exception:
            return value
        rel = unquote(parsed.path or "").lstrip("/")
        if rel.startswith(("output_clips/", "uploads/")):
            query = f"?{parsed.query}" if parsed.query else ""
            frag = f"#{parsed.fragment}" if parsed.fragment else ""
            return f"{base}/{rel}{query}{frag}"
        host = (parsed.hostname or "").lower()
        if host in {"localhost", "127.0.0.1"}:
            query = f"?{parsed.query}" if parsed.query else ""
            frag = f"#{parsed.fragment}" if parsed.fragment else ""
            return f"{base}/{rel}{query}{frag}"
        return value

    rel = value.lstrip("/").replace("\\", "/")
    return f"{base}/{rel}"


def _normalize_event_public_urls(event, base_url=None):
    if not isinstance(event, dict):
        return event

    normalized = dict(event)
    base = (base_url or _get_public_backend_base_url()).rstrip("/")
    frame_urls = normalized.get("frameUrls")
    frame_paths = normalized.get("framePaths")

    if isinstance(frame_urls, list) and frame_urls:
        normalized["frameUrls"] = [_to_public_url(url, base) for url in frame_urls if isinstance(url, str)]
    elif isinstance(frame_paths, list) and frame_paths:
        normalized["frameUrls"] = [_to_public_url(path, base) for path in frame_paths if isinstance(path, str)]

    return normalized


def _extract_video_stem(video_name):
    if not isinstance(video_name, str):
        return ""
    name = video_name.strip()
    if not name:
        return ""
    return os.path.splitext(os.path.basename(name))[0]


def _event_matches_video_name(event, target_video_name):
    """
    Defensive local filter in case the Node backend ignores `videoName` query param.
    Matches by:
    - exact `videoName`
    - `videoClipId` prefix (`<video_stem>__segment_*`)
    - frame path/url containing `/output_clips/<video_stem>/...`
    """
    if not isinstance(event, dict):
        return False
    if not target_video_name:
        return True

    target_name = str(target_video_name).strip()
    if not target_name:
        return True
    target_stem = _extract_video_stem(target_name)

    ev_video_name = str(event.get("videoName") or "").strip()
    if ev_video_name and ev_video_name == target_name:
        return True

    ev_video_clip_id = str(event.get("videoClipId") or "").strip()
    if target_stem and ev_video_clip_id.startswith(f"{target_stem}__"):
        return True

    candidates = []
    frame_paths = event.get("framePaths") or []
    frame_urls = event.get("frameUrls") or []
    if isinstance(frame_paths, list):
        candidates.extend([p for p in frame_paths if isinstance(p, str)])
    if isinstance(frame_urls, list):
        candidates.extend([u for u in frame_urls if isinstance(u, str)])

    if target_stem:
        needle = f"/output_clips/{target_stem}/"
        needle_rel = f"output_clips/{target_stem}/"
        for value in candidates:
            normalized = value.replace("\\", "/")
            if needle in normalized or normalized.startswith(needle_rel):
                return True

    return False


object_detector = ObjectDetector(
    model_name=YOLO_MODEL,
    conf=YOLO_CONF,
    iou=YOLO_IOU,
    device=("cuda:0" if device == "cuda" else "cpu"),
    enabled=YOLO_ENABLED,
)
def _sanitize_caption_text(text: str) -> str:
    if not isinstance(text, str):
        return "No caption"
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", cleaned)
        cleaned = re.sub(r"\s*```$", "", cleaned)
    cleaned = cleaned.replace("\r", " ").replace("\n", " ").strip()
    if not cleaned:
        return "No caption"
    if cleaned.lower().startswith("caption:"):
        cleaned = cleaned.split(":", 1)[1].strip() or cleaned
    if len(cleaned) > 220:
        cleaned = cleaned[:217].rstrip() + "..."
    return cleaned


def _generate_caption_with_llava(image: Image.Image, api_key: str) -> str | None:
    if not api_key:
        return None
    if image is None:
        return None

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5000",
        "X-Title": "Anomalens Backend",
    }
    frame_b64 = encode_image(image.convert("RGB"))
    messages = [
        {
            "role": "user",
            "content": [
                {
                    "type": "text",
                    "text": (
                        "You are a surveillance image captioning assistant. "
                        "Return a short factual caption (max 18 words), no markdown."
                    ),
                },
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"},
                },
            ],
        }
    ]

    last_error = None
    for model_name in VLM_CAPTION_MODELS:
        if not _model_supports_images(model_name):
            continue
        payload = {
            "model": model_name,
            "messages": messages,
            "temperature": VLM_CAPTION_TEMPERATURE,
            "max_tokens": VLM_CAPTION_MAX_TOKENS,
        }
        try:
            response = requests.post(
                f"{OPENROUTER_BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
                timeout=VLM_CAPTION_TIMEOUT_SEC,
            )
        except Exception as e:
            last_error = str(e)
            continue

        try:
            data = response.json()
        except ValueError:
            data = {"raw": response.text}

        if 200 <= response.status_code < 300:
            choices = data.get("choices") if isinstance(data, dict) else None
            if choices and isinstance(choices, list):
                content_text = str(choices[0].get("message", {}).get("content", "")).strip()
                caption = _sanitize_caption_text(content_text)
                if caption and caption != "No caption":
                    return caption
            last_error = f"unexpected OpenRouter caption response from {model_name}"
            continue

        error_message = data.get("error", {}).get("message") if isinstance(data, dict) else None
        last_error = f"{response.status_code} {error_message or str(data)}"
        if response.status_code in {404, 408, 409, 429, 500, 502, 503, 504}:
            continue
        break

    if last_error:
        print(f"⚠️ LLaVA/OpenRouter caption fallback to BLIP: {last_error}")
    return None


# ====== Génération de captions avec VLM (LLaVA/OpenRouter) + fallback BLIP ======
def generate_caption(image: Image.Image) -> str:
    caption = _generate_caption_with_llava(image, OPENROUTER_API_KEY)
    if caption:
        return caption

    if not VLM_CAPTION_FALLBACK_BLIP:
        return "No caption"

    inputs = blip_processor(images=image, return_tensors="pt").to(device)
    out = blip_model.generate(**inputs)
    caption = blip_processor.decode(out[0], skip_special_tokens=True)
    return _sanitize_caption_text(caption)


def _build_local_description_fallback(caption, score, classification, temporal_context=None):
    safe_caption = _sanitize_caption_text(caption)
    safe_class = str(classification or "Unknown").strip() or "Unknown"
    try:
        safe_score = float(score)
    except (TypeError, ValueError):
        safe_score = 0.0

    if safe_score >= 0.7:
        risk_level = "high anomaly confidence"
    elif safe_score >= 0.4:
        risk_level = "moderate anomaly confidence"
    else:
        risk_level = "low anomaly confidence"

    parts = [f"Observed scene: {safe_caption}.", f"Predicted class: {safe_class}.", f"Risk level: {risk_level} ({safe_score:.2f})."]

    if isinstance(temporal_context, dict):
        clip_ctx = temporal_context.get("clipWindowSec") or {}
        before_ctx = temporal_context.get("beforeContextSec") or {}
        after_ctx = temporal_context.get("afterContextSec") or {}
        try:
            parts.append(
                "Temporal window: "
                f"{float(clip_ctx.get('start', 0.0)):.2f}s to {float(clip_ctx.get('end', 0.0)):.2f}s "
                f"(center {float(clip_ctx.get('center', 0.0)):.2f}s)."
            )
            parts.append(
                "Context hypothesis: activity may build from "
                f"{float(before_ctx.get('start', 0.0)):.2f}s to {float(before_ctx.get('end', 0.0)):.2f}s "
                "and continue briefly after the clip."
            )
        except Exception:
            pass

    return " ".join(parts)
# ======Génération de description + correction de classe via OpenRouter (LLaMA) ======
def generate_description(caption, score, classification, preview_base64, api_key, temporal_context=None):
    if not api_key:
        return _build_local_description_fallback(
            caption,
            score,
            classification,
            temporal_context=temporal_context,
        )

    temporal_context_block = ""
    if isinstance(temporal_context, dict):
        try:
            before_ctx = temporal_context.get("beforeContextSec") or {}
            after_ctx = temporal_context.get("afterContextSec") or {}
            clip_ctx = temporal_context.get("clipWindowSec") or {}
            seg_ctx = temporal_context.get("segmentWindowSec") or {}
            temporal_context_block = (
                "\n**Temporal Context (structured)**:\n"
                f"- Segment window: {float(seg_ctx.get('start', 0.0)):.2f}s -> {float(seg_ctx.get('end', 0.0)):.2f}s\n"
                f"- Clip window: {float(clip_ctx.get('start', 0.0)):.2f}s -> {float(clip_ctx.get('end', 0.0)):.2f}s "
                f"(center {float(clip_ctx.get('center', 0.0)):.2f}s)\n"
                f"- Before context window: {float(before_ctx.get('start', 0.0)):.2f}s -> {float(before_ctx.get('end', 0.0)):.2f}s\n"
                f"- After context window: {float(after_ctx.get('start', 0.0)):.2f}s -> {float(after_ctx.get('end', 0.0)):.2f}s\n"
            )
        except Exception:
            temporal_context_block = ""

    prompt = f"""
You are analyzing a surveillance video clip from a fixed camera.

**Caption**: "{caption}"  
**Anomaly Score (0 to 1)**: {score}  
**Initial Classification**: "{classification}"  
**Possible Classes**: {', '.join(POSSIBLE_CLASSES)}
{temporal_context_block}

Instructions:

1. **Short Caption Validation**: confirm/refine the short caption in one sentence.
2. **Detailed Description**: describe the scene with more detail (actors/objects/actions/risk cues).
3. **Temporal Context (Before/After)**: infer what is likely just before and just after the clip using the timestamps and current frame only; mark this as hypothesis, not certainty.
4. **Classification Correction**: if the initial classification appears incorrect, choose a better label from the provided possible classes. Otherwise, keep it.

Respond in this format:
Short Description: <scene summary>  
Detailed Description: <detailed scene description>  
Temporal Context: <before/after hypotheses with uncertainty>  
Corrected Class: <one of the possible classes>
""".strip()

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5000",
        "X-Title": "Anomalens Backend",
    }

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "text", "text": prompt},
                {
                    "type": "image_url",
                    "image_url": {"url": f"data:image/jpeg;base64,{preview_base64}"},
                },
            ],
        }
    ]

    try:
        last_error = None
        attempted_models = []
        for model_name in OPENROUTER_MODELS:
            if not _model_supports_images(model_name):
                continue
            attempted_models.append(model_name)
            payload = {"model": model_name, "messages": messages}
            response = requests.post(
                f"{OPENROUTER_BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
                timeout=30,
            )

            try:
                data = response.json()
            except ValueError:
                data = {"raw": response.text}

            if 200 <= response.status_code < 300:
                if "choices" in data and len(data["choices"]) > 0:
                    return data["choices"][0]["message"]["content"].strip()
                last_error = "Unexpected response format from OpenRouter"
                continue

            error_message = data.get("error", {}).get("message") if isinstance(data, dict) else None
            last_error = f"{response.status_code} {error_message or str(data)}"

            # Common case: selected model is unavailable on this account/tier.
            if response.status_code == 404:
                continue
            break

        if attempted_models:
            return _build_local_description_fallback(
                caption,
                score,
                classification,
                temporal_context=temporal_context,
            )
        return _build_local_description_fallback(
            caption,
            score,
            classification,
            temporal_context=temporal_context,
        )
    except Exception as e:
        return _build_local_description_fallback(
            caption,
            score,
            classification,
            temporal_context=temporal_context,
        )


def _sample_frames_for_vlm(clip_frames, max_frames=3):
    if not isinstance(clip_frames, list) or not clip_frames:
        return []
    n = len(clip_frames)
    k = max(1, min(int(max_frames), n))
    if k >= n:
        return clip_frames
    if k == 1:
        return [clip_frames[n // 2]]
    indices = sorted({round(i * (n - 1) / (k - 1)) for i in range(k)})
    return [clip_frames[i] for i in indices]


def _coerce_unit_score(value):
    try:
        score = float(value)
    except (TypeError, ValueError):
        return None
    if score < 0.0:
        return 0.0
    if score > 1.0:
        return 1.0
    return score


def _parse_vlm_scoring_response(content):
    if not isinstance(content, str) or not content.strip():
        return None, {}

    text = content.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-zA-Z0-9_-]*\s*", "", text)
        text = re.sub(r"\s*```$", "", text)

    payload = None
    json_candidates = []
    brace_match = re.search(r"\{[\s\S]*\}", text)
    if brace_match:
        json_candidates.append(brace_match.group(0))
    json_candidates.append(text)

    for candidate in json_candidates:
        try:
            parsed = json.loads(candidate)
            if isinstance(parsed, dict):
                payload = parsed
                break
        except Exception:
            continue

    if payload is None:
        payload = {}
        score_match = re.search(r"(?:anomaly_score|risk_score|score)\s*[:=]\s*([01](?:\.\d+)?)", text, flags=re.IGNORECASE)
        if score_match:
            payload["anomaly_score"] = score_match.group(1)
        label_match = re.search(r"(?:label|class)\s*[:=]\s*\"?([A-Za-z][A-Za-z0-9_-]{1,40})\"?", text, flags=re.IGNORECASE)
        if label_match:
            payload["label"] = label_match.group(1)
        reason_match = re.search(
            r"(?:short_reason|reason|explanation)\s*[:=]\s*\"?([^\n\"]{3,220})\"?",
            text,
            flags=re.IGNORECASE,
        )
        if reason_match:
            payload["short_reason"] = reason_match.group(1).strip()

    score = _coerce_unit_score(payload.get("anomaly_score"))
    if score is None:
        score = _coerce_unit_score(payload.get("score"))
    if score is None:
        fallback_numbers = re.findall(r"(?<!\d)(?:0(?:\.\d+)?|1(?:\.0+)?)", text)
        if fallback_numbers:
            score = _coerce_unit_score(fallback_numbers[0])

    if score is None:
        return None, {"parse_error": True}

    meta = {
        "label": str(payload.get("label")).strip() if payload.get("label") else None,
        "reason": str(payload.get("short_reason") or payload.get("reason") or "").strip() or None,
    }
    return score, meta


def score_clip_with_vlm(clip_frames, api_key, clip_id=None):
    if not api_key:
        return None, {"error": "missing_openrouter_api_key"}

    sampled_frames = _sample_frames_for_vlm(clip_frames, max_frames=VLM_SCORING_MAX_FRAMES)
    if not sampled_frames:
        return None, {"error": "no_frames_for_vlm"}

    prompt = (
        "You are a surveillance anomaly scoring model.\n"
        "You receive frames from the same short clip in chronological order.\n"
        "Task: return ONLY valid JSON with this schema:\n"
        "{"
        "\"anomaly_score\": <float between 0 and 1>, "
        "\"label\": <one of: " + ", ".join(POSSIBLE_CLASSES) + ">, "
        "\"short_reason\": <max 18 words>"
        "}\n"
        "Scoring scale:\n"
        "- 0.00 to 0.29: normal scene\n"
        "- 0.30 to 0.59: uncertain / mild anomaly\n"
        "- 0.60 to 1.00: clear anomaly\n"
        "No markdown, no extra text."
    )
    if clip_id:
        prompt += f"\nClip ID: {clip_id}"

    headers = {
        "Authorization": f"Bearer {api_key}",
        "Content-Type": "application/json",
        "HTTP-Referer": "http://localhost:5000",
        "X-Title": "Anomalens Backend",
    }

    content = [{"type": "text", "text": prompt}]
    for frame in sampled_frames:
        frame_b64 = encode_image(frame.convert("RGB"))
        content.append(
            {
                "type": "image_url",
                "image_url": {"url": f"data:image/jpeg;base64,{frame_b64}"},
            }
        )

    messages = [{"role": "user", "content": content}]
    last_error = None
    attempted_models = []

    try:
        for model_name in VLM_SCORING_MODELS:
            if not _model_supports_images(model_name):
                continue
            attempted_models.append(model_name)
            payload = {
                "model": model_name,
                "messages": messages,
                "temperature": VLM_SCORING_TEMPERATURE,
            }
            response = requests.post(
                f"{OPENROUTER_BASE_URL}/chat/completions",
                headers=headers,
                json=payload,
                timeout=VLM_SCORING_TIMEOUT_SEC,
            )

            try:
                data = response.json()
            except ValueError:
                data = {"raw": response.text}

            if 200 <= response.status_code < 300:
                choices = data.get("choices") if isinstance(data, dict) else None
                if choices and len(choices) > 0:
                    content_text = choices[0].get("message", {}).get("content", "").strip()
                    score, parsed_meta = _parse_vlm_scoring_response(content_text)
                    if score is not None:
                        parsed_meta["model"] = model_name
                        return score, parsed_meta
                    last_error = f"unparseable scoring response from {model_name}"
                    continue
                last_error = f"unexpected OpenRouter format from {model_name}"
                continue

            error_message = data.get("error", {}).get("message") if isinstance(data, dict) else None
            last_error = f"{response.status_code} {error_message or str(data)}"
            if response.status_code in {404, 408, 409, 429, 500, 502, 503, 504}:
                continue
            break

        if not attempted_models:
            return None, {"error": "no_vision_model_available"}
        return None, {"error": last_error or "vlm_scoring_failed", "models_tried": attempted_models}
    except Exception as e:
        return None, {"error": str(e), "models_tried": attempted_models}
# ======Envoi de l’événement anormal détecté vers le backend Node.js ======
def save_abnormal_event(video_name, event_name, description, score, extra_data=None):
    event_data = {
        "videoName": video_name,
        "eventName": event_name,
        "description": description,
        "score": score,
        "processedAt": datetime.now(timezone.utc).isoformat()
    }

    if isinstance(extra_data, dict):
        event_data.update(extra_data)
    
    try:
        response = requests.post(NODE_BACKEND_URL, json=event_data, timeout=5)
        if 200 <= response.status_code < 300:
            print(f"✅ Successfully saved event: {event_name}")
            return True
        else:
            print(f"⚠️ Server returned status {response.status_code}: {response.text}")
            return False
    except Exception as e:
        print(f"⚠️ Error saving event to Node.js: {str(e)}")
        return False


def fetch_recent_historique_events(limit=20, video_name=None):
    try:
        params = {"limit": limit}
        if video_name:
            params["videoName"] = video_name
        response = requests.get(NODE_BACKEND_URL, params=params, timeout=8)
        if response.status_code != 200:
            return []
        data = response.json()
        if not isinstance(data, list):
            return []
        base_url = _get_public_backend_base_url()
        normalized_events = [_normalize_event_public_urls(ev, base_url=base_url) for ev in data if isinstance(ev, dict)]
        if video_name:
            normalized_events = [
                ev for ev in normalized_events
                if _event_matches_video_name(ev, video_name)
            ]
        return normalized_events
    except Exception:
        return []


def _tokenize_text(text):
    if not isinstance(text, str):
        return []
    return [tok for tok in re.findall(r"[a-zA-Z0-9_]+", text.lower()) if len(tok) > 1]


def _build_event_text(ev):
    parts = [
        str(ev.get("eventName", "")),
        str(ev.get("classification", "")),
        str(ev.get("caption", "")),
        str(ev.get("description", "")),
        str(ev.get("clipId", "")),
    ]
    frame_captions = ev.get("frameCaptions") or []
    if isinstance(frame_captions, list):
        for item in frame_captions[:6]:
            if isinstance(item, dict) and item.get("caption"):
                parts.append(str(item.get("caption")))
    object_summary = ev.get("objectDetectionSummary") or {}
    if isinstance(object_summary, dict):
        classes = object_summary.get("classes") or {}
        if isinstance(classes, dict):
            parts.extend([str(cls_name) for cls_name in classes.keys()])
    return " ".join(parts)


def _retrieve_relevant_events(query, events, top_k=8):
    if not isinstance(events, list) or not events:
        return []

    query_tokens = set(_tokenize_text(query))
    if not query_tokens:
        return events[:top_k]

    scored = []
    for idx, ev in enumerate(events):
        if not isinstance(ev, dict):
            continue

        doc_text = _build_event_text(ev)
        doc_tokens = set(_tokenize_text(doc_text))
        overlap = len(query_tokens & doc_tokens)

        # Light weighting to favor semantically useful fields
        caption_tokens = set(_tokenize_text(ev.get("caption", "")))
        description_tokens = set(_tokenize_text(ev.get("description", "")))
        class_tokens = set(_tokenize_text(ev.get("classification", ""))) | set(_tokenize_text(ev.get("eventName", "")))
        weighted_score = (
            overlap
            + 2.0 * len(query_tokens & caption_tokens)
            + 2.5 * len(query_tokens & description_tokens)
            + 1.5 * len(query_tokens & class_tokens)
        )

        # Small recency bonus (events are already sorted desc by timestamp)
        recency_bonus = max(0.0, 1.0 - (idx / max(1, len(events))))
        final_score = weighted_score + 0.15 * recency_bonus

        if final_score > 0:
            scored.append((final_score, ev))

    if not scored:
        return events[:top_k]

    scored.sort(key=lambda x: x[0], reverse=True)
    return [ev for _, ev in scored[:top_k]]


def _model_supports_images(model_name):
    m = (model_name or "").lower()
    return any(
        k in m
        for k in [
            "llava",
            "vision",
            "vl",
            "openrouter/auto",
            "gpt-4o",
            "gemini",
            "claude",
            "mistral-small-3.1",
            "gemma-3",
            "nemotron",
            "qwen3-vl",
            "qwen2.5-vl",
        ]
    )


def _extract_query_timestamps(query):
    if not isinstance(query, str):
        return []
    timestamps = []
    # Matches "1.23", "1,23", "12", optionally followed by s/sec/seconde(s)
    for match in re.finditer(r"(\d+(?:[.,]\d+)?)\s*(?:s|sec|seconde|secondes)?", query.lower()):
        raw = match.group(1).replace(",", ".")
        try:
            timestamps.append(float(raw))
        except ValueError:
            continue
    return timestamps[:12]


def _is_scene_description_query(query):
    if not isinstance(query, str):
        return False
    q = query.lower()
    keywords = [
        "decris", "décris", "decrire", "décrire", "scene", "scène",
        "chacune", "chacun", "frame", "image", "detail", "détail",
    ]
    return any(k in q for k in keywords)


def _resolve_local_frame_path(path_value):
    if not isinstance(path_value, str):
        return None
    raw = path_value.strip()
    if not raw:
        return None
    normalized = raw.replace("\\", "/")
    candidate = normalized if os.path.isabs(normalized) else os.path.join(os.getcwd(), normalized)
    candidate = os.path.normpath(candidate)
    return candidate if os.path.exists(candidate) else None


def _extract_base64_from_data_url(data_url):
    if not isinstance(data_url, str):
        return None
    s = data_url.strip()
    if not s.startswith("data:image"):
        return None
    parts = s.split(",", 1)
    if len(parts) != 2:
        return None
    return parts[1].strip() or None


def _extract_image_urls_from_text(text):
    if not isinstance(text, str) or not text.strip():
        return []

    matches = re.findall(r"https?://[^\s<>'\"`]+", text)
    urls = []
    for raw in matches:
        candidate = raw.strip().rstrip(").,;!?")
        lower = candidate.lower()
        if (
            lower.endswith((".jpg", ".jpeg", ".png", ".webp", ".bmp"))
            or "/output_clips/" in lower
            or "/uploads/" in lower
            or lower.startswith("data:image/")
        ):
            urls.append(candidate)

    # Dedupe preserving order
    seen = set()
    deduped = []
    for url in urls:
        if url in seen:
            continue
        seen.add(url)
        deduped.append(url)
    return deduped[:LLM_MANUAL_IMAGE_URLS]


def _is_local_image_url(url):
    if not isinstance(url, str):
        return False
    try:
        parsed = urlparse(url.strip())
    except Exception:
        return False
    host = (parsed.hostname or "").lower()
    return host in {"localhost", "127.0.0.1"}


def _image_url_to_base64(url):
    if not isinstance(url, str):
        return None

    raw = url.strip()
    if not raw:
        return None

    direct = _extract_base64_from_data_url(raw)
    if direct:
        return direct

    try:
        parsed = urlparse(raw)
    except Exception:
        return None

    if parsed.scheme not in {"http", "https"}:
        return None

    host = (parsed.hostname or "").lower()
    rel_path = unquote(parsed.path or "").lstrip("/")

    # Fast path for local files already available on disk.
    if host in {"localhost", "127.0.0.1"} and rel_path.startswith(("output_clips/", "uploads/")):
        abs_path = _resolve_local_frame_path(rel_path)
        if abs_path:
            try:
                with Image.open(abs_path) as img:
                    return encode_image(img.convert("RGB"))
            except Exception:
                pass

    # Generic HTTP fetch (works for ngrok/public URLs too), then inline as base64.
    try:
        resp = requests.get(
            raw,
            timeout=8,
            headers={"User-Agent": "AnomaLens/1.0"},
        )
        if 200 <= resp.status_code < 300 and resp.content:
            ctype = (resp.headers.get("Content-Type") or "").lower()
            if ctype.startswith("image/") or raw.lower().endswith((".jpg", ".jpeg", ".png", ".webp", ".bmp")):
                if len(resp.content) > MAX_USER_IMAGE_BYTES:
                    return None
                return base64.b64encode(resp.content).decode("utf-8")
    except Exception:
        pass
    return None


def _collect_user_message_images(user_message):
    image_inputs = []
    image_errors = []
    for url in _extract_image_urls_from_text(user_message):
        if "..." in url:
            image_errors.append(f"URL image incomplète: {url}")
            continue
        local = _is_local_image_url(url)
        b64 = _image_url_to_base64(url)
        if local and not b64:
            image_errors.append(f"Image locale introuvable ou inaccessible: {url}")
            continue
        image_inputs.append(
            {
                "sourceUrl": url,
                "imageUrl": f"data:image/jpeg;base64,{b64}" if b64 else url,
            }
        )
    return image_inputs, image_errors


def _normalize_user_image_item(item):
    if isinstance(item, dict):
        src = item.get("sourceUrl")
        url = item.get("imageUrl")
        if isinstance(url, str) and url.strip():
            return {
                "sourceUrl": src if isinstance(src, str) and src.strip() else url,
                "imageUrl": url.strip(),
            }
        return None

    if isinstance(item, str) and item.strip():
        return {"sourceUrl": item.strip(), "imageUrl": item.strip()}

    if isinstance(item, (list, tuple)):
        if len(item) == 1:
            return _normalize_user_image_item(item[0])
        if len(item) >= 2 and all(isinstance(x, str) for x in item[:2]):
            src = item[0].strip()
            url = item[1].strip()
            if url:
                return {"sourceUrl": src or url, "imageUrl": url}
    return None


def _event_has_image_evidence(ev):
    if not isinstance(ev, dict):
        return False
    frame_samples = ev.get("frameBase64Samples") or []
    if isinstance(frame_samples, list) and any(isinstance(x, str) and x.strip() for x in frame_samples):
        return True
    frame_paths = ev.get("framePaths") or []
    if isinstance(frame_paths, list) and any(isinstance(x, str) and x.strip() for x in frame_paths):
        return True
    frame_urls = ev.get("frameUrls") or []
    if isinstance(frame_urls, list) and any(isinstance(x, str) and x.strip() for x in frame_urls):
        return True
    return False


def _get_event_image_samples(ev, max_count=1):
    if not isinstance(ev, dict):
        return []

    samples = []

    def _push(sample):
        if not isinstance(sample, str):
            return
        s = sample.strip()
        if not s:
            return
        samples.append(s)

    frame_samples = ev.get("frameBase64Samples") or []
    if isinstance(frame_samples, list):
        for sample in frame_samples:
            _push(sample)
            if len(samples) >= max_count:
                return samples[:max_count]

    frame_paths = ev.get("framePaths") or []
    if isinstance(frame_paths, list):
        for rel_path in frame_paths:
            abs_path = _resolve_local_frame_path(rel_path)
            if not abs_path:
                continue
            try:
                with Image.open(abs_path) as img:
                    _push(encode_image(img.convert("RGB")))
            except Exception:
                continue
            if len(samples) >= max_count:
                return samples[:max_count]

    frame_urls = ev.get("frameUrls") or []
    if isinstance(frame_urls, list):
        public_prefix = f"{_get_public_backend_base_url()}/"
        for frame_url in frame_urls:
            if not isinstance(frame_url, str) or not frame_url.strip():
                continue
            frame_url = frame_url.strip()
            direct_base64 = _extract_base64_from_data_url(frame_url)
            if direct_base64:
                _push(direct_base64)
                if len(samples) >= max_count:
                    return samples[:max_count]
                continue
            if not frame_url.startswith(public_prefix):
                continue
            rel_path = frame_url[len(public_prefix):]
            abs_path = _resolve_local_frame_path(rel_path)
            if not abs_path:
                continue
            try:
                with Image.open(abs_path) as img:
                    _push(encode_image(img.convert("RGB")))
            except Exception:
                continue
            if len(samples) >= max_count:
                return samples[:max_count]

    return samples[:max_count]


def _should_send_multimodal(query, events):
    q = (query or "").lower()
    if _extract_image_urls_from_text(query):
        return True
    visual_keywords = [
        "image", "frame", "photo", "visuel", "analyse", "analyser",
        "look", "see", "scene", "scène", "decris", "décris", "décrire",
    ]
    wants_visual = any(k in q for k in visual_keywords)
    if not wants_visual:
        return False
    for ev in events or []:
        if _event_has_image_evidence(ev):
            return True
    return False


def _rerank_events_by_timestamps(query, events):
    if not isinstance(events, list) or not events:
        return []
    stamps = _extract_query_timestamps(query)
    if not stamps:
        return events

    def dist_score(ev):
        t = _safe_float(ev.get("clipTimestampSec"), -1.0)
        if t < 0:
            return 1e9
        return min(abs(t - s) for s in stamps)

    return sorted(events, key=dist_score)


def _format_historique_for_prompt(events):
    if not isinstance(events, list) or not events:
        return "DB historical context: no persisted events available."

    lines = ["DB historical context (latest detected clips):"]
    for ev in events[:LLM_DB_CONTEXT_LIMIT]:
        if not isinstance(ev, dict):
            continue
        lines.append(
            "- "
            f"event={ev.get('eventName')}, score={_safe_float(ev.get('score')):.4f}, "
            f"video={ev.get('videoName')}, video_clip_id={ev.get('videoClipId')}, "
            f"clip_id={ev.get('clipId')}, clip_t={_safe_float(ev.get('clipTimestampSec')):.2f}s, "
            f"frames={ev.get('startFrame')}->{ev.get('endFrame')}"
        )
        if ev.get("caption"):
            lines.append(f"  caption: {ev.get('caption')}")
        if ev.get("description"):
            lines.append(f"  description: {ev.get('description')}")
        object_summary = ev.get("objectDetectionSummary") or {}
        if isinstance(object_summary, dict) and object_summary:
            classes = object_summary.get("classes") or {}
            classes_str = ", ".join(f"{k}:{v}" for k, v in classes.items()) if isinstance(classes, dict) else "n/a"
            lines.append(
                f"  objects: total={int(_safe_float(object_summary.get('totalDetections')))} | classes={classes_str}"
            )
        frame_captions = ev.get("frameCaptions") or []
        if isinstance(frame_captions, list) and frame_captions:
            lines.append("  frame_captions:")
            for fc in frame_captions[:4]:
                if not isinstance(fc, dict):
                    continue
                lines.append(
                    f"    - frame_idx={fc.get('frameIndex')}, t={_safe_float(fc.get('timestampSec')):.2f}s, caption={fc.get('caption')}"
                )
        frame_paths = ev.get("framePaths") or []
        if isinstance(frame_paths, list) and frame_paths:
            lines.append(f"  frame_paths(sample): {', '.join(map(str, frame_paths[:5]))}")
        frame_urls = ev.get("frameUrls") or []
        if isinstance(frame_urls, list) and frame_urls:
            lines.append(f"  frame_urls(sample): {', '.join(map(str, frame_urls[:3]))}")

    return "\n".join(lines)


def _local_rag_fallback_answer(user_message, rag_events):
    if not isinstance(rag_events, list) or not rag_events:
        return (
            "Je ne peux pas confirmer automatiquement faute de contexte LLM distant, "
            "et je n'ai trouvé aucun événement persistant à analyser."
        )

    ordered = sorted(
        [ev for ev in rag_events if isinstance(ev, dict)],
        key=lambda ev: _safe_float(ev.get("clipTimestampSec"), 1e9),
    )

    lines = [
        "Le fournisseur LLM est indisponible, j'utilise une analyse locale basée sur les données persistées.",
        "Synthèse chronologique des scènes détectées :",
    ]
    for ev in ordered[:12]:
        t = _safe_float(ev.get("clipTimestampSec"))
        score = _safe_float(ev.get("score"))
        label = ev.get("classification") or ev.get("eventName") or "Unknown"
        caption = ev.get("caption") or ""
        line = f"- {t:.2f}s | classe={label} | score={score:.4f}"
        if caption:
            line += f" | caption={caption}"
        lines.append(line)

        frame_caps = ev.get("frameCaptions") or []
        if isinstance(frame_caps, list) and frame_caps:
            for fc in frame_caps[:2]:
                if not isinstance(fc, dict):
                    continue
                lines.append(
                    f"  - frame t={_safe_float(fc.get('timestampSec')):.2f}s: {fc.get('caption')}"
                )

    q = (user_message or "").lower()
    if "vandalisme" in q or "vandal" in q:
        lines.append(
            "Concernant 'vandalisme': je ne confirme pas sans vérification visuelle humaine. "
            "Les scores/captions indiquent une suspicion, pas une preuve."
        )

    return "\n".join(lines)


def _collect_evidence_frames(rag_events):
    evidence = []
    if not isinstance(rag_events, list):
        return evidence
    base_url = _get_public_backend_base_url()

    for ev in rag_events[:LLM_EVIDENCE_MAX_EVENTS]:
        if not isinstance(ev, dict):
            continue
        frame_urls = ev.get("frameUrls") or []
        if not isinstance(frame_urls, list):
            frame_urls = []
        normalized_urls = []
        for frame_url in frame_urls:
            if not isinstance(frame_url, str):
                continue
            candidate = frame_url.strip()
            if not candidate:
                continue
            if candidate.startswith(("http://", "https://", "data:image/")):
                normalized_urls.append(candidate)
            else:
                normalized_urls.append(_to_public_url(candidate, base_url=base_url))
        frame_urls = normalized_urls
        if not frame_urls:
            frame_paths = ev.get("framePaths") or []
            if isinstance(frame_paths, list):
                frame_urls = []
                for p in frame_paths[:LLM_EVIDENCE_MAX_FRAMES_PER_EVENT]:
                    if not isinstance(p, str) or not p.strip():
                        continue
                    frame_urls.append(_to_public_url(p, base_url=base_url))
        if not frame_urls:
            frame_samples = _get_event_image_samples(ev, max_count=LLM_EVIDENCE_MAX_FRAMES_PER_EVENT)
            if frame_samples:
                frame_urls = [
                    f"data:image/jpeg;base64,{sample}"
                    for sample in frame_samples
                ]
        object_summary = ev.get("objectDetectionSummary") or {}

        for frame_url in frame_urls[:LLM_EVIDENCE_MAX_FRAMES_PER_EVENT]:
            evidence.append(
                {
                    "videoName": ev.get("videoName"),
                    "videoClipId": ev.get("videoClipId"),
                    "clipId": ev.get("clipId"),
                    "timestampSec": _safe_float(ev.get("clipTimestampSec")),
                    "score": _safe_float(ev.get("score")),
                    "classification": ev.get("classification") or ev.get("eventName"),
                    "caption": ev.get("caption"),
                    "frameUrl": frame_url,
                    "objectDetectionSummary": object_summary,
                }
            )

    evidence.sort(
        key=lambda item: (
            _safe_float(item.get("timestampSec"), 1e9),
            -_safe_float(item.get("score"), 0.0),
        )
    )
    return evidence


def _extract_target_video_name(data, context):
    # Priority: explicit value in request body, then frontend context.
    if isinstance(data, dict):
        explicit = (data.get("videoName") or "").strip()
        if explicit:
            return explicit
    if isinstance(context, dict):
        last_video = context.get("lastVideo") or {}
        if isinstance(last_video, dict):
            for key in ("filename", "videoName", "name"):
                name = str(last_video.get(key) or "").strip()
                if name:
                    return name
        selected_clip = context.get("selectedClip") or {}
        if isinstance(selected_clip, dict):
            for key in ("videoName", "filename"):
                name = str(selected_clip.get(key) or "").strip()
                if name:
                    return name
        top_anomalies = context.get("topAnomalies") or []
        if isinstance(top_anomalies, list):
            for item in top_anomalies:
                if not isinstance(item, dict):
                    continue
                for key in ("videoName", "filename"):
                    name = str(item.get(key) or "").strip()
                    if name:
                        return name
    return None


VIDEO_PIPELINE_ORCHESTRATOR = VideoPipelineOrchestrator(
    config=PipelineAgentConfig(
        device=device,
        anomaly_model_fallback_path=ANOMALY_MODEL_FALLBACK_PATH,
        openrouter_api_key=OPENROUTER_API_KEY,
        vlm_scoring_enabled=VLM_SCORING_ENABLED,
        vlm_scoring_fallback_local=VLM_SCORING_FALLBACK_LOCAL,
        vlm_scoring_fail_limit=VLM_SCORING_FAIL_LIMIT,
        anomaly_threshold=ANOMALY_THRESHOLD,
        debug_pipeline=DEBUG_PIPELINE,
        persist_preview_base64=PERSIST_PREVIEW_BASE64,
        persist_frame_base64_samples=PERSIST_FRAME_BASE64_SAMPLES,
        frame_base64_sample_count=FRAME_BASE64_SAMPLE_COUNT,
        frame_caption_sample_count=FRAME_CAPTION_SAMPLE_COUNT,
        yolo_model=YOLO_MODEL,
    ),
    deps=PipelineAgentDeps(
        fetch_clip_parameters=fetch_clip_parameters,
        frame_extractor_cls=FrameExtractor,
        feature_extractor_cls=FeatureExtractor,
        clip_selector_cls=ClipSelector,
        guaranteed_classifier_cls=GuaranteedClassifier,
        load_model=load_model,
        compute_anomaly_score=compute_anomaly_score,
        score_clip_with_vlm=score_clip_with_vlm,
        encode_image=encode_image,
        generate_caption=generate_caption,
        generate_description=generate_description,
        save_abnormal_event=save_abnormal_event,
        to_public_url=_to_public_url,
        get_public_backend_base_url=_get_public_backend_base_url,
        object_detector=object_detector,
    ),
)
# ======Pipeline principal segment par segment ======
def run_pipeline_segment_by_segment(video_path, anomaly_model_path, output_dir=OUTPUT_CLIP_FOLDER,
                                   segment_duration_sec=30):
    yield from VIDEO_PIPELINE_ORCHESTRATOR.run(
        video_path=video_path,
        anomaly_model_path=anomaly_model_path,
        output_dir=output_dir,
        segment_duration_sec=segment_duration_sec,
    )

@app.route("/", methods=["GET"])
def home():
    return "Backend is working"

@app.route("/upload", methods=["POST"])
def upload_video():
    if "video" not in request.files:
        return jsonify({"error": "No video file provided"}), 400

    video = request.files["video"]
    if not video.filename.lower().endswith(('.mp4', '.webm', '.mov', '.avi', '.mkv')):
        return jsonify({"error": "Unsupported video format. Use MP4, WebM, MOV, AVI, or MKV."}), 400

    filename = video.filename.rsplit(".", 1)[0] + "_" + str(uuid.uuid4()) + ".mp4"
    filepath = os.path.join(UPLOAD_FOLDER, filename)
    #temp_filepath = os.path.join(UPLOAD_FOLDER, "temp_" + str(uuid.uuid4()) + video.filename.rsplit(".", 1)[-1])
    ext = video.filename.rsplit(".", 1)[-1].lower()
    safe_id = str(uuid.uuid4())
    temp_filepath = os.path.join(UPLOAD_FOLDER, f"temp_{safe_id}.{ext}")

    video.save(temp_filepath)

    try:
       
            
        print("TEMP:", temp_filepath, "exists=", os.path.exists(temp_filepath),
              "size=", os.path.getsize(temp_filepath) if os.path.exists(temp_filepath) else -1)
        print("OUT :", filepath)
        print("FFMPEG:", FFMPEG)
        print("FFPROBE:", FFPROBE)

        def run(cmd, label):
            print("RUN:", " ".join(cmd))
            r = subprocess.run(cmd, capture_output=True, text=True)
            if r.returncode != 0:
                print(f"⚠️ {label} rc={r.returncode}")
                print(f"⚠️ {label} stdout=\n{r.stdout}")
                print(f"⚠️ {label} stderr=\n{r.stderr}")
            return r

        # ✅ Si la source est WebM (VP8), on ré-encode directement en MP4/H.264
        if ext == "webm":
            result = run(
                [FFMPEG, "-hide_banner", "-y",
                 "-i", temp_filepath,
                 "-map", "0:v:0", "-map", "0:a?",
                 "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast",
                 "-c:a", "aac", "-b:a", "128k",
                 "-movflags", "+faststart", "-shortest",
                 filepath],
                "reencode_webm"
            )
        else:
            # (Optionnel) tentative de copy pour formats compatibles
            result = run(
                [FFMPEG, "-hide_banner", "-y",
                 "-i", temp_filepath,
                 "-c", "copy", "-fflags", "+genpts",
                 filepath],
                "metadata_copy"
            )

            if result.returncode != 0:
                # Fallback re-encode safe
                result = run(
                    [FFMPEG, "-hide_banner", "-y",
                     "-i", temp_filepath,
                     "-map", "0:v:0", "-map", "0:a?",
                     "-c:v", "libx264", "-pix_fmt", "yuv420p", "-preset", "fast",
                     "-c:a", "aac", "-b:a", "128k",
                     "-movflags", "+faststart", "-shortest",
                     filepath],
                    "reencode_fallback"
                )

        if result.returncode != 0:
            # Nettoyage
            if os.path.exists(temp_filepath):
                os.remove(temp_filepath)
            if os.path.exists(filepath):
                os.remove(filepath)
            return jsonify({"error": "Failed to process video file. It may be corrupted or unsupported."}), 500

        # Validate output video (ffprobe)
        probe = run(
            [FFPROBE, "-hide_banner", "-v", "error",
             "-show_streams", "-select_streams", "v:0",
             filepath],
            "ffprobe_validate"
        )

        if probe.returncode != 0 or not probe.stdout:
            if os.path.exists(temp_filepath):
                os.remove(temp_filepath)
            if os.path.exists(filepath):
                os.remove(filepath)
            return jsonify({"error": "Processed video is invalid. Try a different file."}), 500

        if os.path.exists(temp_filepath):
            os.remove(temp_filepath)

    except Exception as e:
        print(f"⚠️ FFmpeg processing error: {str(e)}")
        if os.path.exists(temp_filepath):
            os.remove(temp_filepath)
        if os.path.exists(filepath):
            os.remove(filepath)
        return jsonify({"error": f"Video processing failed: {str(e)}"}), 500

    video_url = f"/uploads/{filename}"
    return jsonify({
        "filename": filename,
        "video_url": video_url,
        "message": "Video uploaded successfully"
    }), 200

@app.route('/uploads/<path:filename>')
def serve_uploaded_videos(filename):
    return send_from_directory(UPLOAD_FOLDER, filename)


@app.route('/output_clips/<path:filename>')
def serve_output_clips(filename):
    return send_from_directory(OUTPUT_CLIP_FOLDER, filename)

@app.route("/stream_results", methods=["GET", "POST"])
@cross_origin()
def stream_results():
    """
    Lance le traitement d’une vidéo et envoie les résultats clip par clip via Server-Sent Events (SSE).
    """
    if request.method == "GET":
        filename = request.args.get("filename")
    else:
        data = request.get_json()
        filename = data.get("filename")
    
    if not filename:
        return jsonify({"error": "Missing filename parameter"}), 400

    filepath = os.path.join(UPLOAD_FOLDER, filename)
    if not os.path.exists(filepath):
        return jsonify({"error": "File not found"}), 404

    @stream_with_context
    def event_stream():
        try:
            for segment_result in run_pipeline_segment_by_segment(filepath, ANOMALY_MODEL_REF):
                yield f"data: {json.dumps(segment_result)}\n\n"
        except Exception as e:
            yield f"data: {json.dumps({'type': 'analysis_error', 'success': False, 'error': str(e)})}\n\n"
            yield f"data: {json.dumps({'type': 'analysis_complete', 'success': False, 'error': str(e)})}\n\n"

    headers = {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
        "X-Accel-Buffering": "no"
    }
    return Response(event_stream(), headers=headers)

def _safe_float(value, default=0.0):
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _format_context_for_prompt(context):
    if not isinstance(context, dict):
        return "No structured context received."

    lines = ["CONTEXT FOR VIDEO ANALYSIS CHAT"]

    video_meta = context.get("videoMetadata") or {}
    if isinstance(video_meta, dict) and video_meta:
        duration = _safe_float(video_meta.get("duration"), 0.0)
        fps = _safe_float(video_meta.get("fps"), 0.0)
        total_frames = int(_safe_float(video_meta.get("total_frames"), 0.0))
        width = int(_safe_float(video_meta.get("width"), 0.0))
        height = int(_safe_float(video_meta.get("height"), 0.0))
        lines.append(
            f"Video metadata: duration={duration:.2f}s, fps={fps:.2f}, total_frames={total_frames}, resolution={width}x{height}"
        )

    last_video = context.get("lastVideo") or {}
    if isinstance(last_video, dict) and last_video:
        lines.append(
            f"Last video: type={last_video.get('type')}, id={last_video.get('id')}, filename={last_video.get('filename')}, url={last_video.get('videoUrl')}"
        )

    timeline_state = context.get("timelineState") or {}
    if isinstance(timeline_state, dict) and timeline_state:
        lines.append(
            f"Timeline state: current_time={_safe_float(timeline_state.get('currentTime')):.2f}s, duration={_safe_float(timeline_state.get('duration')):.2f}s, is_playing={timeline_state.get('isPlaying')}"
        )

    anomaly_stats = context.get("anomalyStats") or {}
    if isinstance(anomaly_stats, dict) and anomaly_stats:
        lines.append(
            "Anomaly stats: "
            f"total={int(_safe_float(anomaly_stats.get('totalClips')))}, "
            f"severe={int(_safe_float(anomaly_stats.get('severe')))}, "
            f"moderate={int(_safe_float(anomaly_stats.get('moderate')))}, "
            f"normal={int(_safe_float(anomaly_stats.get('normal')))}, "
            f"max_score={_safe_float(anomaly_stats.get('maxScore')):.4f}"
        )

    segment_headers = context.get("segmentHeaders") or []
    if isinstance(segment_headers, list) and segment_headers:
        lines.append("Segments processed:")
        for seg in segment_headers[-10:]:
            if not isinstance(seg, dict):
                continue
            lines.append(
                f"- segment #{seg.get('segmentNumber')}: {seg.get('startTime')}s -> {seg.get('endTime')}s"
            )

    selected_clip = context.get("selectedClip") or {}
    if isinstance(selected_clip, dict) and selected_clip:
        lines.append(
            "Selected clip: "
            f"id={selected_clip.get('id')}, "
            f"score={_safe_float(selected_clip.get('score')):.4f}, "
            f"classification={selected_clip.get('classification')}, "
            f"timestamp={_safe_float(selected_clip.get('timestamp')):.2f}s"
        )
        if selected_clip.get("caption"):
            lines.append(f"Selected clip caption: {selected_clip.get('caption')}")
        if selected_clip.get("description"):
            lines.append(f"Selected clip description: {selected_clip.get('description')}")

    top_anomalies = context.get("topAnomalies") or []
    if isinstance(top_anomalies, list) and top_anomalies:
        lines.append("Top anomalies (highest scores):")
        for clip in top_anomalies[:10]:
            if not isinstance(clip, dict):
                continue
            lines.append(
                "- "
                f"id={clip.get('id')}, score={_safe_float(clip.get('score')):.4f}, "
                f"class={clip.get('classification')}, t={_safe_float(clip.get('timestamp')):.2f}s, "
                f"frames={clip.get('start_frame')}->{clip.get('end_frame')}"
            )

    frame_descriptions = context.get("frameDescriptions") or []
    if isinstance(frame_descriptions, list) and frame_descriptions:
        lines.append("Frame/clip visual descriptions:")
        for frame_info in frame_descriptions[:25]:
            if not isinstance(frame_info, dict):
                continue
            lines.append(
                "- "
                f"clip={frame_info.get('clipId')}, t={_safe_float(frame_info.get('timestamp')):.2f}s, "
                f"score={_safe_float(frame_info.get('score')):.4f}: {frame_info.get('text')}"
            )

    all_clips = context.get("allDetectedClips") or []
    if isinstance(all_clips, list) and all_clips:
        lines.append(f"Total detailed detected clips provided: {len(all_clips)}")

    logs = context.get("latestLogs") or []
    if isinstance(logs, list) and logs:
        lines.append("Latest pipeline logs:")
        for log in logs[-12:]:
            if isinstance(log, str) and log.strip():
                lines.append(f"- {log.strip()}")

    backend_runtime = context.get("backendRuntime") or {}
    if isinstance(backend_runtime, dict) and backend_runtime:
        lines.append(
            "Backend runtime: "
            f"openrouter_api_key_configured={bool(backend_runtime.get('openrouterApiKeyConfigured'))}, "
            f"caption_provider={backend_runtime.get('captionProvider')}, "
            f"caption_model={backend_runtime.get('captionModel')}"
        )
        routes = backend_runtime.get("routes") or {}
        if isinstance(routes, dict) and routes:
            route_pairs = [f"{k}={v}" for k, v in routes.items() if isinstance(v, str)]
            if route_pairs:
                lines.append("Backend routes: " + ", ".join(route_pairs))
    else:
        lines.append(
            "Backend runtime: "
            f"openrouter_api_key_configured={bool(OPENROUTER_API_KEY)}, "
            f"caption_provider={'llava_openrouter' if OPENROUTER_API_KEY else ('blip_fallback' if VLM_CAPTION_FALLBACK_BLIP else 'none')}, "
            f"caption_model={(VLM_CAPTION_MODELS[0] if VLM_CAPTION_MODELS else 'n/a')}"
        )
        lines.append(
            "Backend routes: "
            "upload=/upload, stream_results=/stream_results, chat_llm=/chat_llm, clip_params=/api/clip_params, runtime_status=/api/runtime_status"
        )

    return "\n".join(lines)


CHAT_LLM_ORCHESTRATOR = ChatOrchestrator(
    config=ChatAgentConfig(
        openrouter_api_key=OPENROUTER_API_KEY,
        openrouter_base_url=OPENROUTER_BASE_URL,
        openrouter_models=OPENROUTER_MODELS,
        llm_db_context_limit=LLM_DB_CONTEXT_LIMIT,
        rag_candidate_limit=RAG_CANDIDATE_LIMIT,
        rag_top_k=RAG_TOP_K,
        rag_image_top_k=RAG_IMAGE_TOP_K,
        temperature=0.3,
        timeout_sec=45,
        http_referer="http://localhost:5000",
        app_title="Anomalens Backend",
    ),
    deps=ChatAgentDeps(
        extract_target_video_name=_extract_target_video_name,
        format_context_for_prompt=_format_context_for_prompt,
        fetch_recent_historique_events=fetch_recent_historique_events,
        retrieve_relevant_events=_retrieve_relevant_events,
        rerank_events_by_timestamps=_rerank_events_by_timestamps,
        format_historique_for_prompt=_format_historique_for_prompt,
        collect_evidence_frames=_collect_evidence_frames,
        collect_user_message_images=_collect_user_message_images,
        should_send_multimodal=_should_send_multimodal,
        normalize_user_image_item=_normalize_user_image_item,
        image_url_to_base64=_image_url_to_base64,
        to_public_url=_to_public_url,
        safe_float=_safe_float,
        model_supports_images=_model_supports_images,
        local_rag_fallback_answer=_local_rag_fallback_answer,
    ),
)


@app.route("/chat_llm", methods=["POST"])
@cross_origin()
def chat_llm():
    data = request.get_json(silent=True) or {}
    payload, status_code = CHAT_LLM_ORCHESTRATOR.handle_request(data)
    return jsonify(payload), status_code


def _runtime_status_payload():
    caption_provider = (
        "llava_openrouter"
        if OPENROUTER_API_KEY
        else ("blip_fallback" if VLM_CAPTION_FALLBACK_BLIP else "none")
    )
    return {
        "status": "ok",
        "openrouterApiKeyConfigured": bool(OPENROUTER_API_KEY),
        "openrouterBaseUrl": OPENROUTER_BASE_URL,
        "captionProvider": caption_provider,
        "captionModel": (VLM_CAPTION_MODELS[0] if VLM_CAPTION_MODELS else None),
        "captionModels": VLM_CAPTION_MODELS,
        "vlmScoringEnabled": bool(VLM_SCORING_ENABLED),
        "vlmScoringModels": VLM_SCORING_MODELS,
        "routes": {
            "upload": "/upload",
            "streamResults": "/stream_results",
            "chatLlm": "/chat_llm",
            "clipParams": "/api/clip_params",
            "runtimeStatus": "/api/runtime_status",
        },
    }


@app.route('/api/runtime_status', methods=['GET'])
@cross_origin()
def runtime_status():
    return jsonify(_runtime_status_payload()), 200


@app.route('/api/clip_params', methods=['GET', 'POST'])
def handle_clip_parameters():
    """
    Reçoit les paramètres définissant le traitement des clips :
    - clip_length : nombre d’images par clip
    - stride : pas de glissement
    - top_k : nombre de clips anormaux sélectionnés
    """
    try:
        if request.method == "GET":
            rows = fetch_clip_parameters()
            current = rows[0] if isinstance(rows, list) and rows else {}
            return jsonify(
                {
                    "status": "success",
                    "data": {
                        "clip_length": int(current.get("clip_length", 16)),
                        "top_k": int(current.get("top_k", 4)),
                        "stride": int(current.get("stride", 1)),
                    },
                    "runtime": _runtime_status_payload(),
                }
            ), 200

        print("👉 Received params:", request.json)
        params = request.get_json()
        print("Received params:", params)
        
        required = ['clip_length', 'top_k', 'stride']
        for param in required:
            if param not in params:
                return jsonify({
                    'status': 'error',
                    'message': f'Missing required parameter: {param}'
                }), 400
        
        success, message, data = insert_clip_parameters(params)
        
        if success:
            return jsonify({
                'status': 'success',
                'message': message,
                'data': data,
                'runtime': _runtime_status_payload(),
            }), 200
        else:
            return jsonify({
                'status': 'error',
                'message': message
            }), 400
            
    except Exception as e:
        print(f"Error processing request: {str(e)}")
        return jsonify({
            'status': 'error',
            'message': f'Server error: {str(e)}'
        }), 500

if __name__ == "__main__":
    app.run(debug=True, threaded=True, host="0.0.0.0", port=5000)
