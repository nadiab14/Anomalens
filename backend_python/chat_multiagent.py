from dataclasses import dataclass
from typing import Any, Callable, Dict, List, Optional, Tuple

import requests


JsonDict = Dict[str, Any]


@dataclass
class ChatAgentConfig:
    openrouter_api_key: str
    openrouter_base_url: str
    openrouter_models: List[str]
    llm_db_context_limit: int
    rag_candidate_limit: int
    rag_top_k: int
    rag_image_top_k: int
    temperature: float = 0.3
    timeout_sec: int = 45
    http_referer: str = "http://localhost:5000"
    app_title: str = "Anomalens Backend"


@dataclass
class ChatAgentDeps:
    extract_target_video_name: Callable[[JsonDict, JsonDict], Optional[str]]
    format_context_for_prompt: Callable[[JsonDict], str]
    fetch_recent_historique_events: Callable[..., List[JsonDict]]
    retrieve_relevant_events: Callable[[str, List[JsonDict], int], List[JsonDict]]
    rerank_events_by_timestamps: Callable[[str, List[JsonDict]], List[JsonDict]]
    format_historique_for_prompt: Callable[[List[JsonDict]], str]
    collect_evidence_frames: Callable[[List[JsonDict]], List[JsonDict]]
    collect_user_message_images: Callable[[str], Tuple[List[Any], List[str]]]
    should_send_multimodal: Callable[[str, List[JsonDict]], bool]
    normalize_user_image_item: Callable[[Any], Optional[JsonDict]]
    image_url_to_base64: Callable[[str], Optional[str]]
    to_public_url: Callable[[str], str]
    safe_float: Callable[..., float]
    model_supports_images: Callable[[str], bool]
    local_rag_fallback_answer: Callable[[str, List[JsonDict]], str]


@dataclass
class ChatPrepState:
    data: JsonDict
    user_message: str
    history: List[JsonDict]
    context: JsonDict
    target_video_name: Optional[str]
    context_summary: str
    rag_events: List[JsonDict]
    db_context_summary: str
    evidence_frames: List[JsonDict]
    user_message_images: List[Any]
    image_input_errors: List[str]
    explicit_image_query: bool
    want_multimodal: bool


class BaseAgent:
    name = "base"

    def run(self, *args, **kwargs):
        raise NotImplementedError


class ChatPreparationAgent(BaseAgent):
    name = "chat_preparation"

    def __init__(self, config: ChatAgentConfig, deps: ChatAgentDeps):
        self.config = config
        self.deps = deps

    def run(self, data: JsonDict) -> ChatPrepState:
        user_message = str((data or {}).get("message") or "").strip()
        raw_history = (data or {}).get("history", [])
        raw_context = (data or {}).get("context") or {}
        history = raw_history if isinstance(raw_history, list) else []
        context = raw_context if isinstance(raw_context, dict) else {}

        target_video_name = self.deps.extract_target_video_name(data or {}, context)
        context_summary = self.deps.format_context_for_prompt(context)

        db_events = self.deps.fetch_recent_historique_events(
            limit=max(self.config.llm_db_context_limit, self.config.rag_candidate_limit),
            video_name=target_video_name,
        )
        rag_events = self.deps.retrieve_relevant_events(
            user_message,
            db_events,
            top_k=self.config.rag_top_k,
        )
        rag_events = self.deps.rerank_events_by_timestamps(user_message, rag_events)
        db_context_summary = self.deps.format_historique_for_prompt(rag_events)
        evidence_frames = self.deps.collect_evidence_frames(rag_events)
        user_message_images, image_input_errors = self.deps.collect_user_message_images(user_message)

        explicit_image_query = bool(user_message_images)
        want_multimodal = self.deps.should_send_multimodal(user_message, rag_events) or explicit_image_query

        return ChatPrepState(
            data=data or {},
            user_message=user_message,
            history=history,
            context=context,
            target_video_name=target_video_name,
            context_summary=context_summary,
            rag_events=rag_events,
            db_context_summary=db_context_summary,
            evidence_frames=evidence_frames,
            user_message_images=user_message_images,
            image_input_errors=image_input_errors,
            explicit_image_query=explicit_image_query,
            want_multimodal=want_multimodal,
        )


