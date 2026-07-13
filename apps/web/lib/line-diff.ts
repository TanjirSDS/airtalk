// Minimal LCS line diff for the Versions panel — no dependency. `a` is the older
// (selected) text, `b` the current: 'del' = a line only in a, 'add' = only in b.
// ponytail: O(m·n) table, fine for prompt-sized text (hundreds of lines).

export type DiffLine = { type: 'same' | 'add' | 'del'; text: string }

export function lineDiff(a: string, b: string): DiffLine[] {
  const al = a.split('\n')
  const bl = b.split('\n')
  const m = al.length
  const n = bl.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < m && j < n) {
    if (al[i] === bl[j]) {
      out.push({ type: 'same', text: al[i] })
      i++
      j++
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ type: 'del', text: al[i] })
      i++
    } else {
      out.push({ type: 'add', text: bl[j] })
      j++
    }
  }
  while (i < m) out.push({ type: 'del', text: al[i++] })
  while (j < n) out.push({ type: 'add', text: bl[j++] })
  return out
}
