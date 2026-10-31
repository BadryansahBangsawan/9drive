export type FolderItem = {
  id?: string
  name: string
  updated: string
  color: string
  iconUrl?: string | null
  parentId?: string | null
  providerFolderId?: string | null
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
