# FLIR 红外测温分析系统 — 开发交底

> **最后更新：2026-05-11 | 项目状态：v1.0 已完成 | 标签：v1.0**

打开本文件，任何 AI（Claude / Codex / Copilot / Hermes 本身）都能立刻接手继续开发。

---

## 1. 项目是什么

对 FLIR 红外热像仪拍摄的设备图谱做：温度提取 → 设备识别（YOLO + 热点兜底）→ 手动/自动画框校核 → Word 报告生成。

**已部署为完整 Web 应用** — 前端 React + Konva 画框，后端 FastAPI + SQLite，同一台 Mac 上跑。

---

## 2. 当前状态：v1.0 已实现

```
✅ FLIR 温度提取（纯 Python，exiftool + Planck 反演，不依赖 Atlas SDK）
✅ 文件上传（单张 JPG / ZIP 批量）
✅ 文件名解析（YYYY-MM-DD区域-设备编号类型.jpg）
✅ 自动检测（YOLO 设备识别 or 热点定位）
✅ 手动/自动画框（Konva，可拖拽缩放，一个框可多张图）
✅ 框内温度统计（Tmax / Tmin / Tmean，最高温坐标）
✅ Word 报告生成（docxtpl 模板渲染）
✅ 按 项目/日期/设备 三级文件夹归档
✅ GitHub: https://github.com/Lavenderhaz3/flir-thermal-analysis-v1.0 (tag: v1.0)
```

---

## 3. 怎么跑起来

### 环境

- macOS Apple Silicon
- Python 3.9.6（不要用 3.10+ 语法，不允许 `dict | None`，用 `Optional[dict]`）
- Node 25.9.0 / npm 11.12.1
- exiftool: `/opt/homebrew/bin/exiftool`

### 启动

```bash
# 终端 1：后端
cd "/Users/mba/claude code/detect/backend"
python3 -m uvicorn main:app --port 8000

# 终端 2：前端
cd "/Users/mba/claude code/detect/frontend"
npm run dev
```

- 后端：http://localhost:8000/api/health
- 前端：http://localhost:5173
- API 文档：http://localhost:8000/docs

### 停止 / 清理

```bash
# 杀掉占用 8000 端口的进程
lsof -ti:8000 | xargs kill -9

# 重置数据库 + 清空上传文件
rm "/Users/mba/claude code/detect/backend/app.db"
rm -rf "/Users/mba/claude code/detect/backend/uploads"
```

### 已知坑

- `lsof -ti:8000` 有时输出为空（进程列表不显示），但 kill -9 仍然需要先跑，防止端口占用
- 数据库 schema 变更 -> 必须 `rm app.db && rm -rf uploads` 然后重启后端
- SQLite，单文件 `backend/app.db`，多用户场景需切换 PostgreSQL

---

## 4. 核心架构

```
上传 JPG/ZIP → FastAPI → FLIR 参数提取(exiftool) → Planck 温度矩阵(npy)
                                │
                    ┌───────────┴───────────┐
                    ▼                       ▼
              文件名解析              自动检测(选)
              (日期/区域/设备)         ├─ YOLO 设备框
                    │                 └─ 热点定位(兜底)
                    ▼                       │
              SQLite 存储 ◄─────────────────┘
                    │
        ┌───────────┼───────────┐
        ▼           ▼           ▼
    图片列表   标注编辑器   报告生成
   (React)   (Konva画框)  (docxtpl)
```

### 文件树（实际代码，不是规划）

