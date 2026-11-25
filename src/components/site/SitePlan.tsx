import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { useShallow } from "zustand/react/shallow";
import { Eye, EyeOff, ImagePlus, Lock, LockOpen, Map as MapIcon, Maximize, PenLine, Ruler, Sun, Trash2, X } from "lucide-react";
import { useStore } from "@/store";
import { PageHeader } from "@/components/ui/PageHeader";
import { Button } from "@/components/ui/Button";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { EmptyState } from "@/components/ui/EmptyState";
import { Modal } from "@/components/ui/Modal";
import { useToast } from "@/components/ui/Toast";
import { usePointerFine } from "@/components/planner/usePointerFine";
import { deleteBlob, newBlobId, putBlob } from "@/lib/blobStore";
import { DEFAULT_METERS_PER_PIXEL, prepareBackgroundImage } from "@/lib/siteImage";
import {
  calibratedMetersPerPixel,
  fitBounds,
  formatLength,
  rotatedRectBounds,
  scaleBar,
  type View,
} from "@/lib/siteGeometry";
import { shapeArea, shapeBounds, shapeLength, unionBounds } from "@/lib/siteShapes";
import { newSiteElement } from "@/store/siteSlice";
import { SITE_LAYERS, layerState, type SiteElement, type SiteLayerId, type SiteShape } from "@/types/site";
import { SiteCanvas, type SiteTool } from "./SiteCanvas";
import { SiteToolbar } from "./SiteToolbar";
import { SiteProperties } from "./SiteProperties";
import { SegmentedControl } from "@/components/ui/SegmentedControl";
import { isVisibleInView, type SiteView } from "./siteView";
import { SunPanel, initialSunSettings, sunDate, type SunSettings } from "./SunPanel";
import { casterFor, shadowPolygons, sunAt } from "@/lib/siteShadow";
import { elementType, resolvedType, shadowCasterOptions } from "./elementTypes";
import { useElementHistory } from "./useElementHistory";
import { useSiteImage } from "./useSiteImage";
import { useIsDark } from "./useIsDark";

const DEFAULT_VIEW: View = { x: 0, y: 0, scale: 10 };

const SELECT: SiteTool = { type: "select" };

