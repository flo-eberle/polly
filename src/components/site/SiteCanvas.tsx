import { memo, useEffect, useMemo, useRef, useState } from "react";
import { Circle, Group, Image as KonvaImage, Label, Layer, Line, Rect, Stage, Tag, Text, Transformer } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { useTranslation } from "react-i18next";
import { distance, formatLength, gridLines, gridStep, screenToPlan, zoomAt, type Point, type View } from "@/lib/siteGeometry";
import { pathLength, polygonArea, rectFromCorners, toFlat } from "@/lib/siteShapes";
import { SITE_LAYERS, layerState, type SiteElement, type SiteSettings, type SiteShape } from "@/types/site";
import { elementType, type ShapeType } from "./elementTypes";
import { ELEMENT_NODE, ElementNode, SELECT_COLOR, VertexEditor } from "./SiteElements";
import type { SiteImageState } from "./useSiteImage";

export type SiteTool =
  | { type: "select" }
  | { type: "measure" }
  | { type: "calibrate" }
  | { type: "draw"; kind: string; shape: ShapeType };

interface SiteCanvasProps {
  width: number;
  height: number;
  view: View;
  onViewChange: (view: View) => void;
  settings: SiteSettings;
  elements: SiteElement[];
  image: SiteImageState;
  /** Desktop editing; false on touch devices (view only, tap shows info). */
  editable: boolean;
  tool: SiteTool;
  selectedId: string | null;
  onSelect: (id: string | null) => void;
  onCreate: (kind: string, shape: SiteShape) => void;
  onShapeChange: (id: string, shape: SiteShape) => void;
  /** Calibration line finished: its length in plan metres at the current scale. */
  onMeasured: (measuredM: number) => void;
  onBackgroundMoved: (x: number, y: number) => void;
  /** Esc with nothing to cancel on the canvas: back to the select tool. */
  onEscape: () => void;
  onDeleteSelected: () => void;
  onUndo: () => void;
  onRedo: () => void;
  dark: boolean;
}

type Draft =
  | { mode: "drag"; start: Point; current: Point }
  | { mode: "points"; points: Point[]; done?: boolean };

const WHEEL_SENSITIVITY = 0.0015;
/** Click this close (screen px) to the first point to close a polygon. */
const CLOSE_PX = 10;
/** Two clicks this close (screen px) and this quick count as a double click. */
const DOUBLE_CLICK_PX = 6;
const DOUBLE_CLICK_MS = 500;
/** Smallest rectangle side or circle radius that counts as drawn, in metres. */
const MIN_SIZE_M = 0.1;

function isTyping(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName) || !!el.closest?.("dialog[open]"));
}

