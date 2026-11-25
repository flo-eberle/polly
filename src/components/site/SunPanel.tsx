import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronUp, Pause, Play, Sun as SunIcon, X } from "lucide-react";
import * as SunCalc from "suncalc";
import { IconButton } from "@/components/ui/IconButton";
import { Input } from "@/components/ui/Input";
import { Checkbox } from "@/components/ui/Checkbox";
import { compassKey, sunAt, type Sun } from "@/lib/siteShadow";

export interface SunSettings {
  /** Local date, YYYY-MM-DD. */
  date: string;
  /** Minutes after local midnight. */
  minutes: number;
  /** Trees and shrubs at their mature size. */
  mature: boolean;
}

export function sunDate(settings: SunSettings): Date {
  const [y, m, d] = settings.date.split("-").map(Number);
  return new Date(y, m - 1, d, Math.floor(settings.minutes / 60), settings.minutes % 60);
}

function isoDate(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

export function initialSunSettings(now = new Date()): SunSettings {
  return { date: isoDate(now), minutes: now.getHours() * 60 + Math.floor(now.getMinutes() / 10) * 10, mature: false };
}

/** Daylight window of a day in minutes after midnight; the whole day where the sun never sets. */
export function daylightMinutes(date: string, lat: number, lon: number): { from: number; to: number } {
  const [y, m, d] = date.split("-").map(Number);
  const times = SunCalc.getTimes(new Date(y, m - 1, d, 12), lat, lon);
  const toMin = (t: Date | null | undefined) => (t && !Number.isNaN(t.getTime()) ? t.getHours() * 60 + t.getMinutes() : null);
  const from = toMin(times.sunrise);
  const to = toMin(times.sunset);
  return from !== null && to !== null && to > from ? { from, to } : { from: 0, to: 24 * 60 - 10 };
}

const PRESETS = [
  { key: "spring", month: 3, day: 20 },
  { key: "summer", month: 6, day: 21 },
  { key: "autumn", month: 9, day: 22 },
  { key: "winter", month: 12, day: 21 },
] as const;

interface SunPanelProps {
  settings: SunSettings;
  onChange: (settings: SunSettings) => void;
  onClose: () => void;
  lat: number | null;
  lon: number | null;
}

/** Date, time and options for the shadow simulation, floating on the canvas. */
export function SunPanel({ settings, onChange, onClose, lat, lon }: SunPanelProps) {
  const { t, i18n } = useTranslation();
  const [playing, setPlaying] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const hasLocation = lat !== null && lon !== null;
  const daylight = hasLocation ? daylightMinutes(settings.date, lat, lon) : { from: 0, to: 24 * 60 - 10 };
  const sun: Sun | null = hasLocation ? sunAt(sunDate(settings), lat, lon) : null;
  const time = new Intl.DateTimeFormat(i18n.language, { hour: "2-digit", minute: "2-digit" });
  const minutesLabel = (min: number) => time.format(new Date(2000, 0, 1, Math.floor(min / 60), min % 60));

  // Playing runs the day from sunrise to sunset in 10-minute steps.
  useEffect(() => {
    if (!playing) return;
    const id = setInterval(() => {
      const next = settings.minutes + 10 > daylight.to ? daylight.from : settings.minutes + 10;
      onChange({ ...settings, minutes: next });
    }, 120);
    return () => clearInterval(id);
  }, [playing, settings, onChange, daylight.from, daylight.to]);

  const year = Number(settings.date.slice(0, 4));

  return (
    <div
      role="region"
      aria-label={t("site.sun.title")}
      className="absolute right-3 top-[8.5rem] w-72 max-w-[calc(100%-1.5rem)] space-y-3 rounded-xl bg-white/95 p-3 text-sm shadow-md ring-1 ring-gray-200 dark:bg-gray-900/95 dark:ring-white/10"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold text-gray-900 dark:text-gray-50">
          <SunIcon size={16} aria-hidden="true" className="text-warning" />
          {t("site.sun.title")}
        </h2>
        <span className="flex">
          {hasLocation && (
            <IconButton
              size="sm"
              icon={collapsed ? ChevronDown : ChevronUp}
              label={t(collapsed ? "site.sun.expand" : "site.sun.collapse")}
              aria-expanded={!collapsed}
              onClick={() => setCollapsed(!collapsed)}
            />
          )}
          <IconButton size="sm" icon={X} label={t("site.sun.hide")} onClick={onClose} />
        </span>
      </div>

      {!hasLocation ? (
        <p className="text-gray-600 dark:text-gray-300">
          {t("site.sun.noLocation")}{" "}
          <a href="#/settings" className="font-medium text-garden-700 underline dark:text-garden-300">{t("site.sun.toSettings")}</a>
        </p>
      ) : (
        <>
          {!collapsed && <Input
            label={t("site.sun.date")}
            type="date"
            value={settings.date}
            onChange={(e) => e.target.value && onChange({ ...settings, date: e.target.value })}
          />}
          {!collapsed && <div className="flex flex-wrap gap-1" role="group" aria-label={t("site.sun.presets")}>
            {PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => onChange({ ...settings, date: `${year}-${String(p.month).padStart(2, "0")}-${p.day}` })}
                className="min-h-11 rounded-lg px-2 text-xs font-medium text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 sm:min-h-8 dark:text-gray-200 dark:ring-white/10 dark:hover:bg-white/5"
              >
                {t(`site.sun.${p.key}`)}
              </button>
            ))}
            <button
              type="button"
              onClick={() => onChange({ ...initialSunSettings(), mature: settings.mature })}
              className="min-h-11 rounded-lg px-2 text-xs font-medium text-gray-700 ring-1 ring-gray-200 hover:bg-gray-50 sm:min-h-8 dark:text-gray-200 dark:ring-white/10 dark:hover:bg-white/5"
            >
              {t("site.sun.now")}
            </button>
          </div>}

          <div>
            {!collapsed && <p className="flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-300" aria-hidden="true">
              <span>{t("site.sun.time")}</span>
              <span className="tabular-nums text-gray-900 dark:text-gray-50">{minutesLabel(settings.minutes)}</span>
            </p>}
            <div className="mt-1 flex items-center gap-2">
              <IconButton
                size="sm"
                icon={playing ? Pause : Play}
                label={t(playing ? "site.sun.pause" : "site.sun.play")}
                onClick={() => setPlaying(!playing)}
              />
              <input
                type="range"
                aria-label={t("site.sun.time")}
                aria-valuetext={minutesLabel(settings.minutes)}
                min={daylight.from}
                max={daylight.to}
                step={10}
                value={Math.min(Math.max(settings.minutes, daylight.from), daylight.to)}
                onChange={(e) => onChange({ ...settings, minutes: Number(e.target.value) })}
                className="block w-full accent-warning"
              />
              {collapsed && <span className="shrink-0 tabular-nums font-medium text-gray-900 dark:text-gray-50">{minutesLabel(settings.minutes)}</span>}
            </div>
            {!collapsed && <p className="mt-0.5 flex justify-between text-xs tabular-nums text-gray-500 dark:text-gray-400">
              <span>{minutesLabel(daylight.from)}</span>
              <span>{minutesLabel(daylight.to)}</span>
            </p>}
          </div>

          <p role="status" className={collapsed ? "sr-only" : "text-gray-600 dark:text-gray-300"}>
            {sun && sun.altitudeDeg >= 2
              ? t("site.sun.position", {
                  altitude: Math.round(sun.altitudeDeg),
                  direction: t(`site.compass.${compassKey(sun.azimuthDeg)}`),
                })
              : t("site.sun.down")}
          </p>

          {!collapsed && <Checkbox
            label={t("site.sun.mature")}
            description={t("site.sun.matureHint")}
            checked={settings.mature}
            onChange={(e) => onChange({ ...settings, mature: e.target.checked })}
          />}
        </>
      )}
    </div>
  );
}
