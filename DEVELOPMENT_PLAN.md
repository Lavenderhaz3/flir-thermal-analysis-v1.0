# 红外测温分析软件 — 开发方案

## 1. 项目概述

对 FLIR 红外热像仪拍摄的设备图谱进行温度分析、设备识别、人工校核、报告输出。

## 2. PoC 验证结论

### FLIR 温度数据可读性

| 验证项 | 结果 |
|--------|------|
| FLIR Radiometric JPEG 温度提取 | ✅ Python 可行 |
| 跨平台 (Linux/Docker) | ✅ 纯 Python + exiftool |
| 需要 FLIR Atlas SDK | ❌ 不需要 |
| 需要 Windows 服务 | ❌ 不需要 |

### 技术链路

```
FLIR JPEG ──exiftool──▶ Planck 参数 (R1/R2/B/F/O) + 大气参数
     │
     ├──exiftool -b──▶ 原始热数据 PNG (uint16)
     │
     └──Planck 反演──▶ 温度矩阵 (°C)
```

### 已验证相机型号

- FLIR AX8 (80×60)
- FLIR T1040 (1024×768)

### 温宽问题（已澄清）

PoC 阶段发现温度异常（几百°C），初期误判为「窄温宽导出问题」。

**实际根因：字节序 + 公式错误**（详见 FLIR_TECHNICAL_NOTES.md 第 101-108 行）：
1. FLIR 内嵌 PNG uint16 字节序高/低位交换，直接读取得到错误 raw 值
2. 旧 PoC 使用了 `Real2IR + S−O` 公式，正确为 `raw+O` 无 Real2IR

修复后温度正常（21~34°C），无需温宽校准。

**真正的温宽问题（仍可能发生）：** 若 FLIR 导出时选了窄温宽（非全量程），JPEG 内嵌 raw 会按温宽缩放而 Planck 参数仍是全量程的。检测方法：字节修复后 raw 中位数 vs 元数据 RawValueMedian 是否一致。

## 3. 依赖项

| 依赖 | 用途 | 安装 |
|------|------|------|
| exiftool | FLIR 元数据 + 原始热数据提取 | `brew install exiftool` / `apt install exiftool` |
| numpy | 矩阵运算 | `pip install numpy` |
| Pillow | PNG 解码 | `pip install Pillow` |

## 4. 核心公式

> ⚠️ **权威来源：** 以 `FLIR_TECHNICAL_NOTES.md` 和 `flir_verify_poc.py:raw_to_temperature()` 为准。
> 下方为正确公式摘要。

### 温度计算（Planck 反演）

```
# 字节序修复后直接使用相机计数值，不除以 Real2IR
# 完整大气校正（发射率、距离、湿度、窗口、反射）后：
T(°C) = B / ln(R1 / (R2 × (raw_obj + O)) + F) - 273.15    ← 注意是 +O
```

### 参数说明

| 参数 | 来源 | 说明 |
|------|------|------|
| R1, R2, B, F, O | EXIF Planck 标签 | Planck 标定常数 |
| raw_obj | 内嵌 PNG 字节修复 + 大气校正后 | 物体辐射计数值 |
| raw_pixel | 内嵌 PNG（uint16） | 必须字节序修复后再用，不除 Real2IR |

完整大气校正公式（6 项扣除）见 `FLIR_TECHNICAL_NOTES.md` 第 56-90 行。

## 5. 系统架构

```
浏览器 (React + Konva.js)
    ↓
FastAPI 后端
    ↓
┌─────────────────────────────────────┐
│ 文件导入 → 温度解析 → 设备识别 → 校核 → 报告 │
│    ↓           ↓          ↓        ↓      │
│  zip/jpg   exiftool   YOLO模型    docxtpl │
│             Planck                人工标注 │
└─────────────────────────────────────┘
    ↓
PostgreSQL + MinIO / 本地文件存储
    ↓
Docker Compose 部署
```

## 6. 分阶段计划

### Phase 0 (已完成)：PoC 验证
- [x] 验证 FLIR JPEG Python 可读
- [x] 验证多相机型号兼容性
- [x] 明确温宽问题及解决方案

### Phase 1 (MVP)
- [ ] 文件上传（zip/jpg）
- [ ] 文件名解析（日期/区域/设备）
- [ ] FLIR 温度矩阵解析
- [ ] 手动画框选择设备区域
- [ ] 框内最高温/平均温/温差计算
- [ ] 人工校核界面
- [ ] Word 报告生成（docxtpl）
- [ ] 按日期/设备文件夹归档

### Phase 2 (AI)
- [ ] 标注训练数据（≥500 张）
- [ ] YOLO 设备检测模型训练
- [ ] 自动框选 + 人工修正
- [ ] 校核结果入训练集

### Phase 3 (工程化)
- [ ] 模型版本管理
- [ ] 历史趋势分析
- [ ] 异常阈值告警
- [ ] 多站点/多用户

## 7. 文件结构

```
detect/
├── HERMES_HANDOFF.md       # 开发交底文档（任何 AI 读到就能接着开发）
├── DEVELOPMENT_PLAN.md      # 本文件
├── FLIR_TECHNICAL_NOTES.md  # 技术笔记（公式、相机兼容性）
├── flir_verify_poc.py       # FLIR 温度提取 PoC 脚本
├── storage/                 # 测试输出目录
├── backend/                 # FastAPI 后端（待开发）
├── frontend/                # React 前端（待开发）
├── model-service/           # 设备识别模型（待开发）
└── docker-compose.yml       # Docker 部署（待开发）
```
