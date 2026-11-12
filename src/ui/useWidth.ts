import { type RefCallback, useCallback, useState } from "react";

export function useWidth<T extends HTMLElement>(): [RefCallback<T>, number] {
  const [width, setWidth] = useState(0);
  const ref = useCallback((node: T | null) => {
    if (node === null) {
      return;
    }
    const observer = new ResizeObserver(([entry]) => {
      if (entry) {
        setWidth(Math.floor(entry.contentRect.width));
      }
    });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, width];
}
