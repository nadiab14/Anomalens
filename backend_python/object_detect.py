"""
object_detect.py - YOLOv8 object detection utilities for extracted frames.

This module provides:
- model loading (Ultralytics YOLOv8)
- per-frame object detection
- bounding-box rendering on PIL images
"""

from __future__ import annotations

from typing import Any, Dict, List, Tuple
import hashlib

from PIL import Image, ImageDraw

try:
    import numpy as np
except Exception:  # pragma: no cover
    np = None

try:
    from ultralytics import YOLO
except Exception:  # pragma: no cover
    YOLO = None


class ObjectDetector:
    def __init__(
        self,
        model_name: str = "yolov8n.pt",
        conf: float = 0.25,
        iou: float = 0.45,
        device: str | None = None,
        enabled: bool = True,
    ) -> None:
        self.model_name = model_name
        self.conf = conf
        self.iou = iou
        self.device = device
        self.enabled = bool(enabled)
        self.model = None
        self.names = {}

        if not self.enabled:
            return

        if YOLO is None or np is None:
            print("⚠️ YOLOv8 disabled: missing dependencies (ultralytics/numpy).")
            self.enabled = False
            return

        try:
            self.model = YOLO(self.model_name)
            self.names = getattr(self.model, "names", {}) or {}
            print(f"✅ YOLOv8 loaded: {self.model_name}")
        except Exception as exc:
            print(f"⚠️ YOLOv8 init failed ({self.model_name}): {exc}")
            self.enabled = False
            self.model = None

    def detect(self, image: Image.Image) -> List[Dict[str, Any]]:
        if not self.enabled or self.model is None:
            return []

        try:
            image_rgb = image.convert("RGB")
            array = np.array(image_rgb)
            height, width = array.shape[:2]
            results = self.model.predict(
                source=array,
                conf=self.conf,
                iou=self.iou,
                device=self.device,
                verbose=False,
            )

            if not results:
                return []

            result = results[0]
            boxes = getattr(result, "boxes", None)
            if boxes is None:
                return []

            xyxy = boxes.xyxy.tolist() if boxes.xyxy is not None else []
            confs = boxes.conf.tolist() if boxes.conf is not None else []
            classes = boxes.cls.tolist() if boxes.cls is not None else []

            detections: List[Dict[str, Any]] = []
            for idx, bbox in enumerate(xyxy):
                class_id = int(classes[idx]) if idx < len(classes) else -1
                confidence = float(confs[idx]) if idx < len(confs) else 0.0
                class_name = str(self.names.get(class_id, class_id))
                x1, y1, x2, y2 = [float(v) for v in bbox]
                w = float(max(1, width))
                h = float(max(1, height))

                detections.append(
                    {
                        "classId": class_id,
                        "className": class_name,
                        "confidence": confidence,
                        "bbox": [x1, y1, x2, y2],
                        "bboxNormalized": [x1 / w, y1 / h, x2 / w, y2 / h],
                    }
                )

            detections.sort(key=lambda d: d["confidence"], reverse=True)
            return detections
        except Exception as exc:
            print(f"⚠️ YOLO detect failed: {exc}")
            return []

    def annotate(self, image: Image.Image, detections: List[Dict[str, Any]]) -> Image.Image:
        annotated = image.convert("RGB").copy()
        draw = ImageDraw.Draw(annotated)

        for det in detections:
            x1, y1, x2, y2 = [int(v) for v in det.get("bbox", [0, 0, 0, 0])]
            class_name = str(det.get("className", "obj"))
            confidence = float(det.get("confidence", 0.0))
            color = self._color_for_label(class_name)
            label = f"{class_name} {confidence:.2f}"

            draw.rectangle([x1, y1, x2, y2], outline=color, width=3)

            # Draw text background
            try:
                text_bbox = draw.textbbox((x1, y1), label)
                text_w = text_bbox[2] - text_bbox[0]
                text_h = text_bbox[3] - text_bbox[1]
            except Exception:
                text_w = max(50, len(label) * 6)
                text_h = 14

            text_y = max(0, y1 - text_h - 4)
            draw.rectangle([x1, text_y, x1 + text_w + 6, text_y + text_h + 4], fill=color)
            draw.text((x1 + 3, text_y + 2), label, fill=(255, 255, 255))

        return annotated

    def detect_and_annotate(self, image: Image.Image) -> Tuple[Image.Image, List[Dict[str, Any]]]:
        detections = self.detect(image)
        if not detections:
            return image, []
        return self.annotate(image, detections), detections

    @staticmethod
    def _color_for_label(label: str) -> Tuple[int, int, int]:
        digest = hashlib.md5(label.encode("utf-8")).digest()
        return (55 + digest[0] % 200, 55 + digest[1] % 200, 55 + digest[2] % 200)
