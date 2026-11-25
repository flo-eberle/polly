import { memo, useState } from "react";
import { Circle, Line, Rect } from "react-konva";
import type Konva from "konva";
import type { KonvaEventObject } from "konva/lib/Node";
import type { SiteElement, SiteShape } from "@/types/site";
import { edgeMidpoints, insertVertex, moveVertex, removeVertex, toPoints, translateShape } from "@/lib/siteShapes";
import { resolvedType } from "./elementTypes";

/** Selection colour (sky-500): distinct from every element fill. */
export const SELECT_COLOR = "#0ea5e9";

/** Name on every element node, so clicks can tell elements from the background. */
export const ELEMENT_NODE = "site-element";

interface ElementNodeProps {
  element: SiteElement;
  /** Screen pixels per metre. */
  scale: number;
  selected: boolean;
  draggable: boolean;
  onSelect: (id: string) => void;
  onShapeChange: (id: string, shape: SiteShape) => void;
}

/** One element on the canvas, drawn from its registry style. */
export const ElementNode = memo(function ElementNode({ element, scale, selected, draggable, onSelect, onShapeChange }: ElementNodeProps) {
  const { style } = resolvedType(element);
  const px = (n: number) => n / scale;
  const shape = element.shape;
  const stroke = selected ? SELECT_COLOR : style.stroke;
  const outline = px(selected ? Math.max(style.strokeWidthPx, 2) : style.strokeWidthPx);
  const dash = style.dash?.map(px);

  const common = {
    id: element.id,
    name: ELEMENT_NODE,
    draggable,
    onClick: (e: KonvaEventObject<MouseEvent>) => { e.cancelBubble = true; onSelect(element.id); },
    onTap: (e: KonvaEventObject<TouchEvent>) => { e.cancelBubble = true; onSelect(element.id); },
    onMouseEnter: (e: KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      if (stage && draggable) stage.container().style.cursor = "move";
    },
    onMouseLeave: (e: KonvaEventObject<MouseEvent>) => {
      const stage = e.target.getStage();
      if (stage) stage.container().style.cursor = "";
    },
  };

  switch (shape.type) {
    case "rect":
      return (
        <Rect
          {...common}
          x={shape.cx}
          y={shape.cy}
          width={shape.w}
          height={shape.h}
          offsetX={shape.w / 2}
          offsetY={shape.h / 2}
          rotation={shape.rotationDeg}
          fill={style.fill}
          stroke={stroke}
          strokeWidth={outline}
          dash={dash}
          onDragEnd={(e) => onShapeChange(element.id, { ...shape, cx: e.target.x(), cy: e.target.y() })}
          onTransformEnd={(e) => {
            const node = e.target as Konva.Rect;
            const next: SiteShape = {
              type: "rect",
              cx: node.x(),
              cy: node.y(),
              w: Math.max(0.05, shape.w * Math.abs(node.scaleX())),
              h: Math.max(0.05, shape.h * Math.abs(node.scaleY())),
              rotationDeg: node.rotation(),
            };
            node.scale({ x: 1, y: 1 });
            onShapeChange(element.id, next);
          }}
        />
      );
    case "circle":
      return (
        <Circle
          {...common}
          x={shape.cx}
          y={shape.cy}
          radius={shape.r}
          fill={style.fill}
          stroke={stroke}
          strokeWidth={outline}
          dash={dash}
          onDragEnd={(e) => onShapeChange(element.id, { ...shape, cx: e.target.x(), cy: e.target.y() })}
          onTransformEnd={(e) => {
            const node = e.target as Konva.Circle;
            const r = Math.max(0.05, shape.r * Math.max(Math.abs(node.scaleX()), Math.abs(node.scaleY())));
            node.scale({ x: 1, y: 1 });
            onShapeChange(element.id, { ...shape, cx: node.x(), cy: node.y(), r });
          }}
        />
      );
    case "polygon":
      return (
        <Line
          {...common}
          points={shape.points}
          closed
          fill={style.fill}
          stroke={stroke}
          strokeWidth={outline}
          dash={dash}
          lineJoin="round"
          onDragEnd={(e) => {
            const node = e.target;
            const dx = node.x();
            const dy = node.y();
            node.position({ x: 0, y: 0 }); // the points carry the position
            onShapeChange(element.id, translateShape(shape, dx, dy));
          }}
        />
      );
    case "polyline": {
      // Never thinner than its outline width on screen, so a fence stays visible when zoomed out.
      const width = Math.max(shape.width, px(style.strokeWidthPx * 1.5));
      return (
        <>
          {selected && (
            <Line points={shape.points} stroke={SELECT_COLOR} strokeWidth={width + px(4)} lineCap="round" lineJoin="round" listening={false} />
          )}
          <Line
            {...common}
            points={shape.points}
            stroke={style.stroke}
            strokeWidth={width}
            hitStrokeWidth={Math.max(width, px(12))}
            dash={dash}
            lineCap={dash ? "butt" : "round"}
            lineJoin="round"
            onDragEnd={(e) => {
              const node = e.target;
              const dx = node.x();
              const dy = node.y();
              node.position({ x: 0, y: 0 });
              onShapeChange(element.id, translateShape(shape, dx, dy));
            }}
          />
        </>
      );
    }
  }
});

interface VertexEditorProps {
  element: SiteElement;
  scale: number;
  onShapeChange: (id: string, shape: SiteShape) => void;
}

/**
 * Handles for polygons and lines: drag a corner to move it, drag a midpoint
 * to insert a corner, double-click a corner to remove it.
 */
export function VertexEditor({ element, scale, onShapeChange }: VertexEditorProps) {
  const [preview, setPreview] = useState<number[] | null>(null);
  const shape = element.shape;
  if (shape.type !== "polygon" && shape.type !== "polyline") return null;

  const closed = shape.type === "polygon";
  const minVertices = closed ? 3 : 2;
  const px = (n: number) => n / scale;
  const commit = (points: number[]) => {
    setPreview(null);
    onShapeChange(element.id, { ...shape, points });
  };
  const pos = (e: KonvaEventObject<DragEvent>) => ({ x: e.target.x(), y: e.target.y() });

  return (
    <>
      {preview && (
        <Line points={preview} closed={closed} stroke={SELECT_COLOR} strokeWidth={px(1.5)} dash={[px(5), px(4)]} listening={false} />
      )}
      {edgeMidpoints(shape.points, closed).map((m, i) => (
        <Circle
          key={`m${i}-${m.x}-${m.y}`}
          name="site-handle"
          x={m.x}
          y={m.y}
          radius={px(4)}
          fill={SELECT_COLOR}
          opacity={0.55}
          draggable
          onDragMove={(e) => setPreview(insertVertex(shape.points, i, pos(e)))}
          onDragEnd={(e) => commit(insertVertex(shape.points, i, pos(e)))}
        />
      ))}
      {toPoints(shape.points).map((p, i) => (
        <Circle
          key={`v${i}-${p.x}-${p.y}`}
          name="site-handle"
          x={p.x}
          y={p.y}
          radius={px(6)}
          fill="#ffffff"
          stroke={SELECT_COLOR}
          strokeWidth={px(2)}
          draggable
          onDragMove={(e) => setPreview(moveVertex(shape.points, i, pos(e)))}
          onDragEnd={(e) => commit(moveVertex(shape.points, i, pos(e)))}
          onDblClick={(e) => {
            e.cancelBubble = true;
            const next = removeVertex(shape.points, i, minVertices);
            if (next !== shape.points) commit(next);
          }}
        />
      ))}
    </>
  );
}