```
"/Users/mba/claude code/detect/"
├── HERMES_HANDOFF.md            ◀── 本文件
├── DEVELOPMENT_PLAN.md          开发方案（部分内容已过时）
├── FLIR_TECHNICAL_NOTES.md      技术笔记（温度公式权威）
├── flir_verify_poc.py           PoC 验证脚本（命令行测单张图片）
│
├── backend/
│   ├── main.py                  FastAPI 入口
│   ├── config.py                DATABASE_URL + UPLOAD_DIR
│   ├── app.db                   SQLite 数据库
│   ├── uploads/                 {project_id}/{date}/{equipment}/*.jpg/npy/png
│   ├── models/
│   │   ├── database.py          SQLAlchemy engine + session
│   │   ├── schema.py            Project / Image / Annotation 表
│   │   └── weights/             模型权重目录（YOLO .pt 文件）
│   ├── routes/
│   │   ├── projects.py          项目 CRUD
│   │   ├── images.py            上传 + 批量处理 + 自动检测
│   │   ├── annotations.py       画框 CRUD + 框内温度计算
│   │   └── reports.py           报告生成
│   └── services/
│       ├── flir_extractor.py    FLIR 温度提取核心（exiftool + Planck）
│       ├── filename_parser.py   文件名解析
│       ├── auto_detect.py       YOLO 检测 / 热点定位
│       ├── report_generator.py  Word 报告（docxtpl）
│       └── create_template.py   创建默认 Word 模板
│
└── frontend/
    ├── package.json             React 19 + Konva 10 + Vite
    └── src/
        ├── App.tsx              路由
        ├── main.tsx             入口
        ├── api/client.ts        axios 封装
        └── pages/
            ├── ProjectList.tsx      项目列表
            ├── ProjectDetail.tsx    图片列表 + 上传
            └── AnnotationEditor.tsx 画框编辑器（Konva 核心）
```

---

## 5. 绝对不可改的公式（已验证，与 FlirImageExtractor/flirpy/Thermimage 一致）

### FLIR 温度公式

```python
# 字节序修复（FLIR 内嵌 PNG uint16 高低位交换）
raw = (raw >> 8) + ((raw & 0xFF) << 8)

# Planck 反演（注意：raw 直接用相机计数值，不除以 Real2IR！）
# 完整大气校正后得到 raw_obj，然后：
T_celsius = B / math.log(R1 / (R2 * (raw_obj + O)) + F) - 273.15
#                                              ^^^
#                                  注意是 +O，不是 −O
```

| 参数 | 来源 | 说明 |
|------|------|------|
| R1, R2, B, F, O | EXIF Planck 标签 | Planck 标定常数 |
| raw_obj | PNG 字节修复 + 大气校正(6项)后 | 物体辐射计数值 |
| Real2IR | ❌ 不使用 | 旧公式错在这里 |
| 大气校正 | 发射率/距离/湿度/窗口/反射 | 6 项扣除，详见 FLIR_TECHNICAL_NOTES.md |

### 权威来源（按优先级）

1. `flir_verify_poc.py` — `raw_to_temperature()` 函数
2. `FLIR_TECHNICAL_NOTES.md` 第 56-90 行
3. `backend/services/flir_extractor.py` — 服务化版本

### ⚠️ DEVELOPMENT_PLAN.md 第 55-56 行是旧公式

```
旧（错误）：signal = raw/Real2IR, signal − O
新（正确）：raw 直接用，raw + O
```
禁止使用 DEVELOPMENT_PLAN.md 的旧公式！

---

## 6. 坐标映射（温度矩阵 ↔ 前端画布）

FLIR JPEG 显示分辨率通常 ≠ 热分辨率，前端画框必须映射：

```python
scale_x = display_w / thermal_w
scale_y = display_h / thermal_h

# 前端（显示坐标）→ 后端（温度矩阵坐标）
thermal_x = int(display_x / scale_x)
thermal_y = int(display_y / scale_y)
```

- T1040 (1024×768)：通常 scale=1.0（热分辨率 = JPEG 分辨率）
- AX8 (80×60)：JPEG 显示 640×480，scale≈8.0，**绝对不能假设 scale=1**

后端存储 `display_width/height` 和 `thermal_width/height` 两套尺寸，坐标转换在 `annotations.py:calc_box_temps()` 中处理。

---

## 7. 数据表结构（SQLite）

```sql
projects:
  id, name, model_type, report_template_path, created_at

images:
  id, project_id(FK), filename, original_path, thermal_npy_path, preview_path,
  date, area, equipment,
  t_min, t_max, t_mean,
  thermal_width, thermal_height, display_width, display_height,
  created_at

annotations:
  id, image_id(FK), box_coords(JSON), version,
  t_max, t_min, t_mean,
  max_x, max_y,                   -- 框内最高温像素坐标
  source('manual'|'auto'),        -- blue=auto, green=manual（前端约定）
  status, reviewed_by, created_at
```

