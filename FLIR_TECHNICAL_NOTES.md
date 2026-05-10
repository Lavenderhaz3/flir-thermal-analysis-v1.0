# FLIR 温度提取技术笔记

## 图片类型判断

| 特征 | Radiometric JPEG | 普通截图/导出 |
|------|-----------------|--------------|
| EXIF Make | `FLIR Systems AB` | 无 |
| Planck 参数 | R1/R2/B/F/O 齐全 | 无 |
| 嵌入热数据 | PNG/TIFF (uint16) | 无 |
| 文件大小 | 较大 (几百KB-数MB) | 较小 |

```bash
# 快速判断
exiftool image.jpg -Make -PlanckR1 -RawThermalImageType
```

## 温度还原流程

### 步骤

1. **提取原始热数据** — exiftool -b -RawThermalImage → PNG
2. **字节序修复** — FLIR PNG 内 uint16 值字节高低位交换，需 `(raw >> 8) + ((raw & 0xFF) << 8)`
3. **大气校正** — 扣除大气衰减、窗口传输、环境反射
4. **Planck 反演** — `T = B / ln(R1 / (R2 * (raw_obj + O)) + F) - 273.15`

### 正确公式（与 FlirImageExtractor / flirpy / Thermimage 一致）

```python
import numpy as np
import math

# 1. 读取元数据
meta = json.loads(subprocess.run(
    ["exiftool", "-j", "-PlanckR1", "-PlanckR2", "-PlanckB", "-PlanckF", "-PlanckO",
     "-Emissivity", "-ObjectDistance", "-AtmosphericTemperature",
     "-ReflectedApparentTemperature", "-IRWindowTemperature",
     "-IRWindowTransmission", "-RelativeHumidity", "image.jpg"],
    capture_output=True, text=True
).stdout)[0]

PR1, PR2, PB, PF, PO = [float(meta[k]) for k in 
    ["PlanckR1","PlanckR2","PlanckB","PlanckF","PlanckO"]]

# 2. 提取 + 字节序修复
with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
    tmp_path = tmp.name
subprocess.run(["exiftool", "-b", "-RawThermalImage", "image.jpg"],
               stdout=open(tmp_path, "wb"), check=True)
raw = np.array(Image.open(tmp_path), dtype=np.uint16)
os.unlink(tmp_path)
# FLIR PNG 字节序修复
raw = np.right_shift(raw, 8) + np.left_shift(np.bitwise_and(raw, 0x00FF), 8)
raw = raw.astype(np.float64)

# 3. 大气传输计算
def _pf(s):
    return float(str(s).strip().split(" ")[0])

E = float(meta["Emissivity"])
OD = _pf(meta.get("ObjectDistance", "1.0"))
RTemp = _pf(meta.get("ReflectedApparentTemperature", "20.0"))
ATemp = _pf(meta.get("AtmosphericTemperature", "20.0"))
IRWTemp = _pf(meta.get("IRWindowTemperature", "20.0"))
IRT = float(meta.get("IRWindowTransmission", 1.0))
RH = _pf(meta.get("RelativeHumidity", "50.0"))

ATA1, ATA2 = 0.006569, 0.01262
ATB1, ATB2 = -0.002276, -0.00667
ATX = 1.9

h2o = (RH/100) * math.exp(1.5587 + 0.06939*ATemp - 0.00027816*ATemp**2 + 0.00000068455*ATemp**3)
tau = ATX * math.exp(-math.sqrt(OD/2)*(ATA1 + ATB1*math.sqrt(h2o))) + \
      (1-ATX) * math.exp(-math.sqrt(OD/2)*(ATA2 + ATB2*math.sqrt(h2o)))

# 4. 环境辐射扣除 + Planck 反演
raw_refl = PR1/(PR2*(np.exp(PB/(RTemp+273.15)) - PF)) - PO
raw_atm  = PR1/(PR2*(np.exp(PB/(ATemp+273.15)) - PF)) - PO
raw_wind = PR1/(PR2*(np.exp(PB/(IRWTemp+273.15)) - PF)) - PO

ediv = 1.0 / E / tau / IRT / tau
raw_obj = (raw * ediv
    - (1-E)/E * raw_refl
    - 2*(1-tau)/E/tau * raw_atm
    - (1-IRT)/E/tau/IRT * raw_wind)

# 5. 温度反演
T = PB / np.log(PR1 / (PR2 * (raw_obj + PO)) + PF) - 273.15

print(f"温度范围: {np.nanmin(T):.1f} ~ {np.nanmax(T):.1f} °C")
```

### 关键修正点

| 项 | 错误（旧 PoC） | 正确 |
|----|---------------|------|
| 字节序 | 直接读 PNG uint16 | **必须先修复字节序** `(r>>8) + ((r&0xFF)<<8)` |
| 公式 | `S = raw/Real2IR`, `T = B/ln(R1/(R2*(S-O))+F)` | `T = B/ln(R1/(R2*(raw_obj+O))+F)` |
| Real2IR | 除以 Real2IR | **不使用** Real2IR |
| 大气校正 | 无 | **需要完整大气校正** |

## 温宽问题

### 实际根因：字节序 + 公式

之前误判为"窄温宽导出问题"，实际根因是两个叠加错误：

1. **字节序** — FLIR 内嵌 PNG 的 uint16 值字节交换，直接读会得到错误的 raw 值
2. **公式错误** — 旧 PoC 使用 `Real2IR + S-O` 公式，正确公式是 `raw+O` 无 Real2IR

修复后温度正常（21~34°C），落在相机标定范围内，无需温宽校准。

### 真正的温宽问题（仍可能发生）

若 FLIR 导出时选了窄温宽（非全量程），JPEG 内嵌 raw 值会按温宽缩放，Planck 参数仍是全量程的。此时需用 RawValueMedian/Range 校准。

检测方法：字节修复后 raw 中位数 vs 元数据 RawValueMedian 是否一致。

## 相机兼容性

| 型号 | 热分辨率 | Real2IR | Raw 格式 | 备注 |
|------|---------|---------|---------|------|
| FLIR AX8 | 80×60 | ~1.16 | PNG | 全量程，直接公式可用 |
| FLIR T1040 | 1024×768 | ~1.68 | PNG | 多段 APP1，温宽问题 |

## 依赖

- exiftool (系统包): `brew install exiftool` / `apt install libimage-exiftool-perl`
- numpy: `pip install numpy`
- Pillow: `pip install Pillow`
- 不需要: FLIR Atlas SDK, flirpy
