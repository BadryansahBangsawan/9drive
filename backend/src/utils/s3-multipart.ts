// Part sizing and checks for S3 multipart uploads that the desktop app sends straight to the bucket.
const MiB = 1024 * 1024
export const S3_DEFAULT_PART_BYTES = 64 * MiB
export const S3_MIN_PART_BYTES = 5 * MiB
export const S3_MAX_PARTS = 10_000

// 64 MiB, or larger (whole MiB) when the file would otherwise need more than 10,000 parts.
export function s3PartSize(sizeBytes: bigint) {
  const needed = (sizeBytes + BigInt(S3_MAX_PARTS) - 1n) / BigInt(S3_MAX_PARTS)
  if (needed <= BigInt(S3_DEFAULT_PART_BYTES)) return S3_DEFAULT_PART_BYTES
  const mib = BigInt(MiB)
  return Number(((needed + mib - 1n) / mib) * mib)
}

export function s3PartCount(sizeBytes: bigint, partSize: number) {
  if (sizeBytes <= 0n) return 1
  return Number((sizeBytes + BigInt(partSize) - 1n) / BigInt(partSize))
}

// The parts a client reports for CompleteMultipartUpload: every part 1..expected exactly once, in order.
export function completedPartsInOrder(parts: Array<{ partNumber: number; etag: string }>, expected: number) {
  const sorted = [...parts].sort((a, b) => a.partNumber - b.partNumber)
  if (sorted.length !== expected) return null
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].partNumber !== i + 1 || !sorted[i].etag) return null
  }
  return sorted
}
