export type FolderItem = {
  id?: string
  name: string
  updated: string
  color: string
  iconUrl?: string | null
  parentId?: string | null
  providerFolderId?: string | null
  // 'drive_root' is the per-account folder standing for a connected Drive's My Drive.
  source?: string
}

export type FileItem = {
  id?: string
  name: string
  mimeType?: string
  date: string
  size: string
  sizeBytes?: string
  accountId?: string
  accountLabel?: string
  accountEmail?: string
  accountProvider?: string
  createdAt?: string
  kind: 'doc' | 'image' | 'video' | 'pdf'
  folderId?: string | null
  folderName?: string | null
}
