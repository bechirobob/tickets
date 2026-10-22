"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { FLASH_LOOKS, renderFlashLook, type FlashLook } from "../../../lib/flash-photo-filters";

export default function FlashLookPicker({ source, look, strength, disabled, onLook, onStrength }: {
  source: HTMLCanvasElement; look: FlashLook; strength: number; disabled: boolean;
  onLook: (look: FlashLook) => void; onStrength: (strength: number) => void;
}) {
  const [thumbnails, setThumbnails] = useState<Partial<Record<FlashLook, string>>>({});
  useEffect(() => {
    const controller = new AbortController();
    const urls: string[] = [];
    async function prepare() {
      for (const option of FLASH_LOOKS) {
        const blob = await renderFlashLook(source, option.id, 100, controller.signal, 144);
        if (controller.signal.aborted) return;
        const url = URL.createObjectURL(blob); urls.push(url);
        setThumbnails(previous => ({ ...previous, [option.id]: url }));
      }
    }
    // A missing thumbnail never prevents selecting a look or sending Original.
    void prepare().catch(() => {});
    return () => { controller.abort(); urls.forEach(url => URL.revokeObjectURL(url)); };
  }, [source]);
  return <div className="flash-looks">
    <div className="flash-looks__options" role="group" aria-label="Photo look">
      {FLASH_LOOKS.map(option => <button key={option.id} type="button" aria-pressed={look === option.id} aria-label={`${option.name}: ${option.description}`} disabled={disabled} onClick={() => onLook(option.id)}>
        <span className="flash-looks__thumbnail" aria-hidden="true">{thumbnails[option.id] && <Image src={thumbnails[option.id]!} alt="" width={72} height={72} unoptimized draggable={false} />}</span>
        <span>{option.name}</span>
      </button>)}
    </div>
    {look !== "original" && <label className="flash-looks__strength"><span>Strength</span><input type="range" min="0" max="100" step="1" value={strength} disabled={disabled} onChange={event => onStrength(Number(event.target.value))} /><output>{strength}%</output></label>}
  </div>;
}
