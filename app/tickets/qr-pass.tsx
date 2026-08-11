"use client";

import QRCode from "qrcode";
import { useEffect, useRef } from "react";

export default function QrPass({ payload, label }: { payload: string; label: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!canvasRef.current) return;
    void QRCode.toCanvas(canvasRef.current, payload, {
      width: 228,
      margin: 2,
      errorCorrectionLevel: "M",
      color: { dark: "#181914", light: "#fffdf8" },
    });
  }, [payload]);

  return <canvas ref={canvasRef} role="img" aria-label={label} />;
}
