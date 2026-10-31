export type DayGroup<T> = { label: string; items: T[] }

const LABELS = ['Today', 'Yesterday', 'Earlier this week', 'Older'] as const

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

export function groupByDay<T>(items: T[], getDate: (item: T) => string, now: Date): DayGroup<T>[] {
  const today = startOfDay(now)
  const buckets: T[][] = [[], [], [], []]
  for (const item of items) {
    const days = Math.round((today - startOfDay(new Date(getDate(item)))) / 86_400_000)
    const index = days <= 0 ? 0 : days === 1 ? 1 : days <= 7 ? 2 : 3
    buckets[index].push(item)
  }
  return buckets.map((list, i) => ({ label: LABELS[i], items: list })).filter((g) => g.items.length > 0)
}
