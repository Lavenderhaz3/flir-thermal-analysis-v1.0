# FLIR 设备识别模型训练管道 — 方案与设计

> **状态：设计阶段，待评审 | 2026-05-11**

---

## 1. 目标

在 Windows 上训练一套 YOLOv8 设备检测模型，用于从 FLIR 红外图谱中自动识别电力设备并画框。

输出 5 个 `.pt` 模型文件，放入主项目的 `backend/models/weights/` 目录后，自动检测即可生效。

---

## 2. 当前现状

| 项 | 现状 |
|---|------|
| 设备类型 | 5 类：transformer、switchgear、cable、busbar、insulator |
| 模型权重 | 占位，均为空或不存在 |
| 兜底策略 | 无模型时取温度矩阵最高温点自动画框 |
| 图片来源 | 54 张 FLIR T1040 红外图（`/Users/mba/0502/`），更多待采集 |
| 主项目 | macOS 运行，模型路径 `backend/models/weights/{type}.pt` |
| 训练环境 | **Windows**（本方案的目标运行平台） |

---

## 3. 技术选型

### 3.1 标注工具

**选定：MakeSense.ai** — 满足「直接能用、免费、易用」

| 特性 | 说明 |
|------|------|
| 网址 | https://www.makesense.ai |
| 安装 | **零安装** — 打开浏览器即用 |
| 注册 | 不需要，免费无限制 |
| 隐私 | 所有处理在浏览器本地完成，图片不上传服务器 |
| YOLO 导出 | 原生支持，导出 zip 含 `.txt` 标注文件 |
| 格式 | class_id x_center y_center width height（归一化，与 YOLO 训练直接兼容）|
| 操作 | 拖入图片 → 创建标签列表 → 鼠标画框 → 导出 |

**工作流**：
1. Windows 浏览器打开 https://www.makesense.ai
2. 点击 Get Started → 拖入 `data/raw/` 里的图片
3. 创建 5 个标签（transformer, switchgear, cable, busbar, insulator）
4. 逐张画框标注（快捷键：`R` 画框，`Delete` 删框）
5. 导出 → 选择 YOLO 格式 → 下载 `annotations.zip`
6. 解压到 `data/yolo/labels/` → 运行 `02_prepare_dataset.py` 自动划分 train/val

### 3.2 训练框架

**ultralytics YOLOv8**：
- `pip install ultralytics`
- 一行命令训练：`yolo detect train data=dataset.yaml model=yolov8n.pt epochs=100`
- 支持 .pt 导出，直接可被主项目 `torch.hub.load()` 加载
- Windows 原生支持（需 CUDA 或 CPU）

### 3.3 推理集成方式

主项目 `auto_detect.py` 目前代码注释里写了 `torch.hub.load('ultralytics/yolov5', …)`（YOLOv5 API），**实际应改为 ultralytics YOLOv8 API**：

```python
from ultralytics import YOLO
model = YOLO(model_path)
results = model(image_path)
```

### 3.4 运行环境

```
Windows 10/11
Python 3.9 ~ 3.11
NVIDIA GPU + CUDA（用户已确认有 GPU）
—— 也可 CPU 训练（慢），脚本自动检测
存储：建议 50GB+ 空闲（图片 + 训练输出）
```

---

## 4. 目录结构

独立于主项目存放，方便在 Windows 上操作：

```
flir-model-training/                  # 新建独立仓库
├── README.md                         # 本方案的简化版，上手指南
├── requirements.txt                  # ultralytics, opencv-python, numpy, pyyaml
│
├── scripts/
│   ├── 01_labels.txt                  # 供 MakeSense.ai 导入的标签列表（5 类）
│   ├── 02_prepare_dataset.py          # 解压 MakeSense 导出 → 划分 train/val → 生成 dataset.yaml
│   ├── 03_train.py                   # YOLOv8 训练入口（自动检测 GPU/CPU）
│   ├── 04_evaluate.py                # mAP / PR 曲线 / 混淆矩阵
│   └── 05_deploy.py                  # 复制 best.pt → models/ → 提示拷到 U 盘路径
│
├── data/
│   ├── raw/                          # 原始 FLIR JPEG（从相机/主项目拷过来）
│   │   ├── 2025-05-02主变区-T01变压器.jpg
│   │   ├── 2025-05-02开关区-CB03开关柜.jpg
│   │   └── ...
│   │
│   └── yolo/                         # YOLO 格式训练集（脚本自动生成）
│       ├── dataset.yaml              # class 定义 + train/val 路径
│       ├── images/
│       │   ├── train/                # 70%
│       │   └── val/                  # 30%
│       └── labels/
│           ├── train/                # 每张图对应一个 .txt
│           └── val/
│
├── runs/                             # YOLO 训练输出（自动生成）
│   └── detect/
│       └── trainN/
│           ├── weights/
│           │   ├── best.pt           # ← 这个就是最终模型
│           │   └── last.pt
│           ├── results.png           # 训练曲线
│           ├── confusion_matrix.png
│           └── PR_curve.png
│
└── models/                           # 整理后的最终模型
    ├── transformer.pt
    ├── switchgear.pt
    ├── cable.pt
    ├── busbar.pt
    └── insulator.pt
```

