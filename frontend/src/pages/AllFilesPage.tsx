import { useEffect, useRef, useState, type FormEvent, type MouseEvent } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Check, ChevronDown, ClipboardPaste, Download, FolderInput, FolderPlus, LayoutGrid, List, RefreshCw, Trash2, Upload } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Dialog } from '@/components/ui/dialog'
import { EmptyState } from '@/components/ui/empty-state'
import { Input } from '@/components/ui/input'
import { Menu, MenuItem } from '@/components/ui/menu'
import { DetailsPanel } from '@/components/drive/DetailsPanel'
import { EmptyAreaContextMenu } from '@/components/drive/EmptyAreaContextMenu'
import { FileContextMenu } from '@/components/drive/FileContextMenu'
import { FileGrid } from '@/components/drive/FileGrid'
import { FileTable } from '@/components/drive/FileTable'
import { FolderContextMenu } from '@/components/drive/FolderContextMenu'
import { FolderGrid } from '@/components/drive/FolderGrid'
import { defaultFolderIconUrl, folderIconOptions, FolderVisual } from '@/components/drive/FolderVisual'
import { PageHeader } from '@/components/drive/PageHeader'
import { SelectionBar } from '@/components/drive/SelectionBar'
import { ShareDialog } from '@/components/drive/ShareDialog'
import { API_URL, apiFetch, formatBytes, formatDate } from '@/lib/api'
import { accountLabel as formatAccountLabel, type ConnectedAccount } from '@/lib/accounts'
import { getAccessToken } from '@/lib/auth'
import { createPlyr, ensurePlyr } from '@/lib/plyr'
import { getPreviewKind, officeViewerUrl } from '@/lib/preview'
import { cn } from '@/lib/utils'
import type { FileItem, FolderItem } from '@/types/drive'
import { useDriveLayoutActions } from '@/layouts/DriveLayout'

type BackendFile = { id: string; name: string; mimeType: string; sizeBytes: string; createdAt: string; folderId?: string | null; connectedAccount?: { id: string; email: string; provider: string; displayName?: string | null }; folder?: { id: string; name: string } | null }
type BackendFolder = { id: string; name: string; color: string; iconUrl?: string | null; parentId?: string | null; providerFolderId?: string | null; updatedAt: string }

type FileViewMode = 'list' | 'grid'

const fileViewStorageKey = '9drive:all-files-view-mode'
const selectClass = 'h-9 w-full rounded-lg border border-border bg-bg px-3 text-[13px] text-text outline-none transition-colors focus:border-accent focus:ring-2 focus:ring-accent/25'
const fieldLabelClass = 'grid gap-1.5 text-[13px] font-medium text-text'

const typeOptions = [
  { value: 'image', label: 'Image' },
  { value: 'video', label: 'Video' },
  { value: 'pdf', label: 'PDF' },
  { value: 'doc', label: 'Document' },
  { value: 'archive', label: 'Archive' },
]
const modifiedOptions = [
  { value: '7', label: 'Last 7 days' },
  { value: '30', label: 'Last 30 days' },
  { value: '365', label: 'Last year' },
]
const filterParams = ['kind', 'accountId', 'startDate', 'endDate', 'minSize', 'maxSize']

function getStoredFileViewMode(): FileViewMode {
  try {
    const stored = localStorage.getItem(fileViewStorageKey)
    return stored === 'grid' || stored === 'list' ? stored : 'list'
  } catch {
    return 'list'
  }
}

function mimeToKind(mimeType: string): FileItem['kind'] {
  if (mimeType.startsWith('image/')) return 'image'
  if (mimeType.startsWith('video/')) return 'video'
  if (mimeType.includes('pdf')) return 'pdf'
  return 'doc'
}

function mapFile(file: BackendFile): FileItem {
  const account = file.connectedAccount
  const label = account ? formatAccountLabel(account) : undefined
  return {
    id: file.id,
    name: file.name,
    mimeType: file.mimeType,
    sizeBytes: file.sizeBytes,
    createdAt: file.createdAt,
    accountId: account?.id,
    accountEmail: account?.email,
    accountProvider: account?.provider,
    accountLabel: label,
    date: formatDate(file.createdAt),
    size: formatBytes(file.sizeBytes),
    access: label ?? '--',
    kind: mimeToKind(file.mimeType),
    shared: 1,
    folderId: file.folderId,
    folderName: file.folder?.name,
  }
}

function mapFolder(folder: BackendFolder): FolderItem {
  return { id: folder.id, name: folder.name, color: folder.color, iconUrl: folder.iconUrl, parentId: folder.parentId, providerFolderId: folder.providerFolderId, updated: `Updated ${formatDate(folder.updatedAt)}` }
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches)
  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = () => setMatches(mq.matches)
    onChange()
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])
  return matches
}

/** Anchor for a menu: the pointer for right-click, the button's lower edge for a click or key press. */
function menuAnchor(event: MouseEvent<HTMLElement>) {
  if (event.type === 'contextmenu') return { x: event.clientX, y: event.clientY }
  const rect = event.currentTarget.getBoundingClientRect()
  return { x: rect.left, y: rect.bottom + 4 }
}

