# AI 图片视频生成器

面向 AI 影视预演的本地工作台：从角色、场景与镜头表出发，在自由画布中组织参考素材，生成镜头关键帧，再使用 MiniMax H3 或 LTX 生成视频。

> 本项目是本地应用。ComfyUI、模型权重与 Google Gemini API 均由使用者自行配置；不同工作流所需的 ComfyUI 自定义节点和模型也必须已经可用。

## 当前功能

### 自由画布

- 上传、排列、连线图片与视频节点；上传 GLB 模型并在画布中预览。
- 文生图：本地 ComfyUI 的 Flux.2 Klein / QwenImage，或 Gemini 图片模型。
- 图生图：QwenImage Edit、Flux.2 Klein 多图编辑、Gemini 多图合成。
- 局部重绘、图片拆分（YOLO）、放大（SeedVR2）、提示词细化与角色模型三视图辅助。
- 画布项目可保存、打开、删除；浏览器会缓存最近一次工作区。

### 镜头表与视频

- 管理 Concepts（角色、场景、道具）和镜头表；镜头记录时长、景别、机位、焦段、运镜、动作、对白、连续性及参考图。
- 每个镜头可进入独立自由画布，制作角色参考与镜头参考帧。
- 可由 Qwen3-VL 根据“角色概念图 + 镜头参考帧 + 镜头 JSON”生成可编辑的 MiniMax H3 单镜头提示词。
- 图生视频支持本地 ComfyUI 的 LTX 2.3 首帧视频，以及 MiniMax H3 Ref2VA 多参考图视频（1–9 张）。

### 导演台（轻量 3D 预演）

- 在自由画布添加一个共享的 Three.js 导演台，摆放墙体、木箱、油桶和人形占位物。
- 采用 DCC 轴向：X 为横向、Y 为纵深、Z 为高度；可通过右侧面板精确编辑位置、Z 轴旋转与 XYZ 缩放，也可锁定等比缩放。
- 选中物体后使用操控轴拖拽：`W` 移动、`E` 旋转、`R` 缩放；`Ctrl + Z` 撤销，`Ctrl + Shift + Z` / `Ctrl + Y` 重做。
- 保存命名视角、切换视角并导出当前预览 PNG。它用于构图和机位预演，并非 Blender 级建模器。

## 典型制作流程

1. 在“镜头表管理”建立 Concepts 与镜头资料，补齐角色、场景、动作、机位、连续性和参考图。
2. 为一个镜头打开自由画布，放入角色概念图、场景图和已有参考帧。
3. 需要预演时，添加导演台，摆放基础占位物、确定机位并导出构图参考。
4. 用 Flux.2 Klein 或 Gemini 生成该镜头关键帧；保持同一项目尽量使用同一图像模型以减少风格漂移。
5. 在右侧“镜头表生成”中选择镜头，并指定两张图片：角色概念图与镜头参考帧。生成并检查 MiniMax 提示词。
6. 使用 MiniMax H3 INT8 / Pruned 生成视频；结果会作为节点回到画布，文件也会保存到输出目录。

## 技术栈

- 前端：React 18、Vite、React Flow、Three.js
- 后端：FastAPI、Pydantic、Uvicorn
- 本地图像/视频：ComfyUI 工作流（Flux.2 Klein、QwenImage、LTX、MiniMax H3、SeedVR2 等）
- 云端图像：Google Gemini API（可选）
- 辅助能力：Ollama / Qwen3-VL（镜头提示词与图片分析，取决于本机配置）、Ultralytics YOLO（图片拆分）

## 目录结构

```text
ai_image_video_generator/
├── backend/
│   ├── config/                 # ComfyUI 工作流 JSON
│   ├── routes/                 # 生成、项目、镜头表 API
│   ├── services/               # ComfyUI、Gemini、视觉 LLM 客户端
│   ├── skills/                 # 图像/视频提示词规则
│   ├── main.py                 # FastAPI 入口
│   └── requirements.txt
├── frontend/                   # React 自由画布、镜头表与导演台
├── outputs/_temp/              # 生成结果、画布项目、镜头表与 Concepts
└── README.md
```

## 环境要求

- Python 3.10+
- Node.js 18+
- 已启动的 ComfyUI（默认 `http://127.0.0.1:8188`）以及所选工作流的全部模型/自定义节点
- 使用 Gemini 时的 Google AI Studio API Key
- 使用镜头提示词辅助功能时，本地可用的 Ollama / Qwen3-VL 配置

## 快速开始

### 1. 配置后端

```powershell
cd backend
python -m venv venv
.\venv\Scripts\python.exe -m pip install -r requirements.txt
```

在 `backend/.env` 新建或补充配置（仅使用 Gemini 时需要）：

```env
GOOGLE_AI_STUDIO_API_KEY=你的_Gemini_API_Key
```

ComfyUI 地址、输出目录及 Ollama 模型等本机参数，请按 `backend/services/` 中的客户端配置与你的环境保持一致。

```powershell
.\venv\Scripts\python.exe -m uvicorn main:app --host 0.0.0.0 --port 8001
```

访问 `http://localhost:8001/api/status` 可检查 ComfyUI 与 Gemini 连接状态。

### 2. 启动前端

```powershell
cd frontend
npm install
npm run dev
```

打开 `http://localhost:5173/`。Vite 会将 `/api` 与 `/static` 代理到 `http://localhost:8001`；MiniMax 推理耗时较长，代理超时已设为两小时。

## 数据与输出

- 图片/视频默认写入 `outputs/_temp/generator_outputs/`。
- 自由画布项目保存在 `outputs/_temp/freeCanvas/`。
- 镜头表保存在 `outputs/_temp/shotbreakdown/`，Concepts 保存在 `outputs/_temp/concepts/`。
- 这些都是工作数据；清理前请备份需要保留的素材和 JSON。

## 常见问题

### ComfyUI 未连接或生成失败

确认 ComfyUI 已启动、地址与 `backend/services/comfyui_client.py` 一致；再确认所选工作流的模型、节点和 workflow JSON 均已安装。`/api/status` 只能确认服务连接，不代表某个工作流依赖齐全。

### MiniMax H3 长时间没有结果

本地视频推理通常远慢于生图。保持 ComfyUI 和前后端运行；显卡显存、模型加载和分辨率都会显著影响耗时。

### 导演台或画布没有恢复

导演台会随自由画布项目 JSON 保存。浏览器临时缓存不等同于正式项目保存；重要镜头请使用项目栏保存，并保留对应的 `outputs/_temp` 数据。

## 安全说明

- 不要提交 `backend/.env` 或真实 API Key。
- `outputs/` 可能包含项目素材和生成内容；分享或清理前请确认其中不含敏感资料。

<!-- 以下是旧版 README 内容，仅为保留历史文本，不再作为当前说明展示。

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
-->
