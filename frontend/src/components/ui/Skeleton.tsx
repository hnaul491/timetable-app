export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden="true" className={`animate-pulse rounded-lg bg-subtle ${className}`} />;
}

export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-hidden="true" className="flex flex-col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}