class ChatPromptBuilderAgent(BaseAgent):
    name = "chat_prompt_builder"

    def __init__(self, config: ChatAgentConfig, deps: ChatAgentDeps):
        self.config = config
        self.deps = deps

    def run(self, state: ChatPrepState) -> List[JsonDict]:
        system_prompt = (
            "You are AnomaLens assistant for surveillance video analysis. "
            "Always ground your answers in the provided context. "
            "If detected clips or frame descriptions exist, NEVER say there is no information. "
            "When user asks what happened in the latest video, summarize events chronologically using clip timestamps and scores. "
            "When user asks to describe frames, use frame/clip descriptions, captions, anomaly scores and timestamps. "
            "State uncertainty explicitly only for missing parts, but still answer with available detections. "
            "Default language: French, unless user asks another language."
        )
        if state.explicit_image_query:
            system_prompt += (
                " IMPORTANT: user provided one or more explicit images. "
                "You MUST analyze those images visually first. "
                "Do NOT answer only from historical context. "
                "Do NOT say you cannot access the image if an image was attached in the request."
            )

        messages: List[JsonDict] = [{"role": "system", "content": system_prompt}]
        if state.explicit_image_query:
            messages.append(
                {
                    "role": "system",
                    "content": (
                        "Mode image-only: prioritize direct visual analysis of attached images. "
                        "Use historical context only as secondary support."
                    ),
                }
            )
        else:
            messages.append({"role": "system", "content": state.context_summary})
            messages.append({"role": "system", "content": state.db_context_summary})

        if not state.explicit_image_query:
            for item in state.history[-20:]:
                if not isinstance(item, dict):
                    continue
                role = item.get("role")
                content = item.get("content")
                if role in {"user", "assistant"} and isinstance(content, str) and content.strip():
                    messages.append({"role": role, "content": content.strip()})

        if not messages or messages[-1].get("role") != "user":
            messages.append({"role": "user", "content": state.user_message})

        if state.want_multimodal:
            last_message = messages[-1] if messages else None
            if (
                isinstance(last_message, dict)
                and last_message.get("role") == "user"
                and last_message.get("content") == state.user_message
            ):
                messages.pop()

            multimodal_instruction = (
                "Question utilisateur: "
                f"{state.user_message}\n\n"
                "Instruction: fais une analyse visuelle des images fournies. "
                "Base ta réponse d'abord sur ce que tu vois réellement dans les images. "
                "Considère que les images sont déjà jointes au message."
            )
            if not state.explicit_image_query:
                multimodal_instruction += f"\n\nScènes récupérées (RAG):\n{state.db_context_summary}"

            multimodal_parts: List[JsonDict] = [{"type": "text", "text": multimodal_instruction}]

            for img in state.user_message_images:
                normalized_img = self.deps.normalize_user_image_item(img)
                if not normalized_img:
                    continue
                source_url = normalized_img.get("sourceUrl")
                image_url = normalized_img.get("imageUrl")
                if not isinstance(image_url, str) or not image_url.strip():
                    continue
                multimodal_parts.append(
                    {
                        "type": "text",
                        "text": f"Image fournie par l'utilisateur: {source_url}",
                    }
                )
                multimodal_parts.append(
                    {
                        "type": "image_url",
                        "image_url": {"url": image_url},
                    }
                )

            if not state.explicit_image_query:
                added_images = 0
                for ev_frame in state.evidence_frames:
                    if added_images >= self.config.rag_image_top_k:
                        break
                    if not isinstance(ev_frame, dict):
                        continue
                    raw_frame_url = str(ev_frame.get("frameUrl") or "").strip()
                    if not raw_frame_url:
                        continue

                    image_payload_url = raw_frame_url
                    if raw_frame_url.startswith(("http://", "https://")):
                        inline_b64 = self.deps.image_url_to_base64(raw_frame_url)
                        if inline_b64:
                            image_payload_url = f"data:image/jpeg;base64,{inline_b64}"
                    elif not raw_frame_url.startswith("data:image/"):
                        candidate_public = self.deps.to_public_url(raw_frame_url)
                        inline_b64 = self.deps.image_url_to_base64(candidate_public)
                        image_payload_url = (
                            f"data:image/jpeg;base64,{inline_b64}" if inline_b64 else candidate_public
                        )

                    multimodal_parts.append(
                        {
                            "type": "text",
                            "text": (
                                f"Scene video={ev_frame.get('videoName')} | "
                                f"video_clip_id={ev_frame.get('videoClipId')} | clip_id={ev_frame.get('clipId')} | "
                                f"t={self.deps.safe_float(ev_frame.get('timestampSec')):.2f}s | "
                                f"score={self.deps.safe_float(ev_frame.get('score')):.4f} | "
                                f"class={ev_frame.get('classification')}\n"
                                f"caption={ev_frame.get('caption')}"
                            ),
                        }
                    )
                    multimodal_parts.append(
                        {
                            "type": "image_url",
                            "image_url": {"url": image_payload_url},
                        }
                    )
                    added_images += 1

            messages.append({"role": "user", "content": multimodal_parts})

        return messages


@dataclass
class LLMRunResult:
    ok: bool
    payload: Optional[JsonDict]
    last_error: Optional[str]
    attempted_models: List[str]


