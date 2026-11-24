import { memo, useMemo, useRef, useState } from "react";
import { Circle, Image as KonvaImage, Layer, Line, Stage } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import { distance, gridLines, gridStep, screenToPlan, zoomAt, type Point, type View } from "@/lib/siteGeometry";
import { layerState, type SiteSettings } from "@/types/site";
import type { SiteImageState } from "./useSiteImage";

export type SiteTool = "pan" | "calibrate";

interface SiteCanvasProps {
  width: number;
  height: number;
  view: View;
  onViewChange: (view: View) => void;
  settings: SiteSettings;
  image: SiteImageState;
  /** Desktop editing; false on touch devices (view only). */
  editable: boolean;
  tool: SiteTool;
  /** Calibration line finished: its length in plan metres at the current scale. */
  onMeasured: (measuredM: number) => void;
  onBackgroundMoved: (x: number, y: number) => void;
  dark: boolean;
}

const WHEEL_SENSITIVITY = 0.0015;

/** The Konva stage: grid, background image and the calibration line. */
export const SiteCanvas = memo(function SiteCanvas({
  width, height, view, onViewChange, settings, image, editable, tool, onMeasured, onBackgroundMoved, dark,
}: SiteCanvasProps) {
  const stageRef = useRef<Konva.Stage>(null);
  const [calibStart, setCalibStart] = useState<Point | null>(null);
  const [pointer, setPointer] = useState<Point | null>(null);
  const pinchRef = useRef<{ dist: number; center: Point } | null>(null);

  const bg = settings.background;
  const bgLayer = layerState(settings, "background");
  const calibrating = editable && tool === "calibrate";

  const grid = useMemo(() => {
    const step = gridStep(view.scale);
    const { xs, ys } = gridLines(view, { width, height }, step);
    const top = screenToPlan(view, { x: 0, y: 0 });
    const bottom = screenToPlan(view, { x: width, y: height });
    return { step, xs, ys, top, bottom };
  }, [view, width, height]);

  const planPointer = (): Point | null => {
    const pos = stageRef.current?.getPointerPosition();
    return pos ? screenToPlan(view, pos) : null;
  };

  const handleWheel = (e: KonvaEventObject<WheelEvent>) => {
    e.evt.preventDefault();
    const anchor = stageRef.current?.getPointerPosition();
    if (!anchor) return;
    onViewChange(zoomAt(view, anchor, Math.exp(-e.evt.deltaY * WHEEL_SENSITIVITY)));
  };

  const handleStageDrag = (e: KonvaEventObject<DragEvent>) => {
    if (e.target !== e.target.getStage()) return; // the background image moves itself
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

  const handleClick = () => {
    if (!calibrating) return;
    const p = planPointer();
    if (!p) return;
    if (!calibStart) {
      setCalibStart(p);
      return;
    }
    const measured = distance(calibStart, p);
    setCalibStart(null);
    setPointer(null);
    if (measured > 0) onMeasured(measured);
  };

  const gridColor = dark ? "rgba(255,255,255,0.08)" : "rgba(17,24,39,0.08)";
  const majorColor = dark ? "rgba(255,255,255,0.16)" : "rgba(17,24,39,0.16)";
  const isMajor = (v: number) => Math.abs(v / (grid.step * 5) - Math.round(v / (grid.step * 5))) < 1e-6;
  const px = (n: number) => n / view.scale; // screen pixels in plan units

  const calibEnd = calibStart && pointer ? pointer : null;

  return (
    <Stage
      ref={stageRef}
      width={width}
      height={height}
      x={view.x}
      y={view.y}
      scaleX={view.scale}
      scaleY={view.scale}
      draggable={!calibrating}
      onDragMove={handleStageDrag}
      onDragEnd={handleStageDrag}
      onWheel={handleWheel}
      onTouchMove={handleTouchMove}
      onTouchEnd={() => { pinchRef.current = null; }}
      onClick={handleClick}
      onTap={handleClick}
      onMouseMove={() => { if (calibStart) setPointer(planPointer()); }}
      style={{ cursor: calibrating ? "crosshair" : "grab" }}
    >
      <Layer listening={!calibrating && editable}>
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
            draggable={editable && tool === "pan" && !bg.locked && !bgLayer.locked}
            onDragEnd={(e) => onBackgroundMoved(e.target.x(), e.target.y())}
            onMouseEnter={(e) => {
              const stage = e.target.getStage();
              if (stage && editable && !bg.locked && !bgLayer.locked) stage.container().style.cursor = "move";
            }}
            onMouseLeave={(e) => {
              const stage = e.target.getStage();
              if (stage) stage.container().style.cursor = calibrating ? "crosshair" : "grab";
            }}
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
      <Layer listening={false}>
        {calibStart && (
          <>
            <Circle x={calibStart.x} y={calibStart.y} radius={px(5)} fill="#dc2626" />
            {calibEnd && (
              <>
                <Line points={[calibStart.x, calibStart.y, calibEnd.x, calibEnd.y]} stroke="#dc2626" strokeWidth={2} strokeScaleEnabled={false} dash={[px(6), px(4)]} />
                <Circle x={calibEnd.x} y={calibEnd.y} radius={px(5)} fill="#dc2626" />
              </>
            )}
          </>
        )}
      </Layer>
    </Stage>
  );
});
