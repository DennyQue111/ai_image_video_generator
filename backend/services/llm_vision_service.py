"""
本地多模态 LLM 服务（Qwen3.6-35B-A3B-Uncensored-HauhauCS-Aggressive）

基于 Ollama HTTP API，提供图片理解 + 提示词生成能力。
供场景图 HDR、故事板生成等子功能复用。

Ollama 自动管理模型加载和 MoE offload（GPU/CPU 分配）。
12GB 显存实测生成速度约 46 tok/s。
"""

import logging
import base64
import asyncio
import requests
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

# Ollama API 端点
OLLAMA_HOST = "http://localhost:11434"
OLLAMA_MODEL = "qwen36-35b"


class LLMVisionService:
    """
    本地多模态 LLM 服务（单例）

    使用 Ollama 运行的 Qwen3.6-35B-A3B 模型。
    Ollama 自动处理模型加载、MoE offload、GPU/CPU 分配。
    """

    _instance = None

    def __new__(cls):
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def __init__(self):
        if hasattr(self, "_initialized"):
            return
        self.host = OLLAMA_HOST
        self.model = OLLAMA_MODEL
        self._initialized = True
        logger.info("[LLM] LLMVisionService initialized, host=%s, model=%s", self.host, self.model)

    def _check_ollama_running(self) -> bool:
        """检查 Ollama 服务是否运行"""
        try:
            resp = requests.get(f"{self.host}/api/tags", timeout=5)
            if resp.status_code == 200:
                models = resp.json().get("models", [])
                for m in models:
                    if m.get("name", "").startswith(self.model):
                        return True
                logger.error("[LLM] Ollama 运行中，但模型 %s 未找到", self.model)
                return False
            logger.error("[LLM] Ollama API 返回 %d", resp.status_code)
            return False
        except requests.ConnectionError:
            logger.error("[LLM] Ollama 服务未运行，请启动 Ollama")
            return False
        except Exception as e:
            logger.error("[LLM] 检查 Ollama 失败: %s", e)
            return False

    def _image_to_base64(self, image_path: str) -> str:
        """读取图片并转为 base64（不含 data: 前缀）"""
        path = Path(image_path)
        if not path.exists():
            raise FileNotFoundError(f"图片不存在: {path}")
        data = path.read_bytes()
        return base64.b64encode(data).decode("utf-8")

    def _call_llm_sync(self, system_prompt: str, user_text: str, image_path: Optional[str] = None) -> str:
        """同步调用 Ollama API（支持图片输入）"""
        if not self._check_ollama_running():
            raise RuntimeError(
                f"Ollama 服务不可用或模型 {self.model} 未加载。"
                f"请确保 Ollama 正在运行且已创建模型。"
            )

        # 构建消息
        user_content = {"role": "user", "content": user_text}
        if image_path:
            b64 = self._image_to_base64(image_path)
            user_content["images"] = [b64]

        messages = []
        if system_prompt:
            messages.append({"role": "system", "content": system_prompt})
        messages.append(user_content)

        logger.info("[LLM] 调用 Ollama API, has_image=%s, text_len=%d",
                    bool(image_path), len(user_text))

        payload = {
            "model": self.model,
            "messages": messages,
            "stream": False,
            "think": False,  # 关闭 thinking process，直接输出结果
            "options": {
                "temperature": 0.7,
                "top_p": 0.8,
                "top_k": 20,
                "num_ctx": 16384,
            },
        }

        resp = requests.post(f"{self.host}/api/chat", json=payload, timeout=300)
        if resp.status_code != 200:
            raise RuntimeError(f"Ollama API 返回 {resp.status_code}: {resp.text}")

        data = resp.json()
        text = data.get("message", {}).get("content", "")
        # 统计信息
        eval_count = data.get("eval_count", 0)
        eval_duration = data.get("eval_duration", 0)
        if eval_duration > 0:
            rate = eval_count / (eval_duration / 1e9)
            logger.info("[LLM] Ollama 返回, response_len=%d, %d tokens, %.1f tok/s",
                        len(text), eval_count, rate)
        else:
            logger.info("[LLM] Ollama 返回, response_len=%d", len(text))
        return text.strip()

    async def _call_llm(self, system_prompt: str, user_text: str, image_path: Optional[str] = None) -> str:
        """异步调用 LLM（在线程池中执行同步 HTTP 请求）"""
        return await asyncio.to_thread(
            self._call_llm_sync, system_prompt, user_text, image_path
        )

    async def analyze_scene_for_hdr(self, image_path: str, custom_instruction: str = "") -> str:
        """
        分析场景图，生成 HDR 2×2 网格提示词

        Args:
            image_path: 场景图本地路径
            custom_instruction: 用户可选的额外指令

        Returns:
            用于 QwenImage Edit 的英文提示词
        """
        system_prompt = (
            "你是一个专业的场景图分析专家。你的任务是分析用户上传的场景图，"
            "并生成一个用于 AI 图像编辑的英文提示词。\n\n"
            "【任务要求】\n"
            "1. 分析场景图的内容：建筑风格、色调、光线、材质、氛围\n"
            "2. 去掉场景中的所有人物（negative prompt 已设置）\n"
            "3. 生成 2×2 网格布局的场景图，4 个角度分别是：\n"
            "   - 左上：站在场景中心正面视角\n"
            "   - 右上：右转 90 度视角\n"
            "   - 左下：背面视角（180 度）\n"
            "   - 右下：左转 90 度视角\n"
            "4. 4 个角度保持完全一致的色调、光线和风格\n\n"
            "【输出格式】\n"
            "只输出英文提示词，用于 QwenImage Edit。\n"
            "提示词应描述 2×2 网格布局，4 个格子分别是不同角度的场景。\n"
            '开头加上 "A 2x2 grid layout of the same scene from 4 angles:"\n'
            "不要输出任何中文或额外解释。"
        )

        user_text = "请分析这张场景图并生成 HDR 提示词。"
        if custom_instruction:
            user_text += f"\n\n用户额外要求：{custom_instruction}"

        result = await self._call_llm(system_prompt, user_text, image_path)
        logger.info("[LLM] 场景图 HDR 提示词生成完成: %s...", result[:200])
        return result

    async def analyze_image(self, image_path: str, instruction: str = "描述这张图片的内容") -> str:
        """
        通用图片分析（供后续其他子页签复用）

        Args:
            image_path: 图片本地路径
            instruction: 分析指令

        Returns:
            LLM 分析结果文本
        """
        system_prompt = "你是一个专业的图像分析专家。请根据用户指令分析图片。"
        return await self._call_llm(system_prompt, instruction, image_path)

    async def generate_prompt(self, images: list, instruction: str) -> str:
        """
        通用提示词生成（供后续其他子页签复用）

        Args:
            images: 图片本地路径列表（取第一张分析）
            instruction: 生成指令

        Returns:
            LLM 生成的提示词
        """
        system_prompt = "你是一个专业的 AI 提示词生成专家。请根据用户指令和参考图片生成提示词。"
        image_path = images[0] if images else None
        return await self._call_llm(system_prompt, instruction, image_path)

    def is_available(self) -> bool:
        """检查 LLM 服务是否可用（Ollama 运行且模型存在）"""
        return self._check_ollama_running()
