export type DiscoveredField = {
  name: string
  title?: string
  type: 'string' | 'number' | 'boolean' | 'text' | 'url' | 'datetime' | 'image' | 'reference' | 'array' | 'object' | 'block' | 'slug' | 'unknown'
  isReference?: boolean
  referenceTo?: string
  isArray?: boolean
  isInlineObject?: boolean
  isCrossDatasetReference?: boolean
  isGlobalReference?: boolean
  crossDatasetName?: string
  crossDatasetProjectId?: string  // Raw project ID for global refs (before display name resolution)
  crossDatasetTooltip?: string
}

export type DiscoveredType = {
  name: string
  title?: string
  documentCount: number
  fields: DiscoveredField[]
}
