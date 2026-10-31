import { File as FileGeneric, FileImage, FileText, FileVideo } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { FileItem } from '@/types/drive'

export function FileIcon({ kind, className }: { kind: FileItem['kind']; className?: string }) {
  const Icon = kind === 'image' ? FileImage : kind === 'video' ? FileVideo : kind === 'pdf' ? FileText : FileGeneric
  return <Icon className={cn('h-4 w-4 shrink-0 text-muted', className)} strokeWidth={1.5} aria-hidden="true" />
}
