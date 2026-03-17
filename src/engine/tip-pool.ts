export function pickTips(tips: string[] | undefined, count: number): string[] {
  if (!tips || tips.length === 0) return [];
  const shuffled = [...tips].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, Math.min(count, tips.length));
}
