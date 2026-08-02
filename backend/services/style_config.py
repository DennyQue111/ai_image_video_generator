import yaml
from pathlib import Path
from typing import Dict, List, Optional


class StyleConfig:
    """风格配置管理器，从 YAML 文件加载风格定义"""

    def __init__(self, config_path: str = None):
        if config_path is None:
            config_path = Path(__file__).parent.parent / "config" / "styles.yaml"
        self._config_path = Path(config_path)
        self._styles: Dict = {}
        self._load()

    def _load(self):
        """加载 YAML 配置文件"""
        with open(self._config_path, "r", encoding="utf-8") as f:
            data = yaml.safe_load(f)
        self._styles = data.get("styles", {})

    def reload(self):
        """重新加载配置（用于热更新）"""
        self._load()

    def get_style(self, style_id: str) -> Optional[Dict]:
        """获取指定风格的完整配置"""
        return self._styles.get(style_id)

    def get_style_prompt(self, style_id: str) -> str:
        """获取指定风格的英文 prompt"""
        style = self._styles.get(style_id)
        if style:
            return style.get("prompt", "")
        return ""

    def get_style_prompt_cn(self, style_id: str) -> str:
        """获取指定风格的中文 prompt"""
        style = self._styles.get(style_id)
        if style:
            return style.get("prompt_cn", "")
        return ""

    def get_all_styles(self) -> List[Dict]:
        """获取所有风格列表（用于前端展示）"""
        result = []
        for style_id, style_data in self._styles.items():
            result.append({
                "id": style_id,
                "name": style_data.get("name", ""),
                "description": style_data.get("description", ""),
                "tags": style_data.get("tags", []),
            })
        return result

    def get_style_ids(self) -> List[str]:
        """获取所有风格 ID"""
        return list(self._styles.keys())
