export function stableHash(value: string): string {
  let h1 = 2166136261
  let h2 = 16777619
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i)
    h1 ^= code
    h1 = Math.imul(h1, 16777619)
    h2 = Math.imul(h2 ^ (code << (i % 13)), 2246822519) ^ (h1 >>> 7)
  }
  return `${(h1 >>> 0).toString(16).padStart(8, '0')}${(h2 >>> 0).toString(16).padStart(8, '0')}`
}
