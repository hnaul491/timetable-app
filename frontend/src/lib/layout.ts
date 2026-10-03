export interface Span {
  startMin: number;
  endMin: number;
}

export interface Placed<T> {
  item: T;
  column: number;
  columns: number;
}

export function layoutDay<T extends Span>(items: T[]): Placed<T>[] {
  const sorted = [...items].sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  const out: Placed<T>[] = [];
  let cluster: Placed<T>[] = [];
  let columnEnds: number[] = [];
  let clusterEnd = -Infinity;

  const flush = () => {
    for (const placed of cluster) placed.columns = columnEnds.length;
    out.push(...cluster);
    cluster = [];
    columnEnds = [];
    clusterEnd = -Infinity;
  };

  for (const item of sorted) {
    if (cluster.length > 0 && item.startMin >= clusterEnd) flush();
    let column = columnEnds.findIndex((end) => end <= item.startMin);
    if (column === -1) {
      column = columnEnds.length;
      columnEnds.push(item.endMin);
    } else {
      columnEnds[column] = item.endMin;
    }
    cluster.push({ item, column, columns: 0 });
    clusterEnd = Math.max(clusterEnd, item.endMin);
  }
  if (cluster.length > 0) flush();
  return out;
}
