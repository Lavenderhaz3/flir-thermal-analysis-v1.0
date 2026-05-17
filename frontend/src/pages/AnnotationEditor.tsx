import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Stage, Layer, Image as KonvaImage, Rect, Transformer, Text, Circle, Line } from 'react-konva';
import Konva from 'konva';
import api from '../api/client';
import type { ImageDetail, AnnotationData, BoxCoords, EquipmentTrend } from '../types';
import TrendChart from '../components/TrendChart';

export default function AnnotationEditor() {
  const { projectId, imageId } = useParams<{ projectId: string; imageId: string }>();
  const navigate = useNavigate();
  const [image, setImage] = useState<ImageDetail | null>(null);
  const [imgObj, setImgObj] = useState<HTMLImageElement | null>(null);
  const [annotations, setAnnotations] = useState<AnnotationData[]>([]);
  const [drawing, setDrawing] = useState(false);
  const [newBox, setNewBox] = useState<BoxCoords | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const stageRef = useRef<Konva.Stage>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const [trendData, setTrendData] = useState<EquipmentTrend | null>(null);

  // Load image data
  useEffect(() => {
    api.get(`/images/${imageId}`).then(res => {
      const img: ImageDetail = res.data;
      setImage(img);
      // Load trend data for this equipment (cross-project)
      if (img.equipment_id) {
        api.get(`/equipment/${img.equipment_id}/trend`)
          .then(r => setTrendData(r.data))
          .catch(() => setTrendData(null));
      }
    });
  }, [imageId]);

  // Load annotations
  const loadAnnotations = useCallback(async () => {
    const res = await api.get(`/images/${imageId}/annotations/`);
    setAnnotations(res.data);
  }, [imageId]);
  useEffect(() => { loadAnnotations(); }, [loadAnnotations]);

  // Load FLIR JPEG for canvas
  useEffect(() => {
    if (!image) return;
    const img = new window.Image();
    img.crossOrigin = 'anonymous';
    img.src = image.preview_url;
    img.onload = () => setImgObj(img);
  }, [image]);

  // Bind Transformer to selected rect
  useEffect(() => {
    if (!trRef.current || !stageRef.current) return;
    if (selectedId == null) {
      trRef.current.nodes([]);
      return;
    }
    const node = stageRef.current.findOne(`#ann-${selectedId}`);
    if (node) trRef.current.nodes([node]);
    else trRef.current.nodes([]);
  }, [selectedId, annotations]);

  if (!image || !imgObj) return <div style={{ padding: 20 }}>Loading...</div>;

  // Scale factors: thermal matrix ↔ display image
  const dW = image.display_width || imgObj.naturalWidth;
  const dH = image.display_height || imgObj.naturalHeight;
  const tW = image.thermal_width || imgObj.naturalWidth;
  const tH = image.thermal_height || imgObj.naturalHeight;
  const scaleX = dW / tW;  // thermal → display
  const scaleY = dH / tH;

  // Fit canvas to the recorded display image resolution, not the browser image's
  // natural size. This keeps the frame aligned to the actual FLIR preview.
  const imageBaseW = dW;
  const imageBaseH = dH;
  const maxW = Math.min(window.innerWidth - 40, imageBaseW);
  const maxH = Math.min(window.innerHeight - 160, imageBaseH);
  const fitScale = Math.min(maxW / imageBaseW, maxH / imageBaseH, 1);

  const canvasW = imageBaseW * fitScale;
  const canvasH = imageBaseH * fitScale;

  // ── Coordinate helpers ───────────────────────────────────────────

  /** Convert display-image coords → thermal-matrix coords */
  const toThermal = (box: BoxCoords): BoxCoords => ({
    x1: Math.round(box.x1 / scaleX),
    y1: Math.round(box.y1 / scaleY),
    x2: Math.round(box.x2 / scaleX),
    y2: Math.round(box.y2 / scaleY),
  });

  /** Convert thermal-matrix coords → canvas pixel coords (for Konva) */
  const thermalToCanvas = (box: BoxCoords) => ({
    x: Math.min(box.x1, box.x2) * scaleX * fitScale,
    y: Math.min(box.y1, box.y2) * scaleY * fitScale,
    width: Math.abs(box.x2 - box.x1) * scaleX * fitScale,
    height: Math.abs(box.y2 - box.y1) * scaleY * fitScale,
  });

  /** Convert display-image coords → canvas pixel coords (for drawing) */
  const displayToCanvas = (box: BoxCoords) => ({
    x: Math.min(box.x1, box.x2) * fitScale,
    y: Math.min(box.y1, box.y2) * fitScale,
    width: Math.abs(box.x2 - box.x1) * fitScale,
    height: Math.abs(box.y2 - box.y1) * fitScale,
  });

  // ── Mouse handlers ───────────────────────────────────────────────

  const handleMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    // Skip if clicking on annotation rects or Transformer anchor handles.
    // Transformer anchors have names like "top-left", "bottom-right", etc.
    const target = e.target;
    const name = target.name() || '';
    const isAnnotation = name.startsWith('ann-rect-');
    // Transformer anchors don't have "ann-rect-" in their name, but their
    // parent is the Transformer.  Fallback: common anchor name patterns.
    const isTransformerHandle =
      name.startsWith('top-') ||
      name.startsWith('bottom-') ||
      name.startsWith('middle-left') ||
      name.startsWith('middle-right');

    if (isAnnotation || isTransformerHandle) return;

    // Start drawing a new box on empty stage / background image
    setSelectedId(null);
    const pos = target.getStage()!.getPointerPosition()!;
    setDrawing(true);
    setNewBox({
      x1: pos.x / fitScale,
      y1: pos.y / fitScale,
      x2: pos.x / fitScale,
      y2: pos.y / fitScale,
    });
  };

  const handleMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (!drawing || !newBox) return;
    const pos = e.target.getStage()!.getPointerPosition()!;
    setNewBox({ ...newBox, x2: pos.x / fitScale, y2: pos.y / fitScale });
  };

  const handleMouseUp = async () => {
    if (!drawing || !newBox) return;
    setDrawing(false);

    // Require minimum box size
    const dw = Math.abs(newBox.x2 - newBox.x1);
    const dh = Math.abs(newBox.y2 - newBox.y1);
    if (dw < 10 || dh < 10) {
      setNewBox(null);
      return;
    }

    const thermalCoords = toThermal(newBox);
    try {
      const res = await api.post(`/images/${imageId}/annotations/`, {
        box_coords: thermalCoords,
      });
      setAnnotations(prev => [...prev, res.data]);
      setSelectedId(res.data.id);
    } catch (err) {
      console.error('Failed to save annotation', err);
    }
    setNewBox(null);
  };

  // ── Drag / Transform handlers (for existing annotations) ────────

  const handleDragEnd = async (annId: number, e: Konva.KonvaEventObject<DragEvent>) => {
    const node = e.target;
    // Node position is in canvas coords → convert to display-image coords
    const box: BoxCoords = {
      x1: node.x() / fitScale,
      y1: node.y() / fitScale,
      x2: (node.x() + node.width() * node.scaleX()) / fitScale,
      y2: (node.y() + node.height() * node.scaleY()) / fitScale,
    };
    try {
      const res = await api.put(`/annotations/${annId}`, {
        box_coords: toThermal(box),
      });
      setAnnotations(prev => prev.map(a => a.id === annId ? res.data : a));
    } catch (err) {
      console.error('Failed to update annotation', err);
    }
  };

  const handleTransformEnd = async (annId: number, e: Konva.KonvaEventObject<Event>) => {
    const node = e.target;
    // Apply accumulated scale to width/height BEFORE resetting scale to 1.
    // This avoids Konva implicitly adjusting x/y on scale reset.
    node.width(node.width() * node.scaleX());
    node.height(node.height() * node.scaleY());
    node.scaleX(1);
    node.scaleY(1);

    const box: BoxCoords = {
      x1: node.x() / fitScale,
      y1: node.y() / fitScale,
      x2: (node.x() + node.width()) / fitScale,
      y2: (node.y() + node.height()) / fitScale,
    };
    try {
      const res = await api.put(`/annotations/${annId}`, {
        box_coords: toThermal(box),
      });
      setAnnotations(prev => prev.map(a => a.id === annId ? res.data : a));
    } catch (err) {
      console.error('Failed to update annotation', err);
    }
  };

  const handleDelete = async (annId: number) => {
    await api.delete(`/annotations/${annId}`);
    if (selectedId === annId) setSelectedId(null);
    loadAnnotations();
  };

  const selectedAnnotation = annotations.find(ann => ann.id === selectedId);

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div
      className="app-shell app-shell--wide"
      style={{ '--editor-image-width': `${canvasW}px` } as React.CSSProperties}
    >
      <div className="editor-header">
        <div>
          <p className="eyebrow">
        <a href="/">← 返回主页</a>
        {' · '}
        <a href={`/project/${projectId}`}>进入项目</a>
      </p>
          <h1 className="page-title">{image?.equipment || '未知设备'} 图谱</h1>
          <p className="subtle" style={{ margin: '8px 0 0', fontWeight: 650 }}>
            {image?.filename}
            <button
              className="btn btn-danger-ghost"
              style={{ marginLeft: 10, padding: '2px 8px', fontSize: 12, minHeight: 'auto' }}
              onClick={async () => {
                if (!window.confirm(`确认删除 "${image?.filename}" 及其标注数据？此操作不可撤销。`)) return;
                try {
                  await api.delete(`/images/${imageId}`);
                  const peers = (trendData?.points || [])
                    .filter(p => p.image_id !== Number(imageId) && p.project_id === Number(projectId))
                    .sort((a, b) => b.date.localeCompare(a.date));
                  if (peers.length > 0) {
                    navigate(`/project/${projectId}/image/${peers[0].image_id}`);
                  } else {
                    navigate(`/project/${projectId}`);
                  }
                } catch {
                  alert('删除失败');
                }
              }}
            >
              删除
            </button>
          </p>
        </div>
        <div className="editor-summary">
          <div className="summary-tile summary-tile--hot"><span>最高</span><strong>{image.t_max?.toFixed(1)}°C</strong></div>
          <div className="summary-tile"><span>最低</span><strong>{image.t_min?.toFixed(1)}°C</strong></div>
          <div className="summary-tile"><span>平均</span><strong>{image.t_mean?.toFixed(1)}°C</strong></div>
        </div>
      </div>

      <div className="editor-grid">
        <main className="editor-main">
        <div className="canvas-frame">
          <Stage
            width={canvasW}
            height={canvasH}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            ref={stageRef}
          >
          <Layer>
            <KonvaImage
              image={imgObj}
              width={canvasW}
              height={canvasH}
            />

            {/* Saved annotations — color by source: green=manual, blue=auto */}
            {annotations.map(ann => {
              const box = thermalToCanvas(ann.box_coords);
              const isAuto = ann.source === "auto";
              const color = isAuto ? "#3b82f6" : "#00ff00";
              const fillColor = isAuto ? "rgba(59,130,246,0.08)" : "rgba(0,255,0,0.05)";
              return (
                <Rect
                  key={ann.id}
                  id={`ann-${ann.id}`}
                  name={`ann-rect-${ann.id}`}
                  {...box}
                  stroke={color}
                  strokeWidth={2}
                  fill={fillColor}
                  draggable
                  onClick={() => setSelectedId(ann.id)}
                  onTap={() => setSelectedId(ann.id)}
                  onDragEnd={(e) => handleDragEnd(ann.id, e)}
                  onTransformEnd={(e) => handleTransformEnd(ann.id, e)}
                />
              );
            })}

            {/* Temperature labels + max-point crosshair */}
            {annotations.map(ann => {
              const box = thermalToCanvas(ann.box_coords);
              const cx = box.x + box.width / 2;
              const isAuto = ann.source === "auto";
              const accentColor = isAuto ? "#3b82f6" : "#ff4444";
              return (
                <React.Fragment key={`label-${ann.id}`}>
                  {/* Max temperature crosshair */}
                  {ann.max_position && (
                    <>
                      <Circle
                        x={ann.max_position.x * scaleX * fitScale}
                        y={ann.max_position.y * scaleY * fitScale}
                        radius={7}
                        stroke={accentColor}
                        strokeWidth={2}
                        listening={false}
                      />
                      <Line
                        points={[
                          ann.max_position.x * scaleX * fitScale - 4,
                          ann.max_position.y * scaleY * fitScale,
                          ann.max_position.x * scaleX * fitScale + 4,
                          ann.max_position.y * scaleY * fitScale,
                        ]}
                        stroke={accentColor}
                        strokeWidth={2}
                        listening={false}
                      />
                      <Line
                        points={[
                          ann.max_position.x * scaleX * fitScale,
                          ann.max_position.y * scaleY * fitScale - 4,
                          ann.max_position.x * scaleX * fitScale,
                          ann.max_position.y * scaleY * fitScale + 4,
                        ]}
                        stroke={accentColor}
                        strokeWidth={2}
                        listening={false}
                      />
                    </>
                  )}
                  <Text
                    x={cx - 30}
                    y={Math.max(0, box.y - 22)}
                    width={60}
                    text={ann.t_max != null ? `${ann.t_max.toFixed(1)}°C` : '...'}
                    fontSize={13}
                    fill={accentColor}
                    stroke="#000"
                    strokeWidth={3}
                    fillAfterStrokeEnabled
                    align="center"
                    listening={false}
                  />
                </React.Fragment>
              );
            })}

            {/* Drawing box (in-progress, display coords) */}
            {drawing && newBox && (
              <Rect
                {...displayToCanvas(newBox)}
                stroke="#ffff00"
                strokeWidth={2}
                dash={[6, 4]}
                listening={false}
              />
            )}

            {/* Transformer — controlled by useEffect */}
            <Transformer
              ref={trRef}
              rotateEnabled={false}
              keepRatio={false}
              enabledAnchors={['top-left', 'top-right', 'bottom-left', 'bottom-right']}
              boundBoxFunc={(oldBox, newBox) =>
                newBox.width < 20 || newBox.height < 20 ? oldBox : newBox
              }
            />
          </Layer>
        </Stage>
      </div>
      {trendData && trendData.points.length > 0 && (
        <section className="history-under-canvas">
          <div className="section-bar">
            <h2 className="panel__title">历史图谱</h2>
            <span className="subtle">{trendData.points.length} 次记录</span>
          </div>
          <div className="history-strip">
            {trendData.points.map(p => (
              <button
                key={p.image_id}
                type="button"
                onClick={() => navigate(`/project/${p.project_id}/image/${p.image_id}`)}
                className={`history-chip ${p.image_id === Number(imageId) ? 'history-chip--current' : ''}`}
              >
                <span>{p.date || '未知日期'}</span>
                <strong>{p.t_max?.toFixed(1)}°C</strong>
                <small>{p.project_name || p.filename}</small>
              </button>
            ))}
          </div>
        </section>
      )}
      </main>

      {/* Temperature trend chart — right side */}
      <aside className="editor-side">
        {selectedAnnotation && (
          <section className="panel selected-panel">
            <div className="panel__head">
              <h2 className="panel__title">当前标注</h2>
              {selectedAnnotation.source === "auto" && <span className="ai-badge">AI</span>}
            </div>
            <div className="panel__body">
              <div className="selected-metrics">
                <div><span>最高</span><strong className="metric-hot">{selectedAnnotation.t_max?.toFixed(1)}°C</strong></div>
                <div><span>平均</span><strong>{selectedAnnotation.t_mean?.toFixed(1)}°C</strong></div>
                <div><span>最低</span><strong className="metric-cool">{selectedAnnotation.t_min?.toFixed(1)}°C</strong></div>
              </div>
              <button
                onClick={() => handleDelete(selectedAnnotation.id)}
                className="btn btn-secondary"
                style={{ width: '100%', marginTop: 12 }}
              >
                删除此标注
              </button>
            </div>
          </section>
        )}
        {trendData && trendData.points && trendData.points.length > 0 && (
          <section className="panel" style={{ minWidth: 0 }}>
            <div className="panel__body">
            <TrendChart
              trend={trendData}
              currentImageId={Number(imageId)}
            />
            </div>
          </section>
        )}

        <section className="panel annotation-panel">
          <div className="panel__head">
            <h2 className="panel__title">标注列表</h2>
            <span className="status-pill">{annotations.length} 个</span>
          </div>
          <div className="panel__body">
          <div className="annotation-list">
            {annotations.map(ann => (
              <div
                key={ann.id}
                onClick={() => setSelectedId(ann.id)}
                className={`annotation-item ${selectedId === ann.id ? 'annotation-item--selected' : ''}`}
              >
                <div>
                  <strong>框 {ann.id}</strong>
                  {ann.source === "auto" && (
                    <span className="ai-badge">AI</span>
                  )}
                  <span className="annotation-metrics">
                    <span>最高 {ann.t_max?.toFixed(1)}°C</span>
                    <span>平均 {ann.t_mean?.toFixed(1)}°C</span>
                    <span>最低 {ann.t_min?.toFixed(1)}°C</span>
                  </span>
                </div>
              </div>
            ))}
            {annotations.length === 0 && (
              <div className="empty-state">在热像图上按住鼠标拖拽画框，框选设备区域</div>
            )}
          </div>
          </div>
        </section>
      </aside>
    </div>
    </div>
  );
}
