import { useEffect, useRef, useState } from "react";
import { polylinePath, type Point } from "@/features/editor/edges/pathMath";

export interface EdgeSplit {
  mid: Point;
  half1: string;
  half2: string;
}

/**
 * Samples the rendered path at its midpoint and splits it into two halves —
 * many-to-many edges render each half as a separately-animated dashed path
 * (dots flowing outward from the middle in both directions) instead of one
 * continuous line.
 */
export function useEdgeSplitPath(fullPath: string) {
  const measureRef = useRef<SVGPathElement>(null);
  const [split, setSplit] = useState<EdgeSplit | null>(null);

  useEffect(() => {
    const path = measureRef.current;
    if (!path) return;
    const length = path.getTotalLength();
    if (length === 0) {
      setSplit(null);
      return;
    }
    const SAMPLES = 16;
    const half1Points: Point[] = [];
    const half2Points: Point[] = [];
    for (let i = 0; i <= SAMPLES; i++) {
      half1Points.push(path.getPointAtLength((length / 2) * (i / SAMPLES)));
      half2Points.push(path.getPointAtLength(length - (length / 2) * (i / SAMPLES)));
    }
    setSplit({
      mid: path.getPointAtLength(length / 2),
      half1: polylinePath(half1Points),
      half2: polylinePath(half2Points),
    });
  }, [fullPath]);

  return { measureRef, split };
}
