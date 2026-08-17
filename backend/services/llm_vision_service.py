"""
本地多模态 LLM 服务

基于 Ollama HTTP API，提供图片理解 + 提示词生成能力。
供场景图 HDR、故事板生成等子功能复用。

单模型策略（12GB 显存优化）：
- qwen3-vl:8b：8B 多模态模型，同时处理图片理解和文本生成
  - MathVista 85.8，OCR/图表/截图/数学都强
  - 6.1GB 显存占用，12GB 显存充裕

注：qwen36-35b（22GB MoE）在 12GB 显存上无法稳定运行
（CUDA shared object initialization failed），已删除。

Skill 文件动态加载：
- skill 文件放在 backend/skills/*.md
- LLM 调用前实时读取，修改 skill 不用重启后端
- 不同子功能用不同 skill 文件
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
# 统一使用 qwen3-vl:8b（视觉 + 文本）
OLLAMA_VISION_MODEL = "qwen3-vl:8b"
OLLAMA_TEXT_MODEL = "qwen3-vl:8b"

# Skill 文件目录
SKILLS_DIR = Path(__file__).parent.parent / "skills"


class LLMVisionService:
    """
    本地多模态 LLM 服务（单例，双模型）

    视觉模型 qwen3-vl:8b：处理带图片的请求（图片理解 + 描述）
    文本模型 qwen36-35b：处理纯文本请求（提示词生成、文本优化）
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
        self.vision_model = OLLAMA_VISION_MODEL
        self.text_model = OLLAMA_TEXT_MODEL
        self._initialized = True
        logger.info(
            "[LLM] LLMVisionService initialized, host=%s, vision=%s, text=%s",
            self.host, self.vision_model, self.text_model,
        )

    def _load_skill(self, skill_name: str) -> str:
        """读取 skill 文件内容

        Args:
            skill_name: skill 名称（不含 .md 后缀）

        Returns:
            skill 文件内容。文件不存在时返回空字符串并记录警告。
        """
        skill_path = SKILLS_DIR / f"{skill_name}.md"
        if not skill_path.exists():
            logger.warning("[LLM] Skill 文件不存在: %s", skill_path)
            return ""
        content = skill_path.read_text(encoding="utf-8")
        logger.info("[LLM] 已加载 skill: %s (%d 字符)", skill_name, len(content))
        return content

    def _check_ollama_running(self, model_name: str = None) -> bool:
        """检查 Ollama 服务是否运行且指定模型可用

        Args:
            model_name: 检查的模型名（默认检查视觉模型）
        """
        target = model_name or self.vision_model
        try:
            resp = requests.get(f"{self.host}/api/tags", timeout=5)
            if resp.status_code == 200:
                models = resp.json().get("models", [])
                for m in models:
                    if m.get("name", "").startswith(target):
                        return True
                logger.error("[LLM] Ollama 运行中，但模型 %s 未找到", target)
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
        """同步调用 Ollama API（支持图片输入）

        自动选择模型：
        - 有图片 → 视觉模型 qwen3-vl:8b（多模态）
        - 无图片 → 文本模型 qwen36-35b（35B MoE，文本质量更好）
        """
        # 根据是否有图片选择模型
        use_model = self.vision_model if image_path else self.text_model
        if not self._check_ollama_running(use_model):
            raise RuntimeError(
                f"Ollama 服务不可用或模型 {use_model} 未加载。"
                f"请确保 Ollama 正在运行且已下载模型（ollama pull {use_model}）。"
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

        logger.info("[LLM] 调用 Ollama API, model=%s, has_image=%s, text_len=%d",
                    use_model, bool(image_path), len(user_text))

        payload = {
            "model": use_model,
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
            logger.info("[LLM] Ollama 返回, model=%s, response_len=%d, %d tokens, %.1f tok/s",
                        use_model, len(text), eval_count, rate)
        else:
            logger.info("[LLM] Ollama 返回, model=%s, response_len=%d", use_model, len(text))
        return text.strip()

    async def _call_llm(self, system_prompt: str, user_text: str, image_path: Optional[str] = None) -> str:
        """异步调用 LLM（在线程池中执行同步 HTTP 请求）"""
        return await asyncio.to_thread(
            self._call_llm_sync, system_prompt, user_text, image_path
        )

    async def analyze_scene_for_hdr(self, image_path: str, custom_instruction: str = "") -> str:
        """
        分析场景图，生成 HDR 2×2 网格提示词

        从 backend/skills/scene_hdr.md 加载 skill 作为系统提示词。
        修改 skill 文件后立即生效，无需重启后端。

        Args:
            image_path: 场景图本地路径
            custom_instruction: 用户可选的额外指令

        Returns:
            用于 Flux.2 / QwenImage Edit 的英文提示词
        """
        # 动态加载 skill 文件
        system_prompt = self._load_skill("scene_hdr")
        if not system_prompt:
            # skill 文件不存在时的 fallback
            system_prompt = (
                "你是一个专业的场景图分析专家。分析用户上传的场景图，"
                "生成一个用于 AI 图像编辑的英文提示词。"
                "提示词应描述 2×2 网格布局，4 个格子分别是不同角度的场景。"
                '开头加上 "A 2x2 grid layout of the same scene from 4 angles:"'
                "只输出英文提示词。"
            )
            logger.warning("[LLM] skill 文件加载失败，使用 fallback prompt")

        user_text = "请分析这张场景参考图，按照 skill 规则生成 HDR 4 面板场景概念图提示词。"
        if custom_instruction:
            user_text += f"\n\n用户附加要求（请融入对应模块）：{custom_instruction}"

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
        """检查 LLM 服务是否可用（Ollama 运行且视觉模型存在）

        场景图 HDR 等功能必须用视觉模型，因此只检查视觉模型。
        """
        return self._check_ollama_running(self.vision_model)