class OpenRouterChatAgent(BaseAgent):
    name = "openrouter_chat"

    def __init__(self, config: ChatAgentConfig, deps: ChatAgentDeps):
        self.config = config
        self.deps = deps

    def run(self, state: ChatPrepState, messages: List[JsonDict]) -> LLMRunResult:
        headers = {
            "Authorization": f"Bearer {self.config.openrouter_api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": self.config.http_referer,
            "X-Title": self.config.app_title,
        }

        last_error = None
        attempted_models: List[str] = []

        try:
            for model_name in self.config.openrouter_models:
                attempted_models.append(model_name)
                payload_messages = messages

                if state.want_multimodal and not self.deps.model_supports_images(model_name):
                    if state.explicit_image_query:
                        last_error = f"Model does not support image input: {model_name}"
                        continue

                    payload_messages = [
                        m
                        for m in messages
                        if not (m.get("role") == "user" and isinstance(m.get("content"), list))
                    ]
                    payload_messages.append(
                        {
                            "role": "user",
                            "content": (
                                f"{state.user_message}\n\n"
                                "Use the retrieved context summaries and captions to describe scenes chronologically."
                            ),
                        }
                    )

                payload = {
                    "model": model_name,
                    "messages": payload_messages,
                    "temperature": self.config.temperature,
                }
                response = requests.post(
                    f"{self.config.openrouter_base_url}/chat/completions",
                    headers=headers,
                    json=payload,
                    timeout=self.config.timeout_sec,
                )

                try:
                    resp_data = response.json()
                except ValueError:
                    resp_data = {"raw": response.text}

                if 200 <= response.status_code < 300:
                    choices = resp_data.get("choices") if isinstance(resp_data, dict) else None
                    if choices and len(choices) > 0:
                        content = choices[0].get("message", {}).get("content", "").strip()
                        if content:
                            return LLMRunResult(
                                ok=True,
                                payload={
                                    "response": content,
                                    "model": model_name,
                                    "evidence_frames": state.evidence_frames,
                                    "used_multimodal": bool(
                                        any(
                                            m.get("role") == "user" and isinstance(m.get("content"), list)
                                            for m in payload_messages
                                        )
                                    ),
                                },
                                last_error=None,
                                attempted_models=attempted_models,
                            )
                    last_error = "Unexpected response format from OpenRouter"
                    continue

                error_message = (
                    resp_data.get("error", {}).get("message")
                    if isinstance(resp_data, dict)
                    else None
                )
                last_error = f"{response.status_code} {error_message or str(resp_data)}"

                if response.status_code in {400, 404, 408, 409, 429, 500, 502, 503, 504}:
                    continue
                break

            return LLMRunResult(
                ok=False,
                payload=None,
                last_error=last_error or "Unknown OpenRouter error",
                attempted_models=attempted_models,
            )
        except Exception as exc:
            return LLMRunResult(
                ok=False,
                payload=None,
                last_error=str(exc),
                attempted_models=attempted_models,
            )


class ChatFallbackAgent(BaseAgent):
    name = "chat_fallback"

    def __init__(self, deps: ChatAgentDeps):
        self.deps = deps

    def run(self, state: ChatPrepState, last_error: str, attempted_models: Optional[List[str]] = None) -> JsonDict:
        if state.explicit_image_query:
            fallback_response = (
                "Je n'ai pas pu obtenir une analyse visuelle depuis le fournisseur LLM pour l'image demandée. "
                "Je te renvoie uniquement un résumé contextuel local (non visuel direct).\n\n"
                + self.deps.local_rag_fallback_answer(state.user_message, state.rag_events)
            )
        else:
            fallback_response = self.deps.local_rag_fallback_answer(state.user_message, state.rag_events)

        payload: JsonDict = {
            "response": fallback_response,
            "fallback": True,
            "fallback_reason": f"LLM request failed: {last_error}",
            "evidence_frames": state.evidence_frames,
        }
        if attempted_models:
            payload["models_tried"] = attempted_models
        return payload


class ChatOrchestrator:
    def __init__(self, config: ChatAgentConfig, deps: ChatAgentDeps):
        self.config = config
        self.deps = deps
        self.preparation_agent = ChatPreparationAgent(config, deps)
        self.prompt_builder_agent = ChatPromptBuilderAgent(config, deps)
        self.openrouter_chat_agent = OpenRouterChatAgent(config, deps)
        self.fallback_agent = ChatFallbackAgent(deps)

    def handle_request(self, data: Optional[JsonDict]) -> Tuple[JsonDict, int]:
        payload = data if isinstance(data, dict) else {}
        user_message = str(payload.get("message") or "").strip()

        if not user_message:
            return {"error": "Missing message"}, 400

        if not self.config.openrouter_api_key:
            return {"error": "Missing OPENROUTER_API_KEY on backend"}, 500

        state = self.preparation_agent.run(payload)

        if state.image_input_errors and not state.user_message_images:
            return (
                {
                    "response": (
                        "Je n'ai pas pu charger l'image demandée. "
                        "Vérifie que l'URL est complète et que le fichier existe.\n- "
                        + "\n- ".join(state.image_input_errors)
                    ),
                    "fallback": True,
                    "fallback_reason": "Invalid or inaccessible user image URL",
                    "image_errors": state.image_input_errors,
                    "evidence_frames": state.evidence_frames,
                },
                200,
            )

        messages = self.prompt_builder_agent.run(state)
        llm_result = self.openrouter_chat_agent.run(state, messages)

        if llm_result.ok and llm_result.payload is not None:
            return llm_result.payload, 200

        fallback_payload = self.fallback_agent.run(
            state,
            last_error=llm_result.last_error or "Unknown OpenRouter error",
            attempted_models=llm_result.attempted_models,
        )
        return fallback_payload, 200
