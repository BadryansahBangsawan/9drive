// Next byte offset from the `Range` header of a Google resumable-upload 308 response.
// Google reports what it persisted (e.g. `bytes=0-4194303`), which may be less than the
// chunk just sent. No header means nothing was persisted yet.
export function nextOffsetFromRange(range: string | null | undefined): bigint {
  const match = range?.match(/bytes=(\d+)-(\d+)/)
  return match ? BigInt(match[2]) + 1n : 0n
}
