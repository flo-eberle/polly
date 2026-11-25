import { memo, useState } from "react";
import { useTranslation } from "react-i18next";
import { Trash2 } from "lucide-react";
import { Input } from "@/components/ui/Input";
import { Select } from "@/components/ui/Select";
import { Textarea } from "@/components/ui/Textarea";
import { Checkbox } from "@/components/ui/Checkbox";
import { Button } from "@/components/ui/Button";
import { formatLength } from "@/lib/siteGeometry";
import { shapeArea, shapeLength } from "@/lib/siteShapes";
import type { SiteElement } from "@/types/site";
import { elementType, resolvedType } from "./elementTypes";
import { fieldUpdates, fieldValue, fieldsFor, type FieldDef } from "./elementFields";

interface SitePropertiesProps {
  element: SiteElement;
  /** `coalesceKey` groups typing into one field into a single undo step. */
  onChange: (updates: Partial<SiteElement>, coalesceKey: string) => void;
  onDelete: () => void;
}

/** Properties of the selected element, generated from the registry's field list. */
export const SiteProperties = memo(function SiteProperties({ element, onChange, onDelete }: SitePropertiesProps) {
  const { t, i18n } = useTranslation();
  const resolved = resolvedType(element);
  const Icon = resolved.icon;
  const area = shapeArea(element.shape);
  const length = shapeLength(element.shape);
  const num = (v: number, digits: number) => new Intl.NumberFormat(i18n.language, { maximumFractionDigits: digits }).format(v);

  const set = (field: FieldDef, value: unknown) => onChange(fieldUpdates(field, element, value), `${element.id}:${field.key}`);

  return (
    <section aria-label={t("site.element.properties")} className="space-y-3 rounded-xl border border-gray-200 bg-white p-4 dark:border-white/10 dark:bg-gray-900">
      <div className="flex items-start gap-2">
        <Icon size={18} aria-hidden="true" className="mt-0.5 shrink-0 text-gray-500 dark:text-gray-400" />
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-gray-900 dark:text-gray-50">{t(resolved.labelKey)}</h2>
          <p className="text-xs tabular-nums text-gray-500 dark:text-gray-400">
            {area !== null && <>{t("site.element.area", { value: num(area, area < 10 ? 1 : 0) })} · </>}
            {t(element.shape.type === "polyline" ? "site.element.length" : "site.element.perimeter", { value: formatLength(length, i18n.language) })}
          </p>
        </div>
      </div>

      {fieldsFor(element.kind)
        .filter((field) => !field.visible || field.visible(element))
        .map((field) => (
          <Field key={`${element.id}:${field.key}`} field={field} element={element} onSet={set} />
        ))}

      <Button variant="danger-ghost" size="sm" onClick={onDelete}>
        <Trash2 size={16} aria-hidden="true" />
        {t("site.element.delete")}
      </Button>
    </section>
  );
});

function Field({ field, element, onSet }: { field: FieldDef; element: SiteElement; onSet: (field: FieldDef, value: unknown) => void }) {
  const { t } = useTranslation();
  const value = fieldValue(field, element);
  const label = t(field.labelKey);
  const hint = field.hintKey ? t(field.hintKey) : undefined;

  switch (field.type) {
    case "text":
      return <Input label={label} hint={hint} value={typeof value === "string" ? value : ""} onChange={(e) => onSet(field, e.target.value)} />;
    case "textarea":
      return <Textarea label={label} hint={hint} rows={3} value={typeof value === "string" ? value : ""} onChange={(e) => onSet(field, e.target.value)} />;
    case "number": {
      const defaultHeight = field.key === "heightM" ? resolvedType(element).heightM : undefined;
      return (
        <NumberField
          label={field.unit ? `${label} (${field.unit})` : label}
          hint={defaultHeight !== undefined ? t("site.fields.defaultValue", { value: defaultHeight }) : hint}
          value={typeof value === "number" ? value : undefined}
          min={field.min}
          max={field.max}
          onCommit={(v) => onSet(field, v)}
        />
      );
    }
    case "year":
      return <NumberField label={label} hint={hint} value={typeof value === "number" ? value : undefined} min={1800} max={2200} integer onCommit={(v) => onSet(field, v)} />;
    case "select":
      return (
        <Select
          label={label}
          hint={hint}
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onSet(field, e.target.value)}
          options={[
            ...(field.allowEmpty ? [{ value: "", label: t("site.fields.none") }] : []),
            ...field.options.map((o) => ({ value: o.value, label: t(o.labelKey) })),
          ]}
        />
      );
    case "variant": {
      const variants = elementType(element.kind).variants ?? [];
      return (
        <Select
          label={label}
          value={typeof value === "string" ? value : variants[0]?.id}
          onChange={(e) => onSet(field, e.target.value === variants[0]?.id ? undefined : e.target.value)}
          options={variants.map((v) => ({ value: v.id, label: t(v.labelKey) }))}
        />
      );
    }
    case "multi": {
      const selected = Array.isArray(value) ? (value as string[]) : [];
      return (
        <fieldset className="space-y-1">
          <legend className="mb-1 text-sm font-medium text-gray-700 dark:text-gray-300">{label}</legend>
          {field.options.map((o) => (
            <Checkbox
              key={o.value}
              label={t(o.labelKey)}
              checked={selected.includes(o.value)}
              onChange={(e) =>
                onSet(field, e.target.checked ? [...selected, o.value] : selected.filter((v) => v !== o.value))
              }
            />
          ))}
        </fieldset>
      );
    }
  }
}

/**
 * Number input that accepts a decimal comma and partial input ("1,") while
 * typing. Valid numbers are committed right away; clearing the field removes
 * the value.
 */
function NumberField({ label, hint, value, min, max, integer, onCommit }: {
  label: string;
  hint?: string;
  value: number | undefined;
  min?: number;
  max?: number;
  integer?: boolean;
  onCommit: (value: number | undefined) => void;
}) {
  const { t, i18n } = useTranslation();
  const format = (v: number | undefined) => (v === undefined ? "" : new Intl.NumberFormat(i18n.language, { useGrouping: false, maximumFractionDigits: 2 }).format(v));
  const [text, setText] = useState(() => format(value));
  const [shown, setShown] = useState(value);
  // Follow outside changes (undo, dragging the shape) unless they came from typing here.
  if (shown !== value) {
    setShown(value);
    const typed = Number(text.replace(",", "."));
    if (typed !== value) setText(format(value));
  }

  const parsed = text.trim() === "" ? undefined : Number(text.replace(",", "."));
  const invalid =
    parsed !== undefined &&
    (!Number.isFinite(parsed) || (integer && !Number.isInteger(parsed)) || (min !== undefined && parsed < min) || (max !== undefined && parsed > max));

  return (
    <Input
      label={label}
      hint={hint}
      inputMode={integer ? "numeric" : "decimal"}
      value={text}
      error={invalid ? t("site.fields.invalidNumber", { min: min ?? "–", max: max ?? "–" }) : undefined}
      onChange={(e) => {
        const next = e.target.value;
        setText(next);
        const v = next.trim() === "" ? undefined : Number(next.replace(",", "."));
        const ok =
          v === undefined ||
          (Number.isFinite(v) && (!integer || Number.isInteger(v)) && (min === undefined || v >= min) && (max === undefined || v <= max));
        if (ok) {
          setShown(v);
          onCommit(v);
        }
      }}
    />
  );
}
