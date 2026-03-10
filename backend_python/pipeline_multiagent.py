import os
from dataclasses import dataclass
from typing import Any, Callable, Dict, Generator, List, Optional

import torch


JsonDict = Dict[str, Any]


@dataclass
class PipelineAgentConfig:
    device: str
    anomaly_model_fallback_path: Optional[str]
    openrouter_api_key: str
    vlm_scoring_enabled: bool
    vlm_scoring_fallback_local: bool
    vlm_scoring_fail_limit: int
    anomaly_threshold: float
    debug_pipeline: bool
    persist_preview_base64: bool
    persist_frame_base64_samples: bool
    frame_base64_sample_count: int
    frame_caption_sample_count: int
    yolo_model: str


@dataclass
class PipelineAgentDeps:
    fetch_clip_parameters: Callable[[], Any]
    frame_extractor_cls: Any
    feature_extractor_cls: Any
    clip_selector_cls: Any
    guaranteed_classifier_cls: Any
    load_model: Callable[..., Any]
    compute_anomaly_score: Callable[..., float]
    score_clip_with_vlm: Callable[..., Any]
    encode_image: Callable[[Any], str]
    generate_caption: Callable[[Any], str]
    generate_description: Callable[..., str]
    save_abnormal_event: Callable[..., bool]
    to_public_url: Callable[..., str]
    get_public_backend_base_url: Callable[[], str]
    object_detector: Any


@dataclass
class PipelineRuntimeState:
    video_path: str
    anomaly_model_path: str
    output_dir: str
    segment_duration_sec: int
    clip_length: int
    stride: int
    top_k: int
    frame_extractor: Any
    feature_extractor: Any
    anomaly_model: Any
    clip_selector: Any
    classifier: Any
    classification_results: JsonDict
    video_name: str
    video_stem: str
    video_output_dir: str
    public_base_url: str
    video_info: JsonDict
    fps: float
    total_frames: int
    duration: float
    segment_length_frames: int
    total_segments: int
    vlm_scoring_active: bool
    vlm_failure_count: int


@dataclass
class SegmentContext:
    segment_start: int
    segment_end: int
    segment_time: float
    top_clips: List[JsonDict]
    segment_predicted_class: str
    anomalous_clip_count: int
    segment_summary_class: str
    representative_clips: List[JsonDict]


class BaseAgent:
    name = "base"

    def run(self, *args, **kwargs):
        raise NotImplementedError


