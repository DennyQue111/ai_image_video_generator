"""轻量本地人脸定位；用于角色概念图的下巴裁切，不修改原始图片。"""

from pathlib import Path


def locate_chin_y(image_path: str) -> float:
    """返回最大人脸下边缘的相对 Y 坐标（0=顶部，1=底部）。"""
    try:
        import cv2
        import numpy as np
        from PIL import Image
    except ImportError as exc:
        raise RuntimeError("本地人脸检测依赖未安装，请安装 backend/requirements.txt") from exc

    path = Path(image_path)
    if not path.exists():
        raise FileNotFoundError(f"图片不存在: {path}")
    image = np.asarray(Image.open(path).convert("RGB"))
    model_path = Path(__file__).resolve().parent.parent / "assets" / "face_detection" / "face_detection_yunet_2023mar.onnx"
    if not model_path.exists():
        raise RuntimeError(f"YuNet 人脸检测模型不存在: {model_path}")
    height, width = image.shape[:2]
    detector = cv2.FaceDetectorYN_create(str(model_path), "", (width, height), 0.55, 0.3, 5000)
    _, detections = detector.detect(cv2.cvtColor(image, cv2.COLOR_RGB2BGR))
    if detections is None or len(detections) == 0:
        raise ValueError("未检测到人脸；请换用脸部更清晰的正面全身图")
    x, y, face_width, face_height, score, *_ = max(detections, key=lambda box: float(box[2]) * float(box[3]))
    # YuNet 框通常覆盖额头到下巴；额外保留 4% 框高，避免裁到嘴或下巴。
    chin_y = (float(y) + float(face_height) * 1.04) / height
    return max(0.12, min(0.72, float(chin_y)))
