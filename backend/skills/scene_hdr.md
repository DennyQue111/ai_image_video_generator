# 场景图 HDR 技能（通用版）

## 任务

分析用户上传的场景参考图，生成一张 **2×2 网格布局**的 HDR 4 面板场景概念图。4 个面板从同一站立位置拍摄，每转 90° 拍一张，覆盖 360° 环境。

**核心价值**：参考图提供**风格 DNA**（色调、笔触、氛围、光影逻辑），提示词负责定义场景的**空间结构、建筑特征和环境动态**。

**适用模型**：Flux.2 Klein 9B / Qwen Image Edit 2511（图生图编辑模型，参考图通过 LoadImage 节点注入）

---

## 工作流程（5 步分析）

撰写提示词前，先对参考图做以下分析。**分析过程不写进最终 prompt**，但分析结果决定 prompt 内容。

### Step 1: 参考图观察

客观描述参考图中可见的内容——不发明、不美化。

| 类别 | 观察要点 |
|------|---------|
| **地理** | 地形类型（城市/乡村/山野/工业/虚空），地势起伏，自然与人造比例 |
| **空间布局** | 前景（近、细节多）→ 中景（主体区域）→ 背景（纵深、消失点）三层结构 |
| **建筑** | 建筑风格、年代、材料、结构语言（粗野/有机/赛博朋克/民居/极简），高度范围，密度，状况 |
| **基础设施** | 道路、桥梁、电线、路灯、招牌、公共交通元素 |
| **时间天气** | 时间段，季节，天气（晴/雨/雾/雪/霾），天空状况 |
| **光源** | 自然光（日/月方向）、人工光（路灯/霓虹/窗户/车灯）、环境光（天光/反射）。色温和扩散方式 |
| **氛围** | 光线和天气传达的情绪。颗粒物：雾/霾/雨/尘/烟/余烬 |
| **材质** | 主导表面材质：湿沥青、锈金属、光滑玻璃、粗糙混凝土等 |
| **色彩分布** | 背景基色（%覆盖）+ 中景点缀色 + 前景细节色 |
| **生活痕迹** | 磨损、锈迹、碎片、涂鸦、废弃物 |
| **比例参照** | 什么提供尺寸参照：人物、车辆、门、路灯 |

**规则**：元素被阴影、景深虚化、雾气遮挡时标注"不可见"——不要猜。

### Step 2: 风格分析

参考图的渲染美学是生成模型需要近似的核心。拆解以下维度：

| 维度 | 要点 |
|------|------|
| **线条** | 有无明显轮廓线 / 线条粗细一致性 / 线条性格（机械精确/笔触感/速写/墨线） |
| **阴影** | 平涂赛璐璐 / 柔和渐变 / 硬阴影高对比 / 环境光遮蔽 / 阴影深度 |
| **色彩** | 冷暖倾向 / 饱和度 / 色调感（青橙大片/冷蓝科幻/暖怀旧/漂白废土）|
| **材质渲染** | 混凝土、金属、玻璃、地面、水面 |
| **镜头语言** | 焦距感（广角/标准/长焦）/ 角度 / 景深 / 构图法则 |
| **氛围特效** | 雾密度 / 体积光 / 镜头光晕 / 泛光 / 暗角 / 颗粒 |

**风格关键词串**：分析完成后，提炼为一句紧凑的英文关键词串，用于【风格锚定】模块。

### Step 3: 场景定位

1. **目标场景**：哪个位置？（全景建立 / 特定建筑 / 街道层 / 室内等）
2. **排除项**：什么不属于场景？（**必须排除所有人物、角色专属道具**）
3. **用户内容覆盖**：参考图风格 + 用户描述内容
4. **矛盾处理**：用户要求与参考图物理逻辑冲突时，按用户内容 + 参考图色彩/光影逻辑执行

### Step 4: 空间解构

场景没有"正面/侧面/背面"，有的是**空间层**和**替代角度**。

```
前景（距相机最近）：
- 可见元素：[直接可见的前景物体/纹理]
- 纵深功能：[框中框？遮挡元素？比例参照？]
- 主导材质与光线质感：[...]

中景（主体区域）：
- 可见元素：[核心场景特征]
- 视觉锚点：[吸引视线的唯一要素——建筑、光源、地标]
- 主导材质与光线质感：[...]

背景（纵深 / 消失点）：
- 可见元素：[建筑、天际线、山、天空、地平线]
- 纵深处理：[大气透视？锐利细节？剪影？]
- 主导材质与光线质感：[...]
```

### Step 5: 生成英文提示词

将 Step 1-4 的分析结果填入下方的英文模块化提示词结构。

---

## 提示词结构（英文）

**输出语言**：英文（Flux/QwenImage Edit 对英文理解最精准）

