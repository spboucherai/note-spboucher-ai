import { Skeleton } from "@/components/ui/primitives";
export default function Loading() {
  return (
    <div role="status" aria-label="Loading" className="mx-auto w-full max-w-5xl px-5 pt-8 md:px-10">
      <Skeleton className="h-8 w-64" /><Skeleton className="mt-3 h-4 w-96 max-w-full" />
      <div className="mt-8 grid gap-4 md:grid-cols-2">{[0, 1, 2, 3].map((i) => <div key={i} className="rounded-xl border border-line bg-bg-elev p-4"><Skeleton className="h-4 w-32" /><Skeleton className="mt-4 h-3 w-full" /><Skeleton className="mt-2 h-3 w-5/6" /><Skeleton className="mt-2 h-3 w-2/3" /></div>)}</div>
    </div>
  );
}
