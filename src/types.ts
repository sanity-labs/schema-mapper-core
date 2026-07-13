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
   * Dot-notation path of the containing object/array field (empty/undefined
   * for top-level fields). Used by SchemaNode to render nested fields with
   * an indent + a chevron toggle on the parent stub. Examples: `productCore`,
   * `modules[]`, `productCore.pricing`.
   */
  parentPath?: string
  /**
   * When set, this row IS a parent stub — an inline object field or array-of-
   * object field. SchemaNode renders a chevron on stub rows; children (fields
   * whose `parentPath` starts with this stub's `name`) render indented when
   * expanded.
   */
  containerKind?: 'object' | 'array'
  /**
   * For container stub rows: the name of the element type. For a named object
   * container, this is the object type name (e.g. `productCore`). For an
   * array container whose members are a named object type, this is that
   * member type (e.g. `personEntry`). Absent when the container's contents
   * are anonymous inline shapes.
   */
  containerElementType?: string
}

export type DiscoveredType = {
  name: string
  title?: string
  documentCount: number
  fields: DiscoveredField[]
  /**
   * Whether this type is a `document` (has storage in the dataset, holds
   * an _id, referenced by inbound refs) or a top-level named `object` (no
   * storage — value type embedded in documents/other objects). Undefined
   * treated as 'document' for back-compat with older submissions.
   */
  kind?: 'document' | 'object'
}
