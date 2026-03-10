import os
import torch
import torch.nn as nn


class AnomalyDetector(nn.Module):
    """
    Legacy MLP anomaly detector trained on 512-d clip embeddings.
    """

    def __init__(self):
        super().__init__()
        self.model = nn.Sequential(
            nn.Linear(512, 256),
            nn.ReLU(),
            nn.Dropout(0.3),
            nn.Linear(256, 64),
            nn.ReLU(),
            nn.Linear(64, 1),
            nn.Sigmoid(),
        )

    def forward(self, x):
        return self.model(x)


class HuggingFaceImageAnomalyDetector:
    """
    Adapter around Hugging Face image-classification models.
    Computes frame-level anomaly probability and averages it over a clip.
    """

    def __init__(self, model_id, device="cpu"):
        from transformers import AutoImageProcessor, AutoModelForImageClassification

        self.model_id = model_id
        self.device = device
        self.processor = AutoImageProcessor.from_pretrained(model_id)
        self.model = AutoModelForImageClassification.from_pretrained(model_id).to(device)
        self.model.eval()

        self.id2label = getattr(self.model.config, "id2label", {}) or {}
        self.anomaly_index = self._resolve_anomaly_label_index()

    def _resolve_anomaly_label_index(self):
        if not isinstance(self.id2label, dict) or not self.id2label:
            return 1

        keywords = ("anomaly", "abnormal", "violence", "fight", "abuse", "suspicious")
        for idx, label in self.id2label.items():
            text = str(label).lower()
            if any(k in text for k in keywords):
                return int(idx)

        # For binary heads, default to class-1 as "anomaly-like".
        return 1 if len(self.id2label) >= 2 else int(next(iter(self.id2label.keys())))

    def score_clip(self, clip_frames):
        if not clip_frames:
            return 0.0

        with torch.no_grad():
            inputs = self.processor(images=clip_frames, return_tensors="pt")
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            logits = self.model(**inputs).logits
            probs = torch.softmax(logits, dim=-1)

            if probs.ndim != 2:
                return 0.0

            anomaly_idx = min(max(int(self.anomaly_index), 0), probs.shape[-1] - 1)
            frame_scores = probs[:, anomaly_idx]
            return float(frame_scores.mean().item())


def _load_legacy_local_model(model_path, device):
    model = AnomalyDetector().to(device)
    model.load_state_dict(torch.load(model_path, map_location=device))
    model.eval()
    return model


def load_model(model_ref, device="cuda" if torch.cuda.is_available() else "cpu", fallback_local_path=None):
    """
    Load anomaly model from:
    1) Hugging Face model id (preferred),
    2) local .pth/.pt path,
    with optional fallback to legacy local detector.
    """
    model_ref = (model_ref or "").strip()

    # Local checkpoint path
    if model_ref and os.path.exists(model_ref):
        return _load_legacy_local_model(model_ref, device)

    # Try Hugging Face image-classification style model
    if model_ref:
        try:
            print(f"🔄 Loading HF anomaly model: {model_ref}")
            model = HuggingFaceImageAnomalyDetector(model_ref, device=device)
            print(f"✅ HF anomaly model loaded: {model_ref}")
            return model
        except Exception as exc:
            print(f"⚠️ HF anomaly model load failed ({model_ref}): {exc}")

    # Optional fallback to legacy local checkpoint
    if fallback_local_path and os.path.exists(fallback_local_path):
        print(f"↩️ Falling back to local anomaly model: {fallback_local_path}")
        return _load_legacy_local_model(fallback_local_path, device)

    raise RuntimeError(
        "Unable to load anomaly model. "
        "Provide a valid Hugging Face model id or local .pth/.pt checkpoint."
    )


def compute_anomaly_score(model, clip_embedding=None, clip_frames=None):
    """
    Unified scoring API:
    - HF wrapper: score from frames,
    - legacy torch MLP: score from embedding.
    """
    if hasattr(model, "score_clip"):
        return float(model.score_clip(clip_frames or []))

    if clip_embedding is None:
        raise ValueError("clip_embedding is required for legacy anomaly model scoring")

    with torch.no_grad():
        return float(model(clip_embedding.unsqueeze(0)).item())
