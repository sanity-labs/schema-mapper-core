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
  /**
   * True when this field was synthesised by the canvas's nested-object
   * descent (e.g. `entries[].patterns`). These entries exist only to surface
   * deep references in the graph; they are NOT a real top-level field on the
   * parent document and must be skipped by exporters that produce
   * round-trippable schema source.
   */
  isFlattenedRef?: boolean
  /**
   * The raw Studio field definition this entry was parsed from, when
   * available (deployed-schema source only). Carries the full original
   * shape including `of`, `fields`, `to`, `options`, `validation`, etc., so
   * exporters can round-trip without losing nested structure.
   * Omitted for inferred schemas and for flattened synthetic entries.
   */
  studioFieldRaw?: unknown
}

export type DiscoveredType = {
  name: string
  title?: string
  documentCount: number
  fields: DiscoveredField[]
  /**
   * The raw Studio schema entry this type was parsed from, when available
   * (deployed-schema source only). Carries the full document/object
   * definition including `type`, `preview`, `liveEdit`, `fieldsets`, etc.
   * Omitted for inferred schemas.
   */
  studioTypeRaw?: unknown
}
