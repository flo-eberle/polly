import { useTranslation } from "react-i18next";
import { Circle, MousePointer2, Pentagon, Redo2, Ruler, Square, Undo2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { ELEMENT_TYPES, elementType, type ShapeType } from "./elementTypes";
import type { SiteTool } from "./SiteCanvas";

interface SiteToolbarProps {
  tool: SiteTool;
  onToolChange: (tool: SiteTool) => void;
  onUndo: () => void;
  onRedo: () => void;
  canUndo: boolean;
  canRedo: boolean;
}

const SHAPE_ICONS: Partial<Record<ShapeType, LucideIcon>> = { rect: Square, polygon: Pentagon, circle: Circle };

function ToolButton({ icon: Icon, label, active, disabled, onClick, shortcut }: {
  icon: LucideIcon;
  label: string;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  shortcut?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-pressed={active}
      title={shortcut ? `${label} (${shortcut})` : label}
      disabled={disabled}
      onClick={onClick}
      className={`inline-flex size-9 items-center justify-center rounded-lg transition-colors disabled:cursor-not-allowed disabled:opacity-40 ${
        active
          ? "bg-garden-600 text-white"
          : "text-gray-600 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-white/10 dark:hover:text-gray-50"
      }`}
    >
      <Icon size={18} aria-hidden="true" />
    </button>
  );
}

/** Vertical tool palette on the canvas (desktop only). */
export function SiteToolbar({ tool, onToolChange, onUndo, onRedo, canUndo, canRedo }: SiteToolbarProps) {
  const { t } = useTranslation();
  const drawing = tool.type === "draw" ? elementType(tool.kind) : null;

  return (
    <div className="absolute left-3 top-1/2 flex -translate-y-1/2 gap-2">
      <div
        role="toolbar"
        aria-label={t("site.tools.label")}
        aria-orientation="vertical"
        className="flex flex-col gap-0.5 rounded-xl bg-white/95 p-1 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900/95 dark:ring-white/10"
      >
        <ToolButton icon={MousePointer2} label={t("site.tools.select")} shortcut="Esc" active={tool.type === "select"} onClick={() => onToolChange({ type: "select" })} />
        <ToolButton icon={Ruler} label={t("site.tools.measure")} active={tool.type === "measure"} onClick={() => onToolChange({ type: "measure" })} />
        <div className="my-1 h-px bg-gray-200 dark:bg-white/10" aria-hidden="true" />
        {ELEMENT_TYPES.map((type) => (
          <ToolButton
            key={type.kind}
            icon={type.icon}
            label={t("site.tools.draw", { kind: t(type.labelKey) })}
            active={tool.type === "draw" && tool.kind === type.kind}
            onClick={() => onToolChange({ type: "draw", kind: type.kind, shape: type.shapes[0], variant: type.variants?.[0].id })}
          />
        ))}
        <div className="my-1 h-px bg-gray-200 dark:bg-white/10" aria-hidden="true" />
        <ToolButton icon={Undo2} label={t("site.tools.undo")} shortcut="Ctrl+Z" disabled={!canUndo} onClick={onUndo} />
        <ToolButton icon={Redo2} label={t("site.tools.redo")} shortcut="Ctrl+Shift+Z" disabled={!canRedo} onClick={onRedo} />
      </div>

      {drawing && tool.type === "draw" && (drawing.shapes.length > 1 || (drawing.variants?.length ?? 0) > 1) && (
        <div className="flex flex-col gap-2 self-start">
          {drawing.variants && drawing.variants.length > 1 && (
            <div
              role="group"
              aria-label={t("site.tools.variant")}
              className="flex flex-col gap-0.5 rounded-xl bg-white/95 p-1 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900/95 dark:ring-white/10"
            >
              {drawing.variants.map((variant) => (
                <ToolButton
                  key={variant.id}
                  icon={variant.icon}
                  label={t(variant.labelKey)}
                  active={(tool.variant ?? drawing.variants?.[0].id) === variant.id}
                  onClick={() => onToolChange({ ...tool, variant: variant.id })}
                />
              ))}
            </div>
          )}
          {drawing.shapes.length > 1 && (
            <div
              role="group"
              aria-label={t("site.tools.shape")}
              className="flex flex-col gap-0.5 rounded-xl bg-white/95 p-1 shadow-sm ring-1 ring-gray-200 dark:bg-gray-900/95 dark:ring-white/10"
            >
              {drawing.shapes.map((shape) => {
                const Icon = SHAPE_ICONS[shape];
                if (!Icon) return null;
                return (
                  <ToolButton
                    key={shape}
                    icon={Icon}
                    label={t(`site.shapes.${shape}`)}
                    active={tool.shape === shape}
                    onClick={() => onToolChange({ ...tool, shape })}
                  />
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
