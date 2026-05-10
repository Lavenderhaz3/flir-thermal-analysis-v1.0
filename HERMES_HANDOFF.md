# FLIR 红外测温分析系统 — 开发交底

## 项目目标

对 FLIR 红外热像仪拍摄的设备图谱进行温度分析、设备识别、人工校核、报告输出。

## 当前状态：PoC 已完成

### 文件结构
```
detect/
├── HERMES_HANDOFF.md         # 本文件
├── DEVELOPMENT_PLAN.md        # 完整开发方案（架构、分阶段计划）
├── FLIR_TECHNICAL_NOTES.md    # 技术笔记（公式、相机兼容性）
├── flir_verify_poc.py         # PoC 验证脚本（命令行即可测 FLIR 图片温度）
└── storage/                   # 测试输出目录
```

### 已验证结论

1. **FLIR 温度提取不需要 Atlas SDK** — 用 exiftool + Planck 公式即可，纯 Python，跨平台
2. **正确公式**（与 FlirImageExtractor / flirpy / Thermimage 一致）：
   - 字节序修复：`(raw >> 8) + ((raw & 0xFF) << 8)`
   - `T = B / ln(R1 / (R2 * (raw_obj + O)) + F) - 273.15`
   - raw 直接用相机计数值（不用 Real2IR）
   - 完整大气校正（发射率、距离、湿度、窗口传输）
3. **显示**：FLIR JPEG 本身就是 Iron 色板渲染好的热像图，预览直接用原图做底图叠加标注
4. **已验证相机**：FLIR T1040 (1024×768)，54 张图片全部成功提取温度
5. **测试图片**：`/Users/mba/cap2.jpg`，`/Users/mba/0502/`（54 张）

### ⚠️ 公式权威级

DEVELOPMENT_PLAN.md 第 55-56 行的公式是旧版（`signal = raw/Real2IR`、`signal − O`），**已过时，禁止使用**。

正确公式以这两个文件为准：
- FLIR_TECHNICAL_NOTES.md（第 87 行）
- flir_verify_poc.py（`raw_to_temperature()` 函数）

关键差异：

| 项 | DEVELOPMENT_PLAN（错） | TECHNICAL_NOTES / PoC（对） |
|----|----------------------|---------------------------|
| Real2IR | 除以 Real2IR | 不使用 Real2IR |
| O 符号 | signal **−** O | raw_obj **+** O |
| 大气校正 | 无 | 完整 6 项校正 |

### 运行 PoC
```bash
cd "/Users/mba/claude code/detect"
python3 flir_verify_poc.py /Users/mba/0502/IR_53167.jpg -o output/
# 输出: result.json + temperature_matrix.npy + preview.png
```

## Phase 1 (MVP) 待开发

1. 文件上传（zip/jpg）
2. 文件名解析（日期/区域/设备，格式：`YYYY-MM-DD区域-设备编号类型.jpg`）
3. FLIR 温度矩阵解析（整合 flir_verify_poc.py 的公式）
4. 手动画框选择设备区域
5. 框内最高温/平均温/温差计算
6. 人工校核界面
7. Word 报告生成（docxtpl 模板渲染）
8. 按日期/设备文件夹归档

## 文件名解析规则

格式：`YYYY-MM-DD区域-设备编号类型.jpg`

```python
import re
PATTERN = re.compile(
    r'^(?P<date>\d{4}-\d{2}-\d{2})'          # 日期 YYYY-MM-DD，如 2025-05-02
    r'(?P<area>[A-Za-z\u4e00-\u9fff]+)'      # 区域（中英文），如 主变区 / ZoneA
    r'-(?P<equip_id>[A-Za-z0-9]+)'           # 设备编号，如 T01 / CB03
    r'(?P<type>[A-Za-z\u4e00-\u9fff]+)'      # 类型（中英文），如 变压器 / Transformer
    r'\.(jpg|jpeg)$'
)
```

示例：`2025-05-02主变区-T01变压器.jpg`
→ `date=2025-05-02`, `area=主变区`, `equip_id=T01`, `type=变压器`

分隔符说明：
- 日期和区域之间无分隔符，直接拼接
- 区域和编号之间用 `-`
- 编号和类型之间无分隔符，直接拼接
- 类型后直接跟扩展名

## 技术栈建议

- 后端：FastAPI + PostgreSQL + SQLAlchemy
- 前端：React + Konva.js（画框）+ FLIR JPEG 原图做底图
- 报告：docxtpl + python-docx
- 部署：Docker Compose
- 依赖：exiftool（系统包）、numpy、Pillow

## API 路由设计（建议）

```
POST   /api/projects/                    创建项目
GET    /api/projects/{id}/               项目详情（含图片列表）
POST   /api/projects/{id}/images/        上传图片（jpg/zip）
GET    /api/images/{id}/                 图片详情 + 温度统计
GET    /api/images/{id}/thermal          温度矩阵数据
POST   /api/images/{id}/annotations/     画框 + 计算温度
PUT    /api/annotations/{id}/            修改框（重新计算温度）
DELETE /api/annotations/{id}/            删除框
POST   /api/projects/{id}/report/        生成 Word 报告
```

## 数据模型

```
Project:    id, name, created_at
Image:      id, project_id, filename, date, area, equipment,
            original_path, thermal_npy_path, preview_path,
            t_min, t_max, t_mean
Annotation: id, image_id, box_coords(JSON), version,
            t_max, t_min, t_mean, status, reviewed_by
```

## 坐标映射（温度矩阵 ↔ 显示图像）

FLIR JPEG 的显示分辨率 ≠ 温度矩阵分辨率，画框时必须映射。

| 项目 | 来源 | 说明 |
|------|------|------|
| 温度矩阵尺寸 | `RawThermalImageWidth` × `RawThermalImageHeight` (EXIF) | 实际热数据像素数 |
| 显示图像尺寸 | FLIR JPEG 像素尺寸 (PIL `Image.size`) | 通常 ≥ 温度矩阵 |
| 映射比例 | `scale_x = display_w / thermal_w` | 前端画框 → 后端裁剪 |

前端画框坐标落在显示图像上，后端裁剪温度矩阵时需反算：

```python
scale_x = display_w / thermal_w
scale_y = display_h / thermal_h

# 前端（显示坐标）→ 后端（温度矩阵坐标）
thermal_x1 = int(display_x1 / scale_x)
thermal_y1 = int(display_y1 / scale_y)
thermal_x2 = int(display_x2 / scale_x)
thermal_y2 = int(display_y2 / scale_y)

# 裁剪温度矩阵
roi = temp_matrix[thermal_y1:thermal_y2, thermal_x1:thermal_x2]
t_max = np.nanmax(roi)
t_mean = np.nanmean(roi)
t_diff = t_max - np.nanmin(roi)
```

特例：T1040 热分辨率 1024×768，通常与 JPEG 显示分辨率一致（scale=1.0）。AX8 热 80×60，JPEG 显示可能 640×480（scale≈8.0），**不要假设 scale=1**。

## 关键注意事项

- 预览显示直接用 FLIR JPEG 原图，不要自己渲染色板
- 温度计算用 float64 数组，框选坐标落在温度矩阵上裁剪计算
- 框可以拖动移动 + 右下角拖拽缩放
- 每个框内显示最高温标签
- 一张图只允许一个框（MVP 阶段）
- 公式是 `raw+O`（不是 `raw-O`），不用 Real2IR

## 后续 Phase

- Phase 2: AI 自动识别（YOLO 设备检测）
- Phase 3: 工程化（模型版本管理、历史趋势、异常告警、多用户）
