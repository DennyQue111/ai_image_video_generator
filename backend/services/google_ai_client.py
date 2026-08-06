"""Google AI Studio (Gemini) image generation client."""
import logging
import os
import uuid
import json
from pathlib import Path
from typing import Optional, List, Dict

from google import genai
from google.genai import types

logger = logging.getLogger(__name__)


class GoogleAIClient:
    def __init__(self, api_key: Optional[str] = None, timeout_seconds: int = 120):
        # 官方 SDK 自动从 GEMINI_API_KEY 环境变量加载，兼容 GOOGLE_AI_STUDIO_API_KEY
        key = api_key or os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_STUDIO_API_KEY")
        if not key:
            logger.error("GEMINI_API_KEY (或 GOOGLE_AI_STUDIO_API_KEY) 未在环境中配置")
            raise ValueError("GEMINI_API_KEY (或 GOOGLE_AI_STUDIO_API_KEY) 未在环境中配置")
        os.environ["GEMINI_API_KEY"] = key
        logger.info("GoogleAIClient initialized, timeout=%ss", timeout_seconds)
        # 与 Google AI Studio 应用一致：添加 aistudio-build User-Agent
        self.client = genai.Client(
            http_options=types.HttpOptions(
                timeout=timeout_seconds * 1000,
                headers={"User-Agent": "aistudio-build"},
            )
        )

    def is_available(self) -> bool:
        return bool(os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_AI_STUDIO_API_KEY"))

    async def generate_concept_image(
        self,
        prompt: str,
        model: str = "gemini-2.5-flash-image",
        negative_prompt: str = "",
        aspect_ratio: str = "1:1",
    ) -> Dict:
        contents = prompt
        if negative_prompt:
            contents = f"{prompt}\n\nAvoid: {negative_prompt}"

        logger.info("[Gemini] Generating image, model=%s, prompt_len=%d, aspect_ratio=%s", model, len(contents), aspect_ratio)

        # Imagen 系列模型使用 generateImages 方法
        if "imagen" in model.lower():
            logger.info("[Gemini] Using generateImages for Imagen model")
            try:
                response = await self.client.aio.models.generate_images(
                    model=model,
                    prompt=contents,
                    config=types.GenerateImagesConfig(
                        number_of_images=1,
                        output_mime_type="image/jpeg",
                        aspect_ratio=aspect_ratio,
                    ),
                )
                if not response.generated_images:
                    raise RuntimeError("Imagen API 未返回任何图片")
                img = response.generated_images[0]
                if not img.image or not img.image.image_bytes:
                    raise RuntimeError("Imagen API 未返回图片数据")
                logger.info("[Gemini] Imagen image data received, size=%d bytes", len(img.image.image_bytes))
                return {
                    "image_data": img.image.image_bytes,
                    "mime_type": "image/jpeg",
                }
            except Exception as e:
                logger.error("[Gemini] Imagen API request failed: %s", e)
                raise

        # Gemini 系列模型使用 generateContent 方法（与官方示例一致）
        try:
            response = await self.client.aio.models.generate_content(
                model=model,
                contents=contents,
                config=types.GenerateContentConfig(
                    image_config=types.ImageConfig(
                        aspect_ratio=aspect_ratio,
                    ),
                ),
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
        aspect_ratio: str = "1:1",
    ) -> Dict:
        logger.info("[Gemini] generate_and_save called, model=%s, save_dir=%s", model, save_dir)
        result = await self.generate_concept_image(
            prompt=prompt, model=model, aspect_ratio=aspect_ratio
        )

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
        aspect_ratio: str = "1:1",
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
                parts.append(types.Part(text=f"Reference Image #{idx + 1}: {desc}"))

        parts.append(types.Part(text=(
            f"Based on the above reference images and their descriptions, "
            f"generate a new fused image according to the following instructions:\n\n"
            f"{overall_prompt}"
        )))

        contents = [types.Content(role="user", parts=parts)]

        try:
            response = await self.client.aio.models.generate_content(
                model=model,
                contents=contents,
                config=types.GenerateContentConfig(
                    image_config=types.ImageConfig(
                        aspect_ratio=aspect_ratio,
                    ),
                ),
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

    async def generate_inpaint_and_save(
        self,
        prompt: str,
        base_image_data: bytes,
        base_image_mime: str,
        mask_image_data: bytes,
        model: str,
        save_dir: Path,
        aspect_ratio: str = "1:1",
    ) -> Dict:
        """图像修复：base image + mask + prompt → new image"""
        logger.info("[Gemini] generate_inpaint_and_save, model=%s, aspect_ratio=%s", model, aspect_ratio)

        parts = [
            types.Part.from_bytes(data=base_image_data, mime_type=base_image_mime),
            types.Part.from_bytes(data=mask_image_data, mime_type="image/png"),
            types.Part(text=(
                f"Inpaint the specified region highlighted in white in the mask image. "
                f"Please fill it or replace it with: {prompt}"
            )),
        ]

        contents = [types.Content(role="user", parts=parts)]

        try:
            response = await self.client.aio.models.generate_content(
                model=model,
                contents=contents,
                config=types.GenerateContentConfig(
                    image_config=types.ImageConfig(
                        aspect_ratio=aspect_ratio,
                    ),
                ),
            )
        except Exception as e:
            logger.error("[Gemini] Inpaint API request failed: %s", e)
            raise

        if not response.candidates:
            feedback = response.prompt_feedback
            reason = feedback.block_reason.name if feedback and feedback.block_reason else "UNKNOWN"
            logger.error("[Gemini] Inpaint API rejected, block_reason=%s", reason)
            raise RuntimeError(f"Gemini API 拒绝了请求 (block_reason={reason})")

        logger.info("[Gemini] Inpaint response received, candidates=%d", len(response.candidates))
        for candidate in response.candidates:
            if not candidate.content:
                continue
            for part in candidate.content.parts or []:
                if part.inline_data and part.inline_data.data:
                    image_data = part.inline_data.data
                    mime_type = part.inline_data.mime_type or "image/png"
                    ext = "png" if "png" in mime_type else "jpg" if "jpg" in mime_type or "jpeg" in mime_type else "webp"
                    filename = f"gemini_inpaint_{uuid.uuid4().hex[:8]}.{ext}"
                    save_dir.mkdir(parents=True, exist_ok=True)
                    local_path = save_dir / filename
                    with open(local_path, "wb") as f:
                        f.write(image_data)
                    logger.info("[Gemini] Inpaint result saved, size=%d bytes", len(image_data))
                    return {
                        "filename": filename,
                        "local_path": local_path,
                    }

        logger.error("[Gemini] No image data returned for inpaint")
        raise RuntimeError("No image data returned from Gemini API for inpaint")

    async def image_to_prompt(
        self,
        image_data: bytes,
        image_mime: str,
        model: str = "gemini-2.5-flash",
    ) -> Dict:
        """图生提示词：分析图片，提取结构化风格信息"""
        logger.info("[Gemini] image_to_prompt called, model=%s", model)

        parts = [
            types.Part.from_bytes(data=image_data, mime_type=image_mime),
            types.Part(text=(
                "Analyze this image in extreme detail. Break down its visual properties into: "
                "subjectDescription (vivid, clear subject), "
                "styleSignature (dense, cohesive, reusable keywords of style, medium, lens, camera, lighting, colors, textures), "
                "fullPrompt (combines subject + styleSignature), "
                "styleType ('realistic' | 'artistic/animation' | 'graphic/other'), "
                "and nested styleDetails containing: generalStyle, colors, materialOrTextures, lighting, cameraDetails, atmosphere."
            )),
        ]

        contents = [types.Content(role="user", parts=parts)]

        response_schema = types.Schema(
            type=types.Type.OBJECT,
            properties={
                "subjectDescription": types.Schema(type=types.Type.STRING),
                "styleSignature": types.Schema(type=types.Type.STRING),
                "fullPrompt": types.Schema(type=types.Type.STRING),
                "styleType": types.Schema(type=types.Type.STRING),
                "styleDetails": types.Schema(
                    type=types.Type.OBJECT,
                    properties={
                        "generalStyle": types.Schema(type=types.Type.STRING),
                        "colors": types.Schema(type=types.Type.STRING),
                        "materialOrTextures": types.Schema(type=types.Type.STRING),
                        "lighting": types.Schema(type=types.Type.STRING),
                        "cameraDetails": types.Schema(type=types.Type.STRING),
                        "atmosphere": types.Schema(type=types.Type.STRING),
                    },
                    required=["generalStyle", "colors", "materialOrTextures", "lighting", "cameraDetails", "atmosphere"],
                ),
            },
            required=["subjectDescription", "styleSignature", "fullPrompt", "styleType", "styleDetails"],
        )

        try:
            response = await self.client.aio.models.generate_content(
                model=model,
                contents=contents,
                config=types.GenerateContentConfig(
                    response_mime_type="application/json",
                    response_schema=response_schema,
                ),
            )
        except Exception as e:
            logger.error("[Gemini] Image-to-prompt API request failed: %s", e)
            raise

        response_text = response.text
        if not response_text:
            raise RuntimeError("Gemini API 返回空响应")

        result = json.loads(response_text.strip())
        logger.info("[Gemini] Image-to-prompt success, styleType=%s", result.get("styleType"))
        return result
