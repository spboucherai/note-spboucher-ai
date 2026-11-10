import { Skeleton } from "@/components/ui/primitives";
export default function Loading() {
  return (
    <div role="status" aria-label="Loading page" className="measure mx-auto w-full px-5 pt-10 md:px-0">
      <Skeleton className="size-12 rounded-xl" /><Skeleton className="mt-4 h-10 w-2/3" />
      <div className="mt-8 space-y-3">{["w-full", "w-11/12", "w-4/5", "w-full", "w-3/5"].map((w, i) => <Skeleton key={i} className={`h-4 ${w}`} />)}</div>
      <div className="mt-8 space-y-3">{["w-full", "w-5/6", "w-2/3"].map((w, i) => <Skeleton key={i} className={`h-4 ${w}`} />)}</div>
    </div>
  );
}
