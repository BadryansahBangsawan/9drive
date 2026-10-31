import { Archive } from 'lucide-react'
import { EmptyState } from '@/components/ui/empty-state'
import { PageHeader } from '@/components/drive/PageHeader'

export function ArchivedPage() {
  return (
    <>
      <PageHeader title="Archived" description="Older files kept out of the active workspace." />
      <EmptyState icon={<Archive className="h-4 w-4" strokeWidth={1.5} />} title="Nothing archived" description="Archived files will appear here." />
    </>
  )
}
