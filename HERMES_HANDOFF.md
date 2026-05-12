# FLIR 红外测温分析系统 — 开发交底

> **最后更新：2026-05-11 | 项目状态：v1.1 | 标签：v1.1**

打开本文件，任何 AI（Claude / Codex / Copilot / Hermes 本身）都能立刻接手继续开发。

---

## 1. 项目是什么

对 FLIR 红外热像仪拍摄的设备图谱做：温度提取 → 设备识别（YOLO + 热点兜底）→ 手动/自动画框校核 → 跨项目趋势图 → Word 报告生成。

**已部署为完整 Web 应用 + 桌面 .app** — 前端 React + Konva 画框，后端 FastAPI + SQLite，macOS 双击即用。

---

## 2. 当前状态：v1.1 已实现

```
✅ FLIR 温度提取（纯 Python，exiftool + Planck 反演，不依赖 Atlas SDK）
✅ 文件上传（单张 JPG / ZIP 批量）
✅ 文件名解析（支持 YYYY-MM-DD区域-设备编号[-序号]类型.jpg）
✅ 自动检测（YOLO 设备识别 or 热点定位）
✅ 手动/自动画框（Konva，可拖拽缩放）
✅ 框内温度统计（Tmax / Tmin / Tmean，最高温坐标）
✅ 跨项目趋势图表（同一设备跨日期按名称+区域汇总）
✅ Word 报告生成（含相对温差公式 + 环境温度自动提取）
✅ 项目上限 20 个自动清理 + 手动删除
✅ 一键启动脚本 (start.sh) + macOS .app 桌面程序 (build_app.sh)
✅ 按 项目/日期/设备 三级文件夹归档
✅ GitHub: https://github.com/Lavenderhaz3/flir-thermal-analysis-v1.0
```

---

## 3. 怎么跑起来

### 环境

- macOS Apple Silicon
- Python 3.9.6（不要用 3.10+ 语法，不允许 `dict | None`，用 `Optional[dict]`）
- Node 25.9.0 / npm 11.12.1
- exiftool: `/opt/homebrew/bin/exiftool`

### 一键启动（推荐）

```bash
cd "/Users/mba/claude code/detect"
./start.sh
# 自动杀旧进程 → 检查依赖 → 启动后端+前端 → 打开浏览器
# Ctrl+C 一键停止所有服务
```

### 手动启动

```bash
# 终端 1：后端
cd "/Users/mba/claude code/detect/backend"
python3 -m uvicorn main:app --port 8000

# 终端 2：前端
cd "/Users/mba/claude code/detect/frontend"
npm run dev
```

### 桌面 .app

```bash
cd "/Users/mba/claude code/detect"
./build_app.sh
# 产出 dist/FLIR红外测温.app，双击即用
# 数据保存在 ~/Documents/FLIR分析数据/
```

- 后端：http://localhost:8000/api/health
- 前端：http://localhost:5173
- API 文档：http://localhost:8000/docs

### 停止 / 清理

```bash
lsof -ti:8000 | xargs kill -9

# 完全重置
rm "/Users/mba/claude code/detect/backend/app.db"
rm -rf "/Users/mba/claude code/detect/backend/uploads"
```

### 已知坑

- `lsof -ti:8000` 有时输出为空，但 kill -9 仍要先跑防止端口占用
- SQLite，单文件 `backend/app.db`，多用户场景需切换 PostgreSQL
- Python 3.9 不支持 `X | None` 联合类型语法，必须用 `Optional[X]`
- 后端 main.py 内置了 ALTER TABLE 迁移（atmospheric_temp, equipment_id），但仍建议大改后删 DB 重建

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
        ┌───────────┼───────────┬───────────┐
        ▼           ▼           ▼           ▼
    图片列表   标注编辑器   趋势图表   报告生成
   (React)   (Konva画框)  (SVG折线)  (docxtpl)