class PipelineBootstrapAgent(BaseAgent):
    name = "pipeline_bootstrap"

    def __init__(self, config: PipelineAgentConfig, deps: PipelineAgentDeps):
        self.config = config
        self.deps = deps

    def run(
        self,
        video_path: str,
        anomaly_model_path: str,
        output_dir: str,
        segment_duration_sec: int,
    ) -> PipelineRuntimeState:
        parameters = self.deps.fetch_clip_parameters()
        if not parameters:
            raise ValueError("No parameters found in database")

        clip_length = int(parameters[0]["clip_length"])
        stride = int(parameters[0]["stride"])
        top_k = int(parameters[0]["top_k"])

        print("=== Parameters ===")
        print(f"📌 clip_length: {clip_length}")
        print(f"📌 stride: {stride}")
        print(f"📌 top_k: {top_k}")
        print(f"📌 scoring_mode: {'VLM' if self.config.vlm_scoring_enabled else 'LocalModel'}")

        frame_extractor = self.deps.frame_extractor_cls(clip_length=clip_length)
        feature_extractor = self.deps.feature_extractor_cls(self.config.device)

        anomaly_model = None
        if not self.config.vlm_scoring_enabled or self.config.vlm_scoring_fallback_local:
            anomaly_model = self.deps.load_model(
                anomaly_model_path,
                device=self.config.device,
                fallback_local_path=self.config.anomaly_model_fallback_path,
            )

        clip_selector = self.deps.clip_selector_cls(output_dir=output_dir, top_k=top_k)
        video_name = os.path.basename(video_path)
        video_stem = os.path.splitext(video_name)[0]
        video_output_dir = os.path.join(output_dir, video_stem)
        public_base_url = self.deps.get_public_backend_base_url()
        os.makedirs(video_output_dir, exist_ok=True)

        video_info = frame_extractor.get_video_info(video_path)
        fps = video_info["fps"]
        total_frames = video_info["total_frames"]
        duration = total_frames / fps if fps > 0 else 0
        segment_length_frames = int(fps * segment_duration_sec)
        total_segments = (
            max(1, (total_frames + segment_length_frames - 1) // max(1, segment_length_frames))
            if total_frames > 0
            else 1
        )

        print("=== Video Info ===")
        print(f"📽️ FPS: {fps}, Total Frames: {total_frames}, Duration: {duration:.2f}s")

        classifier = self.deps.guaranteed_classifier_cls(video_path, stride=stride)
        classification_results = classifier.process_video()

        return PipelineRuntimeState(
            video_path=video_path,
            anomaly_model_path=anomaly_model_path,
            output_dir=output_dir,
            segment_duration_sec=segment_duration_sec,
            clip_length=clip_length,
            stride=stride,
            top_k=top_k,
            frame_extractor=frame_extractor,
            feature_extractor=feature_extractor,
            anomaly_model=anomaly_model,
            clip_selector=clip_selector,
            classifier=classifier,
            classification_results=classification_results,
            video_name=video_name,
            video_stem=video_stem,
            video_output_dir=video_output_dir,
            public_base_url=public_base_url,
            video_info=video_info,
            fps=fps,
            total_frames=total_frames,
            duration=duration,
            segment_length_frames=segment_length_frames,
            total_segments=total_segments,
            vlm_scoring_active=self.config.vlm_scoring_enabled,
            vlm_failure_count=0,
        )


class SegmentScoringAgent(BaseAgent):
    name = "segment_scoring"

    def __init__(self, config: PipelineAgentConfig, deps: PipelineAgentDeps):
        self.config = config
        self.deps = deps

    def run(
        self,
        state: PipelineRuntimeState,
        segment_start: int,
    ) -> Generator[JsonDict, None, SegmentContext]:
        fps = state.fps
        segment_end = min(segment_start + state.segment_length_frames, state.total_frames)
        segment_time = segment_start / fps if fps > 0 else 0.0

        yield {
            "type": "segment_start",
            "segment_start": segment_start,
            "segment_end": segment_end,
            "segment_time": segment_time,
            "fps": fps,
        }

        clips = [
            (clip_frames, clip_start_time)
            for clip_frames, clip_start_time in state.frame_extractor.extract_clips(
                state.video_path,
                start_frame=segment_start,
                end_frame=segment_end,
            )
        ]

        yield {
            "type": "clips_extracted",
            "count": len(clips),
            "segment_start": segment_start,
            "segment_end": segment_end,
        }

        clips_metadata: List[JsonDict] = []
        for i, (clip_frames, clip_start_time) in enumerate(clips):
            clip_start_frame = segment_start + (i * state.stride)
            clip_end_frame = clip_start_frame + state.clip_length
            clip_center_frame = clip_start_frame + (state.clip_length // 2)
            timestamp = clip_start_time

            outputs = state.feature_extractor.get_batch_embeddings(clip_frames)
            if self.config.debug_pipeline:
                print("DEBUG outputs type:", type(outputs))

            # Normalize model outputs to a Tensor [N, D]
            if torch.is_tensor(outputs):
                embeddings = outputs
            elif hasattr(outputs, "pooler_output") and outputs.pooler_output is not None:
                embeddings = outputs.pooler_output
            elif hasattr(outputs, "last_hidden_state") and outputs.last_hidden_state is not None:
                embeddings = outputs.last_hidden_state.mean(dim=1)
            else:
                raise ValueError(f"Unexpected output type from feature extractor: {type(outputs)}")

            clip_id = f"segment_{segment_start}_clip_{i}"
            video_clip_id = f"{state.video_stem}__{clip_id}"
            clip_embedding = embeddings.mean(dim=0)
            score_source = "local_model"
            score_meta: JsonDict = {}
            score = None

            if state.vlm_scoring_active:
                score, score_meta = self.deps.score_clip_with_vlm(
                    clip_frames,
                    api_key=self.config.openrouter_api_key,
                    clip_id=video_clip_id,
                )
                if score is not None:
                    score_source = "vlm"
                else:
                    score_source = "local_fallback"
                    state.vlm_failure_count += 1
                    if state.vlm_failure_count >= self.config.vlm_scoring_fail_limit:
                        state.vlm_scoring_active = False
                        print(
                            f"⚠️ VLM scoring disabled after {state.vlm_failure_count} failures; "
                            "using local model fallback."
                        )

            if score is None:
                if state.anomaly_model is None:
                    raise RuntimeError(
                        "VLM scoring failed and local anomaly fallback is disabled. "
                        "Enable VLM_SCORING_FALLBACK_LOCAL=1 or fix OpenRouter access."
                    )
                score = self.deps.compute_anomaly_score(
                    state.anomaly_model,
                    clip_embedding=clip_embedding,
                    clip_frames=clip_frames,
                )

            clip_meta = {
                "id": clip_id,
                "video_clip_id": video_clip_id,
                "frames": clip_frames,
                "embedding": clip_embedding,
                "score": score,
                "score_source": score_source,
                "score_meta": score_meta,
                "timestamp": timestamp,
                "frame_index": clip_center_frame,
                "start_frame": clip_start_frame,
                "end_frame": clip_end_frame,
            }
            clips_metadata.append(clip_meta)

            yield {
                "type": "clip_scored",
                "clip_id": clip_id,
                "video_clip_id": video_clip_id,
                "score": score,
                "score_source": score_source,
                "timestamp": timestamp,
                "frame_index": clip_center_frame,
                "start_frame": clip_start_frame,
                "end_frame": clip_end_frame,
            }

        yield {
            "type": "clips_scored",
            "count": len(clips_metadata),
            "segment_start": segment_start,
            "segment_end": segment_end,
        }

        top_clips = state.clip_selector.select_diverse_clips(
            clips_metadata,
            score_threshold=self.config.anomaly_threshold,
        )

        yield {
            "type": "top_clips_selected",
            "count": len(top_clips),
            "segment_start": segment_start,
            "segment_end": segment_end,
        }

        segment_predicted_class = state.classification_results.get("class", "Unknown")
        anomalous_clip_count = sum(
            1 for clip_meta in top_clips if clip_meta["score"] >= self.config.anomaly_threshold
        )
        segment_summary_class = "Normal" if anomalous_clip_count == 0 else segment_predicted_class

        return SegmentContext(
            segment_start=segment_start,
            segment_end=segment_end,
            segment_time=segment_time,
            top_clips=top_clips,
            segment_predicted_class=segment_predicted_class,
            anomalous_clip_count=anomalous_clip_count,
            segment_summary_class=segment_summary_class,
            representative_clips=[],
        )


class ClipPostprocessAgent(BaseAgent):
    name = "clip_postprocess"

    def __init__(self, config: PipelineAgentConfig, deps: PipelineAgentDeps):
        self.config = config
        self.deps = deps

    def run(
        self,
        state: PipelineRuntimeState,
        segment_ctx: SegmentContext,
    ) -> Generator[JsonDict, None, SegmentContext]:
        fps = state.fps
        representative_clips: List[JsonDict] = []

        for clip_meta in segment_ctx.top_clips:
            clip_classification = (
                "Normal"
                if clip_meta["score"] < self.config.anomaly_threshold
                else segment_ctx.segment_predicted_class
            )
            folder = os.path.join(state.video_output_dir, clip_meta["id"])
            os.makedirs(folder, exist_ok=True)

            with open(os.path.join(folder, "score.txt"), "w") as f:
                f.write(f"Anomaly score: {clip_meta['score']:.4f}\n")
                f.write(f"Timestamp: {clip_meta['timestamp']:.2f}s\n")
                f.write(f"Frame range: {clip_meta['start_frame']}-{clip_meta['end_frame']}\n")
                f.write(f"Center frame: {clip_meta['frame_index']}\n")

            preview_base64 = None
            caption = "No caption"
            description = "No description"
            frame_paths: List[str] = []
            frame_base64_samples: List[str] = []
            frame_captions: List[JsonDict] = []
            object_detections: List[JsonDict] = []
            object_class_counts: JsonDict = {}
            object_total_count = 0
            bounding_boxes: List[JsonDict] = []
            first_frame = None
            clip_start_sec = float(clip_meta["start_frame"] / fps) if fps > 0 else float(clip_meta["timestamp"])
            clip_end_sec = float(clip_meta["end_frame"] / fps) if fps > 0 else float(clip_meta["timestamp"])
            segment_start_sec = float(segment_ctx.segment_time)
            segment_end_sec = float(segment_ctx.segment_end / fps) if fps > 0 else float(segment_ctx.segment_time)
            temporal_context_summary = {
                "segmentWindowSec": {
                    "start": segment_start_sec,
                    "end": segment_end_sec,
                },
                "clipWindowSec": {
                    "start": clip_start_sec,
                    "center": float(clip_meta["timestamp"]),
                    "end": clip_end_sec,
                },
                "beforeContextSec": {
                    "start": max(0.0, clip_start_sec - 3.0),
                    "end": clip_start_sec,
                    "duration": min(3.0, max(0.0, clip_start_sec)),
                },
                "afterContextSec": {
                    "start": clip_end_sec,
                    "end": min(float(state.duration), clip_end_sec + 3.0),
                    "duration": max(0.0, min(float(state.duration), clip_end_sec + 3.0) - clip_end_sec),
                },
                "segmentRelativePosition": {
                    "offsetFromSegmentStartSec": max(0.0, clip_start_sec - segment_start_sec),
                    "offsetToSegmentEndSec": max(0.0, segment_end_sec - clip_end_sec),
                },
            }

            for idx, frame in enumerate(clip_meta["frames"]):
                frame_timestamp = float(clip_meta["timestamp"] + (idx / fps if fps > 0 else 0))
                annotated_frame, frame_objects = self.deps.object_detector.detect_and_annotate(frame)
                frame_path = os.path.join(folder, f"frame_{idx}.jpg")
                annotated_frame.save(frame_path)
                rel_frame_path = os.path.relpath(frame_path, start=os.getcwd()).replace("\\", "/")
                frame_paths.append(rel_frame_path)

                if first_frame is None:
                    first_frame = frame

                if self.config.persist_frame_base64_samples and idx < self.config.frame_base64_sample_count:
                    frame_base64_samples.append(self.deps.encode_image(annotated_frame))

                if idx == 0:
                    preview_base64 = self.deps.encode_image(annotated_frame)

                frame_obj_count = len(frame_objects)
                object_total_count += frame_obj_count
                for obj in frame_objects:
                    cls_name = str(obj.get("className", "unknown"))
                    object_class_counts[cls_name] = object_class_counts.get(cls_name, 0) + 1
                    bbox = obj.get("bbox") or [0.0, 0.0, 0.0, 0.0]
                    bbox_norm = obj.get("bboxNormalized") or [0.0, 0.0, 0.0, 0.0]
                    if not isinstance(bbox, list) or len(bbox) != 4:
                        bbox = [0.0, 0.0, 0.0, 0.0]
                    if not isinstance(bbox_norm, list) or len(bbox_norm) != 4:
                        bbox_norm = [0.0, 0.0, 0.0, 0.0]
                    bounding_boxes.append(
                        {
                            "frameIndex": int(idx),
                            "globalFrameIndex": int(clip_meta["start_frame"] + idx),
                            "timestampSec": float(frame_timestamp),
                            "classId": int(obj.get("classId", -1)),
                            "className": cls_name,
                            "confidence": float(obj.get("confidence", 0.0)),
                            "bbox": [float(v) for v in bbox],
                            "bboxNormalized": [float(v) for v in bbox_norm],
                        }
                    )

                object_detections.append(
                    {
                        "frameIndex": int(idx),
                        "globalFrameIndex": int(clip_meta["start_frame"] + idx),
                        "timestampSec": frame_timestamp,
                        "objectCount": frame_obj_count,
                        "objects": frame_objects,
                    }
                )

            try:
                if first_frame is not None:
                    caption = self.deps.generate_caption(first_frame)

                for idx, frame in enumerate(clip_meta["frames"][: self.config.frame_caption_sample_count]):
                    try:
                        fc = self.deps.generate_caption(frame)
                        frame_captions.append(
                            {
                                "frameIndex": int(idx),
                                "globalFrameIndex": int(clip_meta["start_frame"] + idx),
                                "timestampSec": float(
                                    clip_meta["timestamp"] + (idx / fps if fps > 0 else 0)
                                ),
                                "caption": fc,
                            }
                        )
                    except Exception:
                        continue

                if preview_base64:
                    description = self.deps.generate_description(
                        caption,
                        clip_meta["score"],
                        clip_classification,
                        preview_base64,
                        self.config.openrouter_api_key,
                        temporal_context=temporal_context_summary,
                    )
            except Exception as e:
                description = f"Description generation failed: {str(e)}"

            event_payload = {
                "clipId": clip_meta["id"],
                "videoClipId": clip_meta.get("video_clip_id"),
                "videoName": state.video_name,
                "scoreSource": clip_meta.get("score_source", "local_model"),
                "scoreMeta": clip_meta.get("score_meta", {}),
                "classification": clip_classification,
                "caption": caption,
                "clipTimestampSec": float(clip_meta["timestamp"]),
                "segmentStartFrame": int(segment_ctx.segment_start),
                "segmentEndFrame": int(segment_ctx.segment_end),
                "segmentStartSec": segment_start_sec,
                "segmentEndSec": segment_end_sec,
                "startFrame": int(clip_meta["start_frame"]),
                "endFrame": int(clip_meta["end_frame"]),
                "centerFrame": int(clip_meta["frame_index"]),
                "clipStartSec": clip_start_sec,
                "clipEndSec": clip_end_sec,
                "fps": float(fps),
                "clipLength": int(state.clip_length),
                "stride": int(state.stride),
                "topK": int(state.top_k),
                "videoDurationSec": float(state.duration),
                "videoTotalFrames": int(state.total_frames),
                "frameCountSaved": len(clip_meta["frames"]),
                "framePaths": frame_paths,
                "frameUrls": [
                    self.deps.to_public_url(p, base_url=state.public_base_url) for p in frame_paths
                ],
                "frameBase64Samples": (
                    frame_base64_samples if self.config.persist_frame_base64_samples else []
                ),
                "frameCaptions": frame_captions,
                "objectDetections": object_detections,
                "boundingBoxes": bounding_boxes,
                "objectDetectionSummary": {
                    "totalDetections": int(object_total_count),
                    "classes": object_class_counts,
                },
                "temporalContext": temporal_context_summary,
                "objectDetectorModel": (
                    self.config.yolo_model if self.deps.object_detector.enabled else None
                ),
                "previewBase64": preview_base64 if self.config.persist_preview_base64 else None,
                "isAnomalousClip": bool(clip_meta["score"] >= self.config.anomaly_threshold),
            }

            self.deps.save_abnormal_event(
                video_name=state.video_name,
                event_name=clip_classification,
                description=description,
                score=clip_meta["score"],
                extra_data=event_payload,
            )

            representative = {
                "id": clip_meta["id"],
                "video_clip_id": clip_meta.get("video_clip_id"),
                "score": clip_meta["score"],
                "score_source": clip_meta.get("score_source", "local_model"),
                "score_meta": clip_meta.get("score_meta", {}),
                "caption": caption,
                "description": description,
                "timestamp": clip_meta["timestamp"],
                "frame_index": clip_meta["frame_index"],
                "start_frame": clip_meta["start_frame"],
                "end_frame": clip_meta["end_frame"],
                "frame_paths": frame_paths,
                "frame_captions": frame_captions,
                "object_detections": object_detections,
                "bounding_boxes": bounding_boxes,
                "object_detection_summary": {
                    "totalDetections": int(object_total_count),
                    "classes": object_class_counts,
                },
                "preview_base64": preview_base64,
                "classification": clip_classification,
                "fps": fps,
                "temporal_context": temporal_context_summary,
            }
            representative_clips.append(representative)

            yield {
                "type": "clip_processed",
                "clip_id": clip_meta["id"],
                "video_clip_id": clip_meta.get("video_clip_id"),
                "score": clip_meta["score"],
                "score_source": clip_meta.get("score_source", "local_model"),
                "caption": caption,
                "description": description,
                "image_url": (f"data:image/jpeg;base64,{preview_base64}" if preview_base64 else None),
                "preview_base64": preview_base64,
                "classification": clip_classification,
                "timestamp": clip_meta["timestamp"],
                "frame_index": clip_meta["frame_index"],
                "start_frame": clip_meta["start_frame"],
                "end_frame": clip_meta["end_frame"],
                "frame_paths": frame_paths,
                "frame_captions": frame_captions,
                "object_detections": object_detections,
                "bounding_boxes": bounding_boxes,
                "object_detection_summary": {
                    "totalDetections": int(object_total_count),
                    "classes": object_class_counts,
                },
                "fps": fps,
                "temporal_context": temporal_context_summary,
            }

        segment_ctx.representative_clips = representative_clips

        print("\n=== Classification Results ===")
        print(
            {
                "class": segment_ctx.segment_summary_class,
                "segmentPredictedClass": segment_ctx.segment_predicted_class,
                "anomalousClips": segment_ctx.anomalous_clip_count,
                "threshold": self.config.anomaly_threshold,
            }
        )
        print("\n=== Top Clips ===")
        for clip in representative_clips:
            print(f"📌 Clip {clip['id']}")
            print(f"⏱️ Timestamp: {clip['timestamp']:.2f}s")
            print(f"📊 Score: {clip['score']:.4f}")
            print(f"🧠 Score source: {clip.get('score_source', 'local_model')}")
            print(f"🎞️ Frame range: {clip['start_frame']}-{clip['end_frame']}")
            print(f"🎯 Center frame: {clip['frame_index']}")
            print(f"🏷️ Classification: {clip['classification']}")
            print(f"📝 Caption: {clip['caption']}")
            print(f"📋 Description: {clip['description']}")
            print("----------")
        print("\n====================\n")

        return segment_ctx


class VideoPipelineOrchestrator:
    def __init__(self, config: PipelineAgentConfig, deps: PipelineAgentDeps):
        self.config = config
        self.deps = deps
        self.bootstrap_agent = PipelineBootstrapAgent(config, deps)
        self.segment_scoring_agent = SegmentScoringAgent(config, deps)
        self.clip_postprocess_agent = ClipPostprocessAgent(config, deps)

    def run(
        self,
        video_path: str,
        anomaly_model_path: str,
        output_dir: str,
        segment_duration_sec: int = 30,
    ) -> Generator[JsonDict, None, None]:
        state = self.bootstrap_agent.run(
            video_path=video_path,
            anomaly_model_path=anomaly_model_path,
            output_dir=output_dir,
            segment_duration_sec=segment_duration_sec,
        )

        yield {
            "type": "video_metadata",
            "fps": state.fps,
            "total_frames": state.total_frames,
            "duration": state.duration,
            "width": state.video_info.get("width", 0),
            "height": state.video_info.get("height", 0),
            "total_segments": state.total_segments,
        }

        processed_segments = 0
        processed_clips = 0
        anomalous_clips = 0

        for segment_index, segment_start in enumerate(
            range(0, state.total_frames, max(1, state.segment_length_frames)),
            start=1,
        ):
            yield {
                "type": "segment_progress",
                "phase": "started",
                "segment_index": segment_index,
                "total_segments": state.total_segments,
                "progress_ratio": float((segment_index - 1) / max(1, state.total_segments)),
                "progress_percent": float(100.0 * (segment_index - 1) / max(1, state.total_segments)),
            }
            segment_ctx = yield from self.segment_scoring_agent.run(state, segment_start)
            segment_ctx = yield from self.clip_postprocess_agent.run(state, segment_ctx)
            processed_segments += 1
            processed_clips += len(segment_ctx.representative_clips)
            anomalous_clips += sum(
                1
                for clip in segment_ctx.representative_clips
                if float(clip.get("score", 0.0)) >= float(self.config.anomaly_threshold)
            )
            yield {
                "type": "segment_done",
                "segment_start": segment_ctx.segment_start,
                "segment_end": segment_ctx.segment_end,
            }
            yield {
                "type": "segment_progress",
                "phase": "completed",
                "segment_index": segment_index,
                "total_segments": state.total_segments,
                "progress_ratio": float(processed_segments / max(1, state.total_segments)),
                "progress_percent": float(100.0 * processed_segments / max(1, state.total_segments)),
                "processed_segments": processed_segments,
                "processed_clips": processed_clips,
                "anomalous_clips": anomalous_clips,
            }

        yield {
            "type": "analysis_complete",
            "success": True,
            "video_name": state.video_name,
            "processed_segments": processed_segments,
            "total_segments": state.total_segments,
            "processed_clips": processed_clips,
            "anomalous_clips": anomalous_clips,
            "vlm_scoring_active_final": bool(state.vlm_scoring_active),
            "vlm_failures": int(state.vlm_failure_count),
        }