---

## 5. 工作流（五步）

```
┌──────────────────────────────────────────────────────────────┐
│  Step 1           Step 2          Step 3       Step 4   Step 5│
│  ─────────        ────────        ────────      ───────  ─────│
│  准备图片  ───►  标注设备  ───►  训练模型 ───►  评估   ───►  部署│
│  (拷到raw/)   (MakeSense.ai)  (YOLOv8)     (mAP等)  (→U盘)│
│                                                              │
│  时间: 5min      时间: N×图       时间: 30min-2h   10min   1min │
└──────────────────────────────────────────────────────────────┘
```

### Step 1：准备图片

从主项目或相机收集 FLIR JPEG，放入 `data/raw/`。建议每类至少 50 张，总数 ≥ 200 张开始训练有效果。

如果红外图中设备不明显，可同时放入可见光对照图（FLIR 相机通常 MSX 混合模式已嵌入）。

### Step 2：标注（MakeSense.ai）

1. Windows 浏览器打开 https://www.makesense.ai
2. 点击 **Get Started** → 拖入 `data/raw/` 下的所有图片
3. 点击 **Create labels list**（或从 `scripts/01_labels.txt` 粘贴导入）

标签定义（与主项目 `MODEL_MAP` 一致）：

| class_id | 标签 | 中文 |
|:---:|---|------|
| 0 | transformer | 变压器 |
| 1 | switchgear | 开关柜 |
| 2 | cable | 电缆 |
| 3 | busbar | 母线 |
| 4 | insulator | 绝缘子 |

标注完后导出 → 选 **Export Labels** → 选 **YOLO** 格式 → 下载 `annotations.zip`

### Step 3：数据转换 & 训练

```bash
# 将 MakeSense 导出的 annotations.zip 解压到 data/yolo/labels/
# 然后运行脚本：自动划分 train/val → 生成 dataset.yaml
python scripts/02_prepare_dataset.py

# 训练（自动检测 GPU / CPU）
python scripts/03_train.py
# 等价于: yolo detect train data=data/yolo/dataset.yaml model=yolov8n.pt epochs=100 imgsz=640
```

YOLOv8 模型选择：

| 模型 | 参数量 | 速度 | 适用 |
|------|:---:|------|------|
| yolov8n | 3.2M | 最快 | 数据 <500 张，设备类别少 |
| yolov8s | 11.2M | 快 | 数据 500-2000 张 |
| yolov8m | 25.9M | 中 | 数据 >2000 张 |

推荐从 `yolov8n.pt` 起步，快速迭代。

### Step 4：评估

```bash
python scripts/04_evaluate.py
# 输出: mAP@50, mAP@50-95, 每类 AP, 混淆矩阵
```

验收标准（建议）：
- mAP@50 ≥ 0.8 达到可部署水平
- 每类 AP ≥ 0.7，无类别完全识别不出
- 在未参与训练的测试图上人工抽查 10 张，框位置合理

### Step 5：部署到主项目

```bash
python scripts/05_deploy.py
# 自动将 runs/detect/trainN/weights/best.pt → 重命名为 models/{type}.pt
# 提示：将 models/ 目录下的 .pt 文件通过 U 盘拷到 Mac 主项目：
#   "/Users/mba/claude code/detect/backend/models/weights/"
```

部署后需更新主项目 `auto_detect.py` 的 `_yolo_detect()` 函数，从 YOLOv5 hub API 改为 ultralytics YOLOv8 API（参见第 3.3 节）。

---

## 6. 关键设计决策

### 6.1 五类模型独立训练 vs 单模型多类

| 方案 | 优点 | 缺点 |
|------|------|------|
| **独立训练**（当前设计） | 每类一个模型，按项目 model_type 精确加载 | 需要 5 次训练，每类需足量数据 |
| 单模型多类 | 一次训练，自动分类 | 框内类别可能不匹配项目设定 |