function FilterChip({ label, options, selected, onChange }: { label: string; options: { value: string; label: string }[]; selected: string | null; onChange: (value: string | null) => void }) {
  const [anchor, setAnchor] = useState<{ x: number; y: number } | null>(null)
  const activeLabel = selected ? (options.find((option) => option.value === selected)?.label ?? 'Custom') : null
  return (
    <>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={anchor !== null}
        onClick={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          setAnchor({ x: rect.left, y: rect.bottom + 4 })
        }}
        className={cn(
          'inline-flex h-7 max-w-full items-center gap-1.5 rounded-md border px-2.5 text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
          activeLabel ? 'border-accent bg-accent-soft text-text' : 'border-border bg-bg text-muted hover:bg-hover hover:text-text',
        )}
      >
        <span className="truncate">{activeLabel ? `${label}: ${activeLabel}` : label}</span>
        <ChevronDown className="h-3.5 w-3.5 shrink-0" strokeWidth={1.5} aria-hidden="true" />
      </button>
      <Menu open={anchor !== null} x={anchor?.x ?? 0} y={anchor?.y ?? 0} onClose={() => setAnchor(null)}>
        <MenuItem icon={!selected ? <Check className="h-4 w-4" strokeWidth={1.5} /> : undefined} onSelect={() => { setAnchor(null); onChange(null) }}>Any</MenuItem>
        {options.map((option) => (
          <MenuItem key={option.value} icon={selected === option.value ? <Check className="h-4 w-4" strokeWidth={1.5} /> : undefined} onSelect={() => { setAnchor(null); onChange(option.value) }}>
            <span className="block max-w-[280px] truncate">{option.label}</span>
          </MenuItem>
        ))}
      </Menu>
    </>
  )
}

function FolderIconPicker({ iconUrl, onIconChange }: { iconUrl: string; onIconChange: (iconUrl: string) => void }) {
  return (
    <div className="grid gap-1.5 text-[13px] font-medium text-text">
      <span>Folder icon</span>
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
        {folderIconOptions.map((option) => (
          <button
            key={option.url}
            type="button"
            onClick={() => onIconChange(option.url)}
            className={cn('flex h-10 items-center justify-center rounded-lg border transition-colors', iconUrl === option.url ? 'border-accent bg-accent-soft' : 'border-border bg-surface hover:bg-hover')}
            title={option.label}
            aria-label={`Use ${option.label} icon`}
            aria-pressed={iconUrl === option.url}
          >
            <FolderVisual folder={{ iconUrl: option.url }} className="h-5 w-5" />
          </button>
        ))}
      </div>
    </div>
  )
}

