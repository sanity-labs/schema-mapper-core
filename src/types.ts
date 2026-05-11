export type DiscoveredField = {
  name: string
  title?: string
  type: 'string' | 'number' | 'boolean' | 'text' | 'url' | 'datetime' | 'image' | 'reference' | 'array' | 'object' | 'block' | 'slug' | 'unknown'
  isReference?: boolean
  referenceTo?: string
  /**
   * For references that accept multiple target document types
   * (e.g. `to: [{type: 'a'}, {type: 'b'}]`). When set, `referenceTo` holds the
   * first target for back-compat; `referenceTargets` holds the full list.
   * When omitted/single-target, treat as [referenceTo].
   */
  referenceTargets?: string[]
  isArray?: boolean
  isInlineObject?: boolean
  isCrossDatasetReference?: boolean
  isGlobalReference?: boolean
  crossDatasetName?: string
  crossDatasetProjectId?: string  // Raw project ID for global refs (before display name resolution)
  crossDatasetTooltip?: string
  crossDatasetResourceType?: 'dataset' | 'media-library' | string  // From deployed schema resourceType field
}

export type DiscoveredType = {
  name: string
  title?: string
  documentCount: number
  fields: DiscoveredField[]
}
