export type DiscoveredField = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'text' | 'url' | 'datetime' | 'image' | 'reference' | 'array' | 'object' | 'block' | 'slug' | 'unknown'
  isReference?: boolean
  referenceTo?: string
  isArray?: boolean
  isInlineObject?: boolean
}

export type DiscoveredType = {
  name: string
  documentCount: number
  fields: DiscoveredField[]
}
