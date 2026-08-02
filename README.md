# AI 图片视频生成器

一个简化的 AI 生成工具前端界面，支持文生图、图生图、图生视频三种能力，后端可切换 ComfyUI 工作流或 Google Gemini 模型。

---

## 功能概览

- **文生图（Text-to-Image）**
  - 输入 Prompt，选择模型和风格，生成图片。
  - 支持模型：ComfyUI（QwenImage）、Gemini 2.5 Flash Image。

- **图生图（Image-to-Image）**
  - 上传参考图片，输入编辑描述，生成新图片。
  - 支持模型：ComfyUI（QwenImage Edit）、Gemini 2.5 Flash Image。

- **图生视频（Image-to-Video）**
  - 上传首帧图片，输入视频描述，生成短视频。
  - 支持模型：ComfyUI（LTX Video）。

---

## 技术栈

- **后端**：FastAPI + Python
- **前端**：React + Vite
- **AI 后端**：
  - [ComfyUI](https://github.com/comfyanonymous/ComfyUI)（本地工作流）
  - Google AI Studio / Gemini API

---

## 目录结构

```
ai_image_video_generator/
├── backend/                     # FastAPI 后端
│   ├── config/                  # ComfyUI 工作流 JSON
│   ├── routes/                  # API 路由
│   ├── services/                # ComfyUI 客户端、Gemini 客户端、风格配置
│   ├── main.py                  # 后端入口
│   ├── requirements.txt         # Python 依赖
│   └── .env                     # API Key 配置（需自行创建）
├── frontend/                    # React 前端
│   ├── src/
│   │   ├── components/          # 三个生成页面组件
│   │   ├── App.jsx              # 主界面与 Tab 切换
│   │   └── ...
│   ├── package.json
│   └── vite.config.js           # 开发代理配置
├── outputs/                     # 生成的图片/视频默认输出目录
└── README.md
```

---

## 环境要求

- Python 3.10+
- Node.js 18+
- 本地已启动 ComfyUI（默认地址：`http://127.0.0.1:8188`）
- Google AI Studio API Key（使用 Gemini 时需要）

---

## 快速开始

### 1. 后端启动

进入后端目录：

```bash
cd backend
```

创建虚拟环境（推荐）：

```bash
python -m venv venv
```

安装依赖：

```bash
# Windows
.\venv\Scripts\python.exe -m pip install -r requirements.txt

# 如果默认源下载慢，可使用国内镜像
.\venv\Scripts\python.exe -m pip install -r requirements.txt -i https://pypi.tuna.tsinghua.edu.cn/simple
```

配置环境变量：

复制 `backend/.env` 文件（如果尚未创建则新建），填入 Gemini API Key：

```env
GOOGLE_AI_STUDIO_API_KEY=你的真实_api_key
```

> 如果不需要 Gemini 功能，可保留空值或删除该配置，但 Gemini 相关模型将不可用。

启动后端服务：

```bash
.\venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8001
```

服务启动后访问：`http://localhost:8001/api/status` 可查看 ComfyUI 和 Gemini 连接状态。

---

### 2. 前端启动

进入前端目录：

```bash
cd frontend
```

安装依赖：

```bash
npm install

# 如果默认 registry 较慢，可使用国内镜像
npm install --registry https://registry.npmmirror.com
```

启动开发服务器：

```bash
npm run dev
```

前端默认地址：`http://localhost:5173/`

---

## 使用说明

1. 同时启动后端和前端。
2. 在浏览器中打开 `http://localhost:5173/`。
3. 选择顶部 Tab 切换功能：文生图 / 图生图 / 图生视频。
4. 在“模型”下拉框中选择要使用的后端模型。
5. 填写必要参数后点击生成按钮。
6. 生成的图片/视频会保存到 `outputs/_temp/generator_outputs/` 目录下，同时在前端展示结果。

---

## 主要 API 接口

| 接口 | 方法 | 说明 |
|------|------|------|
| `/api/status` | GET | 查看后端、ComfyUI、Gemini 状态 |
| `/api/styles` | GET | 获取可用风格列表 |
| `/api/upload-image` | POST | 上传图片，返回可访问 URL |
| `/api/text-to-image` | POST | 文生图 |
| `/api/image-to-image` | POST | 图生图 |
| `/api/image-to-video` | POST | 图生视频 |

---

## 常见问题

### 1. 后端启动时提示 `No module named 'xxx'`

确认是否在虚拟环境中运行，并已成功安装 `requirements.txt` 中的所有依赖。

### 2. 前端启动时报 lucide 图标错误

如果后续升级了 `lucide-react` 版本，请确保使用的图标名称在当前版本中真实存在。

### 3. ComfyUI 连接失败

确认本地 ComfyUI 已启动，且地址为 `http://127.0.0.1:8188`。如需修改，请编辑 `backend/services/comfyui_client.py` 中的 `COMFYUI_BASE_URL`。

### 4. Gemini 生成失败

确认 `backend/.env` 中 `GOOGLE_AI_STUDIO_API_KEY` 已正确配置，且网络可访问 Google AI Studio。

---

## 备注

- `.env` 文件已加入 `.gitignore`，请勿将真实 API Key 提交到版本库。
- 当前版本为简化版，后续可根据使用需求继续扩展多图输入、工作流参数自定义、批量生成等功能。
