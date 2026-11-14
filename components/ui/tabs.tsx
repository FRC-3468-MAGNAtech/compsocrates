"use client";

import { createContext, useContext, useId, useState } from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { motion } from "framer-motion";
import { spring } from "@/lib/motion";
import { cn } from "@/lib/utils";

const ActiveTabContext = createContext<{ value: string; layoutId: string } | null>(null);

export function Tabs({
  value,
  defaultValue,
  onValueChange,
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Root>) {
  const layoutId = useId();
  const [internal, setInternal] = useState(defaultValue ?? "");
  const active = value ?? internal;

  return (
    <ActiveTabContext.Provider value={{ value: active, layoutId }}>
      <TabsPrimitive.Root
        value={value}
        defaultValue={defaultValue}
        onValueChange={(v) => {
          setInternal(v);
          onValueChange?.(v);
        }}
        className={className}
        {...props}
      />
    </ActiveTabContext.Provider>
  );
}

export function TabsList({
  className,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      // No fixed height here or at call sites: a fixed h-10 clamped the 44px touch-target triggers and made Table / Summary look cramped.
      className={cn("glass-pill inline-flex items-center gap-1 p-1.5", className)}
      {...props}
    />
  );
}

export function TabsTrigger({
  className,
  children,
  value,
  ...props
}: React.ComponentProps<typeof TabsPrimitive.Trigger>) {
  const ctx = useContext(ActiveTabContext);
  const active = ctx?.value === value;

  return (
    <TabsPrimitive.Trigger
      value={value}
      className={cn(
        // Roomy by default (px-5, min-h-10 on a mouse; the global coarse-pointer rule lifts buttons to 44px) and never wraps its label.
        "relative z-10 inline-flex min-h-10 items-center justify-center whitespace-nowrap rounded-full px-5 py-2 text-sm font-medium text-[var(--muted-foreground)] outline-none transition-colors duration-200 data-[state=active]:text-[var(--color-primary-foreground)]",
        className
      )}
      {...props}
    >
      {active && (
        <motion.span
          layoutId={`tabs-pill-${ctx?.layoutId}`}
          transition={spring}
          className="absolute inset-0 -z-10 rounded-full"
          style={{
            background: "var(--theme-gradient)",
            boxShadow: "0 4px 18px -4px rgba(var(--glow), 0.6)",
          }}
        />
      )}
      <span className="relative">{children}</span>
    </TabsPrimitive.Trigger>
  );
}

export const TabsContent = TabsPrimitive.Content;