**选择独立训练**，原因：主项目按 `project.model_type` 决定加载哪个模型，架构已经这么设计了。且用户知道这张图应该识别什么设备（文件名里带了），不需要模型猜类别。

### 6.2 标注坐标系

MakeSense.ai 标注的是**显示图像坐标**（在浏览器中看到的 JPEG 像素位置），而主项目 annotations 存的是温度矩阵坐标。**训练用显示图像坐标即可**，因为推理时输入的是 JPEG 显示图，输出的框自然也是显示坐标。主项目 `_yolo_detect()` 应在推理后做一次坐标映射（显示 → 温度矩阵），已在 `auto_detect.py` TODO 注释中说明。

### 6.3 数据增强

FLIR 红外图相对固定（角度、距离、环境），数据增强很重要：
- 水平翻转（设备通常左右对称）
- 小幅旋转（±10°）
- 亮度/对比度调整
- Mosaic（YOLO 默认开启）

这些都是 YOLOv8 训练时自动处理的，不需要额外脚本。

### 6.4 飞轮闭环

```
图片上传 → 人工标注(MakeSense) → 训练 → .pt 模型 → U盘 → Mac主项目
                    ↑                                        │
                    │         自动检测(主项目)                  │
                    │               │                         │
                    └── 人工修正 ←── 自动框 ←─────────────────┘
```

长期来看，主项目中 `status="reviewed"` 的 manual 标注也应能导回到训练项目作为新标注数据。这作为 Phase 2。

---

## 7. 依赖清单

### Python 包（requirements.txt）

```
ultralytics>=8.2
opencv-python>=4.8
numpy>=1.24
pyyaml>=6.0
torch>=2.0          # PyTorch（CUDA 版自动检测）
```

### 系统要求

- Windows 10/11
- Python 3.9-3.11
- NVIDIA GPU + CUDA 11.8 或 12.x（已确认有 GPU）

---

## 8. 实施计划（待评审通过后执行）

本次只出方案，不做代码。以下是后续实施的任务拆解预览：

| # | 任务 | 产出 |
|---|------|------|
| 1 | 创建项目骨架（目录 + requirements.txt + README） | 可 git clone 的仓库 |
| 2 | `01_labels.txt` — 5 类标签列表（MakeSense 导入用） | 标注配置 |
| 3 | `02_prepare_dataset.py` — 解压 MakeSense 导出 zip → 划分 train/val → 生成 dataset.yaml | 训练数据就绪 |
| 4 | `03_train.py` — YOLOv8 训练封装（自动 GPU/CPU 检测，独立 5 类训练） | 训练脚本 |
| 5 | `04_evaluate.py` — 输出 mAP / PR 曲线 / 混淆矩阵 | 评估报告 |
| 6 | `05_deploy.py` — 复制 best.pt → models/{type}.pt → 提示 U 盘目标路径 | 部署自动化 |
| 7 | 更新主项目 `auto_detect.py` — YOLOv5 hub → ultralytics YOLOv8 | 推理兼容 |
| 8 | 端到端验证 — 用主项目图片跑一遍完整流程 | 功能确认 |

---

## 9. 风险

| 风险 | 概率 | 缓解 |
|------|:---:|------|
| 红外图设备特征不明显 | 中 | 可见光 MSX 对照、增大标注框包含更多上下文 |
| 五类数据不均衡 | 高 | 数据增强 + 迁移学习（yolov8n 预训练权重）+ 采集补足 |
| Windows CUDA 配置复杂 | 低 | ultralytics 自动检测 GPU；`03_train.py` 内置 fallback 到 CPU |
| MakeSense 导出格式差异 | 低 | `02_prepare_dataset.py` 做归一化校验和格式修复 |
| 坐标系混乱（显示 vs 温度矩阵） | 中 | 全程在 YOLO 标注中使用显示坐标，推理后在 `_yolo_detect()` 统一映射 |
| U 盘跨系统文件路径不兼容 | 低 | .pt 文件二进制跨平台通用；路径用脚本自动处理 |

---

## 10. 用户决策（已确认）

| # | 问题 | 决策 |
|---|------|------|
| 1 | 标注工具 | **MakeSense.ai** — 浏览器即用，零安装 |
| 2 | 数据来源 | **等更多图片**，暂不用现有 54 张 |
| 3 | 模型粒度 | **5 类独立训练**，每类一个 .pt |
| 4 | 训练硬件 | **NVIDIA GPU 可用**，CUDA 加速 |
| 5 | 部署方式 | **U 盘** 从 Windows → Mac 主项目 |