/** Site plan: background image, calibration, north direction, layers, drawing and editing. */
export function SitePlan() {
  const { t, i18n } = useTranslation();
  const { toast, confirm } = useToast();
  const editable = usePointerFine();
  const dark = useIsDark();
  const { settings, elements, backendUrl, lat, lon, setSiteBackground, updateSiteBackground, setNorthDeg, setSiteLayer } = useStore(
    useShallow((s) => ({
      settings: s.siteSettings,
      elements: s.siteElements,
      lat: s.locationLat,
      lon: s.locationLon,
      backendUrl: s.backendUrl,
      setSiteBackground: s.setSiteBackground,
      updateSiteBackground: s.updateSiteBackground,
      setNorthDeg: s.setNorthDeg,
      setSiteLayer: s.setSiteLayer,
    })),
  );
  const bg = settings.background;
  const image = useSiteImage(bg?.imageId, backendUrl);

  const containerRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [view, setView] = useState<View>(DEFAULT_VIEW);
  const [fittedFor, setFittedFor] = useState<string | null>(null);
  const [tool, setTool] = useState<SiteTool>(SELECT);
  const [measured, setMeasured] = useState<number | null>(null);
  const [importing, setImporting] = useState(false);
  const [startedBlank, setStartedBlank] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const { commit, undo, redo, canUndo, canRedo } = useElementHistory();
  const [planView, setPlanView] = useState<SiteView>("all");
  const shownElements = useMemo(() => elements.filter((e) => isVisibleInView(e, planView)), [elements, planView]);
  const selected = shownElements.find((e) => e.id === selectedId) ?? null;

  const [shadowsOn, setShadowsOn] = useState(false);
  const [sun, setSun] = useState<SunSettings>(() => initialSunSettings());
  const shadows = useMemo(() => {
    if (!shadowsOn || lat === null || lon === null) return null;
    const position = sunAt(sunDate(sun), lat, lon);
    const solid: number[][] = [];
    const partial: number[][] = [];
    for (const el of shownElements) {
      if (!layerState(settings, elementType(el.kind).layer).visible) continue;
      const caster = casterFor(el, shadowCasterOptions(el, sun.mature));
      if (!caster) continue;
      (caster.partial ? partial : solid).push(...shadowPolygons(caster, position, settings.northDeg));
    }
    return { solid, partial };
  }, [shadowsOn, lat, lon, sun, shownElements, settings]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setSize({ width: el.clientWidth, height: el.clientHeight });
    update();
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const fitView = useCallback(() => {
    if (size.width === 0) return;
    const bounds = unionBounds([
      bg ? rotatedRectBounds(bg.x, bg.y, bg.widthPx * bg.metersPerPixel, bg.heightPx * bg.metersPerPixel, bg.rotationDeg) : null,
      ...elements.map((e) => shapeBounds(e.shape)),
    ]);
    if (!bounds) {
      setView({ ...DEFAULT_VIEW, x: size.width / 2, y: size.height / 2 });
      return;
    }
    setView(fitBounds(bounds, size));
  }, [bg, elements, size]);

  // Fit once per image (or once for a plan without one) as soon as the canvas has a size.
  const fitKey = size.width === 0 ? null : bg ? bg.imageId : "no-background";
  if (fitKey && fitKey !== fittedFor) {
    setFittedFor(fitKey);
    fitView();
  }

  const handleFile = async (file: File) => {
    setImporting(true);
    try {
      const prepared = await prepareBackgroundImage(file);
      const imageId = newBlobId("site-bg");
      await putBlob(imageId, prepared.blob);
      const previous = bg?.imageId;
      setSiteBackground({
        imageId,
        widthPx: prepared.width,
        heightPx: prepared.height,
        x: 0,
        y: 0,
        rotationDeg: 0,
        metersPerPixel: DEFAULT_METERS_PER_PIXEL,
        opacity: 1,
        locked: false,
        calibrated: false,
      });
      if (previous) void deleteBlob(previous).catch(() => undefined);
      setTool(SELECT);
      toast(t("site.background.imported"), "success");
    } catch {
      toast(t("site.background.importFailed"), "error");
    } finally {
      setImporting(false);
    }
  };

  const pickFile = async () => {
    if (bg) {
      const ok = await confirm({
        title: t("site.background.replaceTitle"),
        message: t("site.background.replaceMessage"),
        confirmLabel: t("site.background.replace"),
      });
      if (!ok) return;
    }
    fileRef.current?.click();
  };

  const removeBackground = async () => {
    if (!bg) return;
    const ok = await confirm({
      title: t("site.background.removeTitle"),
      message: t("site.background.removeMessage"),
      confirmLabel: t("site.background.remove"),
    });
    if (!ok) return;
    const id = bg.imageId;
    setSiteBackground(undefined);
    void deleteBlob(id).catch(() => undefined);
  };

  const applyCalibration = (actualM: number) => {
    if (!bg || measured === null) return;
    updateSiteBackground({
      metersPerPixel: calibratedMetersPerPixel(bg.metersPerPixel, measured, actualM),
      calibrated: true,
    });
    setMeasured(null);
    setTool(SELECT);
    setFittedFor(null); // refit to the corrected size
    toast(t("site.calibrate.done", { length: formatLength(actualM, i18n.language) }), "success");
  };

  // --- Elements ---------------------------------------------------------------

  const createElement = useCallback((kind: string, shape: SiteShape, variant?: string) => {
    const type = elementType(kind);
    const created = newSiteElement({ kind, ...(variant ? { variant } : {}), layer: type.layer, shape, status: "existing" });
    commit([...useStore.getState().siteElements, created]);
    setSelectedId(created.id);
  }, [commit]);

  const updateElement = useCallback((id: string, updates: Partial<SiteElement>, coalesceKey?: string) => {
    const stamp = new Date().toISOString();
    commit(
      useStore.getState().siteElements.map((e) => (e.id === id ? { ...e, ...updates, id, updatedAt: stamp } : e)),
      coalesceKey,
    );
  }, [commit]);

  const changeShape = useCallback((id: string, shape: SiteShape) => {
    const stamp = new Date().toISOString();
    commit(useStore.getState().siteElements.map((e) => (e.id === id ? { ...e, shape, updatedAt: stamp } : e)));
  }, [commit]);

  const deleteSelected = useCallback(async () => {
    const target = useStore.getState().siteElements.find((e) => e.id === selectedId);
    if (!target) return;
    const name = target.name || t(resolvedType(target).labelKey);
    const ok = await confirm({
      title: t("site.element.deleteTitle", { name }),
      message: t("site.element.deleteMessage"),
      confirmLabel: t("common.delete"),
    });
    if (!ok) return;
    commit(useStore.getState().siteElements.filter((e) => e.id !== target.id));
    setSelectedId(null);
  }, [commit, confirm, selectedId, t]);

  const handleEscape = useCallback(() => {
    if (tool.type !== "select") setTool(SELECT);
    else setSelectedId(null);
  }, [tool]);

  const changeTool = (next: SiteTool) => {
    setTool(next);
    if (next.type !== "select") setSelectedId(null);
  };

  const bar = scaleBar(view.scale);
  const showCanvas = !!bg || elements.length > 0 || startedBlank;
  const toolHint =
    tool.type === "calibrate" ? t("site.calibrate.hint")
    : tool.type === "measure" ? t("site.measure.hint")
    : tool.type === "draw" ? t(`site.hints.${tool.shape}`)
    : null;

  return (
    <div className="flex h-full flex-col">
      <PageHeader
        title={t("site.title")}
        description={editable ? t("site.subtitle") : t("site.subtitleViewOnly")}
        className="mb-4"
        actions={editable && showCanvas ? (
          <>
            <Button variant="secondary" onClick={() => void pickFile()} disabled={importing}>
              <ImagePlus size={16} aria-hidden="true" />
              {bg ? t("site.background.replace") : t("site.background.import")}
            </Button>
            {bg && <Button
              variant={tool.type === "calibrate" ? "primary" : "secondary"}
              aria-pressed={tool.type === "calibrate"}
              onClick={() => changeTool(tool.type === "calibrate" ? SELECT : { type: "calibrate" })}
            >
              <Ruler size={16} aria-hidden="true" />
              {t("site.calibrate.action")}
            </Button>}
          </>
        ) : undefined}
      />

      <input
        ref={fileRef}
        type="file"
        accept="image/png,image/jpeg,image/webp,image/gif"
        className="hidden"
        aria-hidden="true"
        tabIndex={-1}
        onChange={(e) => {
          const file = e.target.files?.[0];
          e.target.value = "";
          if (file) void handleFile(file);
        }}
      />

      {!showCanvas ? (
        <EmptyState
          icon={MapIcon}
          title={t("site.empty.title")}
          description={editable ? t("site.empty.description") : t("site.empty.descriptionViewOnly")}
          action={editable ? (
            <div className="flex flex-wrap justify-center gap-2">
              <Button onClick={() => void pickFile()} disabled={importing}>
                <ImagePlus size={16} aria-hidden="true" />
                {t("site.background.import")}
              </Button>
              <Button variant="secondary" onClick={() => setStartedBlank(true)}>
                <PenLine size={16} aria-hidden="true" />
                {t("site.empty.startBlank")}
              </Button>
            </div>
          ) : undefined}
        />
      ) : null}

      <div className={`flex min-h-0 flex-1 gap-4 ${showCanvas ? "" : "hidden"}`}>
        <div
          ref={containerRef}
          className="relative min-h-[360px] flex-1 overflow-hidden rounded-xl border border-gray-200 bg-white touch-none dark:border-white/10 dark:bg-gray-900"
          style={{ height: "calc(100dvh - 13rem)" }}
          data-testid="site-canvas"
          data-shadows={shadows ? shadows.solid.length + shadows.partial.length : undefined}
        >
          {size.width > 0 && (
            <SiteCanvas
              width={size.width}
              height={size.height}
              view={view}
              onViewChange={setView}
              settings={settings}
              elements={shownElements}
              image={image}
              editable={editable}
              tool={tool}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onCreate={createElement}
              onShapeChange={changeShape}
              onMeasured={setMeasured}
              onBackgroundMoved={(x, y) => updateSiteBackground({ x, y })}
              onEscape={handleEscape}
              onDeleteSelected={() => void deleteSelected()}
              onUndo={undo}
              onRedo={redo}
              shadows={shadows}
              dark={dark}
            />
          )}

          {editable && (
            <SiteToolbar
              tool={tool}
              onToolChange={changeTool}
              onUndo={undo}
              onRedo={redo}
              canUndo={canUndo}
              canRedo={canRedo}
            />
          )}

          {selected && (
            <SelectionInfo
              // On wide screens the properties panel in the side bar takes over.
              className={editable ? "lg:hidden" : ""}
              element={selected}
              editable={editable}
              onDelete={() => void deleteSelected()}
              onClose={() => setSelectedId(null)}
            />
          )}

          {/* North arrow */}
          <div className="pointer-events-none absolute right-3 top-3 flex flex-col items-center rounded-lg bg-white/85 px-2 py-1.5 text-xs font-semibold text-gray-800 shadow-xs dark:bg-gray-900/85 dark:text-gray-100">
            <svg width="28" height="28" viewBox="-14 -14 28 28" aria-hidden="true" style={{ transform: `rotate(${settings.northDeg}deg)` }}>
              <polygon points="0,-12 5,6 0,2 -5,6" className="fill-gray-800 dark:fill-gray-100" />
            </svg>
            <span>{t("site.north.short")}</span>
            <span className="sr-only">{t("site.north.label", { deg: settings.northDeg })}</span>
          </div>

          <div className="absolute right-3 top-[5.25rem]">
            <IconButton
              icon={Sun}
              label={t(shadowsOn ? "site.sun.hide" : "site.sun.show")}
              aria-pressed={shadowsOn}
              tone={shadowsOn ? "brand" : "neutral"}
              onClick={() => setShadowsOn(!shadowsOn)}
              className={`shadow-xs ${shadowsOn ? "bg-garden-50 ring-1 ring-inset ring-garden-600/40 dark:bg-garden-500/15" : "bg-white/85 dark:bg-gray-900/85"}`}
            />
          </div>
          {shadowsOn && (
            <SunPanel settings={sun} onChange={setSun} onClose={() => setShadowsOn(false)} lat={lat} lon={lon} />
          )}

          {/* Scale bar */}
          <div className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-white/85 px-2 py-1 text-xs text-gray-800 shadow-xs dark:bg-gray-900/85 dark:text-gray-100">
            <div className="h-1.5 border-x-2 border-b-2 border-gray-800 dark:border-gray-100" style={{ width: bar.px }} />
            <span className="tabular-nums">{formatLength(bar.meters, i18n.language)}</span>
          </div>

          <div className="absolute bottom-3 right-3 flex items-center gap-2">
            {elements.length > 0 && (
              <SegmentedControl<SiteView>
                label={t("site.views.label")}
                size="sm"
                inline
                value={planView}
                onChange={(v) => setPlanView(v)}
                options={[
                  { value: "all", label: t("site.views.all") },
                  { value: "current", label: t("site.views.current") },
                  { value: "target", label: t("site.views.target") },
                ]}
                className="bg-white/90 shadow-xs dark:bg-gray-900/90"
              />
            )}
            <IconButton icon={Maximize} label={t("site.fit")} onClick={fitView} className="bg-white/85 shadow-xs dark:bg-gray-900/85" />
          </div>

          {toolHint && (
            <p role="status" className="pointer-events-none absolute left-1/2 top-3 max-w-[60%] -translate-x-1/2 rounded-lg bg-gray-900/85 px-3 py-1.5 text-center text-sm text-white">
              {toolHint}
            </p>
          )}
          {bg && !bg.calibrated && tool.type === "select" && (
            <p role="status" className="absolute left-3 top-3 max-w-xs rounded-lg bg-warning/15 px-3 py-1.5 text-sm text-gray-900 dark:text-gray-100">
              {editable ? t("site.calibrate.missing") : t("site.calibrate.missingViewOnly")}
            </p>
          )}
          {image.status === "missing" && (
            <p role="status" className="absolute inset-x-3 top-14 rounded-lg bg-danger/10 px-3 py-1.5 text-sm text-danger">
              {t("site.background.missing")}
            </p>
          )}
        </div>

        {editable && showCanvas && (
          <aside aria-label={t("site.panel")} className="hidden w-72 shrink-0 space-y-5 overflow-y-auto lg:block">
            {selected && (
              <SiteProperties
                element={selected}
                onChange={(updates, key) => updateElement(selected.id, updates, key)}
                onDelete={() => void deleteSelected()}
              />
            )}
            {bg && <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">{t("site.background.title")}</h2>
              <label className="block text-sm text-gray-700 dark:text-gray-300">
                {t("site.background.opacity")}
                <input
                  type="range"
                  min={0.1}
                  max={1}
                  step={0.05}
                  value={bg.opacity}
                  onChange={(e) => updateSiteBackground({ opacity: Number(e.target.value) })}
                  className="mt-1 block w-full accent-garden-600"
                />
              </label>
              <Input
                label={t("site.background.rotation")}
                type="number"
                step="0.5"
                value={bg.rotationDeg}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) updateSiteBackground({ rotationDeg: v });
                }}
                disabled={bg.locked}
              />
              <Checkbox
                label={t("site.background.lock")}
                checked={bg.locked}
                onChange={(e) => updateSiteBackground({ locked: e.target.checked })}
              />
              <p className="text-xs text-gray-500 dark:text-gray-400">
                {bg.calibrated
                  ? t("site.background.scale", { value: formatLength(bg.metersPerPixel, i18n.language) })
                  : t("site.background.notCalibrated")}
              </p>
              <Button variant="danger-ghost" size="sm" onClick={() => void removeBackground()}>
                <Trash2 size={16} aria-hidden="true" />
                {t("site.background.remove")}
              </Button>
            </section>}

            <section className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
              <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">{t("site.north.title")}</h2>
              <Input
                label={t("site.north.input")}
                hint={t("site.north.hint")}
                type="number"
                step="1"
                value={settings.northDeg}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  if (Number.isFinite(v)) setNorthDeg(v);
                }}
              />
            </section>

            <section className="rounded-xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
              <h2 className="mb-2 text-sm font-semibold text-gray-900 dark:text-gray-50">{t("site.layers.title")}</h2>
              <ul className="divide-y divide-gray-100 dark:divide-white/5">
                {SITE_LAYERS.map((layer) => (
                  <LayerRow
                    key={layer}
                    layer={layer}
                    // The background layer's lock is the background's own lock, so the
                    // layer row and the checkbox above always agree.
                    state={layer === "background" ? { ...layerState(settings, layer), locked: bg?.locked ?? false } : layerState(settings, layer)}
                    onChange={(l, updates) => {
                      if (l === "background" && updates.locked !== undefined) updateSiteBackground({ locked: updates.locked });
                      else setSiteLayer(l, updates);
                    }}
                  />
                ))}
              </ul>
            </section>
          </aside>
        )}
      </div>

      <CalibrateDialog
        measuredM={measured}
        onCancel={() => setMeasured(null)}
        onApply={applyCalibration}
      />
    </div>
  );

}

