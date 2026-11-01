import { useState } from 'react'
import { FileIcon } from '@/components/drive/FileIcon'
import { cn } from '@/lib/utils'
import type { FileItem } from '@/types/drive'

// The file's thumbnail when it has one (loaded only when scrolled into view), over its type icon,
// which stays visible while loading and when there is no thumbnail.
export function FileThumbnail({ file, iconClassName, fit = 'cover' }: { file: FileItem; iconClassName: string; fit?: 'cover' | 'contain' }) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading')
  return (
    <>
      {state !== 'loaded' ? <FileIcon kind={file.kind} className={iconClassName} /> : null}
      {file.thumbnailUrl && state !== 'failed' ? (
        <img
          src={file.thumbnailUrl}
          alt=""
          loading="lazy"
          decoding="async"
          draggable={false}
          onLoad={() => setState('loaded')}
          onError={() => setState('failed')}
          className={cn(
            'absolute inset-0 h-full w-full rounded-[inherit] transition-opacity duration-200',
            fit === 'cover' ? 'object-cover' : 'object-contain',
            state === 'loaded' ? 'opacity-100' : 'opacity-0',
          )}
        />
      ) : null}
    </>
  )
}
