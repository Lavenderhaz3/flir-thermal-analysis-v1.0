import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams } from 'react-router-dom';
import { Stage, Layer, Image as KonvaImage, Rect, Transformer, Text, Circle, Line } from 'react-konva';
import Konva from 'konva';
import api from '../api/client';
import type { ImageDetail, AnnotationData, BoxCoords, EquipmentTrend } from '../types';
import TrendChart from '../components/TrendChart';

export default function AnnotationEditor() {
  const { projectId, imageId } = useParams<{ projectId: string; imageId: string }>();
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

  // Fit canvas to viewport
  const maxW = Math.min(window.innerWidth - 40, imgObj.naturalWidth);
  const maxH = Math.min(window.innerHeight - 160, imgObj.naturalHeight);
  const fitScale = Math.min(maxW / imgObj.naturalWidth, maxH / imgObj.naturalHeight, 1);

  const canvasW = imgObj.naturalWidth * fitScale;
  const canvasH = imgObj.naturalHeight * fitScale;

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

  // ── Render ───────────────────────────────────────────────────────

  return (
    <div style={{ padding: 10 }}>
      <p>
        <a href={`/project/${projectId}`} style={{ color: '#2563eb' }}>← 返回项目</a>
        {' · '}{image.filename}
        {' · '}最高温: {image.t_max?.toFixed(1)}°C
        {' · '}最低温: {image.t_min?.toFixed(1)}°C
        {' · '}平均温: {image.t_mean?.toFixed(1)}°C
        {tW !== dW && (
          <span style={{ color: '#999', marginLeft: 8 }}>
            (热分辨率: {tW}×{tH}, 显示: {dW}×{dH})
          </span>
        )}
      </p>

      <div style={{ display: 'flex', gap: 16, alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <div style={{ border: '1px solid #ccc', background: '#222', flexShrink: 0 }}>
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

      {/* Temperature trend chart — right side */}
      {trendData && trendData.points && trendData.points.length > 0 && (
        <div style={{ flex: '1 1 280px', minWidth: 260, maxWidth: 380 }}>
          <TrendChart
            trend={trendData}
            currentImageId={Number(imageId)}
          />
        </div>
      )}
    </div>

    {/* Annotation list */}
      <div style={{ marginTop: 16, maxWidth: 600 }}>
        <h3>标注列表</h3>
        {annotations.map(ann => (
          <div
            key={ann.id}
            onClick={() => setSelectedId(ann.id)}
            style={{
              marginBottom: 8, padding: '8px 12px',
              background: selectedId === ann.id ? '#e0f2fe' : '#f8f8f8',
              borderRadius: 4, cursor: 'pointer',
              border: selectedId === ann.id ? '2px solid #2563eb' : '1px solid transparent',
            }}
          >
            <strong>框 {ann.id}</strong>
            {ann.source === "auto" && (
              <span style={{
                background: '#dbeafe', color: '#1d4ed8', fontSize: 11,
                padding: '1px 6px', borderRadius: 3, marginLeft: 6, fontWeight: 600,
              }}>AI</span>
            )}
            {' · '}最高 {ann.t_max?.toFixed(1)}°C
            {' · '}平均 {ann.t_mean?.toFixed(1)}°C
            {' · '}最低 {ann.t_min?.toFixed(1)}°C
            <button
              onClick={(e) => { e.stopPropagation(); handleDelete(ann.id); }}
              style={{ marginLeft: 12, color: '#dc2626', border: 'none', background: 'none', cursor: 'pointer' }}
            >
              删除
            </button>
          </div>
        ))}
        {annotations.length === 0 && (
          <div style={{ color: '#999' }}>在热像图上按住鼠标拖拽画框，框选设备区域</div>
        )}
      </div>
    </div>
  );
}