function SelectionInfo({ element, editable, onDelete, onClose, className = "" }: {
  element: SiteElement;
  editable: boolean;
  onDelete: () => void;
  onClose: () => void;
  className?: string;
}) {
  const { t, i18n } = useTranslation();
  const type = resolvedType(element);
  const Icon = type.icon;
  const area = shapeArea(element.shape);
  const length = shapeLength(element.shape);
  const num = (v: number, digits: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: digits }).format(v);
  const isLine = element.shape.type === "polyline";
  // Read-only summary for phones: what the household wants to know at a glance.
  const details = [
    element.status && element.status !== "existing" ? t(`site.status.${element.status}`) + (element.plannedYear ? ` ${element.plannedYear}` : "") : null,
    [element.speciesText, element.variety].filter(Boolean).join(" ") || null,
    element.usage?.length ? element.usage.map((u) => t(`site.usage.${u}`)).join(", ") : null,
    element.plantedYear ? t("site.element.planted", { year: element.plantedYear }) : null,
  ].filter((d): d is string => !!d);

  return (
    <div
      role="region"
      aria-label={t("site.element.info")}
      className={`absolute bottom-14 left-1/2 flex w-[min(22rem,calc(100%-1.5rem))] ${className} -translate-x-1/2 items-start gap-3 rounded-xl bg-white/95 p-3 text-sm shadow-md ring-1 ring-gray-200 dark:bg-gray-900/95 dark:ring-white/10`}
    >
      <Icon size={20} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-500 dark:text-gray-400" />
      <div className="min-w-0 flex-1">
        <p className="font-medium text-gray-900 dark:text-gray-50">{element.name || t(type.labelKey)}</p>
        <p className="tabular-nums text-gray-600 dark:text-gray-300">
          {area !== null && <>{t("site.element.area", { value: num(area, area < 10 ? 1 : 0) })} · </>}
          {t(isLine ? "site.element.length" : "site.element.perimeter", { value: formatLength(length, i18n.language) })}
        </p>
        {details.length > 0 && <p className="text-gray-600 dark:text-gray-300">{details.join(" · ")}</p>}
      </div>
      {editable && <IconButton size="sm" icon={Trash2} tone="danger" label={t("site.element.delete")} onClick={onDelete} />}
      <IconButton size="sm" icon={X} label={t("common.close")} onClick={onClose} />
    </div>
  );
}