/** The Konva stage: background, grid, elements, drawing and editing. */
export const SiteCanvas = memo(function SiteCanvas(props: SiteCanvasProps) {
  const {
    width, height, view, onViewChange, settings, elements, image, editable, tool, selectedId,
    onSelect, onCreate, onShapeChange, onMeasured, onBackgroundMoved, onEscape, onDeleteSelected, onUndo, onRedo, dark,
  } = props;
  const { t, i18n } = useTranslation();
  const stageRef = useRef<Konva.Stage>(null);
  const transformerRef = useRef<Konva.Transformer>(null);
  const pinchRef = useRef<{ dist: number; center: Point } | null>(null);
  const lastClickRef = useRef(0);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);

  const bg = settings.background;
  const bgLayer = layerState(settings, "background");
  const selecting = tool.type === "select";
  const dragDrawing = tool.type === "draw" && (tool.shape === "rect" || tool.shape === "circle");
  const px = (n: number) => n / view.scale;
  const fmt = (m: number) => formatLength(m, i18n.language);
  const fmtArea = (m2: number) => `${new Intl.NumberFormat(i18n.language, { maximumFractionDigits: m2 < 10 ? 1 : 0 }).format(m2)} m²`;

  // A new tool starts with a clean slate.
  const [draftTool, setDraftTool] = useState(tool);
  if (draftTool !== tool) {
    setDraftTool(tool);
    setDraft(null);
  }

  const selected = elements.find((e) => e.id === selectedId) ?? null;
  const selectedLayer = selected ? layerState(settings, elementType(selected.kind).layer) : null;
  const selectedEditable = !!selected && editable && selecting && !selected.locked && !selectedLayer?.locked;

  // Attach the transformer to the selected rectangle or circle.
  useEffect(() => {
    const tr = transformerRef.current;
    const stage = stageRef.current;
    if (!tr || !stage) return;
    const node = selected && selectedEditable && (selected.shape.type === "rect" || selected.shape.type === "circle")
      ? stage.findOne(`#${selected.id}`)
      : null;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selected, selectedEditable]);

  const grid = useMemo(() => {
    const step = gridStep(view.scale);
    const { xs, ys } = gridLines(view, { width, height }, step);
    return { step, xs, ys, top: screenToPlan(view, { x: 0, y: 0 }), bottom: screenToPlan(view, { x: width, y: height }) };
  }, [view, width, height]);

  const planPointer = (): Point | null => {
    const pos = stageRef.current?.getPointerPosition();
    return pos ? screenToPlan(view, pos) : null;
  };

  // --- Finishing drafts ------------------------------------------------------

  const finishPoints = (points: Point[]) => {
    if (tool.type === "calibrate") {
      setDraft(null);
      if (points.length >= 2 && distance(points[0], points[1]) > 0) onMeasured(distance(points[0], points[1]));
      return;
    }
    if (tool.type === "measure") {
      setDraft(points.length >= 2 ? { mode: "points", points, done: true } : null);
      return;
    }
    if (tool.type !== "draw") return;
    setDraft(null);
    if (tool.shape === "polygon" && points.length >= 3) onCreate(tool.kind, { type: "polygon", points: toFlat(points) });
    if (tool.shape === "polyline" && points.length >= 2) {
      onCreate(tool.kind, { type: "polyline", points: toFlat(points), width: elementType(tool.kind).lineWidthM ?? 0.5 });
    }
  };

  const finishDrag = (start: Point, end: Point) => {
    setDraft(null);
    if (tool.type !== "draw") return;
    if (tool.shape === "rect") {
      const rect = rectFromCorners(start, end);
      if (rect.w >= MIN_SIZE_M && rect.h >= MIN_SIZE_M) onCreate(tool.kind, rect);
    } else if (tool.shape === "circle") {
      const r = distance(start, end);
      if (r >= MIN_SIZE_M) onCreate(tool.kind, { type: "circle", cx: start.x, cy: start.y, r });
    }
  };

  // --- Keyboard ----------------------------------------------------------------

  const keyState = useRef({ draft, finishPoints, onEscape, onDeleteSelected, onUndo, onRedo, selectedId, editable });
  useEffect(() => {
    keyState.current = { draft, finishPoints, onEscape, onDeleteSelected, onUndo, onRedo, selectedId, editable };
  });

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = keyState.current;
      if (!s.editable || isTyping(e.target)) return;
      const d = s.draft;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.key.toLowerCase() === "z") {
        e.preventDefault();
        if (e.shiftKey) s.onRedo();
        else s.onUndo();
        return;
      }
      if (mod && e.key.toLowerCase() === "y") {
        e.preventDefault();
        s.onRedo();
        return;
      }
      if (e.key === "Escape") {
        if (d) setDraft(null);
        else s.onEscape();
        return;
      }
      if (d?.mode === "points" && !d.done) {
        if (e.key === "Enter") {
          e.preventDefault();
          s.finishPoints(d.points);
        } else if (e.key === "Backspace") {
          e.preventDefault();
          setDraft(d.points.length > 1 ? { ...d, points: d.points.slice(0, -1) } : null);
        }
        return;
      }
      if ((e.key === "Delete" || e.key === "Backspace") && s.selectedId) {
        e.preventDefault();
        s.onDeleteSelected();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // --- Pointer -------------------------------------------------------------------

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const anchor = stageRef.current?.getPointerPosition();
    if (!anchor) return;
    onViewChange(zoomAt(view, anchor, Math.exp(-e.evt.deltaY * WHEEL_SENSITIVITY)));
  };

  const handleStageDrag = (e: KonvaEventObject<DragEvent>) => {
    if (e.target !== e.target.getStage()) return; // elements and the image move themselves
    onViewChange({ ...view, x: e.target.x(), y: e.target.y() });
  };

  const handleTouchMove = (e: KonvaEventObject<TouchEvent>) => {
    const touches = e.evt.touches;
    if (touches.length !== 2) return;
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    if (stage.isDragging()) stage.stopDrag();
    const rect = stage.container().getBoundingClientRect();
    const a = { x: touches[0].clientX - rect.left, y: touches[0].clientY - rect.top };
    const b = { x: touches[1].clientX - rect.left, y: touches[1].clientY - rect.top };
    const center = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
    const dist = distance(a, b);
    const last = pinchRef.current;
    pinchRef.current = { dist, center };
    if (!last || last.dist === 0) return;
    const zoomed = zoomAt(view, center, dist / last.dist);
    onViewChange({ ...zoomed, x: zoomed.x + center.x - last.center.x, y: zoomed.y + center.y - last.center.y });
  };

  const handleMouseDown = (e: KonvaEventObject<MouseEvent>) => {
    if (!editable || !dragDrawing || e.evt.button !== 0) return;
    const p = planPointer();
    if (p) setDraft({ mode: "drag", start: p, current: p });
  };

  const handleMouseMove = () => {
    const p = planPointer();
    setPointer(p);
    if (p && draft?.mode === "drag") setDraft({ ...draft, current: p });
  };

  const handleMouseUp = () => {
    if (draft?.mode === "drag") finishDrag(draft.start, draft.current);
  };

  const handleClick = (e: KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (selecting || !editable) {
      // Clicks on elements select them (ElementNode stops the event); anything else clears.
      if (!e.target.hasName(ELEMENT_NODE) && !e.target.hasName("site-handle")) onSelect(null);
      return;
    }
    if (dragDrawing) return;
    const p = planPointer();
    if (!p) return;
    const current = draft?.mode === "points" && !draft.done ? draft.points : [];
    const now = performance.now();
    const last = current[current.length - 1];
    const sameSpot = !!last && distance(last, p) * view.scale < DOUBLE_CLICK_PX;
    const quick = now - lastClickRef.current < DOUBLE_CLICK_MS;
    lastClickRef.current = now;
    // A second click on the last point: a double click finishes, a slow one is ignored.
    // (Konva's own dblclick fires for any two quick clicks, wherever they land.)
    if (sameSpot) {
      if (quick) finishPoints(current);
      return;
    }
    const isPolygon = tool.type === "draw" && tool.shape === "polygon";
    // Clicking the first point closes a polygon.
    if (isPolygon && current.length >= 3 && distance(current[0], p) * view.scale <= CLOSE_PX) {
      finishPoints(current);
      return;
    }
    const points = [...current, p];
    if (tool.type === "calibrate" && points.length === 2) {
      finishPoints(points);
      return;
    }
    setDraft({ mode: "points", points });
  };

  // --- Drawing ---------------------------------------------------------------------

  const gridColor = dark ? "rgba(255,255,255,0.08)" : "rgba(17,24,39,0.08)";
  const majorColor = dark ? "rgba(255,255,255,0.16)" : "rgba(17,24,39,0.16)";
  const isMajor = (v: number) => Math.abs(v / (grid.step * 5) - Math.round(v / (grid.step * 5))) < 1e-6;

  const visibleLayers = SITE_LAYERS.filter((l) => l !== "background" && l !== "labels" && layerState(settings, l).visible);
  const byLayer = (layer: string) =>
    elements
      .filter((el) => elementType(el.kind).layer === layer)
      .sort((a, b) => (a.z ?? 0) - (b.z ?? 0));

  /** Points of the draft including the rubber band to the pointer. */
  const draftPoints: Point[] = draft?.mode === "points" ? (draft.done || !pointer ? draft.points : [...draft.points, pointer]) : [];
  // Drafts in the selection colour, calibration in red: both stand out on any fill and background.
  const draftColor = tool.type === "calibrate" ? "#dc2626" : SELECT_COLOR;

  let readout: { at: Point; text: string } | null = null;
  if (draft?.mode === "drag" && tool.type === "draw") {
    if (tool.shape === "rect") {
      const r = rectFromCorners(draft.start, draft.current);
      readout = { at: draft.current, text: `${fmt(r.w)} × ${fmt(r.h)} · ${fmtArea(r.w * r.h)}` };
    } else {
      const r = distance(draft.start, draft.current);
      readout = { at: draft.current, text: `⌀ ${fmt(2 * r)} · ${fmtArea(Math.PI * r * r)}` };
    }
  } else if (draftPoints.length >= 2 && !(draft?.mode === "points" && draft.done)) {
    const at = draftPoints[draftPoints.length - 1];
    const isArea = tool.type === "draw" && tool.shape === "polygon" && draftPoints.length >= 3;
    readout = {
      at,
      text: isArea
        ? `${fmtArea(polygonArea(draftPoints))} · ${fmt(pathLength(draftPoints, true))}`
        : fmt(pathLength(draftPoints)),
    };
  }

  /** Offsets that keep a readout label inside the canvas (it sits right/below the point by default). */
  const labelOffset = (at: Point) => {
    const screenX = at.x * view.scale + view.x;
    const screenY = at.y * view.scale + view.y;
    return { offsetX: screenX > width - 200 ? 200 : -12, offsetY: screenY > height - 40 ? 36 : -12 };
  };

  const cursor = !editable ? "grab" : selecting ? "default" : "crosshair";
  const rectDraft = draft?.mode === "drag" && tool.type === "draw" && tool.shape === "rect" ? rectFromCorners(draft.start, draft.current) : null;

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      x={view.x}
      y={view.y}
      scaleX={view.scale}
      scaleY={view.scale}
      draggable={!dragDrawing}
      dragDistance={4}
      onDragMove={handleStageDrag}
      onDragEnd={handleStageDrag}
      onWheel={handleWheel}
      onTouchMove={handleTouchMove}
      onTouchEnd={() => { pinchRef.current = null; }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={() => setPointer(null)}
      onClick={handleClick}
      onTap={handleClick}
      style={{ cursor }}
    >
      <Layer listening={editable && selecting}>
        {bg && bgLayer.visible && image.status === "ready" && (
          <KonvaImage
            image={image.image}
            x={bg.x}
            y={bg.y}
            width={bg.widthPx * bg.metersPerPixel}
            height={bg.heightPx * bg.metersPerPixel}
            offsetX={(bg.widthPx * bg.metersPerPixel) / 2}
            offsetY={(bg.heightPx * bg.metersPerPixel) / 2}
            rotation={bg.rotationDeg}
            opacity={bg.opacity}
            draggable={editable && selecting && !bg.locked}
            onDragEnd={(e) => onBackgroundMoved(e.target.x(), e.target.y())}
          />
        )}
      </Layer>

      <Layer listening={false}>
        {grid.xs.map((x) => (
          <Line key={`x${x}`} points={[x, grid.top.y, x, grid.bottom.y]} stroke={isMajor(x) ? majorColor : gridColor} strokeWidth={1} strokeScaleEnabled={false} />
        ))}
        {grid.ys.map((y) => (
          <Line key={`y${y}`} points={[grid.top.x, y, grid.bottom.x, y]} stroke={isMajor(y) ? majorColor : gridColor} strokeWidth={1} strokeScaleEnabled={false} />
        ))}
      </Layer>

      <Layer listening={selecting || !editable}>
        {visibleLayers.map((layer) => {
          const locked = layerState(settings, layer).locked;
          return (
            <Group key={layer} listening={!editable || !locked}>
              {byLayer(layer).map((el) => (
                <ElementNode
                  key={el.id}
                  element={el}
                  scale={view.scale}
                  selected={el.id === selectedId}
                  draggable={editable && selecting && !locked && !el.locked}
                  onSelect={onSelect}
                  onShapeChange={onShapeChange}
                />
              ))}
            </Group>
          );
        })}
        {selected && selectedEditable && <VertexEditor element={selected} scale={view.scale} onShapeChange={onShapeChange} />}
        <Transformer
          ref={transformerRef}
          rotateEnabled={selected?.shape.type === "rect"}
          keepRatio={selected?.shape.type === "circle"}
          enabledAnchors={selected?.shape.type === "circle" ? ["top-left", "top-right", "bottom-left", "bottom-right"] : undefined}
          borderStroke={SELECT_COLOR}
          anchorStroke={SELECT_COLOR}
          anchorSize={10}
          ignoreStroke
          flipEnabled={false}
        />
      </Layer>

      <Layer listening={false}>
        {rectDraft && (
          <Rect x={rectDraft.cx - rectDraft.w / 2} y={rectDraft.cy - rectDraft.h / 2} width={rectDraft.w} height={rectDraft.h} stroke={draftColor} strokeWidth={px(2)} dash={[px(6), px(4)]} />
        )}
        {draft?.mode === "drag" && tool.type === "draw" && tool.shape === "circle" && (
          <Circle x={draft.start.x} y={draft.start.y} radius={distance(draft.start, draft.current)} stroke={draftColor} strokeWidth={px(2)} dash={[px(6), px(4)]} />
        )}
        {draftPoints.length >= 1 && (
          <>
            <Line
              points={toFlat(draftPoints)}
              closed={tool.type === "draw" && tool.shape === "polygon" && draftPoints.length >= 3}
              stroke={draftColor}
              strokeWidth={px(2)}
              dash={[px(6), px(4)]}
            />
            {(draft?.mode === "points" ? draft.points : []).map((p, i) => (
              <Circle key={i} x={p.x} y={p.y} radius={px(i === 0 ? 5 : 3.5)} fill={draftColor} />
            ))}
          </>
        )}
        {readout && (
          <Label x={readout.at.x} y={readout.at.y} scaleX={1 / view.scale} scaleY={1 / view.scale} {...labelOffset(readout.at)}>
            <Tag fill="rgba(17,24,39,0.85)" cornerRadius={4} />
            <Text text={readout.text} fill="#ffffff" fontSize={12} padding={5} fontFamily="Inter, system-ui, sans-serif" />
          </Label>
        )}
        {tool.type === "measure" && draft?.mode === "points" && draft.done && (
          <Label
            x={draft.points[draft.points.length - 1].x}
            y={draft.points[draft.points.length - 1].y}
            scaleX={1 / view.scale}
            scaleY={1 / view.scale}
            {...labelOffset(draft.points[draft.points.length - 1])}
          >
            <Tag fill="rgba(17,24,39,0.85)" cornerRadius={4} />
            <Text text={t("site.measure.total", { length: fmt(pathLength(draft.points)) })} fill="#ffffff" fontSize={12} padding={5} fontFamily="Inter, system-ui, sans-serif" />
          </Label>
        )}
      </Layer>
    </Stage>
  );
});