```
A 2x2 grid layout of the same scene from 4 angles:

[Layout]
2x2 grid, 4 equal panels separated by thin dark lines. 4 photos taken from the same standing position, rotating 90° between each shot, 28mm wide-angle lens.
Top-left: Front (0°), main viewpoint.
Top-right: Right (90°), right side environment.
Bottom-left: Back (180°), reverse direction.
Bottom-right: Left (270°), left side environment.

[Scene Definition]
[Scene name] + [Indoor/Outdoor/Semi-indoor] + [Time of day] + [Weather]

[Front 0° — Main View]
[Foreground → Midground → Background three layers] + [Architectural features and materials] + [Light source direction and hardness] + [Wear marks and life traces] + [Scale reference elements] + [Dominant color and atmosphere]

[Right 90°]
[Right side wall materials, side passage, side lighting, different building facades]

[Back 180°]
[Reverse view: path back, building backs, opposite depth. Together with front, forms the scene's in-out relationship]

[Left 270°]
[Left side environment, mirror of right but with different details]

[Style Anchor]
[Style keyword string from Step 2 — color palette, line quality, shadow type, atmosphere effects]

[Environmental Atmosphere]
[Overall mood] + [Atmospheric perspective] + [Particulates: fog/haze/rain/dust] + [Volumetric light scattering]

[Environmental Dynamics]
[Wind/airflow direction and intensity] + [Affected elements: flags fluttering, cables swaying, puddle ripples, dust dancing] + [Dynamic layering]
```

**长度建议**：200-400 单词。超过 400 词时生成模型容易丢失细节。

---

## 完整示例

**参考图**：赛博朋克贫民区窄巷

**生成的提示词**：

```
A 2x2 grid layout of the same scene from 4 angles:

[Layout]
2x2 grid, 4 equal panels separated by thin dark lines. 4 photos taken from the same standing position, rotating 90° between each shot, 28mm wide-angle lens.
Top-left: Front (0°), alley main viewpoint.
Top-right: Right (90°), right side environment.
Bottom-left: Back (180°), looking from alley end toward entrance.
Bottom-right: Left (270°), left side environment.

[Scene Definition]
Slum district main alley, outdoor, cyberpunk dystopian city lower residential area, late night, just rained, wet ground.

[Front 0° — Main View]
Foreground: wet irregular stone slab ground, puddles reflecting neon colors, scattered metal fragments and debris at edges.
Midground: dense multi-story modular housing on both sides — metal panel + concrete + recycled material walls, external pipes and ventilation ducts, barred windows emitting cold blue light.
Background: alley vanishes into atmospheric haze, neon signs (magenta horizontal tubes + sickly green vertical panels) fading into fog, vanishing point at mid-frame.
Overhead: power lines and data cables interwoven into a partial canopy.
Lighting: overhead horizontal neon tubes (magenta + cyan-green), building facade warm amber wall lamps, cold blue window glow.
Dominant colors: deep cyan-blue base ~60%, magenta neon ~25%, warm amber ~15%.

[Right 90°]
Right building side wall — metal panels over concrete, rivets, rust streaks. Narrow side passage leading deeper, warm amber wall lamp. Wet ground still reflects neon. Overhead cable density increases, some sagging.

[Back 180°]
View from alley dead-end toward entrance. Shows building backs — different window arrangements, half-collapsed metal awnings, flickering neon signs seen from behind. Alley mouth opens to slightly wider street, distant building silhouettes. Still wet ground with puddles.

[Left 270°]
Left building side — mirrors right but different details. Abandoned metal doorframe half-open, wall graffiti and pipes. Side alley entrance visible in distance. Wet ground, scattered debris.

[Style Anchor]
Cyberpunk aesthetic, deep cyan-blue base with magenta neon accents, warm amber highlights, soft gradient shadows, atmospheric perspective, volumetric light scattering, film grain, cinematic 28mm wide-angle.

[Environmental Atmosphere]
Claustrophobic oppressive isolation. Atmospheric perspective softens background. Moist haze permeates. Neon volumetric light scattering, soft glow halos. Dark areas near-black but retain detail.

[Environmental Dynamics]
Light cold wind along alley direction. Overhead cables sway slightly. Puddles show tiny ripples. Distant neon signs flicker subtly in moisture. Fine water droplets drift in air, forming translucent light layer in neon glow.
```

---

## 关键规则

1. **英文优先**：Flux/QwenImage Edit 对英文长句描述理解最精准
2. **Layout 先于内容**：开篇先声明 2×2 网格结构，再逐面板撰写内容
3. **环境动态不可忽视**：【Environmental Dynamics】是场景概念图的核心价值——让场景从模型道具变成活着的空间
4. **主视觉锚定一切**：Front 0° 面板的光照、时间、氛围必须贯穿所有面板，保证一致性
5. **场景概念图不含人物**：不描述任何人物。用建筑元素（门、车、路灯）作为比例参照
6. **色板是生产工具**：颜色描述要带材质语境——"deep cyan-blue"不够，"deep cyan-blue wet stone ground at night"才够
7. **字数超限时的取舍优先级**：
   - 第一删：重复的材质描述
   - 第二删：Back 180° 和 Left 270° 的细节，每面板保留 1 句
   - 绝对保留：[Layout] [Front 0°] [Style Anchor]

## 输出要求

- 只输出英文提示词，不要任何中文解释
- 不要输出 markdown 代码块标记（```）
- 不要输出分析过程
- 提示词以 "A 2x2 grid layout of the same scene from 4 angles:" 开头
- 用户额外要求（custom_instruction）融入对应模块，不破坏整体结构
