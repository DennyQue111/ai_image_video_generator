"""Google AI Studio (Gemini) image generation client."""
import logging
import os
import uuid
from pathlib import Path
from typing import Optional, List, Dict

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)


class GoogleAIClient:
    def __init__(self, api_key: Optional[str] = None, timeout_seconds: int = 120):
        self.api_key = api_key or os.getenv("GOOGLE_AI_STUDIO_API_KEY")
        if not self.api_key:
            logger.error("GOOGLE_AI_STUDIO_API_KEY is not set in environment")
            raise ValueError("GOOGLE_AI_STUDIO_API_KEY is not set in environment")
        logger.info("GoogleAIClient initialized, timeout=%ss", timeout_seconds)
        self.client = genai.Client(api_key=self.api_key, http_options={"timeout": timeout_seconds * 1000})

    def is_available(self) -> bool:
        return bool(self.api_key)

    async def generate_concept_image(
        self,
        prompt: str,
        model: str = "gemini-2.5-flash-image",
        negative_prompt: str = "",
    ) -> Dict:
        contents = prompt
        if negative_prompt:
            contents = f"{prompt}\n\nAvoid: {negative_prompt}"

        logger.info("[Gemini] Generating image with model=%s, prompt_len=%d", model, len(contents))
        try:
            response = await self.client.aio.models.generate_content(
                model=model,
                contents=contents,
            )
        except Exception as e:
            logger.error("[Gemini] API request failed: %s", e)
            raise

        logger.info("[Gemini] Response received, candidates=%d", len(response.candidates or []))
        for candidate in response.candidates or []:
            if not candidate.content:
                logger.warning("[Gemini] Candidate has no content")
                continue
            for part in candidate.content.parts or []:
                if part.inline_data and part.inline_data.data:
                    logger.info("[Gemini] Image data received, mime_type=%s", part.inline_data.mime_type)
                    return {
                        "image_data": part.inline_data.data,
                        "mime_type": part.inline_data.mime_type or "image/png",
                    }

        logger.error("[Gemini] No image data returned from API")
        raise RuntimeError("No image data returned from Gemini API")

    async def generate_and_save(
        self,
        prompt: str,
        model: str,
        save_dir: Path,
        filename: Optional[str] = None,
    ) -> Dict:
        logger.info("[Gemini] generate_and_save called, model=%s, save_dir=%s", model, save_dir)
        result = await self.generate_concept_image(prompt=prompt, model=model)

        image_data = result["image_data"]
        mime_type = result.get("mime_type", "image/png")
        ext = "png" if "png" in mime_type else "jpg" if "jpg" in mime_type or "jpeg" in mime_type else "webp"

        if not filename:
            filename = f"gemini_{uuid.uuid4().hex[:8]}.{ext}"
        elif not filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
            filename = f"{filename}.{ext}"

        save_dir.mkdir(parents=True, exist_ok=True)
        local_path = save_dir / filename
        logger.info("[Gemini] Saving image to %s", local_path)
        with open(local_path, "wb") as f:
            f.write(image_data)
        logger.info("[Gemini] Image saved, size=%d bytes", len(image_data))

        return {
            "filename": filename,
            "local_path": local_path,
        }

    async def generate_with_images_and_save(
        self,
        overall_prompt: str,
        image_descriptions: List[Dict],
        model: str,
        save_dir: Path,
        filename: Optional[str] = None,
    ) -> Dict:
        logger.info(
            "[Gemini] generate_with_images_and_save called, model=%s, num_images=%d, save_dir=%s",
            model, len(image_descriptions), save_dir
        )
        parts = []
        for idx, img_data in enumerate(image_descriptions):
            mime = img_data.get("mime_type", "image/png")
            desc = img_data.get("description", "")
            logger.info("[Gemini] Attaching image %d, mime=%s, has_description=%s", idx + 1, mime, bool(desc))
            parts.append(types.Part.from_bytes(
                data=img_data["data"],
                mime_type=mime,
            ))
            if desc:
                parts.append(types.Part(text=f"这张图片的描述: {desc}"))

        parts.append(types.Part(text=(
            f"请根据以上多张参考图片以及它们的描述，按照以下总体要求生成一张新的合成图片。\n\n"
            f"总体要求：{overall_prompt}\n\n"
            f"请确保生成的图片融合了所有参考图的元素，并遵守总体要求。"
        )))

        contents = [types.Content(role="user", parts=parts)]

        try:
            response = await self.client.aio.models.generate_content(
                model=model,
                contents=contents,
            )
        except Exception as e:
            logger.error("[Gemini] Multi-image API request failed: %s", e)
            raise

        if not response.candidates:
            feedback = response.prompt_feedback
            reason = feedback.block_reason.name if feedback and feedback.block_reason else "UNKNOWN"
            logger.error("[Gemini] API rejected request, block_reason=%s", reason)
            raise RuntimeError(f"Gemini API 拒绝了请求 (block_reason={reason})")

        logger.info("[Gemini] Multi-image response received, candidates=%d", len(response.candidates))
        for candidate in response.candidates:
            if not candidate.content:
                logger.warning("[Gemini] Candidate has no content")
                continue
            for part in candidate.content.parts or []:
                if part.inline_data and part.inline_data.data:
                    image_data = part.inline_data.data
                    mime_type = part.inline_data.mime_type or "image/png"
                    ext = "png" if "png" in mime_type else "jpg" if "jpg" in mime_type or "jpeg" in mime_type else "webp"

                    if not filename:
                        filename = f"gemini_img2img_{uuid.uuid4().hex[:8]}.{ext}"
                    elif not filename.lower().endswith((".png", ".jpg", ".jpeg", ".webp")):
                        filename = f"{filename}.{ext}"

                    save_dir.mkdir(parents=True, exist_ok=True)
                    local_path = save_dir / filename
                    logger.info("[Gemini] Saving multi-image result to %s", local_path)
                    with open(local_path, "wb") as f:
                        f.write(image_data)
                    logger.info("[Gemini] Multi-image result saved, size=%d bytes", len(image_data))

                    return {
                        "filename": filename,
                        "local_path": local_path,
                        "image_data": image_data,
                        "mime_type": mime_type,
                    }

        logger.error("[Gemini] No image data returned for multi-image input")
        raise RuntimeError("No image data returned from Gemini API for multi-image input")
