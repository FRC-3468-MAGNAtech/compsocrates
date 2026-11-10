// The client-side query cache hook for the event layer. The implementation stays in
// lib/ftc/use-ftc-query.ts (it is provider-neutral: it only caches ActionResult values); this file is
// the stable import path so pages do not name a provider. `useFtcQuery` remains as an alias so
// existing call sites keep compiling.
export { useFtcQuery as useEventQuery, useFtcQuery } from "@/lib/ftc/use-ftc-query";
