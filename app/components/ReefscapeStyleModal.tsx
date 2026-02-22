"use client";

import { useEffect, useRef, useState } from "react";

export default function ReefscapeStyleModal({
  open,
  onClose,
  step,
  children,
}: {
  open: boolean;
  onClose: () => void;
  step: string;
  children: React.ReactNode;
}) {
  const [mounted, setMounted] = useState(false);
  const [visible, setVisible] = useState(false);
  const [height, setHeight] = useState<string | number>("auto");
  const [hasOpened, setHasOpened] = useState(false);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          setVisible(true);
          setHasOpened(true);
        });
      });
    } else {
      setVisible(false);
      setHasOpened(false);
      const timeout = setTimeout(() => setMounted(false), 250);
      return () => clearTimeout(timeout);
    }
  }, [open]);

  useEffect(() => {
    if (contentRef.current) {
      const newHeight = `${contentRef.current.scrollHeight}px`;
      if (!hasOpened) {
        setHeight(newHeight);
      } else {
        requestAnimationFrame(() => setHeight(newHeight));
      }
    }
  }, [step, mounted, hasOpened, children]);

  if (!mounted) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div
        className={`
          absolute inset-0 bg-black/40 backdrop-blur-sm
          transition-opacity duration-300
          ${visible ? "opacity-100" : "opacity-0"}
        `}
        onClick={onClose}
      />

      <div
        className={`
          relative bg-white rounded-2xl shadow-xl
          transition-all duration-300
          ${visible ? "opacity-100" : "opacity-0"}
          ${
            step === "qualification"
              ? "w-[85%] max-w-[900px]"
              : step === "finals"
              ? "w-[90%] max-w-[1400px]"
              : "w-[90%] max-w-md"
          }
        `}
      >
        <button
          onClick={onClose}
          className="absolute top-3 right-3 px-3 py-1 rounded border text-sm text-gray-700 bg-white hover:bg-gray-50 z-10"
        >
          Cancel
        </button>
        <div
          style={{ height }}
          className={`
            overflow-hidden
            ${hasOpened ? "transition-[height] duration-300 ease-out" : ""}
          `}
        >
          <div ref={contentRef} className="p-6">
            {children}
          </div>
        </div>
      </div>
    </div>
  );
}

