import { Star } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/drive/PageHeader'

export function StarredPage() {
  return (
    <>
      <PageHeader title="Starred" description="Pinned files for quick access." />
      <EmptyState icon={<Star className="h-4 w-4" strokeWidth={1.5} />} title="No starred files" description="Starred files will appear here." />
    </>
  )
}
