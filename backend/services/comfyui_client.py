"""
ComfyUI API Client
用于与本地 ComfyUI 服务通信，生成镜头图片
"""

import json
import logging
import uuid
import asyncio
import aiohttp
from pathlib import Path
from typing import Optional, Dict, Any, List

from dependencies import style_config

logger = logging.getLogger(__name__)


class ComfyUIClient:
    """ComfyUI API 客户端"""
    
    def __init__(
        self, 
        host: str = "127.0.0.1", 
        port: int = 8188,
        output_dir: str = "./generated_images",
        comfyui_output_dir: str = r"D:\program\comfyUI_python\output"
    ):
        self.base_url = f"http://{host}:{port}"
        self.output_dir = Path(output_dir)
        self.output_dir.mkdir(exist_ok=True)
        self.comfyui_output_dir = comfyui_output_dir
        self.client_id = str(uuid.uuid4())
        logger.info("[ComfyUI] Client initialized, base_url=%s, output_dir=%s, comfyui_output_dir=%s",
                    self.base_url, self.output_dir, self.comfyui_output_dir)
    
    async def check_connection(self) -> bool:
        """检查 ComfyUI 是否在运行"""
        try:
            async with aiohttp.ClientSession() as session:
                async with session.get(f"{self.base_url}/system_stats", timeout=5) as resp:
                    ok = resp.status == 200
                    if ok:
                        logger.info("[ComfyUI] Connection check OK (%s)", self.base_url)
                    else:
                        logger.warning("[ComfyUI] Connection check failed, status=%s", resp.status)
                    return ok
        except Exception as e:
            logger.warning("[ComfyUI] Connection check error: %s", e)
            return False
    
    async def get_models(self) -> Dict[str, list]:
        """获取可用的模型列表"""
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{self.base_url}/object_info") as resp:
                if resp.status != 200:
                    raise Exception("Failed to get model info")
                data = await resp.json()
                
                # 提取 checkpoint 列表
                checkpoints = []
                if "CheckpointLoaderSimple" in data:
                    checkpoints = data["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
                
                return {
                    "checkpoints": checkpoints
                }
    
    def _build_basic_workflow(
        self,
        prompt: str,
        negative_prompt: str = "",
        checkpoint: str = "sd_xl_base_1.0.safetensors",
        width: int = 1024,
        height: int = 1024,
        steps: int = 20,
        cfg: float = 7.0,
        seed: int = -1
    ) -> Dict[str, Any]:
        """
        构建基础的 SDXL 文生图工作流
        """
        if seed == -1:
            seed = uuid.uuid4().int % (2**32)
        
        workflow = {
            # Checkpoint Loader
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": checkpoint
                }
            },
            # CLIP Text Encode (Positive)
            "2": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": ["1", 1]
                }
            },
            # CLIP Text Encode (Negative)
            "3": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative_prompt or "low quality, blurry, distorted",
                    "clip": ["1", 1]
                }
            },
            # Empty Latent Image
            "4": {
                "class_type": "EmptyLatentImage",
                "inputs": {
                    "width": width,
                    "height": height,
                    "batch_size": 1
                }
            },
            # KSampler
            "5": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["1", 0],
                    "positive": ["2", 0],
                    "negative": ["3", 0],
                    "latent_image": ["4", 0],
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": "euler",
                    "scheduler": "normal",
                    "denoise": 1.0
                }
            },
            # VAE Decode
            "6": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["5", 0],
                    "vae": ["1", 2]
                }
            },
            # Save Image
            "7": {
                "class_type": "SaveImage",
                "inputs": {
                    "images": ["6", 0],
                    "filename_prefix": "shot"
                }
            }
        }
        
        return workflow
    
    def _build_z_image_prompt_to_image_workflow(
            self,
            prompt: str,
            unet: str = "z_image_turbo_bf16.safetensors",
            vae: str = "ae.safetensors",
            clip: str = "qwen_3_4b.safetensors",
            lora: str = "z_image\\CharacterDesign-IZT-V1.safetensors",
            width: int = 1024,
            height: int = 1024,
            steps: int = 9,
            cfg: float = 1.0,
            seed: int = -1
    ) -> Dict[str, Any]:
        """
        构建基础的Z-Image concept design 工作流
        """
        if seed == -1:
            seed = uuid.uuid4().int % (2**32)

        workflow = {
            # Empty Latent Image
            "1": {
                "class_type": "EmptySD3LatentImage",
                "inputs": {
                    "width": width,
                    "height": height,
                    "batch_size": 1
                }
            },
            # KSampler
            "2": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["3", 0],
                    "positive": ["11", 0],
                    "negative": ["5", 0],
                    "latent_image": ["1", 0],
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": "res_multistep",
                    "scheduler": "simple",
                    "denoise": 1.0
                }
            },
            # model sampling aura flow
            "3": {
                "class_type": "ModelSamplingAuraFlow",
                "inputs": {
                    "model": ["10", 0],
                    "shift": 3.0,
                }
            },
            # VAE Decode
            "4": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["2", 0],
                    "vae": ["6", 0]
                }
            },
            # conditioning zero out
            "5": {
                "class_type": "ConditioningZeroOut",
                "inputs": {
                    "conditioning": ["11", 0],
                }
            },
            # vae loader
            "6": {
                "class_type": "VAELoader",
                "inputs": {
                    "vae_name": vae
                }
            },
            # unet loader
            "7": {
                "class_type": "UNETLoader",
                "inputs": {
                    "unet_name": unet,
                    "weight_dtype": "default"
                }
            },
            # clip loader
            "8": {
                "class_type": "CLIPLoader",
                "inputs": {
                    "clip_name": clip,
                    "type": "lumina2",
                    "device": "default"
                }
            },
            # save image
            "9": {
                "class_type": "SaveImage",
                "inputs": {
                    "images": ["4", 0],
                    "filename_prefix": "z-image"
                }
            },
            # lora loader model only
            "10": {
                "class_type": "LoraLoaderModelOnly",
                "inputs": {
                    "model": ["7", 0],
                    "lora_name": lora,
                    "strength_model": 1.0,
                }
            },
            # clip text encode
            "11": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "clip": ["8", 0],
                    "text": prompt
                }
            } 

        }
        
        return workflow
    
    async def _build_qwen_image_workflow(
            self,
            prompt: str,
            width: int = 1024,
            height: int = 1024,
            steps: int = 8,
            cfg: float = 1.0,
            seed: int = -1,
    ) -> Dict[str, Any]:
        """
        加载 Qwen_Image_2512_text_image 工作流 JSON，转换为 API 格式，并注入参数。
        
        工作流节点说明：
        - Node 27 (CLIPTextEncode): prompt 文本
        - Node 25 (CR SDXL Aspect Ratio): width/height
        - Node 20 (KSampler): seed, steps, cfg
        """
        if seed == -1:
            seed = uuid.uuid4().int % (2**32)

        # 加载工作流 JSON
        workflow_path = Path(__file__).parent.parent / "config" / "Qwen_Image_2512_text_image.json"
        with open(workflow_path, "r", encoding="utf-8") as f:
            workflow_json = json.load(f)

        # 转换为 API 格式
        api_workflow = await self._convert_workflow_to_api(workflow_json)

        # 注入参数
        # Node 27: CLIPTextEncode — 注入 prompt
        if "27" in api_workflow:
            api_workflow["27"]["inputs"]["text"] = prompt

        # Node 25: CR SDXL Aspect Ratio — 注入 width/height
        if "25" in api_workflow:
            api_workflow["25"]["inputs"]["width"] = width
            api_workflow["25"]["inputs"]["height"] = height

        # Node 20: KSampler — 注入 seed, steps, cfg
        if "20" in api_workflow:
            api_workflow["20"]["inputs"]["seed"] = seed
            api_workflow["20"]["inputs"]["steps"] = steps
            api_workflow["20"]["inputs"]["cfg"] = cfg

        return api_workflow

    async def generate_image(
        self,
        prompt: str,
    ) -> Dict[str, Any]:
        """
        生成单张图片
        
        Returns:
            包含 prompt_id 和生成状态的字典
        """
        workflow = self._build_z_image_prompt_to_image_workflow(
            prompt=prompt,
        )
        
        async with aiohttp.ClientSession() as session:
            # 提交任务
            payload = {
                "prompt": workflow,
                "client_id": self.client_id
            }
            
            async with session.post(
                f"{self.base_url}/prompt",
                json=payload
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise Exception(f"Failed to queue prompt: {error_text}")
                
                result = await resp.json()
                prompt_id = result["prompt_id"]
                
                return {
                    "prompt_id": prompt_id,
                    "status": "queued"
                }
    
    async def wait_for_completion(
        self, 
        prompt_id: str, 
        timeout: int = 300,
        poll_interval: float = 1.0
    ) -> Dict[str, Any]:
        """
        等待图片生成完成
        
        Args:
            prompt_id: 任务 ID
            timeout: 超时时间（秒）
            poll_interval: 轮询间隔（秒）
        
        Returns:
            包含生成结果的字典
        """
        elapsed = 0
        logger.info("[ComfyUI] Waiting for image completion, prompt_id=%s, timeout=%ss", prompt_id, timeout)
        
        async with aiohttp.ClientSession() as session:
            while elapsed < timeout:
                async with session.get(f"{self.base_url}/history/{prompt_id}") as resp:
                    if resp.status != 200:
                        logger.warning("[ComfyUI] history request failed, status=%s", resp.status)
                        await asyncio.sleep(poll_interval)
                        elapsed += poll_interval
                        continue
                    
                    history = await resp.json()
                    
                    if prompt_id in history:
                        outputs = history[prompt_id].get("outputs", {})
                        
                        # 查找 SaveImage 节点的输出
                        for node_id, node_output in outputs.items():
                            if "images" in node_output:
                                images = node_output["images"]
                                logger.info("[ComfyUI] Image generation completed, prompt_id=%s, images=%d", prompt_id, len(images))
                                return {
                                    "status": "completed",
                                    "images": images,
                                    "prompt_id": prompt_id
                                }
                
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval
        
        logger.error("[ComfyUI] Image generation timed out after %ss", timeout)
        raise TimeoutError(f"Image generation timed out after {timeout} seconds")
    
    async def generate_and_wait(
        self,
        prompt: str,
        negative_prompt: str = "",
        checkpoint: str = "sd_xl_base_1.0.safetensors",
        width: int = 1024,
        height: int = 1024,
        steps: int = 20,
        cfg: float = 7.0,
        seed: int = -1,
        timeout: int = 300
    ) -> Dict[str, Any]:
        """
        生成图片并等待完成（便捷方法）
        """
        result = await self.generate_image(
            prompt=prompt,
            negative_prompt=negative_prompt,
            checkpoint=checkpoint,
            width=width,
            height=height,
            steps=steps,
            cfg=cfg,
            seed=seed
        )

        return await self.wait_for_completion(result["prompt_id"], timeout=timeout)

    async def generate_concept_image_and_wait(
        self,
        prompt: str,
        width: int = 1024,
        height: int = 1024,
        steps: int = 8,
        cfg: float = 1.0,
        seed: int = -1,
        timeout: int = 300,
    ) -> Dict[str, Any]:
        """
        使用 Qwen Image 2512 工作流生成概念设计图
        """
        logger.info("[ComfyUI] generate_concept_image_and_wait called, width=%d, height=%d, steps=%d, cfg=%s, seed=%s",
                    width, height, steps, cfg, seed)
        workflow = await self._build_qwen_image_workflow(
            prompt=prompt,
            width=width,
            height=height,
            steps=steps,
            cfg=cfg,
            seed=seed,
        )
        logger.info("[ComfyUI] Qwen image workflow built, nodes=%d", len(workflow))

        async with aiohttp.ClientSession() as session:
            payload = {"prompt": workflow, "client_id": self.client_id}
            async with session.post(
                f"{self.base_url}/prompt", json=payload
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    logger.error("[ComfyUI] Failed to queue Qwen image generation: %s", error_text)
                    raise Exception(f"Failed to queue Qwen image generation: {error_text}")
                result = await resp.json()
                prompt_id = result["prompt_id"]
                logger.info("[ComfyUI] Qwen image queued, prompt_id=%s", prompt_id)

        return await self.wait_for_completion(prompt_id, timeout=timeout)

    def get_image_url(self, filename: str, subfolder: str = "", type: str = "output") -> str:
        """获取生成图片的 URL"""
        return f"{self.base_url}/view?filename={filename}&subfolder={subfolder}&type={type}"

    async def upload_image(self, image_url: str) -> Dict[str, Any]:
        """
        从URL下载图片并上传到ComfyUI

        Args:
            image_url: 图片URL（可以是ComfyUI的本地URL或外部URL）

        Returns:
            包含上传后文件信息的字典
        """
        logger.info("[ComfyUI] Uploading image from %s", image_url)
        async with aiohttp.ClientSession() as session:
            # 下载图片
            async with session.get(image_url) as resp:
                if resp.status != 200:
                    logger.error("[ComfyUI] Failed to download image from %s, status=%s", image_url, resp.status)
                    raise Exception(f"Failed to download image: {image_url}")
                image_data = await resp.read()
                logger.info("[ComfyUI] Image downloaded, size=%d bytes", len(image_data))

            # 上传到ComfyUI
            form_data = aiohttp.FormData()
            form_data.add_field('image', image_data,
                              filename='reference.png',
                              content_type='image/png')

            async with session.post(
                f"{self.base_url}/upload/image",
                data=form_data
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    logger.error("[ComfyUI] Failed to upload image: %s", error_text)
                    raise Exception(f"Failed to upload image: {error_text}")

                result = await resp.json()
                logger.info("[ComfyUI] Image uploaded, filename=%s", result.get("name"))
                return result
    
    async def wait_for_video_completion(
        self, 
        prompt_id: str, 
        timeout: int = 600,
        poll_interval: float = 2.0
    ) -> Dict[str, Any]:
        """
        等待视频生成完成
        """
        elapsed = 0
        logger.info("[ComfyUI] Waiting for video completion, prompt_id=%s, timeout=%ss", prompt_id, timeout)
        
        async with aiohttp.ClientSession() as session:
            while elapsed < timeout:
                async with session.get(f"{self.base_url}/history/{prompt_id}") as resp:
                    if resp.status != 200:
                        logger.warning("[ComfyUI] history request failed, status=%s", resp.status)
                        await asyncio.sleep(poll_interval)
                        elapsed += poll_interval
                        continue
                    
                    history = await resp.json()
                    
                    if prompt_id in history:
                        outputs = history[prompt_id].get("outputs", {})
                        
                        # 查找 VHS_VideoCombine 节点的输出
                        for node_id, node_output in outputs.items():
                            if "gifs" in node_output:
                                gifs = node_output["gifs"]
                                logger.info("[ComfyUI] Video generation completed, prompt_id=%s, videos=%d", prompt_id, len(gifs))
                                return {
                                    "status": "completed",
                                    "videos": gifs,
                                    "prompt_id": prompt_id
                                }
                
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval
        
        logger.error("[ComfyUI] Video generation timed out after %ss", timeout)
        raise TimeoutError(f"Video generation timed out after {timeout} seconds")
        
    
    def get_video_url(self, filename: str, subfolder: str = "", type: str = "output") -> str:
        """获取生成视频的 URL"""
        return f"{self.base_url}/view?filename={filename}&subfolder={subfolder}&type={type}"

    async def generate_video_with_reference(
        self,
        prompt: str,
        reference_image_url: str,
        negative_prompt: str = "",
        checkpoint: str = "sd_xl_base_1.0.safetensors",
        motion_module: str = "mm_sdxl_v10_beta.ckpt",
        width: int = 1024,
        height: int = 576,
        frames: int = 16,
        steps: int = 20,
        cfg: float = 7.0,
        seed: int = -1,
        fps: int = 8,
        ipadapter_weight: float = 0.8
    ) -> Dict[str, Any]:
        """
        使用参考图生成视频（保持角色/场景一致性）(16:9, 1024x576)

        Args:
            prompt: 文字提示词
            reference_image_url: 参考图片URL
            其他参数同generate_video
        """
        # 1. 上传参考图片到ComfyUI
        upload_result = await self.upload_image(reference_image_url)
        reference_filename = upload_result.get("name", "reference.png")

        # 2. 构建带IPAdapter的工作流
        workflow = self._build_animatediff_with_ipadapter_workflow(
            prompt=prompt,
            reference_image=reference_filename,
            negative_prompt=negative_prompt,
            checkpoint=checkpoint,
            motion_module=motion_module,
            width=width,
            height=height,
            frames=frames,
            steps=steps,
            cfg=cfg,
            seed=seed,
            fps=fps,
            ipadapter_weight=ipadapter_weight
        )

        # 3. 提交任务
        async with aiohttp.ClientSession() as session:
            payload = {
                "prompt": workflow,
                "client_id": self.client_id
            }

            async with session.post(
                f"{self.base_url}/prompt",
                json=payload
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise Exception(f"Failed to queue video prompt with IPAdapter: {error_text}")

                result = await resp.json()
                prompt_id = result["prompt_id"]

                return {
                    "prompt_id": prompt_id,
                    "status": "queued",
                    "reference_image": reference_filename
                }

    async def generate_video_with_reference_and_wait(
        self,
        prompt: str,
        reference_image_url: str,
        negative_prompt: str = "",
        checkpoint: str = "sd_xl_base_1.0.safetensors",
        motion_module: str = "mm_sdxl_v10_beta.ckpt",
        width: int = 1024,
        height: int = 576,
        frames: int = 16,
        steps: int = 20,
        cfg: float = 7.0,
        seed: int = -1,
        fps: int = 8,
        ipadapter_weight: float = 0.8,
        timeout: int = 600
    ) -> Dict[str, Any]:
        """
        使用参考图生成视频并等待完成 (16:9, 1024x576)
        """
        result = await self.generate_video_with_reference(
            prompt=prompt,
            reference_image_url=reference_image_url,
            negative_prompt=negative_prompt,
            checkpoint=checkpoint,
            motion_module=motion_module,
            width=width,
            height=height,
            frames=frames,
            steps=steps,
            cfg=cfg,
            seed=seed,
            fps=fps,
            ipadapter_weight=ipadapter_weight
        )

        return await self.wait_for_video_completion(result["prompt_id"], timeout=timeout)

    # ============== Wan2.1 视频生成 (高质量) ==============

    def _build_wan21_i2v_workflow(
        self,
        prompt: str,
        reference_image: str,
        negative_prompt: str = "",
        width: int = 640,
        height: int = 384,
        num_frames: int = 33,
        steps: int = 20,
        cfg: float = 6.0,
        seed: int = -1,
        fps: int = 16,
        model: str = "Wan2_1-I2V-14B-480P_fp8_e4m3fn.safetensors",
        vae: str = "Wan2_1_VAE_bf16.safetensors",
        text_encoder: str = "umt5-xxl-enc-fp8_e4m3fn.safetensors"
    ) -> Dict[str, Any]:
        """
        构建 Wan2.1 Image-to-Video 工作流
        使用参考图生成高质量视频
        """
        if seed == -1:
            seed = uuid.uuid4().int % (2**32)

        workflow = {
            # 1. 加载 Wan2.1 模型
            "1": {
                "class_type": "WanVideoModelLoader",
                "inputs": {
                    "model": model,
                    "base_precision": "bf16",
                    "quantization": "disabled",
                    "load_device": "offload_device"
                }
            },
            # 2. 加载 VAE
            "2": {
                "class_type": "WanVideoVAELoader",
                "inputs": {
                    "model_name": vae,
                    "precision": "bf16"
                }
            },
            # 3. 加载 T5 文本编码器
            "3": {
                "class_type": "LoadWanVideoT5TextEncoder",
                "inputs": {
                    "model_name": text_encoder,
                    "precision": "bf16"
                }
            },
            # 4. 文本编码
            "4": {
                "class_type": "WanVideoTextEncode",
                "inputs": {
                    "positive_prompt": prompt,
                    "negative_prompt": negative_prompt or "low quality, blurry, distorted, ugly, bad anatomy",
                    "t5": ["3", 0],
                    "force_offload": True
                }
            },
            # 5. 加载参考图片
            "5": {
                "class_type": "LoadImage",
                "inputs": {
                    "image": reference_image
                }
            },
            # 6. 图像编码 (I2V)
            "6": {
                "class_type": "WanVideoImageToVideoEncode",
                "inputs": {
                    "width": width,
                    "height": height,
                    "num_frames": num_frames,
                    "noise_aug_strength": 0.0,
                    "start_latent_strength": 1.0,
                    "end_latent_strength": 1.0,
                    "force_offload": True,
                    "vae": ["2", 0],
                    "start_image": ["5", 0]
                }
            },
            # 7. 采样器
            "7": {
                "class_type": "WanVideoSampler",
                "inputs": {
                    "model": ["1", 0],
                    "image_embeds": ["6", 0],
                    "steps": steps,
                    "cfg": cfg,
                    "shift": 5.0,
                    "seed": seed,
                    "force_offload": True,
                    "scheduler": "unipc",
                    "riflex_freq_index": 0,
                    "text_embeds": ["4", 0]
                }
            },
            # 8. VAE 解码
            "8": {
                "class_type": "WanVideoDecode",
                "inputs": {
                    "vae": ["2", 0],
                    "samples": ["7", 0],
                    "enable_vae_tiling": False,
                    "tile_x": 272,
                    "tile_y": 272,
                    "tile_stride_x": 144,
                    "tile_stride_y": 128
                }
            },
            # 9. 保存视频
            "9": {
                "class_type": "VHS_VideoCombine",
                "inputs": {
                    "images": ["8", 0],
                    "frame_rate": fps,
                    "loop_count": 0,
                    "filename_prefix": "wan21_i2v",
                    "format": "video/h264-mp4",
                    "pingpong": False,
                    "save_output": True
                }
            }
        }

        return workflow

    async def generate_video_wan21(
        self,
        prompt: str,
        reference_image_url: str,
        negative_prompt: str = "",
        width: int = 640,
        height: int = 384,
        num_frames: int = 33,
        steps: int = 20,
        cfg: float = 6.0,
        seed: int = -1,
        fps: int = 16
    ) -> Dict[str, Any]:
        """
        使用 Wan2.1 生成高质量视频 (Image-to-Video)
        """
        # 1. 上传参考图片到 ComfyUI
        upload_result = await self.upload_image(reference_image_url)
        reference_filename = upload_result.get("name", "reference.png")

        workflow = self._build_wan21_i2v_workflow(
            prompt=prompt,
            reference_image=reference_filename,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            num_frames=num_frames,
            steps=steps,
            cfg=cfg,
            seed=seed,
            fps=fps
        )

        async with aiohttp.ClientSession() as session:
            payload = {
                "prompt": workflow,
                "client_id": self.client_id
            }

            async with session.post(
                f"{self.base_url}/prompt",
                json=payload
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise Exception(f"Failed to queue Wan2.1 I2V prompt: {error_text}")

                result = await resp.json()
                prompt_id = result["prompt_id"]

                return {
                    "prompt_id": prompt_id,
                    "status": "queued"
                }

    async def generate_video_wan21_and_wait(
        self,
        prompt: str,
        reference_image_url: str,
        negative_prompt: str = "",
        width: int = 640,
        height: int = 384,
        num_frames: int = 33,
        steps: int = 20,
        cfg: float = 6.0,
        seed: int = -1,
        fps: int = 16,
        timeout: int = 1200
    ) -> Dict[str, Any]:
        """
        使用 Wan2.1 生成视频并等待完成
        Wan2.1 生成时间较长，默认超时时间设为 20 分钟
        """
        result = await self.generate_video_wan21(
            prompt=prompt,
            reference_image_url=reference_image_url,
            negative_prompt=negative_prompt,
            width=width,
            height=height,
            num_frames=num_frames,
            steps=steps,
            cfg=cfg,
            seed=seed,
            fps=fps
        )

        return await self.wait_for_video_completion(result["prompt_id"], timeout=timeout)

    # ============== AnimateDiff-Lightning 动漫视频生成 (快速) ==============

    def _build_animatediff_lightning_workflow(
        self,
        prompt: str,
        negative_prompt: str = "",
        checkpoint: str = "AnythingXL_v50.safetensors",
        motion_module: str = "animatediff_lightning_8step_comfyui.safetensors",
        width: int = 512,
        height: int = 512,
        frames: int = 16,
        steps: int = 8,
        cfg: float = 1.5,
        seed: int = -1,
        fps: int = 8
    ) -> Dict[str, Any]:
        """
        构建 AnimateDiff-Lightning 动漫视频工作流
        使用 Lightning 模型实现快速生成（8步即可）
        """
        if seed == -1:
            seed = uuid.uuid4().int % (2**32)

        workflow = {
            # 1. Checkpoint Loader
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": checkpoint
                }
            },
            # 2. Load AnimateDiff Lightning Model
            "2": {
                "class_type": "ADE_LoadAnimateDiffModel",
                "inputs": {
                    "model_name": motion_module
                }
            },
            # 3. AnimateDiff Context Options
            "3": {
                "class_type": "ADE_AnimateDiffUniformContextOptions",
                "inputs": {
                    "context_length": 16,
                    "context_stride": 1,
                    "context_overlap": 4,
                    "closed_loop": False,
                    "fuse_method": "flat",
                    "use_on_equal_length": False
                }
            },
            # 4. Apply AnimateDiff Model
            "4": {
                "class_type": "ADE_ApplyAnimateDiffModelSimple",
                "inputs": {
                    "motion_model": ["2", 0],
                    "motion_scale": 1.0
                }
            },
            # 5. Use Evolved Sampling
            "5": {
                "class_type": "ADE_UseEvolvedSampling",
                "inputs": {
                    "model": ["1", 0],
                    "m_models": ["4", 0],
                    "beta_schedule": "lcm >> sqrt_linear"
                }
            },
            # 6. CLIP Text Encode (Positive)
            "6": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": ["1", 1]
                }
            },
            # 7. CLIP Text Encode (Negative)
            "7": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative_prompt or "low quality, blurry, distorted, static, ugly, bad anatomy",
                    "clip": ["1", 1]
                }
            },
            # 8. Empty Latent Image
            "8": {
                "class_type": "EmptyLatentImage",
                "inputs": {
                    "width": width,
                    "height": height,
                    "batch_size": frames
                }
            },
            # 9. KSampler (使用 sgm_uniform 调度器配合 Lightning)
            "9": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["5", 0],
                    "positive": ["6", 0],
                    "negative": ["7", 0],
                    "latent_image": ["8", 0],
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": "euler",
                    "scheduler": "sgm_uniform",
                    "denoise": 1.0
                }
            },
            # 10. VAE Decode
            "10": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["9", 0],
                    "vae": ["1", 2]
                }
            },
            # 11. RIFE VFI (Video Frame Interpolation) - 3倍插帧
            "11": {
                "class_type": "RIFE VFI",
                "inputs": {
                    "frames": ["10", 0],
                    "ckpt_name": "rife47.pth",
                    "clear_cache_after_n_frames": 10,
                    "multiplier": 3,  # 16帧 -> 48帧
                    "fast_mode": True,
                    "ensemble": False,
                    "scale_factor": 1.0
                }
            },
            # 12. Video Combine (使用插帧后的帧，保持原FPS使视频变长)
            "12": {
                "class_type": "VHS_VideoCombine",
                "inputs": {
                    "images": ["11", 0],
                    "frame_rate": fps,  # 保持原FPS，48帧/6fps = 8秒视频
                    "loop_count": 0,
                    "filename_prefix": "anime_video",
                    "format": "video/h264-mp4",
                    "pingpong": False,
                    "save_output": True
                }
            }
        }

        return workflow

    def _build_animatediff_lightning_i2v_workflow(
        self,
        prompt: str,
        reference_image: str,
        negative_prompt: str = "",
        checkpoint: str = "AnythingXL_v50.safetensors",
        motion_module: str = "animatediff_lightning_8step_comfyui.safetensors",
        width: int = 512,
        height: int = 512,
        frames: int = 16,
        steps: int = 8,
        cfg: float = 1.5,
        seed: int = -1,
        fps: int = 8,
        ipadapter_weight: float = 0.8
    ) -> Dict[str, Any]:
        """
        构建带参考图的 AnimateDiff-Lightning 动漫视频工作流 (Image-to-Video)
        """
        if seed == -1:
            seed = uuid.uuid4().int % (2**32)

        workflow = {
            # 1. Checkpoint Loader (SD1.5 动漫模型)
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": checkpoint
                }
            },
            # 2. Load Reference Image
            "2": {
                "class_type": "LoadImage",
                "inputs": {
                    "image": reference_image
                }
            },
            # 3. IPAdapter Unified Loader (自动加载 SD1.5 兼容的 IPAdapter)
            "3": {
                "class_type": "IPAdapterUnifiedLoader",
                "inputs": {
                    "model": ["1", 0],
                    "preset": "PLUS (high strength)"
                }
            },
            # 4. Apply IPAdapter
            "4": {
                "class_type": "IPAdapter",
                "inputs": {
                    "model": ["3", 0],
                    "ipadapter": ["3", 1],
                    "image": ["2", 0],
                    "weight": ipadapter_weight,
                    "start_at": 0.0,
                    "end_at": 1.0,
                    "weight_type": "standard"
                }
            },
            # 5. Load AnimateDiff Lightning Model
            "5": {
                "class_type": "ADE_LoadAnimateDiffModel",
                "inputs": {
                    "model_name": motion_module
                }
            },
            # 6. AnimateDiff Context Options
            "6": {
                "class_type": "ADE_AnimateDiffUniformContextOptions",
                "inputs": {
                    "context_length": 16,
                    "context_stride": 1,
                    "context_overlap": 4,
                    "closed_loop": False,
                    "fuse_method": "flat",
                    "use_on_equal_length": False
                }
            },
            # 7. Apply AnimateDiff Model
            "7": {
                "class_type": "ADE_ApplyAnimateDiffModelSimple",
                "inputs": {
                    "motion_model": ["5", 0],
                    "motion_scale": 1.0
                }
            },
            # 8. Use Evolved Sampling (使用 IPAdapter 处理后的模型)
            "8": {
                "class_type": "ADE_UseEvolvedSampling",
                "inputs": {
                    "model": ["4", 0],
                    "m_models": ["7", 0],
                    "beta_schedule": "lcm >> sqrt_linear"
                }
            },
            # 9. CLIP Text Encode (Positive)
            "9": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": ["1", 1]
                }
            },
            # 10. CLIP Text Encode (Negative)
            "10": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative_prompt or "low quality, blurry, distorted, static, ugly, bad anatomy",
                    "clip": ["1", 1]
                }
            },
            # 11. Empty Latent Image
            "11": {
                "class_type": "EmptyLatentImage",
                "inputs": {
                    "width": width,
                    "height": height,
                    "batch_size": frames
                }
            },
            # 12. KSampler
            "12": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["8", 0],
                    "positive": ["9", 0],
                    "negative": ["10", 0],
                    "latent_image": ["11", 0],
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": "euler",
                    "scheduler": "sgm_uniform",
                    "denoise": 1.0
                }
            },
            # 13. VAE Decode
            "13": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["12", 0],
                    "vae": ["1", 2]
                }
            },
            # 14. RIFE VFI (Video Frame Interpolation) - 3倍插帧
            "14": {
                "class_type": "RIFE VFI",
                "inputs": {
                    "frames": ["13", 0],
                    "ckpt_name": "rife47.pth",
                    "clear_cache_after_n_frames": 10,
                    "multiplier": 3,  # 16帧 -> 48帧
                    "fast_mode": True,
                    "ensemble": False,
                    "scale_factor": 1.0
                }
            },
            # 15. Video Combine (使用插帧后的帧)
            "15": {
                "class_type": "VHS_VideoCombine",
                "inputs": {
                    "images": ["14", 0],
                    "frame_rate": fps,
                    "loop_count": 0,
                    "filename_prefix": "anime_i2v",
                    "format": "video/h264-mp4",
                    "pingpong": False,
                    "save_output": True
                }
            }
        }

        return workflow

    async def generate_anime_video(
        self,
        prompt: str,
        negative_prompt: str = "",
        checkpoint: str = "AnythingXL_v50.safetensors",
        width: int = 512,
        height: int = 512,
        frames: int = 16,
        steps: int = 8,
        cfg: float = 1.5,
        seed: int = -1,
        fps: int = 8
    ) -> Dict[str, Any]:
        """
        生成动漫风格视频 (Text-to-Video)
        使用 AnimateDiff-Lightning 快速生成
        """
        workflow = self._build_animatediff_lightning_workflow(
            prompt=prompt,
            negative_prompt=negative_prompt,
            checkpoint=checkpoint,
            width=width,
            height=height,
            frames=frames,
            steps=steps,
            cfg=cfg,
            seed=seed,
            fps=fps
        )

        async with aiohttp.ClientSession() as session:
            payload = {
                "prompt": workflow,
                "client_id": self.client_id
            }

            async with session.post(
                f"{self.base_url}/prompt",
                json=payload
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise Exception(f"Failed to queue anime video prompt: {error_text}")

                result = await resp.json()
                prompt_id = result["prompt_id"]

                return {
                    "prompt_id": prompt_id,
                    "status": "queued"
                }

    async def generate_anime_video_and_wait(
        self,
        prompt: str,
        negative_prompt: str = "",
        checkpoint: str = "AnythingXL_v50.safetensors",
        width: int = 512,
        height: int = 512,
        frames: int = 16,
        steps: int = 8,
        cfg: float = 1.5,
        seed: int = -1,
        fps: int = 8,
        timeout: int = 120
    ) -> Dict[str, Any]:
        """
        生成动漫视频并等待完成
        Lightning 模型生成速度快，默认 2 分钟超时
        """
        result = await self.generate_anime_video(
            prompt=prompt,
            negative_prompt=negative_prompt,
            checkpoint=checkpoint,
            width=width,
            height=height,
            frames=frames,
            steps=steps,
            cfg=cfg,
            seed=seed,
            fps=fps
        )

        return await self.wait_for_video_completion(result["prompt_id"], timeout=timeout)

    async def generate_anime_video_with_reference(
        self,
        prompt: str,
        reference_image_url: str,
        negative_prompt: str = "",
        checkpoint: str = "AnythingXL_v50.safetensors",
        width: int = 512,
        height: int = 512,
        frames: int = 16,
        steps: int = 8,
        cfg: float = 1.5,
        seed: int = -1,
        fps: int = 8,
        ipadapter_weight: float = 0.8
    ) -> Dict[str, Any]:
        """
        使用参考图生成动漫视频 (Image-to-Video)
        """
        # 上传参考图片
        upload_result = await self.upload_image(reference_image_url)
        reference_filename = upload_result.get("name", "reference.png")

        workflow = self._build_animatediff_lightning_i2v_workflow(
            prompt=prompt,
            reference_image=reference_filename,
            negative_prompt=negative_prompt,
            checkpoint=checkpoint,
            width=width,
            height=height,
            frames=frames,
            steps=steps,
            cfg=cfg,
            seed=seed,
            fps=fps,
            ipadapter_weight=ipadapter_weight
        )

        async with aiohttp.ClientSession() as session:
            payload = {
                "prompt": workflow,
                "client_id": self.client_id
            }

            async with session.post(
                f"{self.base_url}/prompt",
                json=payload
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise Exception(f"Failed to queue anime I2V prompt: {error_text}")

                result = await resp.json()
                prompt_id = result["prompt_id"]

                return {
                    "prompt_id": prompt_id,
                    "status": "queued",
                    "reference_image": reference_filename
                }

    async def generate_anime_video_with_reference_and_wait(
        self,
        prompt: str,
        reference_image_url: str,
        negative_prompt: str = "",
        checkpoint: str = "AnythingXL_v50.safetensors",
        width: int = 512,
        height: int = 512,
        frames: int = 16,
        steps: int = 8,
        cfg: float = 1.5,
        seed: int = -1,
        fps: int = 8,
        ipadapter_weight: float = 0.8,
        timeout: int = 120
    ) -> Dict[str, Any]:
        """
        使用参考图生成动漫视频并等待完成
        """
        result = await self.generate_anime_video_with_reference(
            prompt=prompt,
            reference_image_url=reference_image_url,
            negative_prompt=negative_prompt,
            checkpoint=checkpoint,
            width=width,
            height=height,
            frames=frames,
            steps=steps,
            cfg=cfg,
            seed=seed,
            fps=fps,
            ipadapter_weight=ipadapter_weight
        )

        return await self.wait_for_video_completion(result["prompt_id"], timeout=timeout)

    def _build_animatediff_multi_reference_workflow(
        self,
        prompt: str,
        reference_images: List[Dict[str, Any]],  # [{"filename": "...", "weight": 0.5, "type": "character/location"}]
        negative_prompt: str = "",
        checkpoint: str = "AnythingXL_v50.safetensors",
        motion_module: str = "animatediff_lightning_8step_comfyui.safetensors",
        width: int = 512,
        height: int = 512,
        frames: int = 16,
        steps: int = 8,
        cfg: float = 1.5,
        seed: int = -1,
        fps: int = 8
    ) -> Dict[str, Any]:
        """
        构建支持多参考图的 AnimateDiff-Lightning 工作流
        动态生成多个串联的 IPAdapter 节点
        """
        if seed == -1:
            seed = uuid.uuid4().int % (2**32)

        # 动态节点 ID 分配
        # 1: Checkpoint Loader
        # 2: IPAdapter Unified Loader
        # 3+: LoadImage 和 IPAdapter 节点对（每个参考图2个节点）
        # 然后: AnimateDiff 相关节点, CLIP, KSampler, VAE, RIFE, VideoCombine

        workflow = {
            # 1. Checkpoint Loader
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": checkpoint
                }
            },
            # 2. IPAdapter Unified Loader (只需要加载一次)
            "2": {
                "class_type": "IPAdapterUnifiedLoader",
                "inputs": {
                    "model": ["1", 0],
                    "preset": "PLUS (high strength)"
                }
            }
        }

        # 方案A：多个 IPAdapter 串联，每个图片使用独立权重
        # 每个参考图有自己的 LoadImage + IPAdapter 节点对

        current_node_id = 3
        # 初始模型来源是 IPAdapterUnifiedLoader
        current_model_source = ["2", 0]
        current_ipadapter_source = ["2", 1]

        # 为每个参考图创建 LoadImage + IPAdapter 节点对
        for i, ref in enumerate(reference_images):
            # LoadImage 节点
            load_image_id = str(current_node_id)
            workflow[load_image_id] = {
                "class_type": "LoadImage",
                "inputs": {
                    "image": ref["filename"]
                }
            }
            current_node_id += 1

            # IPAdapter 节点 - 使用该图片的独立权重
            ipadapter_id = str(current_node_id)
            workflow[ipadapter_id] = {
                "class_type": "IPAdapter",
                "inputs": {
                    "model": current_model_source,
                    "ipadapter": current_ipadapter_source,
                    "image": [load_image_id, 0],
                    "weight": ref["weight"],  # 使用每个图片独立的权重
                    "weight_type": "standard",
                    "start_at": 0.0,
                    "end_at": 1.0,
                    "combine_embeds": "concat"  # 使用 concat 模式避免覆盖
                }
            }
            current_node_id += 1

            # 更新模型来源为当前 IPAdapter 的输出，形成串联
            current_model_source = [ipadapter_id, 0]

        # 继续添加后续节点，使用动态 ID
        animatediff_load_id = str(current_node_id)
        context_options_id = str(current_node_id + 1)
        apply_animatediff_id = str(current_node_id + 2)
        evolved_sampling_id = str(current_node_id + 3)
        clip_positive_id = str(current_node_id + 4)
        clip_negative_id = str(current_node_id + 5)
        empty_latent_id = str(current_node_id + 6)
        ksampler_id = str(current_node_id + 7)
        vae_decode_id = str(current_node_id + 8)
        rife_id = str(current_node_id + 9)
        video_combine_id = str(current_node_id + 10)

        # AnimateDiff 相关节点
        workflow[animatediff_load_id] = {
            "class_type": "ADE_LoadAnimateDiffModel",
            "inputs": {
                "model_name": motion_module
            }
        }

        workflow[context_options_id] = {
            "class_type": "ADE_AnimateDiffUniformContextOptions",
            "inputs": {
                "context_length": 16,
                "context_stride": 1,
                "context_overlap": 4,
                "closed_loop": False,
                "fuse_method": "flat",
                "use_on_equal_length": False
            }
        }

        workflow[apply_animatediff_id] = {
            "class_type": "ADE_ApplyAnimateDiffModelSimple",
            "inputs": {
                "motion_model": [animatediff_load_id, 0],
                "motion_scale": 1.0
            }
        }

        workflow[evolved_sampling_id] = {
            "class_type": "ADE_UseEvolvedSampling",
            "inputs": {
                "model": current_model_source,  # 来自最后一个 IPAdapter
                "m_models": [apply_animatediff_id, 0],
                "beta_schedule": "lcm >> sqrt_linear"
            }
        }

        # 动漫风格提示词
        anime_prompt = f"anime style, japanese animation, cel shading, vibrant colors, {prompt}"
        anime_negative = f"realistic, photorealistic, 3d render, {negative_prompt}" if negative_prompt else "realistic, photorealistic, 3d render"

        workflow[clip_positive_id] = {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": anime_prompt,
                "clip": ["1", 1]
            }
        }

        workflow[clip_negative_id] = {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": anime_negative,
                "clip": ["1", 1]
            }
        }

        workflow[empty_latent_id] = {
            "class_type": "EmptyLatentImage",
            "inputs": {
                "width": width,
                "height": height,
                "batch_size": frames
            }
        }

        workflow[ksampler_id] = {
            "class_type": "KSampler",
            "inputs": {
                "model": [evolved_sampling_id, 0],
                "positive": [clip_positive_id, 0],
                "negative": [clip_negative_id, 0],
                "latent_image": [empty_latent_id, 0],
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": "euler",
                "scheduler": "sgm_uniform",
                "denoise": 1.0
            }
        }

        workflow[vae_decode_id] = {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": [ksampler_id, 0],
                "vae": ["1", 2]
            }
        }

        workflow[rife_id] = {
            "class_type": "RIFE VFI",
            "inputs": {
                "frames": [vae_decode_id, 0],
                "ckpt_name": "rife47.pth",
                "clear_cache_after_n_frames": 10,
                "multiplier": 3,
                "fast_mode": True,
                "ensemble": False,
                "scale_factor": 1.0
            }
        }

        workflow[video_combine_id] = {
            "class_type": "VHS_VideoCombine",
            "inputs": {
                "images": [rife_id, 0],
                "frame_rate": fps,
                "loop_count": 0,
                "filename_prefix": "anime_multi_ref",
                "format": "video/h264-mp4",
                "pingpong": False,
                "save_output": True
            }
        }

        return workflow

    async def generate_anime_video_multi_reference_and_wait(
        self,
        prompt: str,
        character_images: List[str],
        location_image: Optional[str] = None,
        negative_prompt: str = "",
        checkpoint: str = "AnythingXL_v50.safetensors",
        width: int = 512,
        height: int = 512,
        frames: int = 16,
        steps: int = 8,
        cfg: float = 1.5,
        seed: int = -1,
        fps: int = 6,
        character_weight: float = 0.6,
        location_weight: float = 0.3,
        timeout: int = 180
    ) -> Dict[str, Any]:
        """
        使用多个参考图生成动漫视频并等待完成

        Args:
            character_images: 角色参考图 URL 列表
            location_image: 场景参考图 URL
            character_weight: 每个角色图的权重
            location_weight: 场景图的权重
        """
        # 上传所有参考图并构建列表
        reference_images = []

        # 上传角色图
        for img_url in character_images:
            upload_result = await self.upload_image(img_url)
            reference_images.append({
                "filename": upload_result.get("name", "reference.png"),
                "weight": character_weight,
                "type": "character"
            })

        # 上传场景图
        if location_image:
            upload_result = await self.upload_image(location_image)
            reference_images.append({
                "filename": upload_result.get("name", "reference.png"),
                "weight": location_weight,
                "type": "location"
            })

        print(f"[Multi-Ref] Building workflow with {len(reference_images)} reference images:")
        for i, ref in enumerate(reference_images):
            print(f"  [{i+1}] {ref['type']}: {ref['filename']} (weight={ref['weight']})")

        # 构建工作流
        workflow = self._build_animatediff_multi_reference_workflow(
            prompt=prompt,
            reference_images=reference_images,
            negative_prompt=negative_prompt,
            checkpoint=checkpoint,
            width=width,
            height=height,
            frames=frames,
            steps=steps,
            cfg=cfg,
            seed=seed,
            fps=fps
        )

        # 提交任务
        async with aiohttp.ClientSession() as session:
            payload = {
                "prompt": workflow,
                "client_id": self.client_id
            }

            async with session.post(
                f"{self.base_url}/prompt",
                json=payload
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise Exception(f"Failed to queue multi-reference anime video: {error_text}")

                result = await resp.json()
                prompt_id = result["prompt_id"]

        return await self.wait_for_video_completion(prompt_id, timeout=timeout)

    # ==================== 关键帧生成方法 ====================
    
    def _build_keyframe_with_ipadapter_workflow(
        self,
        prompt: str,
        character_images: List[str] = None,
        location_image: str = None,
        negative_prompt: str = "",
        checkpoint: str = "AnythingXL_v50.safetensors",
        width: int = 576,
        height: int = 1024,
        steps: int = 25,
        cfg: float = 7.0,
        seed: int = -1,
        character_weight: float = 0.7,
        location_weight: float = 0.5
    ) -> Dict[str, Any]:
        """
        构建带多参考图的关键帧图片生成工作流
        使用 IPAdapter 保持角色和场景一致性
        """
        if seed == -1:
            seed = uuid.uuid4().int % (2**32)
        
        workflow = {
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": checkpoint
                }
            },
            "2": {
                "class_type": "IPAdapterUnifiedLoader",
                "inputs": {
                    "model": ["1", 0],
                    "preset": "PLUS (high strength)"
                }
            }
        }
        
        current_node_id = 3
        current_model_source = ["2", 0]
        current_ipadapter_source = ["2", 1]
        
        # 添加角色参考图
        if character_images:
            for char_img in character_images:
                load_id = str(current_node_id)
                workflow[load_id] = {
                    "class_type": "LoadImage",
                    "inputs": {"image": char_img}
                }
                current_node_id += 1
                
                ipa_id = str(current_node_id)
                workflow[ipa_id] = {
                    "class_type": "IPAdapter",
                    "inputs": {
                        "model": current_model_source,
                        "ipadapter": current_ipadapter_source,
                        "image": [load_id, 0],
                        "weight": character_weight,
                        "weight_type": "standard",
                        "start_at": 0.0,
                        "end_at": 1.0,
                        "combine_embeds": "concat"
                    }
                }
                current_node_id += 1
                current_model_source = [ipa_id, 0]
        
        # 添加场景参考图
        if location_image:
            load_id = str(current_node_id)
            workflow[load_id] = {
                "class_type": "LoadImage",
                "inputs": {"image": location_image}
            }
            current_node_id += 1
            
            ipa_id = str(current_node_id)
            workflow[ipa_id] = {
                "class_type": "IPAdapter",
                "inputs": {
                    "model": current_model_source,
                    "ipadapter": current_ipadapter_source,
                    "image": [load_id, 0],
                    "weight": location_weight,
                    "weight_type": "standard",
                    "start_at": 0.0,
                    "end_at": 1.0,
                    "combine_embeds": "concat"
                }
            }
            current_node_id += 1
            current_model_source = [ipa_id, 0]
        
        # CLIP 编码
        clip_pos_id = str(current_node_id)
        workflow[clip_pos_id] = {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": prompt,
                "clip": ["1", 1]
            }
        }
        current_node_id += 1
        
        clip_neg_id = str(current_node_id)
        workflow[clip_neg_id] = {
            "class_type": "CLIPTextEncode",
            "inputs": {
                "text": negative_prompt or "low quality, blurry, distorted, ugly, bad anatomy",
                "clip": ["1", 1]
            }
        }
        current_node_id += 1
        
        # Empty Latent
        latent_id = str(current_node_id)
        workflow[latent_id] = {
            "class_type": "EmptyLatentImage",
            "inputs": {
                "width": width,
                "height": height,
                "batch_size": 1
            }
        }
        current_node_id += 1
        
        # KSampler
        sampler_id = str(current_node_id)
        workflow[sampler_id] = {
            "class_type": "KSampler",
            "inputs": {
                "model": current_model_source,
                "positive": [clip_pos_id, 0],
                "negative": [clip_neg_id, 0],
                "latent_image": [latent_id, 0],
                "seed": seed,
                "steps": steps,
                "cfg": cfg,
                "sampler_name": "euler",
                "scheduler": "normal",
                "denoise": 1.0
            }
        }
        current_node_id += 1
        
        # VAE Decode
        vae_id = str(current_node_id)
        workflow[vae_id] = {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": [sampler_id, 0],
                "vae": ["1", 2]
            }
        }
        current_node_id += 1
        
        # Save Image
        save_id = str(current_node_id)
        workflow[save_id] = {
            "class_type": "SaveImage",
            "inputs": {
                "images": [vae_id, 0],
                "filename_prefix": "keyframe"
            }
        }
        
        return workflow

    async def generate_keyframe_image(
        self,
        prompt: str,
        character_image_urls: List[str] = None,
        location_image_url: str = None,
        negative_prompt: str = "",
        checkpoint: str = "AnythingXL_v50.safetensors",
        width: int = 576,
        height: int = 1024,
        steps: int = 25,
        cfg: float = 7.0,
        seed: int = -1,
        character_weight: float = 0.7,
        location_weight: float = 0.5,
        timeout: int = 120
    ) -> Dict[str, Any]:
        """
        生成关键帧图片（带角色和场景参考图）
        
        Args:
            prompt: 图片描述
            character_image_urls: 角色参考图 URL 列表
            location_image_url: 场景参考图 URL
            
        Returns:
            生成的图片信息
        """
        # 上传参考图
        character_filenames = []
        if character_image_urls:
            for url in character_image_urls:
                result = await self.upload_image(url)
                character_filenames.append(result.get("name", "reference.png"))
        
        location_filename = None
        if location_image_url:
            result = await self.upload_image(location_image_url)
            location_filename = result.get("name", "reference.png")
        
        # 构建工作流
        workflow = self._build_keyframe_with_ipadapter_workflow(
            prompt=prompt,
            character_images=character_filenames,
            location_image=location_filename,
            negative_prompt=negative_prompt,
            checkpoint=checkpoint,
            width=width,
            height=height,
            steps=steps,
            cfg=cfg,
            seed=seed,
            character_weight=character_weight,
            location_weight=location_weight
        )
        
        # 提交任务
        async with aiohttp.ClientSession() as session:
            payload = {
                "prompt": workflow,
                "client_id": self.client_id
            }
            
            async with session.post(
                f"{self.base_url}/prompt",
                json=payload
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise Exception(f"Failed to queue keyframe generation: {error_text}")
                
                result = await resp.json()
                prompt_id = result["prompt_id"]
        
        # 等待完成
        return await self.wait_for_completion(prompt_id, timeout=timeout)

    def _build_last_frame_from_first_workflow(
        self,
        first_frame: str,
        prompt: str,
        negative_prompt: str = "",
        checkpoint: str = "AnythingXL_v50.safetensors",
        width: int = 576,
        height: int = 1024,
        steps: int = 25,
        cfg: float = 7.0,
        seed: int = -1,
        ipadapter_weight: float = 0.85,
        denoise: float = 0.65
    ) -> Dict[str, Any]:
        """
        构建基于首帧生成尾帧的工作流
        使用 IPAdapter 保持风格一致性 + img2img 保持构图相似
        """
        if seed == -1:
            seed = uuid.uuid4().int % (2**32)
        
        workflow = {
            # 1. 加载模型
            "1": {
                "class_type": "CheckpointLoaderSimple",
                "inputs": {
                    "ckpt_name": checkpoint
                }
            },
            # 2. IPAdapter Unified Loader
            "2": {
                "class_type": "IPAdapterUnifiedLoader",
                "inputs": {
                    "model": ["1", 0],
                    "preset": "PLUS (high strength)"
                }
            },
            # 3. 加载首帧作为参考
            "3": {
                "class_type": "LoadImage",
                "inputs": {
                    "image": first_frame
                }
            },
            # 4. Apply IPAdapter - 用首帧作为风格参考
            "4": {
                "class_type": "IPAdapter",
                "inputs": {
                    "model": ["2", 0],
                    "ipadapter": ["2", 1],
                    "image": ["3", 0],
                    "weight": ipadapter_weight,
                    "start_at": 0.0,
                    "end_at": 1.0,
                    "weight_type": "style transfer"
                }
            },
            # 5. 调整首帧尺寸用于 img2img
            "5": {
                "class_type": "ImageScale",
                "inputs": {
                    "image": ["3", 0],
                    "width": width,
                    "height": height,
                    "upscale_method": "lanczos",
                    "crop": "center"
                }
            },
            # 6. VAE 编码首帧
            "6": {
                "class_type": "VAEEncode",
                "inputs": {
                    "pixels": ["5", 0],
                    "vae": ["1", 2]
                }
            },
            # 7. 正向提示词
            "7": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt,
                    "clip": ["1", 1]
                }
            },
            # 8. 负向提示词
            "8": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": negative_prompt if negative_prompt else "blurry, low quality, distorted, deformed",
                    "clip": ["1", 1]
                }
            },
            # 9. KSampler - img2img 模式
            "9": {
                "class_type": "KSampler",
                "inputs": {
                    "model": ["4", 0],
                    "positive": ["7", 0],
                    "negative": ["8", 0],
                    "latent_image": ["6", 0],
                    "seed": seed,
                    "steps": steps,
                    "cfg": cfg,
                    "sampler_name": "euler_ancestral",
                    "scheduler": "normal",
                    "denoise": denoise
                }
            },
            # 10. VAE 解码
            "10": {
                "class_type": "VAEDecode",
                "inputs": {
                    "samples": ["9", 0],
                    "vae": ["1", 2]
                }
            },
            # 11. 保存图片
            "11": {
                "class_type": "SaveImage",
                "inputs": {
                    "images": ["10", 0],
                    "filename_prefix": "last_frame"
                }
            }
        }
        
        return workflow

    async def generate_last_frame_from_first(
        self,
        first_frame_url: str,
        prompt: str,
        negative_prompt: str = "",
        checkpoint: str = "AnythingXL_v50.safetensors",
        width: int = 576,
        height: int = 1024,
        steps: int = 25,
        cfg: float = 7.0,
        seed: int = -1,
        ipadapter_weight: float = 0.85,
        denoise: float = 0.65,
        timeout: int = 120
    ) -> Dict[str, Any]:
        """
        基于首帧生成尾帧（保持风格一致性）
        
        Args:
            first_frame_url: 首帧图片 URL
            prompt: 尾帧的描述（动作变化后的状态）
            ipadapter_weight: IPAdapter 权重，越高越接近首帧风格
            denoise: 去噪强度，越低越接近首帧构图
            
        Returns:
            生成的尾帧图片信息
        """
        # 上传首帧
        first_result = await self.upload_image(first_frame_url)
        first_filename = first_result.get("name", "first_frame.png")
        
        # 构建工作流
        workflow = self._build_last_frame_from_first_workflow(
            first_frame=first_filename,
            prompt=prompt,
            negative_prompt=negative_prompt,
            checkpoint=checkpoint,
            width=width,
            height=height,
            steps=steps,
            cfg=cfg,
            seed=seed,
            ipadapter_weight=ipadapter_weight,
            denoise=denoise
        )
        
        # 提交任务
        async with aiohttp.ClientSession() as session:
            payload = {
                "prompt": workflow,
                "client_id": self.client_id
            }
            
            async with session.post(
                f"{self.base_url}/prompt",
                json=payload
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise Exception(f"Failed to queue last frame generation: {error_text}")
                
                result = await resp.json()
                prompt_id = result["prompt_id"]
        
        # 等待完成
        return await self.wait_for_completion(prompt_id, timeout=timeout)

    # ==================== ToonCrafter 动画生成方法 ====================
    
    def _build_tooncrafter_workflow(
        self,
        first_frame: str,
        last_frame: str,
        prompt: str = "",
        width: int = 384,
        height: int = 256,
        frames: int = 16,
        steps: int = 20,
        cfg: float = 7.0,
        seed: int = -1
    ) -> Dict[str, Any]:
        """
        构建 ToonCrafter 插值动画工作流
        使用 Kijai 的 ComfyUI-DynamiCrafterWrapper
        """
        if seed == -1:
            seed = uuid.uuid4().int % (2**32)
        
        workflow = {
            # 加载第一帧
            "1": {
                "class_type": "LoadImage",
                "inputs": {
                    "image": first_frame
                }
            },
            # 加载最后一帧
            "2": {
                "class_type": "LoadImage",
                "inputs": {
                    "image": last_frame
                }
            },
            # ToonCrafter 模型加载器
            "3": {
                "class_type": "DynamiCrafterModelLoader",
                "inputs": {
                    "ckpt_name": "tooncrafter_512_interp-pruned-fp16.safetensors",
                    "dtype": "auto",
                    "fp8_unet": False
                }
            },
            # CLIP Vision 加载器
            "4": {
                "class_type": "CLIPVisionLoader",
                "inputs": {
                    "clip_name": "CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors"
                }
            },
            # 从 SD 2.1 加载 CLIP (用于 conditioning，1024 维度)
            "5": {
                "class_type": "CLIPLoader",
                "inputs": {
                    "clip_name": "stable-diffusion-2-1-clip-fp16.safetensors",
                    "type": "stable_diffusion"
                }
            },
            # 正向 prompt 编码
            "6": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": prompt if prompt else "smooth animation, fluid motion",
                    "clip": ["5", 0]
                }
            },
            # 负向 prompt 编码
            "7": {
                "class_type": "CLIPTextEncode",
                "inputs": {
                    "text": "blurry, low quality, distorted, static",
                    "clip": ["5", 0]
                }
            },
            # 图片批处理（合并首尾帧）
            "8": {
                "class_type": "ImageBatch",
                "inputs": {
                    "image1": ["1", 0],
                    "image2": ["2", 0]
                }
            },
            # 调整图片尺寸
            "9": {
                "class_type": "ImageScale",
                "inputs": {
                    "image": ["8", 0],
                    "width": width,
                    "height": height,
                    "upscale_method": "lanczos",
                    "crop": "disabled"
                }
            },
            # ToonCrafter 采样器
            "10": {
                "class_type": "ToonCrafterInterpolation",
                "inputs": {
                    "model": ["3", 0],
                    "clip_vision": ["4", 0],
                    "positive": ["6", 0],
                    "negative": ["7", 0],
                    "images": ["9", 0],
                    "seed": seed,
                    "steps": 20,
                    "cfg": 7.0,
                    "eta": 1.0,
                    "frames": frames,
                    "fs": 10,
                    "vae_dtype": "fp32"
                }
            },
            # ToonCrafter VAE 解码
            "11": {
                "class_type": "ToonCrafterDecode",
                "inputs": {
                    "model": ["3", 0],
                    "latent": ["10", 0],
                    "vae_dtype": "fp16"
                }
            },
            # 视频合成
            "12": {
                "class_type": "VHS_VideoCombine",
                "inputs": {
                    "images": ["11", 0],
                    "frame_rate": 8,
                    "loop_count": 0,
                    "filename_prefix": "tooncrafter",
                    "format": "video/h264-mp4",
                    "pingpong": False,
                    "save_output": True
                }
            }
        }
        
        return workflow

    async def generate_tooncrafter_animation(
        self,
        first_frame_url: str,
        last_frame_url: str,
        prompt: str = "",
        width: int = 384,
        height: int = 256,
        frames: int = 16,
        steps: int = 25,
        cfg: float = 7.5,
        seed: int = -1,
        timeout: int = 300
    ) -> Dict[str, Any]:
        """
        使用 ToonCrafter 生成首尾帧插值动画
        
        Args:
            first_frame_url: 第一帧图片 URL
            last_frame_url: 最后一帧图片 URL
            prompt: 可选的动作描述
            
        Returns:
            生成的视频信息
        """
        # 上传首尾帧图片
        first_result = await self.upload_image(first_frame_url)
        first_filename = first_result.get("name", "first_frame.png")
        
        last_result = await self.upload_image(last_frame_url)
        last_filename = last_result.get("name", "last_frame.png")
        
        # 构建工作流
        workflow = self._build_tooncrafter_workflow(
            first_frame=first_filename,
            last_frame=last_filename,
            prompt=prompt,
            width=width,
            height=height,
            frames=frames,
            steps=steps,
            cfg=cfg,
            seed=seed
        )
        
        # 提交任务
        async with aiohttp.ClientSession() as session:
            payload = {
                "prompt": workflow,
                "client_id": self.client_id
            }
            
            async with session.post(
                f"{self.base_url}/prompt",
                json=payload
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise Exception(f"Failed to queue ToonCrafter animation: {error_text}")
                
                result = await resp.json()
                prompt_id = result["prompt_id"]
        
        # 等待完成
        return await self.wait_for_video_completion(prompt_id, timeout=timeout)

    # ==================== QwenImage 首帧生成方法 ====================

    def _qwen_edit_nodes(
        self,
        prefix: str,
        input_image_ref,
        image2_ref,
        image3_ref,
        prompt: str,
        neg_prompt: str,
        clip_ref,
        vae_ref,
        model_ref,
        resize_mode: str = "resize",
        resize_width: int = 1280,
        resize_height: int = 720,
    ) -> tuple:
        """
        生成一个 QwenImage Edit 处理阶段的所有节点（对应工作流中的子图）

        Args:
            prefix: 节点 ID 前缀
            input_image_ref: 主图片输入引用 [node_id, slot]
            image2_ref: 第二张图片引用（可选）
            image3_ref: 第三张图片引用（可选）
            prompt: 正向 prompt
            neg_prompt: 反向 prompt
            clip_ref: CLIP 模型引用
            vae_ref: VAE 模型引用
            model_ref: 扩散模型引用（经过 CFGNorm 后的）
            resize_mode: "resize" 或 "rescale"

        Returns:
            (nodes_dict, output_node_id)
        """
        import random
        nodes = {}

        # FluxKontextImageScale
        nodes[f"{prefix}_scl"] = {
            "class_type": "FluxKontextImageScale",
            "inputs": {"image": input_image_ref},
        }
        scaled_ref = [f"{prefix}_scl", 0]

        # Image Resize
        nodes[f"{prefix}_rsz"] = {
            "class_type": "Image Resize",
            "inputs": {
                "image": scaled_ref,
                "mode": resize_mode,
                "supersample": "true",
                "resampling": "lanczos",
                "rescale_factor": 1,
                "resize_width": resize_width,
                "resize_height": resize_height,
            },
        }

        # VAEEncode
        nodes[f"{prefix}_enc"] = {
            "class_type": "VAEEncode",
            "inputs": {
                "pixels": [f"{prefix}_rsz", 0],
                "vae": vae_ref,
            },
        }

        # TextEncodeQwenImageEditPlus (positive)
        pos_inputs = {
            "clip": clip_ref,
            "vae": vae_ref,
            "image1": scaled_ref,
            "prompt": prompt,
        }
        if image2_ref:
            pos_inputs["image2"] = image2_ref
        if image3_ref:
            pos_inputs["image3"] = image3_ref
        nodes[f"{prefix}_pos"] = {
            "class_type": "TextEncodeQwenImageEditPlus",
            "inputs": pos_inputs,
        }

        # TextEncodeQwenImageEditPlus (negative)
        neg_inputs = {
            "clip": clip_ref,
            "vae": vae_ref,
            "image1": scaled_ref,
            "prompt": neg_prompt,
        }
        if image2_ref:
            neg_inputs["image2"] = image2_ref
        if image3_ref:
            neg_inputs["image3"] = image3_ref
        nodes[f"{prefix}_neg"] = {
            "class_type": "TextEncodeQwenImageEditPlus",
            "inputs": neg_inputs,
        }

        # KSampler
        nodes[f"{prefix}_smp"] = {
            "class_type": "KSampler",
            "inputs": {
                "model": model_ref,
                "positive": [f"{prefix}_pos", 0],
                "negative": [f"{prefix}_neg", 0],
                "latent_image": [f"{prefix}_enc", 0],
                "seed": random.randint(0, 2**32 - 1),
                "steps": 4,
                "cfg": 1,
                "sampler_name": "euler",
                "scheduler": "simple",
                "denoise": 1,
            },
        }

        # VAEDecode
        nodes[f"{prefix}_dec"] = {
            "class_type": "VAEDecode",
            "inputs": {
                "samples": [f"{prefix}_smp", 0],
                "vae": vae_ref,
            },
        }

        return nodes, f"{prefix}_dec"

    async def generate_character_variant_and_wait(
        self,
        source_image_url: str,
        variant_prompt: str,
        negative_prompt: str = "",
        timeout: int = 300,
    ) -> Dict[str, Any]:
        """
        使用 QwenImage Edit 工作流生成角色变体图（不同着装/造型）

        Args:
            source_image_url: 原始角色概念图的 URL 或本地路径
            variant_prompt: 描述变化的英文编辑 prompt
            negative_prompt: 反向 prompt
            timeout: 超时时间

        Returns:
            包含生成图片信息的字典
        """
        logger.info("[ComfyUI] generate_character_variant_and_wait called, source=%s", source_image_url)
        workflow = {}

        # ===== Shared model nodes (same as generate_qwen_first_frame) =====
        workflow["m1"] = {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "Qwen-Image-Edit-2511-FP8_e4m3fn.safetensors",
                "weight_dtype": "default",
            },
        }
        workflow["m2"] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": ["m1", 0],
                "lora_name": "Qwen_Edit\\Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
                "strength_model": 1,
            },
        }
        workflow["m3"] = {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {"model": ["m2", 0], "shift": 1},
        }
        workflow["m4"] = {
            "class_type": "CFGNorm",
            "inputs": {"model": ["m3", 0], "scale": 1, "strength": 1},
        }
        workflow["m5"] = {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
                "type": "qwen_image",
            },
        }
        workflow["m6"] = {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "qwen_image_vae.safetensors"},
        }

        clip_ref = ["m5", 0]
        vae_ref = ["m6", 0]
        model_ref = ["m4", 0]

        # Upload source image
        upload_result = await self.upload_image(source_image_url)
        uploaded_filename = upload_result.get("name", "")
        if not uploaded_filename:
            raise Exception("Failed to upload source image to ComfyUI")

        workflow["load_src"] = {
            "class_type": "LoadImage",
            "inputs": {"image": uploaded_filename},
        }

        # QwenImage edit — no ImageCrop, directly edit the full image
        nodes, out_id = self._qwen_edit_nodes(
            prefix="var",
            input_image_ref=["load_src", 0],
            image2_ref=None,
            image3_ref=None,
            prompt=variant_prompt,
            neg_prompt=negative_prompt,
            clip_ref=clip_ref,
            vae_ref=vae_ref,
            model_ref=model_ref,
            resize_width=1024,
            resize_height=1024,
        )
        workflow.update(nodes)

        # Save output
        workflow["save_out"] = {
            "class_type": "PreviewImage",
            "inputs": {"images": [out_id, 0]},
        }

        # Submit workflow
        logger.info("[ComfyUI] Queuing character variant workflow, nodes=%d", len(workflow))
        logger.info("[ComfyUI] Character variant prompt: %s", variant_prompt[:200])

        async with aiohttp.ClientSession() as session:
            payload = {"prompt": workflow, "client_id": self.client_id}
            async with session.post(
                f"{self.base_url}/prompt", json=payload
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    logger.error("[ComfyUI] Failed to queue character variant generation: %s", error_text)
                    raise Exception(f"Failed to queue character variant generation: {error_text}")
                result = await resp.json()
                prompt_id = result["prompt_id"]
                logger.info("[ComfyUI] Character variant queued, prompt_id=%s", prompt_id)

        return await self.wait_for_completion(prompt_id, timeout=timeout)

    async def generate_qwen_first_frame(
        self,
        prompt: str,
        character_image_urls: Optional[List[str]] = None,
        character_prompts: Optional[List[str]] = None,
        location_image_url: Optional[str] = None,
        location_prompt: Optional[str] = None,
        negative_prompt: str = "same face, same clothes, same person posture",
        translated_dialogue: Optional[str] = None,
        timeout: int = 800,
    ) -> Dict[str, Any]:
        """
        使用 QwenImage 工作流生成首帧图片（支持 Chain A 多角色链式合成）

        Args:
            prompt: 首帧合成的 prompt
            character_image_urls: 角色参考图 URL 列表
            character_prompts: 对应的角色动作 prompt 列表
            location_image_url: 场景参考图 URL
            location_prompt: 场景机位 prompt
            negative_prompt: 反向 prompt
            translated_dialogue: 翻译后的对白英文文本，用于修正对话气泡中的文字
            timeout: 超时时间

        Returns:
            包含生成图片信息的字典
        """
        character_image_urls = character_image_urls or []
        character_prompts = character_prompts or []
        location_image_url = location_image_url or ""
        location_prompt = location_prompt or ""

        workflow = {}

        # ===== Shared model nodes =====
        workflow["m1"] = {
            "class_type": "UNETLoader",
            "inputs": {
                "unet_name": "Qwen-Image-Edit-2511-FP8_e4m3fn.safetensors",
                "weight_dtype": "default",
            },
        }
        workflow["m2"] = {
            "class_type": "LoraLoaderModelOnly",
            "inputs": {
                "model": ["m1", 0],
                "lora_name": "Qwen_Edit\\Qwen-Image-Edit-2511-Lightning-4steps-V1.0-bf16.safetensors",
                "strength_model": 1,
            },
        }
        workflow["m3"] = {
            "class_type": "ModelSamplingAuraFlow",
            "inputs": {"model": ["m2", 0], "shift": 1},
        }
        workflow["m4"] = {
            "class_type": "CFGNorm",
            "inputs": {"model": ["m3", 0], "scale": 1, "strength": 1},
        }
        workflow["m5"] = {
            "class_type": "CLIPLoader",
            "inputs": {
                "clip_name": "qwen_2.5_vl_7b_fp8_scaled.safetensors",
                "type": "qwen_image",
            },
        }
        workflow["m6"] = {
            "class_type": "VAELoader",
            "inputs": {"vae_name": "qwen_image_vae.safetensors"},
        }

        clip_ref = ["m5", 0]
        vae_ref = ["m6", 0]
        model_ref = ["m4", 0]

        # ===== Stage 1: Character pose generation =====
        char_output_refs = []
        for i, (img_url, char_prompt) in enumerate(
            zip(character_image_urls, character_prompts)
        ):
            if not img_url or not char_prompt:
                continue
            # Upload image to ComfyUI
            uploaded = await self.upload_image(img_url)
            char_load_id = f"cl{i}"
            workflow[char_load_id] = {
                "class_type": "LoadImage",
                "inputs": {"image": uploaded["name"]},
            }
            # Crop to 341x1024 (character proportions)
            char_crop_id = f"cc{i}"
            workflow[char_crop_id] = {
                "class_type": "ImageCrop",
                "inputs": {
                    "image": [char_load_id, 0],
                    "width": 700,
                    "height": 1080,
                    "x": 0,
                    "y": 0,
                },
            }
            # QwenImage edit stage for this character
            nodes, out_id = self._qwen_edit_nodes(
                prefix=f"cp{i}",
                input_image_ref=[char_crop_id, 0],
                image2_ref=None,
                image3_ref=None,
                prompt=char_prompt,
                neg_prompt=negative_prompt,
                clip_ref=clip_ref,
                vae_ref=vae_ref,
                model_ref=model_ref,
            )
            workflow.update(nodes)
            char_output_refs.append([out_id, 0])

        # ===== Stage 2: Scene angle generation =====
        scene_output_ref = None
        if location_image_url and location_prompt:
            uploaded_loc = await self.upload_image(location_image_url)
            workflow["sl0"] = {
                "class_type": "LoadImage",
                "inputs": {"image": uploaded_loc["name"]},
            }
            workflow["sc0"] = {
                "class_type": "ImageCrop",
                "inputs": {
                    "image": ["sl0", 0],
                    "width": 512,
                    "height": 340,
                    "x": 0,
                    "y": 0,
                },
            }
            nodes, out_id = self._qwen_edit_nodes(
                prefix="sp0",
                input_image_ref=["sc0", 0],
                image2_ref=None,
                image3_ref=None,
                prompt=location_prompt,
                neg_prompt=negative_prompt,
                clip_ref=clip_ref,
                vae_ref=vae_ref,
                model_ref=model_ref,
            )
            workflow.update(nodes)
            scene_output_ref = [out_id, 0]

        # ===== Stage 3: Combine characters + scene → first frame =====
        num_chars = len(char_output_refs)
        final_output_ref = None

        if num_chars == 0 and scene_output_ref:
            # No characters, just scene
            nodes, out_id = self._qwen_edit_nodes(
                prefix="f0",
                input_image_ref=scene_output_ref,
                image2_ref=None,
                image3_ref=None,
                prompt=prompt,
                neg_prompt=negative_prompt,
                clip_ref=clip_ref,
                vae_ref=vae_ref,
                model_ref=model_ref,
            )
            workflow.update(nodes)
            final_output_ref = [out_id, 0]
        elif num_chars == 1:
            # 1 character + scene
            nodes, out_id = self._qwen_edit_nodes(
                prefix="f0",
                input_image_ref=char_output_refs[0],
                image2_ref=scene_output_ref,
                image3_ref=None,
                prompt=prompt,
                neg_prompt=negative_prompt,
                clip_ref=clip_ref,
                vae_ref=vae_ref,
                model_ref=model_ref,
            )
            workflow.update(nodes)
            final_output_ref = [out_id, 0]
        elif num_chars >= 2:
            # 2 characters + scene (uses all 3 slots)
            nodes, out_id = self._qwen_edit_nodes(
                prefix="f0",
                input_image_ref=char_output_refs[0],
                image2_ref=char_output_refs[1],
                image3_ref=scene_output_ref,
                prompt=prompt,
                neg_prompt=negative_prompt,
                clip_ref=clip_ref,
                vae_ref=vae_ref,
                model_ref=model_ref,
            )
            workflow.update(nodes)
            final_output_ref = [out_id, 0]

            # Chain A: for 3+ characters, chain additional characters
            for ci in range(2, num_chars):
                chain_prompt = f"Add the character from <image2> into the scene shown in <image1>. Keep existing characters unchanged."
                nodes, out_id = self._qwen_edit_nodes(
                    prefix=f"f{ci}",
                    input_image_ref=final_output_ref,
                    image2_ref=char_output_refs[ci],
                    image3_ref=None,
                    prompt=chain_prompt,
                    neg_prompt=negative_prompt,
                    clip_ref=clip_ref,
                    vae_ref=vae_ref,
                    model_ref=model_ref,
                )
                workflow.update(nodes)
                final_output_ref = [out_id, 0]

        if final_output_ref is None:
            raise Exception("No character or scene images provided")

        # ===== Stage 4: Fix dialogue bubble text (if translated_dialogue provided) =====
        if translated_dialogue:
            dialogue_prompt = f'Only change the text in the white dialogue bubble to be "{translated_dialogue}". Keep everything else exactly the same.'
            print(f"[QwenFirstFrame] Adding dialogue fix step: {dialogue_prompt}")
            nodes, out_id = self._qwen_edit_nodes(
                prefix="dlg",
                input_image_ref=final_output_ref,
                image2_ref=None,
                image3_ref=None,
                prompt=dialogue_prompt,
                neg_prompt=negative_prompt,
                clip_ref=clip_ref,
                vae_ref=vae_ref,
                model_ref=model_ref,
            )
            workflow.update(nodes)
            final_output_ref = [out_id, 0]

        # Save image node
        workflow["save"] = {
            "class_type": "SaveImage",
            "inputs": {
                "images": final_output_ref,
                "filename_prefix": "qwen_first_frame",
            },
        }

        # Queue prompt
        print(f"[QwenFirstFrame] Queuing workflow with {len(workflow)} nodes")
        async with aiohttp.ClientSession() as session:
            payload = {"prompt": workflow, "client_id": self.client_id}
            async with session.post(
                f"{self.base_url}/prompt", json=payload
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    raise Exception(f"Failed to queue keyframe generation: {error_text}")
                result = await resp.json()
                prompt_id = result["prompt_id"]

        return await self.wait_for_completion(prompt_id, timeout=timeout)


    # ==================== LTX 2.3 视频生成 ====================

    async def _fetch_object_info(self) -> Dict:
        """
        从 ComfyUI 获取所有节点类型的参数定义（/object_info）
        返回 { class_type: { "input": { "required": {...}, "optional": {...} }, ... } }
        """
        async with aiohttp.ClientSession() as session:
            async with session.get(f"{self.base_url}/object_info") as resp:
                if resp.status != 200:
                    raise Exception(f"Failed to fetch object_info: {resp.status}")
                return await resp.json()

    async def _convert_workflow_to_api(self, workflow_json: Dict) -> Dict:
        """
        将 ComfyUI 可视化节点格式 (nodes + links) 转换为 API prompt 格式。
        使用 /object_info 获取每个节点类型的真实参数定义来正确映射 widgets_values。
        """
        nodes = workflow_json.get("nodes", [])
        links = workflow_json.get("links", [])

        # 获取节点类型的参数定义
        object_info = await self._fetch_object_info()

        # 构建 link 索引: link_id -> (source_node_id, source_output_index)
        link_map = {}
        for link in links:
            link_id = link[0]
            source_node_id = link[1]
            source_output_index = link[2]
            link_map[link_id] = (str(source_node_id), source_output_index)

        # 处理 bypassed 节点 (mode == 4) 和 Reroute 节点: 将输出重定向到第一个输入的来源
        # bypassed_passthrough: { str(node_id): (upstream_node_id, upstream_slot) }
        bypassed_passthrough = {}
        for node in nodes:
            is_bypass = node.get("mode") == 4
            is_reroute = node.get("type") == "Reroute"
            if is_bypass or is_reroute:
                nid = str(node["id"])
                # 找到第一个有连接的输入
                for inp in node.get("inputs", []):
                    link_id = inp.get("link")
                    if link_id is not None and link_id in link_map:
                        bypassed_passthrough[nid] = link_map[link_id]
                        break

        def resolve_source(node_id_str: str, slot: int) -> tuple:
            """递归解析 bypassed 节点链，返回最终的上游 (node_id, slot)"""
            visited = set()
            while node_id_str in bypassed_passthrough:
                if node_id_str in visited:
                    break  # 避免无限循环
                visited.add(node_id_str)
                node_id_str, slot = bypassed_passthrough[node_id_str]
            return (node_id_str, slot)

        # 更新 link_map，将所有指向 bypassed 节点的引用解析为上游
        for link_id in link_map:
            src_node, src_slot = link_map[link_id]
            link_map[link_id] = resolve_source(src_node, src_slot)

        def _is_widget_type(param_def):
            """判断 object_info 中的参数定义是否为 widget 类型（非节点连接类型）"""
            pt = param_def[0] if isinstance(param_def, (list, tuple)) and len(param_def) > 0 else param_def
            if isinstance(pt, list):
                return True  # 枚举
            if isinstance(pt, str) and pt in ("INT", "FLOAT", "STRING", "BOOLEAN", "COMBO"):
                return True
            if isinstance(pt, str) and pt == "*":
                return False  # 通配符连接类型
            if isinstance(pt, str) and pt.isupper() and len(pt) > 1:
                return False  # MODEL, CLIP, IMAGE 等连接类型
            return True  # 其他默认为 widget

        api_workflow = {}
        for node in nodes:
            node_id = str(node["id"])
            class_type = node.get("type", "")

            # 跳过注释节点和 Reroute
            if class_type in ("MarkdownNote", "VRAM_Debug", "Reroute", "Note"):
                continue

            # 跳过 bypassed 节点（已通过 passthrough 处理）
            if node.get("mode") == 4:
                continue

            # SetNode / GetNode 后面统一处理
            if class_type in ("SetNode", "GetNode"):
                api_workflow[node_id] = {
                    "class_type": class_type,
                    "inputs": {},
                    "_node_ref": node,
                }
                # 处理 SetNode 的连接输入
                for inp in node.get("inputs", []):
                    link_id = inp.get("link")
                    if link_id is not None and link_id in link_map:
                        source_node, source_slot = link_map[link_id]
                        api_workflow[node_id]["inputs"][inp.get("name", "")] = [source_node, source_slot]
                continue

            inputs_dict = {}
            widgets_values = node.get("widgets_values", [])
            node_inputs_visual = node.get("inputs", [])

            # 1. 处理连接输入（来自 links）
            connected_names = set()
            for inp in node_inputs_visual:
                inp_name = inp.get("name", "")
                link_id = inp.get("link")
                if link_id is not None and link_id in link_map:
                    source_node, source_slot = link_map[link_id]
                    inputs_dict[inp_name] = [source_node, source_slot]
                    connected_names.add(inp_name)

            # 2. 从 object_info 获取该节点类型的 widget 参数定义
            type_info = object_info.get(class_type, {})
            type_input_def = type_info.get("input", {})
            required_inputs = type_input_def.get("required", {})
            optional_inputs = type_input_def.get("optional", {})

            # 合并所有 widget 参数（按 required 先、optional 后的顺序）
            # ComfyUI 的 widgets_values 按此顺序排列
            # 注意：即使某个 widget 参数当前通过连接提供，它在 widgets_values 中仍占位
            all_widget_params = []
            for param_name, param_def in required_inputs.items():
                if _is_widget_type(param_def):
                    all_widget_params.append(param_name)
            for param_name, param_def in optional_inputs.items():
                if _is_widget_type(param_def):
                    all_widget_params.append(param_name)

            # 3. 将 widgets_values 映射到参数名
            # 即使参数已通过连接提供，仍需推进 wv_idx 以保持对齐
            wv_idx = 0
            for param_name in all_widget_params:
                if wv_idx >= len(widgets_values):
                    break
                val = widgets_values[wv_idx]
                # 仅在未被连接覆盖时赋值
                if param_name not in connected_names:
                    inputs_dict[param_name] = val
                wv_idx += 1
                # 跳过 control_after_generate（紧跟在 seed 类参数后面的前端专用值）
                if ("seed" in param_name.lower()) and wv_idx < len(widgets_values):
                    next_val = widgets_values[wv_idx]
                    if isinstance(next_val, str) and next_val in ("fixed", "increment", "decrement", "randomize"):
                        wv_idx += 1

            api_workflow[node_id] = {
                "class_type": class_type,
                "inputs": inputs_dict,
            }

        # 处理 GetNode/SetNode 的间接引用
        set_nodes = {}  # var_name -> (source_node_id, source_output_slot)
        for node in nodes:
            if node.get("type") == "SetNode" and node.get("mode") != 4:
                nid = str(node["id"])
                var_name = node.get("widgets_values", [""])[0]
                if node.get("inputs") and node["inputs"][0].get("link") is not None:
                    link_id = node["inputs"][0]["link"]
                    if link_id in link_map:
                        set_nodes[var_name] = link_map[link_id]

        for node in nodes:
            if node.get("type") == "GetNode" and node.get("mode") != 4:
                nid = str(node["id"])
                var_name = node.get("widgets_values", [""])[0]
                if var_name in set_nodes:
                    source_node, source_slot = set_nodes[var_name]
                    # 扫描所有 api_workflow 节点，替换所有引用此 GetNode 的输入
                    # （包括通过 Reroute passthrough 间接引用的情况）
                    for target_nid, target_data in api_workflow.items():
                        for inp_name, inp_val in target_data["inputs"].items():
                            if isinstance(inp_val, list) and len(inp_val) == 2 and inp_val[0] == nid:
                                target_data["inputs"][inp_name] = [source_node, source_slot]
                if nid in api_workflow:
                    del api_workflow[nid]

        for node in nodes:
            if node.get("type") == "SetNode":
                nid = str(node["id"])
                if nid in api_workflow:
                    del api_workflow[nid]

        # 清理 _node_ref 临时字段
        for nid in list(api_workflow.keys()):
            if "_node_ref" in api_workflow[nid]:
                del api_workflow[nid]["_node_ref"]

        return api_workflow

    async def generate_ltx_video_and_wait(
        self,
        first_frame_image_url: str,
        video_prompt: str,
        dialogue: str = "",
        voice_instruct: str = "",
        negative_prompt: str = "",
        save_prefix: str = "video/LTX_shot",
        fps: int = 24,
        duration_seconds: float = 0,
        timeout: int = 1200,
    ) -> Dict[str, Any]:
        """
        使用 LTX 2.3 工作流生成视频（图生视频 + 音频）

        Args:
            first_frame_image_url: 首帧图片 URL（后端可访问的）
            video_prompt: 视频 prompt (英文)
            dialogue: 对白文本（中文，用于 TTS 生成语音）
            voice_instruct: 声音描述（用于 TTS，如 "20多岁男性的声音"）
            negative_prompt: 负面 prompt
            save_prefix: 保存视频的文件名前缀
            fps: 帧率（默认 24）
            duration_seconds: 镜头时长（秒），0 表示使用工作流默认值
            timeout: 超时时间（秒）

        Returns:
            包含生成结果的字典
        """
        # 1. 上传首帧图片到 ComfyUI
        upload_result = await self.upload_image(first_frame_image_url)
        uploaded_filename = upload_result.get("name", "")
        if not uploaded_filename:
            raise Exception("Failed to upload first frame image to ComfyUI")

        # 2. 根据是否有对白选择工作流
        config_dir = Path(__file__).parent.parent / "config"
        if dialogue:
            workflow_path = config_dir / "ltx_video_workflow.json"
        else:
            workflow_path = config_dir / "ltx_video_workflow_no_dialogue.json"

        if not workflow_path.exists():
            raise Exception(f"LTX workflow not found: {workflow_path}")

        logger.info("[ComfyUI] LTX using workflow: %s (%s dialogue)", workflow_path.name, "with" if dialogue else "without")

        with open(workflow_path, "r", encoding="utf-8") as f:
            workflow_json = json.load(f)

        # 3. 转换为 API 格式（使用 /object_info 获取真实参数定义）
        api_workflow = await self._convert_workflow_to_api(workflow_json)
        logger.info("[ComfyUI] LTX workflow converted to API format, nodes=%d", len(api_workflow))

        # 4. 注入动态参数
        # Node 240: LoadImage — 首帧图片
        if "240" in api_workflow:
            api_workflow["240"]["inputs"]["image"] = uploaded_filename
            logger.info("[ComfyUI] LTX injected first frame into node 240")

        # Node 169: CLIPTextEncode (positive) — 视频 prompt
        if "169" in api_workflow:
            api_workflow["169"]["inputs"]["text"] = video_prompt

        # Node 165: CLIPTextEncode (negative) — 负面 prompt
        if "165" in api_workflow:
            api_workflow["165"]["inputs"]["text"] = negative_prompt

        # Node 337: FB_Qwen3TTSVoiceDesign — 对白 TTS（仅在有对白的工作流中存在）
        if "337" in api_workflow:
            api_workflow["337"]["inputs"]["text"] = dialogue
            if voice_instruct:
                api_workflow["337"]["inputs"]["instruct"] = voice_instruct
            logger.info("[ComfyUI] LTX injected dialogue into node 337")

        # Node 330: SaveVideo — 保存路径前缀
        if "330" in api_workflow:
            api_workflow["330"]["inputs"]["filename_prefix"] = save_prefix

        # 计算帧数: (镜头时长 + 1) * fps
        if duration_seconds > 0:
            total_frames = int((duration_seconds + 1) * fps)
            # Node 162: EmptyLTXVLatentVideo — 视频帧数
            if "162" in api_workflow:
                api_workflow["162"]["inputs"]["length"] = total_frames
            # Node 324: LTXVEmptyLatentAudio — 音频帧数
            if "324" in api_workflow:
                api_workflow["324"]["inputs"]["frames_number"] = total_frames
            logger.info("[ComfyUI] LTX set total_frames=%d (fps=%d, duration=%ss)", total_frames, fps, duration_seconds)

        # 5. 提交工作流
        logger.info("[ComfyUI] LTX queuing workflow, nodes=%d", len(api_workflow))
        logger.info("[ComfyUI] LTX prompt: %s", video_prompt[:200])
        logger.info("[ComfyUI] LTX image=%s, fps=%s, duration=%ss", uploaded_filename, fps, duration_seconds)
        # Debug: 打印每个节点的输入摘要
        for nid, ndata in api_workflow.items():
            inp_keys = list(ndata.get("inputs", {}).keys())
            logger.debug("[ComfyUI] LTX node %s (%s): inputs=%s", nid, ndata['class_type'], inp_keys)
        if dialogue:
            logger.info("[ComfyUI] LTX dialogue: %s", dialogue)

        async with aiohttp.ClientSession() as session:
            payload = {"prompt": api_workflow, "client_id": self.client_id}
            async with session.post(
                f"{self.base_url}/prompt", json=payload
            ) as resp:
                if resp.status != 200:
                    error_text = await resp.text()
                    logger.error("[ComfyUI] Failed to queue LTX video generation: %s", error_text)
                    raise Exception(f"Failed to queue LTX video generation: {error_text}")
                result = await resp.json()
                prompt_id = result["prompt_id"]
                logger.info("[ComfyUI] LTX video queued, prompt_id=%s", prompt_id)

        # 6. 等待视频生成完成
        return await self._wait_for_ltx_video_completion(
            prompt_id,
            save_prefix=save_prefix,
            comfyui_output_dir=self.comfyui_output_dir,
            timeout=timeout
        )

    async def _wait_for_ltx_video_completion(
        self,
        prompt_id: str,
        save_prefix: str = "",
        comfyui_output_dir: str = "",
        timeout: int = 1200,
        poll_interval: float = 5.0
    ) -> Dict[str, Any]:
        """
        等待 LTX 视频生成完成。
        1. 轮询 history API 直到工作流完成
        2. 完成后从 history 或磁盘获取视频文件
        """
        elapsed = 0
        logger.info("[ComfyUI] Waiting for LTX video completion, prompt_id=%s, timeout=%ss", prompt_id, timeout)
        # 记录开始前已有文件
        existing_files = set()
        scan_dir = None
        if comfyui_output_dir and save_prefix:
            prefix_parts = save_prefix.replace("\\", "/").rsplit("/", 1)
            subfolder = prefix_parts[0] if len(prefix_parts) == 2 else ""
            scan_dir = Path(comfyui_output_dir) / subfolder if subfolder else Path(comfyui_output_dir)
            if scan_dir.exists():
                existing_files = {f for f in scan_dir.iterdir() if f.is_file()}
            logger.info("[ComfyUI] LTX scan_dir=%s, existing_files=%d", scan_dir, len(existing_files))

        # 第一步：轮询直到工作流完成
        async with aiohttp.ClientSession() as session:
            while elapsed < timeout:
                await asyncio.sleep(poll_interval)
                elapsed += poll_interval

                async with session.get(f"{self.base_url}/history/{prompt_id}") as resp:
                    if resp.status != 200:
                        logger.warning("[ComfyUI] LTX history request failed, status=%s", resp.status)
                        continue
                    history = await resp.json()

                if prompt_id not in history:
                    continue

                status_data = history[prompt_id].get("status", {})
                status_str = status_data.get("status_str", "")

                if status_str == "error":
                    messages = status_data.get("messages", [])
                    logger.error("[ComfyUI] LTX workflow error: %s", messages)
                    raise Exception(f"ComfyUI workflow error: {messages}")

                if status_str == "success":
                    logger.info("[ComfyUI] LTX workflow completed in ~%ss", elapsed)
                    outputs = history[prompt_id].get("outputs", {})

                    # 优先从 history outputs 获取视频
                    for node_id, node_output in outputs.items():
                        for key in ("videos", "gifs"):
                            if key in node_output and node_output[key]:
                                logger.info("[ComfyUI] LTX found %s in node %s", key, node_id)
                                return {"status": "completed", "videos": node_output[key], "prompt_id": prompt_id}

                    # History 没有 videos — 从磁盘找（等几秒确保文件写完）
                    logger.info("[ComfyUI] LTX no videos in history output, scanning disk...")
                    await asyncio.sleep(3)

                    if scan_dir and scan_dir.exists():
                        current_files = {f for f in scan_dir.iterdir() if f.is_file()}
                        new_files = current_files - existing_files
                        video_files = sorted(
                            [f for f in new_files if f.suffix.lower() in (".mp4", ".webm", ".mov")],
                            key=lambda f: f.stat().st_mtime, reverse=True
                        )
                        if video_files:
                            video_path = video_files[0]
                            logger.info("[ComfyUI] LTX found video on disk: %s", video_path)
                            return {
                                "status": "completed",
                                "videos": [{"_local_path": str(video_path), "filename": video_path.name}],
                                "prompt_id": prompt_id
                            }
                        else:
                            logger.warning("[ComfyUI] LTX no new video files found on disk")
                    else:
                        logger.warning("[ComfyUI] LTX scan_dir not available: %s", scan_dir)

                    return {"status": "completed", "videos": [], "prompt_id": prompt_id}

        logger.error("[ComfyUI] LTX video generation timed out after %ss", timeout)
        raise TimeoutError(f"LTX video generation timed out after {timeout}s")


# 单例实例
comfyui_client: Optional[ComfyUIClient] = None


def get_comfyui_client() -> ComfyUIClient:
    """获取 ComfyUI 客户端单例"""
    global comfyui_client
    if comfyui_client is None:
        comfyui_client = ComfyUIClient()
    return comfyui_client