---

## 8. 前端 Konva 关键约定

- **蓝色框** = 自动检测框（`source: "auto"`）
- **绿色框** = 手动绘制框（`source: "manual"`）
- 不要对 `KonvaImage` 设置 `listening={false}`，否则 Stage 收不到绘制事件
- 框可拖动 + 右下角缩放（Transformer 组件）
- 每个框内显示最高温标签（Text 组件）

---

## 9. 文件名解析规则

格式：`YYYY-MM-DD区域-设备编号类型.jpg`

```python
PATTERN = re.compile(
    r'^(?P<date>\d{4}-\d{2}-\d{2})'
    r'(?P<area>[A-Za-z\u4e00-\u9fff]+)'
    r'-(?P<equip_id>[A-Za-z0-9]+)'
    r'(?P<type>[A-Za-z\u4e00-\u9fff]+)'
    r'\.(jpg|jpeg)$'
)
```

示例：`2025-05-02主变区-T01变压器.jpg` → date=2025-05-02, area=主变区, equip_id=T01, type=变压器

---

## 10. 自动检测（auto_detect.py）

两种模式：

1. **YOLO**：项目设置了 `model_type`（transformer/switchgear/cable/busbar/insulator），且对应 `.pt` 权重文件存在于 `backend/models/weights/`
2. **热点兜底**：无模型时取温度矩阵最高温区域，生成一个自动框

检测结果在图片上传时自动执行，框存入 annotations 表（`source="auto"`）。

---

## 11. 测试图片

54 张 FLIR T1040 图片：`/Users/mba/0502/`

PoC 验证单张：
```bash
cd "/Users/mba/claude code/detect"
python3 flir_verify_poc.py /Users/mba/0502/IR_53167.jpg -o output/
```

---

## 12. 已知问题和待做事项

- [ ] 照片可见光模式 → 近红外模式校准/切换
- [ ] YOLO 模型训练（当前权重文件为占位，需真实训练数据）
- [ ] 多用户支持（需将 SQLite 替换为 PostgreSQL）
- [ ] Docker Compose 部署
- [ ] 异常告警（温度超阈值通知）
- [ ] 历史趋势图表
- [ ] 图片对比模式（同设备不同时间）

---

## 13. 给接手的 AI

### 第一步：读这些文件
1. 本文件（你正在读）
2. `FLIR_TECHNICAL_NOTES.md` — 温度公式完整推导
3. `backend/services/flir_extractor.py` — 公式的服务化实现
4. `backend/main.py` — 看看路由和入口

### 第二步：启动验证
```bash
# 确保端口干净
lsof -ti:8000 | xargs kill -9

# 后端
cd "/Users/mba/claude code/detect/backend" && python3 -m uvicorn main:app --port 8000

# 前端（另一个终端）
cd "/Users/mba/claude code/detect/frontend" && npm run dev
```

### 第三步：浏览器打开 http://localhost:5173
- 创建项目
- 上传图片（JPG 或 ZIP）
- 进入图片画框
- 导出报告

### 注意事项
- `python3` 不是 `python`
- Python 3.9 — 别用 3.10+ 语法
- numpy 1.26.x（pin 住的版本）
- 改 DB schema → 删 app.db + uploads 重建
- 前端改完用浏览器验证，不要猜测
- 如果前端报 CORS，检查后端是否在 8000 端口
- 如果 Konva 画框不响应，检查 `listening` 属性

---

## 14. FLIR JPEG 包含可见光照片

FLIR T1040 每张红外图里嵌了一张可见光数码照片：

```
红外热像：1024×768（Iron 色板，温度矩阵嵌在 EXIF 中）
可见光图：1280×960 RGB JPEG（EmbeddedImage 标签）
```

提取命令：
```bash
exiftool -b -EmbeddedImage IR_53167.jpg > visible.jpg
```

**对模型训练的意义**：用可见光图标注设备比用红外图精确得多（看得清形状、纹理、铭牌）。训练计划详见 `docs/MODEL_TRAINING_PLAN.md`。
