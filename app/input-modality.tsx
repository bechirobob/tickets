"use client";

import { useEffect } from "react";
import { installInputModality } from "../lib/input-modality";

export default function InputModality() {
  useEffect(() => installInputModality(document), []);
  return null;
}
