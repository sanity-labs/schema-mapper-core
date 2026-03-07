# @sanity-labs/schema-mapper-core

Shared schema graph rendering components for Sanity schema visualization. Used by [schema-mapper](https://github.com/sanity-labs/schema-mapper) and internal tools.

## Install

```bash
npm install github:sanity-labs/schema-mapper-core
```

### Peer Dependencies

This package exports raw TypeScript/JSX — your app's bundler (Vite, etc.) compiles it. You need these peer dependencies installed:

```bash
npm install react @xyflow/react @sanity/ui @dagrejs/dagre elkjs react-icons lucide-react class-variance-authority clsx tailwind-merge
```

## Usage

```tsx
import { SchemaGraph, type DiscoveredType } from '@sanity-labs/schema-mapper-core'
import '@xyflow/react/dist/style.css'

function MySchemaViewer({ types }: { types: DiscoveredType[] }) {
  return (
    <div style={{ width: '100%', height: '100vh' }}>
      <SchemaGraph types={types} />
    </div>
  )
}
```

The `SchemaGraph` component accepts an array of `DiscoveredType[]` and renders an interactive node graph with:

- **SchemaNode** — displays type name, document count, and field list with type badges
- **FloatingEdge** — smart edge routing with bezier, step, and straight styles
- **Layout engines** — Dagre, ELK Layered, Force, and Stress (clustered) layouts
- **Controls** — layout switcher, edge style picker, spacing slider

### Types

```ts
type DiscoveredField = {
  name: string
  type: 'string' | 'number' | 'boolean' | 'text' | 'url' | 'datetime' | 'image' | 'reference' | 'array' | 'object' | 'block' | 'slug' | 'unknown'
  isReference?: boolean
  referenceTo?: string
  isArray?: boolean
  isInlineObject?: boolean
}

type DiscoveredType = {
  name: string
  documentCount: number
  fields: DiscoveredField[]
}
```

## License

MIT
