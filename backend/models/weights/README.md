# YOLO 设备检测模型权重

## 模型文件命名

| model_type | 文件 |
|-----------|------|
| transformer | transformer.pt |
| switchgear | switchgear.pt |
| cable | cable.pt |
| busbar | busbar.pt |
| insulator | insulator.pt |

## 模型格式

- YOLOv5 或 YOLOv8 格式
- 使用 ultralytics 导出：`model.export(format="torchscript")` → `.pt`
- 或直接用 PyTorch Hub 加载：`torch.hub.load('ultralytics/yolov5', 'custom', path='xxx.pt')`

## 训练数据飞轮

```
人工标注 → 导出 YOLO 标注 → 训练模型 → 替换 .pt → 自动检测 → 人工修正
    ↑                                                              │
    └──────────────────────────────────────────────────────────────┘
```

### 导出训练数据

标注框存储在 `annotations` 表的 `box_coords` 字段（温度矩阵坐标）。

转换脚本（待实现）：
```python
# 1. 查询 source="manual" 且 status="reviewed" 的标注
# 2. box_coords 从温度矩阵坐标 → 显示图像坐标
# 3. 写入 YOLO txt 格式：class_id x_center y_center width height（归一化）
# 4. class_id 从 model_type 映射
```

## 当前状态

所有模型文件均未训练。系统在模型缺失时自动使用**最高温点** fallback：
- 在红外图谱最高温度像素处生成 5% 画幅的矩形框
- 作为自动标注的初始参考

## 快速开始

1. 在项目中上传红外图片并人工画框标注
2. 累计 ≥ 200 张标注后，导出训练数据
3. 用 YOLOv5/v8 训练：`yolo train data=dataset.yaml model=yolov8n.pt epochs=100`
4. 将输出的 `best.pt` 复制到此目录，按上表命名
5. 下次创建同类项目时自动检测生效
