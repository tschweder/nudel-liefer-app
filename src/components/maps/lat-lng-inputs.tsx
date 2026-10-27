"use client";

import { useId, useState } from "react";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { isValidLatLng, type LatLng, parseCoordinate, roundLatLng } from "@/lib/coords";

export type LatLngInputsLabels = {
  legend: string;
  latitude: string;
  longitude: string;
  invalid: string;
};

type Props = {
  /** Current pin or `null`. The inputs follow it (map click/drag) and edit it (typing). */
  value: LatLng | null;
  /** Called with coordinates rounded to 6 decimals once both fields hold a valid pair. */
  onChange: (value: LatLng) => void;
  labels: LatLngInputsLabels;
};

function show(n: number | undefined): string {
  return n === undefined ? "" : String(n);
}

const parse = parseCoordinate;

/**
 * Editable latitude/longitude next to a pin picker: the keyboard alternative to click/drag
 * (WCAG). Typing a valid pair moves the pin; the map moves the numbers back.
 */
export function LatLngInputs({ value, onChange, labels }: Props) {
  const id = useId();
  const [lat, setLat] = useState(show(value?.lat));
  const [lng, setLng] = useState(show(value?.lng));
  const [seen, setSeen] = useState(value);

  // The pin changed from outside (map, locate button): show its numbers.
  if (value?.lat !== seen?.lat || value?.lng !== seen?.lng) {
    setSeen(value);
    setLat(show(value?.lat));
    setLng(show(value?.lng));
  }

  function update(nextLat: string, nextLng: string) {
    setLat(nextLat);
    setLng(nextLng);
    const a = parse(nextLat);
    const b = parse(nextLng);
    if (a === null || b === null || !isValidLatLng({ lat: a, lng: b })) return;
    const point = roundLatLng({ lat: a, lng: b });
    setSeen(point); // our own change: do not rewrite what the user is typing
    onChange(point);
  }

  const latInvalid = lat.trim() !== "" && (parse(lat) === null || Math.abs(parse(lat)!) > 90);
  const lngInvalid = lng.trim() !== "" && (parse(lng) === null || Math.abs(parse(lng)!) > 180);
  const errorId = `${id}-error`;

  return (
    <fieldset className="flex flex-col gap-2" data-testid="latlng-inputs">
      <legend className="sr-only">{labels.legend}</legend>
      <div className="flex flex-wrap gap-4">
        <div className="flex w-40 flex-col gap-1">
          <Label htmlFor={`${id}-lat`}>{labels.latitude}</Label>
          <Input
            id={`${id}-lat`}
            inputMode="decimal"
            autoComplete="off"
            value={lat}
            onChange={(e) => update(e.target.value, lng)}
            aria-invalid={latInvalid || undefined}
            aria-describedby={latInvalid || lngInvalid ? errorId : undefined}
            data-testid="pin-lat"
          />
        </div>
        <div className="flex w-40 flex-col gap-1">
          <Label htmlFor={`${id}-lng`}>{labels.longitude}</Label>
          <Input
            id={`${id}-lng`}
            inputMode="decimal"
            autoComplete="off"
            value={lng}
            onChange={(e) => update(lat, e.target.value)}
            aria-invalid={lngInvalid || undefined}
            aria-describedby={latInvalid || lngInvalid ? errorId : undefined}
            data-testid="pin-lng"
          />
        </div>
      </div>
      {latInvalid || lngInvalid ? (
        <p id={errorId} className="text-sm text-destructive" role="alert">
          {labels.invalid}
        </p>
      ) : null}
    </fieldset>
  );
}