/** A switched-on toggle (hidden, locked) stands out from the default state. */
const PRESSED = "bg-garden-50 ring-1 ring-inset ring-garden-600/40 dark:bg-garden-500/15 dark:ring-garden-300/40";

interface LayerRowProps {
  layer: SiteLayerId;
  state: { visible: boolean; locked: boolean };
  onChange: (layer: SiteLayerId, updates: { visible?: boolean; locked?: boolean }) => void;
}

function LayerRow({ layer, state, onChange }: LayerRowProps) {
  const { t } = useTranslation();
  const name = t(`site.layers.${layer}`);
  return (
    <li className="flex items-center justify-between gap-2 py-1">
      <span className={`text-sm ${state.visible ? "text-gray-800 dark:text-gray-200" : "text-gray-500 dark:text-gray-400"}`}>{name}</span>
      <span className="flex">
        <IconButton
          size="sm"
              icon={state.visible ? Eye : EyeOff}
          label={t(state.visible ? "site.layers.hide" : "site.layers.show", { name })}
          aria-pressed={!state.visible}
          tone={state.visible ? "neutral" : "brand"}
          className={state.visible ? "" : PRESSED}
          onClick={() => onChange(layer, { visible: !state.visible })}
        />
        <IconButton
          size="sm"
          icon={state.locked ? Lock : LockOpen}
          label={t(state.locked ? "site.layers.unlock" : "site.layers.lock", { name })}
          aria-pressed={state.locked}
          tone={state.locked ? "brand" : "neutral"}
          className={state.locked ? PRESSED : ""}
          onClick={() => onChange(layer, { locked: !state.locked })}
        />
      </span>
    </li>
  );
}

function CalibrateDialog({ measuredM, onCancel, onApply }: { measuredM: number | null; onCancel: () => void; onApply: (m: number) => void }) {
  const { t, i18n } = useTranslation();
  const [value, setValue] = useState("");
  const parsed = Number(value.replace(",", "."));
  const valid = Number.isFinite(parsed) && parsed > 0;

  return (
    <Modal
      open={measuredM !== null}
      onClose={() => { setValue(""); onCancel(); }}
      title={t("site.calibrate.title")}
      description={measuredM !== null ? t("site.calibrate.measured", { length: formatLength(measuredM, i18n.language) }) : undefined}
      footer={
        <>
          <Button variant="secondary" onClick={() => { setValue(""); onCancel(); }}>{t("common.cancel")}</Button>
          <Button
            disabled={!valid}
            onClick={() => { onApply(parsed); setValue(""); }}
          >
            {t("site.calibrate.apply")}
          </Button>
        </>
      }
    >
      <form onSubmit={(e) => { e.preventDefault(); if (valid) { onApply(parsed); setValue(""); } }}>
        <Input
          label={t("site.calibrate.length")}
          hint={t("site.calibrate.lengthHint")}
          inputMode="decimal"
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
        />
      </form>
    </Modal>
  );
}