export function AllFilesPage() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeFolderId = searchParams.get('folderId')
  const searchQuery = searchParams.get('q')?.trim() ?? ''
  const filterKey = filterParams.map((key) => searchParams.get(key) ?? '').join('|')
  const hasFilters = filterParams.some((key) => searchParams.get(key))
  const [folderOpen, setFolderOpen] = useState(false)
  const [renameOpen, setRenameOpen] = useState(false)
  const [folderRenameOpen, setFolderRenameOpen] = useState(false)
  const [folderDeleteOpen, setFolderDeleteOpen] = useState(false)
  const [moveOpen, setMoveOpen] = useState(false)
  const [deleteOpen, setDeleteOpen] = useState(false)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [sheetOpen, setSheetOpen] = useState(false)
  const [shareOpen, setShareOpen] = useState(false)
  const [previewUrl, setPreviewUrl] = useState('')
  const [previewError, setPreviewError] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [files, setFiles] = useState<FileItem[]>([])
  const [filesLoaded, setFilesLoaded] = useState(false)
  // fileId -> expiresAt (null = never) for files with an active public link
  const [shareLinks, setShareLinks] = useState<Map<string, string | null>>(new Map())
  const [folders, setFolders] = useState<FolderItem[]>([])
  const [allFolders, setAllFolders] = useState<FolderItem[]>([])
  const [selectedFolderId, setSelectedFolderId] = useState('')
  const [folderName, setFolderName] = useState('')
  const [folderIconUrl, setFolderIconUrl] = useState(defaultFolderIconUrl)
  const [renameValue, setRenameValue] = useState('')
  const [folderRenameValue, setFolderRenameValue] = useState('')
  const [folderRenameIconUrl, setFolderRenameIconUrl] = useState(defaultFolderIconUrl)
  const [activeFile, setActiveFile] = useState<FileItem | null>(null)
  const [activeFolderForMenu, setActiveFolderForMenu] = useState<FolderItem | null>(null)
  // Checked rows (batch actions) and the row shown in the details panel are separate selections.
  const [selectedFileIds, setSelectedFileIds] = useState<Set<string>>(new Set())
  const [detailsFileId, setDetailsFileId] = useState<string | null>(null)
  // Files the open Move / Trash dialog applies to.
  const [targetIds, setTargetIds] = useState<string[]>([])
  const [cutFolder, setCutFolder] = useState<FolderItem | null>(null)
  const [contextMenu, setContextMenu] = useState<{ x: number; y: number; file: FileItem | null }>({ x: 0, y: 0, file: null })
  const [folderContextMenu, setFolderContextMenu] = useState<{ x: number; y: number; folder: FolderItem | null }>({ x: 0, y: 0, folder: null })
  const [emptyContextMenu, setEmptyContextMenu] = useState<{ x: number; y: number; open: boolean }>({ x: 0, y: 0, open: false })
  const [message, setMessage] = useState('')
  const [loading, setLoading] = useState(false)
  const [syncingDrive, setSyncingDrive] = useState(false)
  const [fileViewMode, setFileViewMode] = useState<FileViewMode>(getStoredFileViewMode)
  const isWide = useMediaQuery('(min-width: 1024px)')

  const [inviteOpen, setInviteOpen] = useState(false)
  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState('viewer')
  const [inviteTargetType, setInviteTargetType] = useState<'file' | 'folder'>('file')
  const [inviteTargetId, setInviteTargetId] = useState('')
  const [inviteMessage, setInviteMessage] = useState('')
  const [inviting, setInviting] = useState(false)
  const previewVideoRef = useRef<HTMLVideoElement | null>(null)
  const { setBreadcrumb, openUpload } = useDriveLayoutActions()
  const [connectedAccounts, setConnectedAccounts] = useState<ConnectedAccount[]>([])

  function flash(text: string, ms = 3000) {
    setMessage(text)
    window.setTimeout(() => setMessage((current) => (current === text ? '' : current)), ms)
  }

  async function loadFiles() {
    const params = new URLSearchParams()
    if (activeFolderId) params.set('folderId', activeFolderId)
    if (searchQuery) params.set('q', searchQuery)
    for (const key of filterParams) {
      const value = searchParams.get(key)
      if (value) params.set(key, value)
    }
    const query = params.toString()
    const path = query ? `/files?${query}` : '/files'
    const data = await apiFetch<{ files: BackendFile[] }>(path)
    setFiles(data.files.map(mapFile))
  }

  async function loadFolders() {
    const visiblePath = activeFolderId ? `/folders?parentId=${activeFolderId}` : '/folders'
    const [visibleData, allData] = await Promise.all([
      apiFetch<{ folders: BackendFolder[] }>(visiblePath),
      apiFetch<{ folders: BackendFolder[] }>('/folders?all=1'),
    ])
    setFolders(visibleData.folders.map(mapFolder))
    setAllFolders(allData.folders.map(mapFolder))
  }

  async function loadShares() {
    try {
      const data = await apiFetch<{ shares: { expiresAt: string | null; file: { id: string } }[] }>('/files/shared-links')
      setShareLinks(new Map(data.shares.map((share) => [share.file.id, share.expiresAt])))
    } catch {
      // Sharing info is optional; the panel falls back to "Private"
    }
  }

  async function loadAll() {
    await Promise.all([loadFiles(), loadFolders(), loadShares()])
  }

  async function handleDropItem(fileId: string, targetFolderId: string) {
    const fileIds = selectedFileIds.has(fileId) ? Array.from(selectedFileIds) : [fileId]
    setLoading(true)
    setMessage('')
    try {
      await apiFetch('/files/batch', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileIds, folderId: targetFolderId })
      })
      flash(`Moved ${fileIds.length} item${fileIds.length === 1 ? '' : 's'}.`)
      loadAll().catch(() => undefined)
      setSelectedFileIds(new Set())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to move items')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAll()
      .catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to load files'))
      .finally(() => setFilesLoaded(true))
    setSelectedFileIds(new Set())
    setDetailsFileId(null)
    setSheetOpen(false)
  }, [activeFolderId, searchQuery, filterKey])

  useEffect(() => {
    async function loadConnectedAccounts() {
      try {
        const data = await apiFetch<{ accounts: ConnectedAccount[] }>('/connected-accounts')
        setConnectedAccounts(data.accounts || [])
      } catch (error) {
        console.error('Failed to load connected accounts:', error)
      }
    }
    loadConnectedAccounts()
  }, [])

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.ctrlKey && event.key.toLowerCase() === 'x' && activeFolderForMenu) {
        event.preventDefault()
        cutSelectedFolder(activeFolderForMenu)
      }
      if (event.ctrlKey && event.key.toLowerCase() === 'v' && cutFolder) {
        event.preventDefault()
        pasteFolder().catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to paste folder'))
      }
    }

    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeFolderForMenu, cutFolder, activeFolderId])

  useEffect(() => {
    if (!previewOpen || !activeFile?.mimeType?.startsWith('video/') || !previewVideoRef.current) return undefined
    let disposed = false
    let player: { destroy: () => void } | null = null

    ensurePlyr().then(() => {
      if (disposed || !previewVideoRef.current) return
      player = createPlyr(previewVideoRef.current)
    }).catch(() => undefined)

    return () => {
      disposed = true
      player?.destroy()
    }
  }, [previewOpen, activeFile?.mimeType, previewUrl])

  async function createFolder(event: FormEvent) {
    event.preventDefault()
    await apiFetch('/folders', { method: 'POST', body: JSON.stringify({ name: folderName, iconUrl: folderIconUrl, parentId: activeFolderId ?? null }) })
    setFolderName('')
    setFolderIconUrl(defaultFolderIconUrl)
    setFolderOpen(false)
    await loadFolders()
  }

  async function syncGoogleDrive() {
    setSyncingDrive(true)
    setMessage('')
    try {
      const response = await apiFetch<{ results: { created: number; updated: number; deleted: number }[] }>('/files/sync-google', { method: 'POST', body: JSON.stringify({}) })

      let created = 0, updated = 0, deleted = 0
      for (const res of response.results) {
        created += res.created
        updated += res.updated
        deleted += res.deleted
      }
      const accounts = response.results.length

      flash(`Google Drive synced. ${created} added, ${updated} updated, ${deleted} removed across ${accounts} account${accounts === 1 ? '' : 's'}.`, 6000)
      await loadAll()
      window.dispatchEvent(new Event('9drive:storage-changed'))
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Failed to sync Google Drive')
    } finally {
      setSyncingDrive(false)
    }
  }

  // The native contextmenu event also reaches the open Menu's document listener, which would close a menu
  // opened in the same tick. Opening on the next tick lets that close the previous menu first.
  function openContext(event: MouseEvent<HTMLElement>, file: FileItem) {
    event.preventDefault()
    event.stopPropagation()
    const { x, y } = menuAnchor(event)
    setActiveFile(file)
    window.setTimeout(() => setContextMenu({ x, y, file }), 0)
  }

  function openFolderMenu(event: MouseEvent<HTMLElement>, folder: FolderItem) {
    event.preventDefault()
    event.stopPropagation()
    const { x, y } = menuAnchor(event)
    setActiveFolderForMenu(folder)
    window.setTimeout(() => setFolderContextMenu({ x, y, folder }), 0)
  }

  function openEmptyContextMenu(event: MouseEvent<HTMLElement>) {
    event.preventDefault()
    const { clientX: x, clientY: y } = event
    window.setTimeout(() => setEmptyContextMenu({ x, y, open: true }), 0)
  }

  function toggleFileSelection(file: FileItem) {
    if (!file.id) return
    setSelectedFileIds((current) => {
      const next = new Set(current)
      if (next.has(file.id!)) next.delete(file.id!)
      else next.add(file.id!)
      return next
    })
  }

  function toggleAllVisibleFiles() {
    const visibleIds = files.map((file) => file.id).filter(Boolean) as string[]
    const allSelected = visibleIds.length > 0 && visibleIds.every((id) => selectedFileIds.has(id))
    setSelectedFileIds(allSelected ? new Set() : new Set(visibleIds))
  }

  function clearSelection() {
    setSelectedFileIds(new Set())
  }

  /** A row action applies to the whole selection when the row is part of it, otherwise to that row only. */
  function idsFor(file: FileItem | null) {
    if (file?.id && !selectedFileIds.has(file.id)) return [file.id]
    return [...selectedFileIds]
  }

  function openMoveFor(ids: string[]) {
    if (ids.length === 0) return
    setTargetIds(ids)
    const only = ids.length === 1 ? files.find((file) => file.id === ids[0]) : null
    setSelectedFolderId(only?.folderId || '')
    setMoveOpen(true)
  }

  function openTrashFor(ids: string[]) {
    if (ids.length === 0) return
    setTargetIds(ids)
    setDeleteOpen(true)
  }

  function changeFileViewMode(mode: FileViewMode) {
    setFileViewMode(mode)
    try {
      localStorage.setItem(fileViewStorageKey, mode)
    } catch {
      // storage unavailable; the choice just won't persist
    }
  }

  function setFilter(key: 'kind' | 'accountId' | 'modified', value: string | null) {
    const next = new URLSearchParams(searchParams)
    if (key === 'modified') {
      next.delete('startDate')
      next.delete('endDate')
      if (value) {
        const start = new Date()
        start.setHours(0, 0, 0, 0)
        start.setDate(start.getDate() - Number(value))
        next.set('startDate', start.toISOString())
      }
    } else if (value) {
      next.set(key, value)
    } else {
      next.delete(key)
    }
    setSearchParams(next)
  }

  function clearFilters() {
    const next = new URLSearchParams(searchParams)
    filterParams.forEach((key) => next.delete(key))
    next.delete('q')
    setSearchParams(next)
  }

  // Preset matching for the Modified chip: a custom range from the advanced filters shows as "Custom".
  const startDateParam = searchParams.get('startDate')
  const modifiedValue = (() => {
    if (!startDateParam) return null
    const days = Math.floor((Date.now() - new Date(startDateParam).getTime()) / 86_400_000)
    return modifiedOptions.find((option) => Number(option.value) === days)?.value ?? 'custom'
  })()

  function openFolder(folder: FolderItem) {
    if (!folder.id) return
    setSearchParams(searchQuery ? { folderId: folder.id, q: searchQuery } : { folderId: folder.id })
  }

  async function viewFile() {
    if (!activeFile?.id) return
    setPreviewUrl('')
    setPreviewError('')
    setPreviewLoading(true)
    setPreviewOpen(true)
    try {
      const data = await apiFetch<{ path?: string; url: string }>(`/files/${activeFile.id}/preview-token`, { method: 'POST' })
      const previewPath = data.path ?? new URL(data.url).pathname
      setPreviewUrl(`${API_URL}${previewPath}`)
    } catch (error) {
      setPreviewError(error instanceof Error ? error.message : 'Failed to load preview')
    } finally {
      setPreviewLoading(false)
    }
  }

  async function downloadFile(file: FileItem | null) {
    if (!file?.id) return
    try {
      const response = await fetch(`${API_URL}/files/${file.id}/download`, { headers: { Authorization: `Bearer ${getAccessToken()}` } })
      if (!response.ok) throw new Error('Download failed')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = file.name
      link.click()
      URL.revokeObjectURL(url)
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Download failed')
    }
  }

  async function downloadBatchAsZip() {
    const selectedIds = [...selectedFileIds]
    if (selectedIds.length === 0) return
    setLoading(true)
    setMessage('')
    try {
      const response = await fetch(`${API_URL}/files/batch-download`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${getAccessToken()}`
        },
        body: JSON.stringify({ fileIds: selectedIds })
      })
      if (!response.ok) throw new Error('Failed to download ZIP file')
      const blob = await response.blob()
      const url = URL.createObjectURL(blob)
      const link = document.createElement('a')
      link.href = url
      link.download = '9drive-download.zip'
      link.click()
      URL.revokeObjectURL(url)
      clearSelection()
      flash('Batch download complete.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Batch download failed')
    } finally {
      setLoading(false)
    }
  }

  async function renameFile(event: FormEvent) {
    event.preventDefault()
    if (!activeFile?.id) return
    await apiFetch(`/files/${activeFile.id}`, { method: 'PATCH', body: JSON.stringify({ name: renameValue }) })
    setRenameOpen(false)
    await loadFiles()
  }

  async function moveFile(event: FormEvent) {
    event.preventDefault()
    if (targetIds.length > 1) await apiFetch('/files/batch', { method: 'PATCH', body: JSON.stringify({ fileIds: targetIds, folderId: selectedFolderId || null }) })
    else if (targetIds.length === 1) await apiFetch(`/files/${targetIds[0]}`, { method: 'PATCH', body: JSON.stringify({ folderId: selectedFolderId || null }) })
    else return
    setMoveOpen(false)
    setSelectedFolderId('')
    clearSelection()
    await loadFiles()
  }

  async function deleteFile() {
    if (targetIds.length > 1) await apiFetch('/files/batch', { method: 'DELETE', body: JSON.stringify({ fileIds: targetIds }) })
    else if (targetIds.length === 1) await apiFetch(`/files/${targetIds[0]}`, { method: 'DELETE' })
    else return
    setDeleteOpen(false)
    clearSelection()
    await loadFiles()
    window.dispatchEvent(new Event('9drive:storage-changed'))
  }

  async function copyShareLinkFor(file: FileItem) {
    if (!file.id) return
    try {
      const shareData = await apiFetch<{ url: string }>(`/files/${file.id}/share`, { method: 'POST' })
      await navigator.clipboard.writeText(shareData.url)
      loadShares().catch(() => undefined)
      flash('Share link copied to clipboard.', 2500)
    } catch (err) {
      flash(`Failed to copy link: ${err instanceof Error ? err.message : String(err)}`, 4000)
      throw err
    }
  }

  async function makeDrivePublic(file: FileItem) {
    if (!file.id) return
    try {
      const res = await apiFetch<{ url: string }>(`/files/${file.id}/public-permission`, { method: 'POST' })
      await navigator.clipboard.writeText(res.url)
      flash('Google Drive link copied. Anyone with the link can now view this file.', 5000)
    } catch (err) {
      flash(`Failed to update Google Drive permission: ${err instanceof Error ? err.message : String(err)}`, 5000)
    }
  }

  function inviteToFolder() {
    if (!activeFolderForMenu?.id) return
    setInviteTargetType('folder')
    setInviteTargetId(activeFolderForMenu.id)
    setInviteMessage('')
    setInviteOpen(true)
  }

  async function copyFolderLink() {
    if (!activeFolderForMenu?.id) return
    let url = `${window.location.origin}/all-files?folderId=${activeFolderForMenu.id}`
    if (activeFolderForMenu.providerFolderId) {
      url = `https://drive.google.com/open?id=${activeFolderForMenu.providerFolderId}`
    }
    await navigator.clipboard.writeText(url)
    flash('Folder link copied to clipboard.', 2500)
  }

  async function sendInvite(event: FormEvent) {
    event.preventDefault()
    if (!inviteTargetId) return
    setInviting(true)
    setInviteMessage('')
    try {
      await apiFetch('/invites', { method: 'POST', body: JSON.stringify({ email: inviteEmail, role: inviteRole, targetType: inviteTargetType, targetId: inviteTargetId }) })
      setInviteEmail('')
      setInviteRole('viewer')
      setInviteMessage('Invite saved. Member will appear in Shared.')
      window.dispatchEvent(new Event('9drive:invites-changed'))
    } catch (error) {
      setInviteMessage(error instanceof Error ? error.message : 'Failed to send invite')
    } finally {
      setInviting(false)
    }
  }

  async function renameFolder(event: FormEvent) {
    event.preventDefault()
    if (!activeFolderForMenu?.id) return
    await apiFetch(`/folders/${activeFolderForMenu.id}`, { method: 'PATCH', body: JSON.stringify({ name: folderRenameValue, iconUrl: folderRenameIconUrl }) })
    setFolderRenameOpen(false)
    await loadFolders()
  }

  async function deleteFolder() {
    if (!activeFolderForMenu?.id) return
    await apiFetch(`/folders/${activeFolderForMenu.id}`, { method: 'DELETE' })
    setFolderDeleteOpen(false)
    await loadFolders()
  }

  function cutSelectedFolder(folder: FolderItem | null) {
    if (!folder?.id) return
    setCutFolder(folder)
    setMessage(`Folder "${folder.name}" ready to move. Open target folder and press Ctrl+V.`)
  }

  async function pasteFolder() {
    if (!cutFolder?.id) return
    await apiFetch(`/folders/${cutFolder.id}`, { method: 'PATCH', body: JSON.stringify({ parentId: activeFolderId ?? null }) })
    flash(`Folder "${cutFolder.name}" moved.`)
    setCutFolder(null)
    await loadFolders()
  }

  function closePreview() {
    setPreviewUrl('')
    setPreviewError('')
    setPreviewLoading(false)
    setPreviewOpen(false)
  }

  useEffect(() => {
    function handleUploadCompleted() {
      loadAll().catch(() => undefined)
    }
    window.addEventListener('9drive:upload-completed', handleUploadCompleted)
    return () => window.removeEventListener('9drive:upload-completed', handleUploadCompleted)
    // loadAll closes over the current folder, search and filters, so re-subscribe when any change.
  }, [activeFolderId, searchQuery, filterKey])

  const activeFolder = allFolders.find((folder) => folder.id === activeFolderId)
  const folderBreadcrumbs = (() => {
    if (!activeFolder) return []
    const foldersById = new Map(allFolders.map((folder) => [folder.id, folder]))
    const path: FolderItem[] = []
    const visited = new Set<string>()
    let current: FolderItem | undefined = activeFolder
    while (current?.id && !visited.has(current.id)) {
      path.unshift(current)
      visited.add(current.id)
      current = current.parentId ? foldersById.get(current.parentId) : undefined
    }
    return path
  })()
  const crumbKey = folderBreadcrumbs.map((folder) => `${folder.id}:${folder.name}`).join('|')

  useEffect(() => {
    setBreadcrumb([
      { label: 'All files', href: folderBreadcrumbs.length > 0 ? '/all-files' : undefined },
      ...folderBreadcrumbs.map((folder) => ({ label: folder.name, href: `/all-files?folderId=${folder.id}` })),
    ])
  }, [crumbKey])

  const allVisibleSelected = files.length > 0 && files.every((file) => file.id && selectedFileIds.has(file.id))
  const activePreviewKind = getPreviewKind(activeFile?.mimeType)
  const detailsFile = files.find((file) => file.id === detailsFileId) ?? null
  const detailsSharing = (() => {
    if (!detailsFile?.id || !shareLinks.has(detailsFile.id)) return 'Private'
    const expires = shareLinks.get(detailsFile.id)
    return expires ? `Public link · expires ${new Intl.DateTimeFormat('en', { dateStyle: 'medium' }).format(new Date(expires))}` : 'Public link'
  })()
  const searching = Boolean(searchQuery) || hasFilters
  const showFolders = !searching && folders.length > 0

  const accountOptions = connectedAccounts.map((account) => ({ value: account.id, label: formatAccountLabel(account) }))
  const accountParam = searchParams.get('accountId')
  const kindParam = searchParams.get('kind')

  return (
    <>
      <div className="flex min-h-[60dvh] items-start gap-6">
        <div onContextMenu={openEmptyContextMenu} className="grid min-h-[60dvh] min-w-0 flex-1 content-start gap-5">
          <PageHeader
            title={activeFolder ? activeFolder.name : 'All files'}
            description={activeFolder ? 'Files and folders in this folder.' : 'Everything stored across your connected accounts.'}
            actions={
              <>
                <Button variant="ghost" disabled={syncingDrive} onClick={syncGoogleDrive}>
                  <RefreshCw className={cn('h-4 w-4', syncingDrive && 'animate-spin')} strokeWidth={1.5} />
                  {syncingDrive ? 'Syncing...' : 'Sync'}
                </Button>
                <Button variant="secondary" onClick={() => setFolderOpen(true)}>
                  <FolderPlus className="h-4 w-4" strokeWidth={1.5} />New folder
                </Button>
              </>
            }
          />
          {message ? <p role="status" className="rounded-lg border border-border bg-accent-soft px-3 py-2 text-[13px] text-text">{message}</p> : null}
          {cutFolder ? (
            <p className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2 text-[13px] text-muted">
              <ClipboardPaste className="h-4 w-4 shrink-0" strokeWidth={1.5} />
              <span className="min-w-0 truncate">Cut folder: {cutFolder.name}. Press Ctrl+V or right-click an empty area to paste here.</span>
            </p>
          ) : null}

          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2">
            {selectedFileIds.size > 0 ? (
              <div className="min-w-0 flex-1">
                <SelectionBar count={selectedFileIds.size}>
                  <Button variant="secondary" size="sm" onClick={() => openMoveFor([...selectedFileIds])}><FolderInput className="h-4 w-4" strokeWidth={1.5} />Move to…</Button>
                  <Button variant="secondary" size="sm" disabled={loading} onClick={downloadBatchAsZip}><Download className="h-4 w-4" strokeWidth={1.5} />Download</Button>
                  <Button variant="dangerOutline" size="sm" onClick={() => openTrashFor([...selectedFileIds])}><Trash2 className="h-4 w-4" strokeWidth={1.5} />Move to Trash</Button>
                </SelectionBar>
              </div>
            ) : (
              <div className="flex min-w-0 flex-wrap items-center gap-2" role="group" aria-label="Filters">
                <FilterChip label="Type" options={typeOptions} selected={kindParam} onChange={(value) => setFilter('kind', value)} />
                <FilterChip label="Account" options={accountOptions} selected={accountParam} onChange={(value) => setFilter('accountId', value)} />
                <FilterChip label="Modified" options={modifiedOptions} selected={modifiedValue} onChange={(value) => setFilter('modified', value)} />
              </div>
            )}
            <div className="ml-auto inline-flex gap-0.5 rounded-lg border border-border p-0.5" role="group" aria-label="View">
              {([['list', List, 'List view'], ['grid', LayoutGrid, 'Grid view']] as const).map(([mode, Icon, label]) => (
                <button
                  key={mode}
                  type="button"
                  aria-label={label}
                  aria-pressed={fileViewMode === mode}
                  onClick={() => changeFileViewMode(mode)}
                  className={cn(
                    'flex h-6 w-7 items-center justify-center rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent',
                    fileViewMode === mode ? 'bg-selected text-text' : 'text-muted hover:text-text',
                  )}
                >
                  <Icon className="h-4 w-4" strokeWidth={1.5} />
                </button>
              ))}
            </div>
          </div>

          {showFolders ? (
            <section aria-label="Folders">
              <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-subtle">Folders</h2>
              <FolderGrid items={folders} onFolderMenu={openFolderMenu} onFolderOpen={openFolder} onDropItem={handleDropItem} />
            </section>
          ) : null}

          <section aria-label="Files">
            {fileViewMode === 'grid' && files.length > 0 ? <h2 className="mb-2 text-[11px] font-medium uppercase tracking-wide text-subtle">Files</h2> : null}
            {!filesLoaded ? (
              <p className="py-16 text-center text-[13px] text-muted">Loading files...</p>
            ) : files.length === 0 ? (
              <div className="rounded-[10px] border border-border">
                {searching ? (
                  <EmptyState
                    icon={<Upload className="h-5 w-5" strokeWidth={1.5} />}
                    title="No matching files"
                    description="Nothing matches the current search and filters."
                    action={<Button variant="secondary" onClick={clearFilters}>Clear filters</Button>}
                  />
                ) : (
                  <EmptyState
                    icon={<Upload className="h-5 w-5" strokeWidth={1.5} />}
                    title={activeFolder ? 'This folder is empty' : 'No files yet'}
                    description="Upload a file or create a folder to get started."
                    action={
                      <div className="flex flex-wrap justify-center gap-2">
                        <Button onClick={() => openUpload(activeFolderId)}><Upload className="h-4 w-4" strokeWidth={1.5} />Upload</Button>
                        <Button variant="secondary" onClick={() => setFolderOpen(true)}><FolderPlus className="h-4 w-4" strokeWidth={1.5} />New folder</Button>
                      </div>
                    }
                  />
                )}
              </div>
            ) : fileViewMode === 'grid' ? (
              <FileGrid files={files} selectedFileIds={selectedFileIds} detailsFileId={detailsFileId} onSelectFile={(file) => setDetailsFileId(file.id ?? null)} onToggleFile={toggleFileSelection} onFileContextMenu={openContext} />
            ) : (
              <FileTable files={files} selectedFileIds={selectedFileIds} detailsFileId={detailsFileId} allSelected={allVisibleSelected} onSelectFile={(file) => setDetailsFileId(file.id ?? null)} onToggleFile={toggleFileSelection} onToggleAll={toggleAllVisibleFiles} onFileContextMenu={openContext} />
            )}
          </section>
        </div>

        {isWide && detailsFile ? (
          <div className="sticky top-0 w-[320px] shrink-0 self-start">
            <DetailsPanel
              file={detailsFile}
              folderName={detailsFile.folderName}
              sharing={detailsSharing}
              onClose={() => setDetailsFileId(null)}
              onCopyLink={() => copyShareLinkFor(detailsFile)}
              onDownload={() => downloadFile(detailsFile)}
              onMakeDrivePublic={() => makeDrivePublic(detailsFile)}
            />
          </div>
        ) : null}
      </div>

      <EmptyAreaContextMenu x={emptyContextMenu.x} y={emptyContextMenu.y} open={emptyContextMenu.open} canPasteFolder={Boolean(cutFolder)} onClose={() => setEmptyContextMenu({ x: 0, y: 0, open: false })} onUpload={() => openUpload(activeFolderId)} onCreateFolder={() => setFolderOpen(true)} onPasteFolder={() => { pasteFolder().catch((error) => setMessage(error instanceof Error ? error.message : 'Failed to paste folder')) }} />
      <FileContextMenu
        x={contextMenu.x}
        y={contextMenu.y}
        file={contextMenu.file}
        showDetails={!isWide}
        onClose={() => setContextMenu({ x: 0, y: 0, file: null })}
        onView={viewFile}
        onDownload={() => downloadFile(activeFile)}
        onRename={() => { setRenameValue(activeFile?.name ?? ''); setRenameOpen(true) }}
        onMove={() => openMoveFor(idsFor(activeFile))}
        onDetails={() => { setDetailsFileId(activeFile?.id ?? null); setSheetOpen(true) }}
        onShare={() => setShareOpen(true)}
        onDelete={() => openTrashFor(idsFor(activeFile))}
      />
      <FolderContextMenu
        x={folderContextMenu.x}
        y={folderContextMenu.y}
        folder={folderContextMenu.folder}
        onClose={() => setFolderContextMenu({ x: 0, y: 0, folder: null })}
        onCut={() => cutSelectedFolder(activeFolderForMenu)}
        onRename={() => { setFolderRenameValue(activeFolderForMenu?.name ?? ''); setFolderRenameIconUrl(activeFolderForMenu?.iconUrl ?? defaultFolderIconUrl); setFolderRenameOpen(true) }}
        onInvite={inviteToFolder}
        onCopyLink={() => { copyFolderLink().catch(() => flash('Failed to copy folder link')) }}
        onDelete={() => setFolderDeleteOpen(true)}
      />

      <Dialog open={!isWide && sheetOpen && detailsFile !== null} onClose={() => setSheetOpen(false)} title="Details" width={420}>
        {detailsFile ? (
          <div className="-mx-4 -my-2">
            <DetailsPanel
              embedded
              file={detailsFile}
              folderName={detailsFile.folderName}
              sharing={detailsSharing}
              onCopyLink={() => copyShareLinkFor(detailsFile)}
              onDownload={() => downloadFile(detailsFile)}
              onMakeDrivePublic={() => makeDrivePublic(detailsFile)}
            />
          </div>
        ) : null}
      </Dialog>

      <Dialog
        open={folderOpen}
        onClose={() => setFolderOpen(false)}
        title="New folder"
        footer={<><Button variant="secondary" onClick={() => setFolderOpen(false)}>Cancel</Button><Button type="submit" form="new-folder-form">Create folder</Button></>}
      >
        <form id="new-folder-form" onSubmit={createFolder} className="grid gap-4">
          <label className={fieldLabelClass}>Folder name<Input value={folderName} onChange={(event) => setFolderName(event.target.value)} placeholder="Project assets" required /></label>
          <FolderIconPicker iconUrl={folderIconUrl} onIconChange={setFolderIconUrl} />
        </form>
      </Dialog>
      <Dialog
        open={renameOpen}
        onClose={() => setRenameOpen(false)}
        title="Rename file"
        footer={<><Button variant="secondary" onClick={() => setRenameOpen(false)}>Cancel</Button><Button type="submit" form="rename-file-form">Rename</Button></>}
      >
        <form id="rename-file-form" onSubmit={renameFile} className="grid gap-3">
          <p className="truncate text-[13px] text-muted">{activeFile?.name}</p>
          <Input value={renameValue} onChange={(event) => setRenameValue(event.target.value)} aria-label="File name" required />
        </form>
      </Dialog>
      <Dialog
        open={moveOpen}
        onClose={() => setMoveOpen(false)}
        title="Move to folder"
        footer={<><Button variant="secondary" onClick={() => setMoveOpen(false)}>Cancel</Button><Button type="submit" form="move-file-form">Move</Button></>}
      >
        <form id="move-file-form" onSubmit={moveFile} className="grid gap-3">
          <p className="truncate text-[13px] text-muted">{targetIds.length > 1 ? `Move ${targetIds.length} files` : files.find((file) => file.id === targetIds[0])?.name ?? ''}</p>
          <select className={selectClass} value={selectedFolderId} onChange={(event) => setSelectedFolderId(event.target.value)} aria-label="Destination folder">
            <option value="">No folder</option>
            {allFolders.map((folder) => <option key={folder.id} value={folder.id}>{folder.name}</option>)}
          </select>
        </form>
      </Dialog>
      <Dialog
        open={deleteOpen}
        onClose={() => setDeleteOpen(false)}
        title="Move to Trash"
        footer={<><Button variant="secondary" onClick={() => setDeleteOpen(false)}>Cancel</Button><Button variant="danger" onClick={deleteFile}>Move to Trash</Button></>}
      >
        <p className="text-[13px] text-muted">{targetIds.length > 1 ? `Move ${targetIds.length} files to Trash?` : `Move ${files.find((file) => file.id === targetIds[0])?.name ?? 'this file'} to Trash?`}</p>
      </Dialog>
      <ShareDialog file={activeFile} open={shareOpen} onClose={() => setShareOpen(false)} onChanged={() => { loadShares().catch(() => undefined) }} />
      <Dialog
        open={folderRenameOpen}
        onClose={() => setFolderRenameOpen(false)}
        title="Rename folder"
        footer={<><Button variant="secondary" onClick={() => setFolderRenameOpen(false)}>Cancel</Button><Button type="submit" form="rename-folder-form">Rename</Button></>}
      >
        <form id="rename-folder-form" onSubmit={renameFolder} className="grid gap-4">
          <Input value={folderRenameValue} onChange={(event) => setFolderRenameValue(event.target.value)} aria-label="Folder name" required />
          <FolderIconPicker iconUrl={folderRenameIconUrl} onIconChange={setFolderRenameIconUrl} />
        </form>
      </Dialog>
      <Dialog
        open={folderDeleteOpen}
        onClose={() => setFolderDeleteOpen(false)}
        title="Delete folder"
        footer={<><Button variant="secondary" onClick={() => setFolderDeleteOpen(false)}>Cancel</Button><Button variant="danger" onClick={deleteFolder}>Delete</Button></>}
      >
        <p className="text-[13px] text-muted">{`Delete virtual folder ${activeFolderForMenu?.name ?? ''}? Files inside will remain uploaded.`}</p>
      </Dialog>
      <Dialog
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        title="Invite member"
        footer={<><Button variant="secondary" onClick={() => setInviteOpen(false)}>Cancel</Button><Button type="submit" form="invite-form" disabled={inviting}>{inviting ? 'Sending...' : 'Send invite'}</Button></>}
      >
        <form id="invite-form" onSubmit={sendInvite} className="grid gap-4">
          <p className="text-[13px] text-muted">{`Share ${activeFolderForMenu?.name ?? 'folder'} with a team member.`}</p>
          <label className={fieldLabelClass}>Email address<Input type="email" value={inviteEmail} onChange={(event) => setInviteEmail(event.target.value)} placeholder="member@example.com" required /></label>
          <label className={fieldLabelClass}>Role<select className={selectClass} value={inviteRole} onChange={(event) => setInviteRole(event.target.value)}><option value="viewer">Can view</option><option value="editor">Can edit</option></select></label>
          {inviteMessage ? <p role="status" className="rounded-lg bg-accent-soft p-3 text-[13px] text-text">{inviteMessage}</p> : null}
        </form>
      </Dialog>
      <Dialog open={previewOpen} onClose={closePreview} title={activeFile?.name ?? 'Preview'} width={1400}>
        <div className="flex h-[70dvh] w-full items-center justify-center overflow-hidden rounded-[10px] border border-border bg-surface">
          {previewLoading ? <div className="p-6 text-center text-[13px] font-medium text-muted">Loading preview...</div> : null}
          {previewError ? <div className="p-6 text-center text-[13px] text-danger">{previewError}</div> : null}
          {!previewLoading && !previewError && activePreviewKind === 'image' && previewUrl ? <img src={previewUrl} alt={activeFile?.name ?? 'File preview'} className="max-h-full max-w-full object-contain" onError={() => setPreviewError('Failed to load preview.')} /> : null}
          {!previewLoading && !previewError && activePreviewKind === 'video' && previewUrl ? <div className="shared-video-shell"><video ref={previewVideoRef} controls playsInline preload="metadata" onError={() => setPreviewError('Failed to load preview.')}><source src={previewUrl} type={activeFile?.mimeType} /></video></div> : null}
          {!previewLoading && !previewError && activePreviewKind === 'document' && previewUrl ? <iframe src={previewUrl} title={activeFile?.name ?? 'File preview'} className="h-full w-full border-0 bg-bg" /> : null}
          {!previewLoading && !previewError && activePreviewKind === 'office' && previewUrl ? <iframe src={officeViewerUrl(previewUrl)} title={activeFile?.name ?? 'File preview'} className="h-full w-full border-0 bg-bg" /> : null}
          {!previewLoading && !previewError && !activePreviewKind ? <div className="p-6 text-center text-[13px] text-muted">Preview not available for this file type. Use Download instead.</div> : null}
        </div>
      </Dialog>
    </>  )
}