```

### 文件树

```
"/Users/mba/claude code/detect/"
├── HERMES_HANDOFF.md            ◀── 本文件
├── start.sh                     一键启动脚本
├── build_app.sh                 PyInstaller .app 构建
├── DEVELOPMENT_PLAN.md          开发方案（部分内容已过时）
├── FLIR_TECHNICAL_NOTES.md      技术笔记（温度公式权威）
├── flir_verify_poc.py           PoC 验证脚本
│
├── backend/
│   ├── main.py                  FastAPI 入口 + uvicorn + DB迁移
│   ├── config.py                DATABASE_URL + UPLOAD_DIR (支持 PyInstaller)
│   ├── app.db                   SQLite 数据库
│   ├── uploads/                 {project_id}/{date}/{equipment}/*.jpg/npy/png
│   ├── templates/report.docx    Word 报告模板
│   ├── models/
│   │   ├── database.py          SQLAlchemy engine + session
│   │   ├── schema.py            Project / Equipment / Image / Annotation
│   │   └── weights/             模型权重目录（YOLO .pt 文件）
│   ├── routes/
│   │   ├── projects.py          项目 CRUD + 上限 20 自动清理
│   │   ├── images.py            上传 + 批量处理 + 自动检测
│   │   ├── annotations.py       画框 CRUD + 框内温度计算
│   │   ├── equipment.py         设备趋势（跨项目 by name+area）
│   │   └── reports.py           报告生成（相对温差 + 中文文件名）
│   └── services/
│       ├── flir_extractor.py    FLIR 温度提取（exiftool + Planck）
│       ├── filename_parser.py   文件名解析（支持可选序号 -XXX）
│       ├── auto_detect.py       YOLO 检测 / 热点定位
│       ├── report_generator.py  Word 报告（docxtpl + 相对温差计算）
│       └── create_template.py   创建默认 Word 模板
│
└── frontend/
    ├── package.json             React 19 + Konva 10 + Vite
    └── src/
        ├── App.tsx              路由
        ├── main.tsx             入口
        ├── types.ts             TypeScript 类型定义
        ├── api/client.ts        axios 封装
        ├── components/
        │   └── TrendChart.tsx   SVG 趋势折线图
        └── pages/
            ├── ProjectList.tsx      项目列表 + 创建 + 删除
            ├── ProjectDetail.tsx    图片列表 + 上传 + 报告参数面板
            └── AnnotationEditor.tsx 画框编辑器（Konva + 趋势图）
```

---

## 5. 绝对不可改的公式

### FLIR 温度公式

```python
# 字节序修复（FLIR 内嵌 PNG uint16 高低位交换）
raw = (raw >> 8) + ((raw & 0xFF) << 8)

# Planck 反演（raw 直接用相机计数值，不除以 Real2IR！）
# 完整大气校正后得到 raw_obj，然后：
T_celsius = B / math.log(R1 / (R2 * (raw_obj + O)) + F) - 273.15
#                                              ^^^  注意是 +O，不是 −O
```

| 参数 | 来源 | 说明 |
|------|------|------|
| R1, R2, B, F, O | EXIF Planck 标签 | Planck 标定常数 |
| raw_obj | PNG 字节修复 + 大气校正(6项)后 | 物体辐射计数值 |
| Real2IR | ❌ 不使用 | 旧公式错在这里 |

权威来源：`flir_verify_poc.py` > `FLIR_TECHNICAL_NOTES.md` > `backend/services/flir_extractor.py`

### 相对温差公式（报告用）

```
相对温差 = (T_max - T_normal) / (T_max - T_ambient) × 100%

T_max    = 框内最高温
T_normal = 用户输入的正常设备温度
T_ambient = 手动覆盖值 或 FLIR EXIF AtmosphericTemperature（自动提取）
```

---

## 6. 坐标映射

```python
scale_x = display_w / thermal_w
scale_y = display_h / thermal_h
thermal_x = int(display_x / scale_x)
```

- T1040 (1024×768)：scale=1.0
- AX8 (80×60)：scale≈8.0，**不能假设 scale=1**

---

## 7. 数据表结构

```sql
projects:
  id, name, model_type, report_template_path, created_at

equipment:                                     -- v1.1 新增
  id, project_id(FK), name, area, device_type, created_at

images:
  id, project_id(FK), equipment_id(FK→equipment),  -- v1.1 新增
  filename, original_path, thermal_npy_path, preview_path,
  date, area, equipment,
  t_min, t_max, t_mean,
  atmospheric_temp,                              -- v1.1 新增
  thermal_width, thermal_height, display_width, display_height,
  created_at

annotations:
  id, image_id(FK), box_coords(JSON), version,
  t_max, t_min, t_mean,
  max_x, max_y,
  source('manual'|'auto'),        -- blue=auto, green=manual
  status, reviewed_by, created_at
```

---

## 8. 前端 Konva 关键约定

- **蓝色框** = 自动检测框（`source: "auto"`）
- **绿色框** = 手动绘制框（`source: "manual"`）
- `handleMouseDown` 必须检查 Transformer 锚点名称（`top-*`/`bottom-*`/`middle-*`），否则缩放事件被截断 → 画框功能失效
- `handleTransformEnd` 先展开 scale 到 width/height 再 reset scale=1，防止 Konva 隐式调整 x/y
- 上传按钮须 try/catch + `useRef` 重置 input value，否则失败卡死或重复上传不触发

---

## 9. 文件名解析规则

格式：`YYYY-MM-DD区域-设备编号[-序号]类型.jpg`

```python
PATTERN = re.compile(
    r'^(?P<date>\d{4}-\d{2}-\d{2})'
    r'(?P<area>[A-Za-z\u4e00-\u9fff]+)'
    r'-(?P<equip_id>[A-Za-z0-9]+)'
    r'(?:-\d+)?'                              # 可选序号 -001
    r'(?P<type>[A-Za-z\u4e00-\u9fff]+)'
    r'\.(jpg|jpeg)$'
)
```

示例：
- `2025-05-02主变区-T01变压器.jpg` → date=2025-05-02, area=主变区, equip_id=T01
- `2025-03-20主变区-T01-001变压器.jpg` → 同上（序号被忽略，仅做唯一性区分）

---

## 10. 设备趋势（v1.1 新增）

同一设备跨项目/日期查看历史温度趋势：

- **API**：`GET /api/equipment/{id}/trend` 或 `GET /api/equipment/trend?name=T01&area=主变区`
- **查询逻辑**：按 `equipment_name + area` 跨所有项目搜索，不依赖 equipment_id
- **前端**：AnnotationEditor 右下角 SVG 趋势折线图，点击数据点跳转到对应图片
- **触发条件**：图片的 `equipment_id` 不为空时自动加载

---

## 11. 测试图片

54 张 FLIR T1040 图片：`/Users/mba/0502/`

重命名脚本（随机分配 3 种设备 × 9 个日期）：
```bash
# 输出到 /tmp/test_images/，含序号防重名
python3 -c "..."  # 见 memory 中的 generate_test_data 脚本
```

---

## 12. 已知问题和待做事项

- [ ] 照片可见光模式 → 近红外模式校准/切换
- [ ] YOLO 模型训练（当前权重文件为占位，训练管道见 `docs/MODEL_TRAINING_PLAN.md`）
- [ ] 多用户支持（需将 SQLite 替换为 PostgreSQL）
- [ ] Docker Compose 部署
- [ ] 异常告警（温度超阈值通知）
- [ ] 图片对比模式（同设备不同时间并排显示）
- [ ] Equipment 跨项目唯一（当前每个 project 可创建同名 Equipment，趋势通过 name+area 匹配绕过）

---

## 13. 给接手的 AI

### 第一步：读这些文件
1. 本文件（你正在读）
2. `FLIR_TECHNICAL_NOTES.md` — 温度公式完整推导
3. `backend/services/flir_extractor.py` — 公式的实现
4. `backend/main.py` — 路由和入口

### 第二步：启动
```bash
cd "/Users/mba/claude code/detect"
./start.sh
# 或手动：backend uvicorn + frontend npm run dev
```

### 第三步：浏览器打开 http://localhost:5173

### 注意事项
- `python3` 不是 `python`
- Python 3.9 — 别用 3.10+ 语法（`X | None` → `Optional[X]`）
- numpy 1.26.x
- 前端改完用浏览器验证
- CORS → 检查后端 8000 端口
- Konva Transformer → 检查 `isTransformerHandle` 判断
- `preview_url` 用 `original_path` 计算，不要动态拼 date/equipment

---

## 14. FLIR JPEG 包含可见光照片

```
红外热像：1024×768（Iron 色板，温度矩阵嵌在 EXIF 中）
可见光图：1280×960 RGB JPEG（EmbeddedImage 标签）
```

提取：`exiftool -b -EmbeddedImage IR_53167.jpg > visible.jpg`

训练用可见光图标注更精确，详见 `docs/MODEL_TRAINING_PLAN.md`。
