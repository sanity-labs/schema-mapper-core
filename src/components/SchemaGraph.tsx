'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ReactFlow,
  ReactFlowProvider,
  Background,
  Controls,
  MiniMap,
  useReactFlow,
  useNodesState,
  useEdgesState,
  useNodesInitialized,
  type Node,
  type Edge,
  type NodeTypes,
  type EdgeTypes,
  MarkerType,
} from '@xyflow/react'
import ELK from 'elkjs/lib/elk.bundled.js'
import dagre from '@dagrejs/dagre'
import '@xyflow/react/dist/style.css'

import { Tab, Button } from '@sanity/ui'
import { RxReset } from 'react-icons/rx'
import { TbFocus2, TbArrowsMaximize } from 'react-icons/tb'
// GrContract/GrExpand removed — FocusBar now uses TbFocus2/TbArrowsMaximize to match context menu
import { GoArrowLeft } from 'react-icons/go'
import { useDarkMode } from '../hooks/useDarkMode'
import SchemaNode, { SCHEMA_NODE_TYPE, type SchemaNodeData, ExpandContext } from './SchemaNode'
import FloatingEdge from './FloatingEdge'
import type { DiscoveredField, DiscoveredType } from '../types'

// ---------------------------------------------------------------------------
// Debounce utility
// ---------------------------------------------------------------------------

function debounce<T extends (...args: any[]) => any>(fn: T, ms: number): T & { cancel: () => void } {
  let timer: ReturnType<typeof setTimeout>
  const debounced = ((...args: any[]) => {
    clearTimeout(timer)
    timer = setTimeout(() => fn(...args), ms)
  }) as T & { cancel: () => void }
  debounced.cancel = () => clearTimeout(timer)
  return debounced
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type SchemaNode_RF = Node<SchemaNodeData, 'schema'>
type SchemaEdge = Edge

type LayoutType = 'original' | 'dagre' | 'layered' | 'force' | 'stress'
type EdgeStyle = 'bezier' | 'step' | 'straight'

// ---------------------------------------------------------------------------
// Node & edge types — defined OUTSIDE the component
// ---------------------------------------------------------------------------

const nodeTypes: NodeTypes = {
  [SCHEMA_NODE_TYPE]: SchemaNode,
}

const edgeTypes: EdgeTypes = {
  floating: FloatingEdge,
}

// Per-layout spacing multipliers — read by layout functions
const DEFAULT_SPACING: Record<LayoutType, number> = {
  original: 1,
  dagre: 0.8,
  layered: 0.3,
  force: 0.2,
  stress: 1.3,
}




// ---------------------------------------------------------------------------
// ELK layout engine
// ---------------------------------------------------------------------------

const elk = new ELK()

function getLayoutConfig(type: LayoutType, s: number): Record<string, string> {
  if (type === 'layered') {
    return {
      'elk.separateConnectedComponents': 'true',
      'elk.spacing.componentComponent': String(Math.round(200 * s)),
      'elk.algorithm': 'layered',
      'elk.direction': 'RIGHT',
      'elk.layered.spacing.nodeNodeBetweenLayers': String(Math.round(200 * s)),
      'elk.spacing.nodeNode': String(Math.round(80 * s)),
      'elk.spacing.edgeNode': String(Math.round(40 * s)),
      'elk.spacing.edgeNodeBetweenLayers': String(Math.round(40 * s)),
      'elk.spacing.edgeEdge': String(Math.round(15 * s)),
      'elk.spacing.edgeEdgeBetweenLayers': String(Math.round(15 * s)),
      'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
      'elk.layered.nodePlacement.strategy': 'NETWORK_SIMPLEX',
      'elk.layered.edgeRouting.splines.mode': 'CONSERVATIVE',
      'elk.portConstraints': 'FIXED_ORDER',
      'elk.edgeRouting': 'SPLINES',
    }
  }
  if (type === 'force') return {
    'elk.separateConnectedComponents': 'true',
    'elk.spacing.componentComponent': String(Math.round(300 * s)),
    'elk.algorithm': 'force',
    'elk.spacing.nodeNode': String(Math.round(120 * s)),
    'elk.force.iterations': '300',
    'elk.force.repulsivePower': '1',
  }
  if (type === 'stress') {
    // stress doesn't support separateConnectedComponents — we handle it manually
    return {
      'elk.algorithm': 'stress',
      'elk.spacing.nodeNode': String(Math.round(150 * s)),
      'elk.stress.desiredEdgeLength': String(Math.round(200 * s)),
    }
  }
  return {}
}

const layoutLabels: Record<LayoutType, string> = {
  original: 'Submitted',
  dagre: 'Dagre',
  layered: 'Layered',
  force: 'Force',
  stress: 'Clustered',
}
const edgeStyleLabels: Record<EdgeStyle, string> = { bezier: 'Bezier', step: 'Step', straight: 'Straight' }
const edgeStyleToType: Record<EdgeStyle, string> = { bezier: 'floating', step: 'floating', straight: 'floating' }

function getDagreLayout(
  nodes: SchemaNode_RF[],
  edges: SchemaEdge[],
  spacing: number,
): { nodes: SchemaNode_RF[]; edges: SchemaEdge[] } {
  const g = new dagre.graphlib.Graph().setDefaultEdgeLabel(() => ({}))
  g.setGraph({ rankdir: 'LR', nodesep: Math.round(50 * spacing), ranksep: Math.round(150 * spacing) })

  nodes.forEach((node) => {
    const fieldCount = node.data.fields?.length ?? 4
    g.setNode(node.id, {
      width: node.measured?.width ?? 280,
      height: node.measured?.height ?? 60 + fieldCount * 28,
    })
  })

  edges.forEach((edge) => {
    g.setEdge(edge.source, edge.target)
  })

  dagre.layout(g)

  const layoutedNodes = nodes.map((node) => {
    const pos = g.node(node.id)
    const width = node.measured?.width ?? 280
    const fieldCount = node.data.fields?.length ?? 4
    const height = node.measured?.height ?? 60 + fieldCount * 28
    return {
      ...node,
      position: {
        x: pos.x - width / 2,
        y: pos.y - height / 2,
      },
    }
  })

  return { nodes: layoutedNodes, edges }
}

function findConnectedComponents(
  nodes: SchemaNode_RF[],
  edges: SchemaEdge[],
): SchemaNode_RF[][] {
  const nodeIds = new Set(nodes.map(n => n.id))
  const adj = new Map<string, Set<string>>()
  nodeIds.forEach(id => adj.set(id, new Set()))
  edges.forEach(e => {
    if (adj.has(e.source) && adj.has(e.target)) {
      adj.get(e.source)!.add(e.target)
      adj.get(e.target)!.add(e.source)
    }
  })
  const visited = new Set<string>()
  const components: SchemaNode_RF[][] = []
  const nodeMap = new Map(nodes.map(n => [n.id, n]))
  for (const id of nodeIds) {
    if (visited.has(id)) continue
    const component: SchemaNode_RF[] = []
    const queue = [id]
    while (queue.length > 0) {
      const curr = queue.pop()!
      if (visited.has(curr)) continue
      visited.add(curr)
      component.push(nodeMap.get(curr)!)
      adj.get(curr)?.forEach(neighbor => {
        if (!visited.has(neighbor)) queue.push(neighbor)
      })
    }
    components.push(component)
  }
  // Sort: largest component first
  return components.sort((a, b) => b.length - a.length)
}

/**
 * Post-layout overlap removal — iteratively pushes overlapping nodes apart.
 * Preserves the general layout structure while guaranteeing no overlaps.
 */
function removeOverlaps(
  nodes: { id: string; position: { x: number; y: number }; measured?: { width?: number; height?: number }; data: any }[],
  padding: number = 30,
  maxIterations: number = 50,
): void {
  for (let iter = 0; iter < maxIterations; iter++) {
    let hadOverlap = false
    for (let i = 0; i < nodes.length; i++) {
      for (let j = i + 1; j < nodes.length; j++) {
        const a = nodes[i]
        const b = nodes[j]
        const aW = a.measured?.width ?? 280
        const aH = a.measured?.height ?? 60 + (a.data.fields?.length ?? 4) * 28
        const bW = b.measured?.width ?? 280
        const bH = b.measured?.height ?? 60 + (b.data.fields?.length ?? 4) * 28

        // Check bounding box overlap with padding
        const overlapX = (aW / 2 + bW / 2 + padding) - Math.abs((a.position.x + aW / 2) - (b.position.x + bW / 2))
        const overlapY = (aH / 2 + bH / 2 + padding) - Math.abs((a.position.y + aH / 2) - (b.position.y + bH / 2))

        if (overlapX > 0 && overlapY > 0) {
          hadOverlap = true
          // Push apart along the axis with less overlap (shorter escape)
          const dx = (a.position.x + aW / 2) - (b.position.x + bW / 2)
          const dy = (a.position.y + aH / 2) - (b.position.y + bH / 2)

          if (overlapX < overlapY) {
            // Push horizontally
            const push = overlapX / 2 + 1
            const sign = dx >= 0 ? 1 : -1
            a.position.x += sign * push
            b.position.x -= sign * push
          } else {
            // Push vertically
            const push = overlapY / 2 + 1
            const sign = dy >= 0 ? 1 : -1
            a.position.y += sign * push
            b.position.y -= sign * push
          }
        }
      }
    }
    if (!hadOverlap) break
  }
}

async function getElkLayout(spacing: number, 
  nodes: SchemaNode_RF[],
  edges: SchemaEdge[],
  layoutType: LayoutType,
): Promise<{ nodes: SchemaNode_RF[]; edges: SchemaEdge[] }> {
  const elkNodes = nodes.map((node) => {
    const fieldCount = node.data.fields?.length ?? 4
    const width = node.measured?.width ?? 280
    const height = node.measured?.height ?? 60 + fieldCount * 28

    // Build ports from reference fields for better edge routing
    const ports: any[] = []

    // Target port — single port for floating edge connections
    ports.push({
      id: `${node.id}-target-left`,
      layoutOptions: {
        'elk.port.side': 'WEST',
      },
    })

    // Source ports for reference and inline object fields (right side)
    node.data.fields.forEach((field: DiscoveredField) => {
      if (!field.isCrossDatasetReference && (field.isReference || field.isInlineObject || field.type === 'reference')) {
        ports.push({
          id: `${node.id}-ref-${field.name}`,
          layoutOptions: {
            'elk.port.side': 'EAST',
          },
        })
      }
    })

    return {
      id: node.id,
      width,
      height,
      ports,
      layoutOptions: {
        'elk.portConstraints': 'FIXED_ORDER',
      },
    }
  })

  const elkEdges = edges.map((edge) => ({
    id: edge.id,
    sources: [`${edge.source}-${edge.sourceHandle}`],
    targets: [`${edge.target}-${edge.targetHandle}`],
  }))

  // For stress: manually separate connected components and pack in a rectangle
  if (layoutType === 'stress') {
    const components = findConnectedComponents(nodes, edges)
    const positionMap = new Map<string, { x: number; y: number }>()
    // Cluster gap: small base, scales gently with slider (sqrt curve)
    const CLUSTER_GAP = Math.round(50 * Math.sqrt(spacing))

    // First pass: layout each component independently in parallel and measure bounding boxes
    const layoutedComponents = await Promise.all(
      components.map(async (component) => {
        const compNodeIds = new Set(component.map(n => n.id))
        const compElkNodes = elkNodes.filter(n => compNodeIds.has(n.id))
        const compElkEdges = elkEdges.filter(e => {
          const sourceNodeId = e.sources[0].split('-ref-')[0]
          const targetNodeId = e.targets[0].replace('-target-left', '')
          return compNodeIds.has(sourceNodeId) || compNodeIds.has(targetNodeId)
        })

        const compGraph = {
          id: 'root',
          layoutOptions: getLayoutConfig(layoutType, spacing),
          children: compElkNodes,
          edges: compElkEdges,
        }

        const layouted = await elk.layout(compGraph)

        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
        const positions = new Map<string, { x: number; y: number }>()
        layouted.children?.forEach((n: any) => {
          const node = nodes.find(nd => nd.id === n.id)
          const w = node?.measured?.width ?? 280
          const fCount = node?.data.fields?.length ?? 4
          const h = node?.measured?.height ?? 60 + fCount * 28
          minX = Math.min(minX, n.x)
          minY = Math.min(minY, n.y)
          maxX = Math.max(maxX, n.x + w)
          maxY = Math.max(maxY, n.y + h)
          positions.set(n.id, { x: n.x, y: n.y })
        })

        // Normalize positions to start at 0,0
        positions.forEach((pos, id) => {
          positions.set(id, { x: pos.x - minX, y: pos.y - minY })
        })

        return {
          positions,
          width: maxX - minX,
          height: maxY - minY,
        }
      })
    )

    // Second pass: pack components in rows to fill a roughly square area
    const totalArea = layoutedComponents.reduce((sum, c) => sum + (c.width + CLUSTER_GAP) * (c.height + CLUSTER_GAP), 0)
    const targetWidth = Math.sqrt(totalArea) * 1.2

    let cursorX = 0
    let cursorY = 0
    let rowHeight = 0

    for (const comp of layoutedComponents) {
      // Start new row if this component would exceed target width
      if (cursorX > 0 && cursorX + comp.width > targetWidth) {
        cursorX = 0
        cursorY += rowHeight + CLUSTER_GAP
        rowHeight = 0
      }

      comp.positions.forEach((pos, id) => {
        positionMap.set(id, { x: pos.x + cursorX, y: pos.y + cursorY })
      })

      cursorX += comp.width + CLUSTER_GAP
      rowHeight = Math.max(rowHeight, comp.height)
    }

    const layoutedNodes = nodes.map((node) => ({
      ...node,
      position: positionMap.get(node.id) ?? { x: 0, y: 0 },
    }))

    // Remove any remaining overlaps from the stress layout
    removeOverlaps(layoutedNodes)

    return { nodes: layoutedNodes, edges }
  }

  // All other layouts: single ELK pass
  const graph = {
    id: 'root',
    layoutOptions: getLayoutConfig(layoutType, spacing),
    children: elkNodes,
    edges: elkEdges,
  }

  const layoutedGraph = await elk.layout(graph)

  const layoutedNodes = nodes.map((node) => {
    const elkNode = layoutedGraph.children?.find((n: any) => n.id === node.id)
    return {
      ...node,
      position: {
        x: elkNode?.x ?? 0,
        y: elkNode?.y ?? 0,
      },
    }
  })

  return { nodes: layoutedNodes, edges }
}

// ---------------------------------------------------------------------------
// Build initial nodes & edges from discovered types
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Focus mode — neighbourhood extraction
// ---------------------------------------------------------------------------

function getNeighbourhood(
  types: DiscoveredType[],
  focusTypeName: string,
  depth: 0 | 1 | 2,
): Set<string> {
  const typeMap = new Map(types.map(t => [t.name, t]))
  const included = new Set<string>([focusTypeName])

  // 0-hop: just the focused type itself
  if (depth === 0) return included

  // Inline helper: all reference targets for a field (handles multi-target refs)
  const targetsOf = (field: DiscoveredField): string[] => {
    if (field.referenceTargets && field.referenceTargets.length > 0) return field.referenceTargets
    if (field.referenceTo) return [field.referenceTo]
    return []
  }

  // 1-hop: direct connections (references to and from)
  const focusType = typeMap.get(focusTypeName)
  if (focusType) {
    for (const field of focusType.fields) {
      if (field.isReference || field.isInlineObject) {
        for (const t of targetsOf(field)) included.add(t)
      }
    }
  }
  // Also find types that reference the focus type
  for (const type of types) {
    for (const field of type.fields) {
      if ((field.isReference || field.isInlineObject) && targetsOf(field).includes(focusTypeName)) {
        included.add(type.name)
      }
    }
  }

  if (depth === 2) {
    // 2-hop: connections of connections
    const firstHop = new Set(included)
    for (const name of firstHop) {
      const type = typeMap.get(name)
      if (!type) continue
      for (const field of type.fields) {
        if (field.isReference || field.isInlineObject) {
          for (const t of targetsOf(field)) included.add(t)
        }
      }
      // Also find types that reference any 1-hop type
      for (const t of types) {
        for (const field of t.fields) {
          if (field.isReference || field.isInlineObject) {
            for (const tgt of targetsOf(field)) {
              if (firstHop.has(tgt)) {
                included.add(t.name)
                break
              }
            }
          }
        }
      }
    }
  }

  return included
}

// ---------------------------------------------------------------------------
// Focus mode — UI components
// ---------------------------------------------------------------------------

/** Stable key for a set of types — used to cache focus state across schema switches */
function typesKey(types: DiscoveredType[]): string {
  return types.map(t => t.name).sort().join(',')
}

function NodeContextMenu({ x, y, typeName, onFocus, onExpand, onClose }: {
  x: number; y: number; typeName: string
  onFocus: () => void; onExpand: () => void; onClose: () => void
}) {
  useEffect(() => {
    __effLog('line511');
    // Defer to next frame so the opening click doesn't immediately close
    const raf = requestAnimationFrame(() => {
      window.addEventListener('click', handler, { once: true, capture: false })
    })
    const handler = () => onClose()
    return () => {
      cancelAnimationFrame(raf)
      window.removeEventListener('click', handler)
    }
  }, [onClose])

  return (
    <div
      className="absolute z-50 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg shadow-lg py-1 min-w-[160px]"
      style={{ left: x, top: y }}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="px-3 py-1.5 text-xs text-gray-400 dark:text-gray-500 font-medium">
        {typeName}
      </div>
      <button
        className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
        onClick={() => { onFocus(); onClose() }}
      >
        <TbFocus2 className="text-blue-500" /> Focus
      </button>
      <button
        className="w-full text-left px-3 py-2 text-sm text-gray-700 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2"
        onClick={() => { onExpand(); onClose() }}
      >
        <TbArrowsMaximize className="text-purple-500" /> Expand
      </button>
    </div>
  )
}

function FocusBar({ typeName, depth, connectedCount, canExpand, canFocus, canGoBack, backTypeName, onClose, onExpandDepth, onFocusDepth, onBack }: {
  typeName: string; depth: 0 | 1 | 2; connectedCount: number; canExpand: boolean; canFocus: boolean; canGoBack: boolean; backTypeName?: string
  onClose: () => void; onExpandDepth: () => void; onFocusDepth: () => void; onBack: () => void
}) {
  return (
    <div className="absolute top-3 left-3 z-20 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border border-gray-200 dark:border-gray-700 rounded-lg px-4 py-2 flex items-center gap-3">
      {canGoBack && (
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 -ml-1"
          title={backTypeName ? `Back to ${backTypeName}` : 'Go back'}
        >
          <GoArrowLeft className="w-4 h-4" />
        </button>
      )}
      <span className="text-sm text-gray-600 dark:text-gray-300">
        Focused on <span className="font-medium text-gray-900 dark:text-gray-100">{typeName}</span>
        {depth > 0 && <span className="text-gray-400 dark:text-gray-500 ml-1">({depth}-hop){connectedCount > 0 ? ` — ${connectedCount} connected type${connectedCount !== 1 ? 's' : ''}` : ''}</span>}
      </span>
      {canFocus && depth > 0 && (
        <Button
          mode="ghost"
          tone="primary"
          fontSize={1}
          padding={2}
          onClick={onFocusDepth}
          text="Focus"
          icon={TbFocus2}
        />
      )}
      {canExpand && (
        <Button
          mode="ghost"
          tone="primary"
          fontSize={1}
          padding={2}
          onClick={onExpandDepth}
          text="Expand"
          icon={TbArrowsMaximize}
        />
      )}
      <button
        onClick={onClose}
        className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200"
        title="Exit focus mode"
      >
        ✕
      </button>
    </div>
  )
}

function SearchBox({ query, onChange, onClear, resultCount, totalCount, offsetTop }: {
  query: string; onChange: (q: string) => void; onClear: () => void
  resultCount: number; totalCount: number; offsetTop?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    __effLog('line606');
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && query) {
        e.preventDefault()
        onClear()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [query, onClear])

  return (
    <div className={`absolute left-3 z-20 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border border-gray-200 dark:border-gray-700 rounded-lg px-3 py-2 flex items-center gap-2 ${offsetTop ? 'top-12' : 'top-3'}`}>
      <svg className="w-4 h-4 text-gray-400 dark:text-gray-500 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
      </svg>
      <input
        ref={inputRef}
        type="text"
        value={query}
        onChange={(e) => onChange(e.target.value)}
        placeholder="Filter types…"
        className="bg-transparent border-none outline-none text-sm text-gray-900 dark:text-gray-100 placeholder-gray-400 dark:placeholder-gray-500 w-[160px]"
      />
      {query && (
        <>
          <span className="text-xs text-gray-400 dark:text-gray-500 whitespace-nowrap">
            {resultCount}/{totalCount}
          </span>
          <button
            onClick={onClear}
            className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 shrink-0"
          >
            ✕
          </button>
        </>
      )}
    </div>
  )
}

function buildNodesAndEdges(
  types: DiscoveredType[],
  edgeStyle: EdgeStyle = 'bezier',
  extraNodeData?: Partial<SchemaNodeData>,
): {
  nodes: SchemaNode_RF[]
  edges: SchemaEdge[]
} {
  const typeNames = new Set(types.map((t) => t.name))
  // Kind lookup for orphan-lozenge coloring. If caller passed a fuller map
  // via extraNodeData.typeKinds (which they should, computed from the full
  // types list — not just the filtered subset), we use that. Otherwise we
  // fall back to what we can see in the local `types`.
  const localTypeKinds: Record<string, 'document' | 'object'> = {}
  for (const t of types) localTypeKinds[t.name] = t.kind || 'document'
  const typeKinds: Record<string, 'document' | 'object'> = {
    ...localTypeKinds,
    ...(extraNodeData?.typeKinds || {}),
  }

  const nodes: SchemaNode_RF[] = types.map((type, index) => ({
    id: type.name,
    type: SCHEMA_NODE_TYPE as const,
    position: { x: 0, y: index * 200 },
    data: {
      typeName: type.name,
      documentCount: type.documentCount,
      fields: type.fields,
      kind: type.kind,
      typeKinds,
      ...extraNodeData,
      // Compute per-node: does this node have orphaned refs that add right margin?
      orphanedRefPadding: extraNodeData?.visibleTypeNames
        ? type.fields.some(f => {
            if (f.isCrossDatasetReference) return true
            // Include inline-object rows too — they render orphan lozenges
            // now that the pivot puts named object types on their own nodes.
            const isRefRow = f.isReference || f.type === 'reference'
            const isInlineRefRow = f.isInlineObject && !!f.referenceTo
            if (!isRefRow && !isInlineRefRow) return false
            const targets = f.referenceTargets && f.referenceTargets.length > 0
              ? f.referenceTargets
              : (f.referenceTo ? [f.referenceTo] : [])
            // Reserve space if ANY target is off-canvas (a lozenge will render).
            // (Previously checked "none visible", which broke when SOME targets
            // were visible — the row still had a "+N" lozenge but edges anchored
            // through it, causing a visible offset.)
            return targets.length > 0 && targets.some(t => !extraNodeData.visibleTypeNames!.has(t))
          }) ? 130 : 0
        : (type.fields.some(f => f.isCrossDatasetReference) ? 130 : 0),
    },
  }))

  // Distinct colors for edges. Two rules:
  //   1. Edges targeting an object-kind type ALWAYS use amber, matching the
  //      amber-bordered object nodes. This gives a real semantic cue.
  //   2. Edges targeting a document-kind type use a per-source-type colour
  //      chosen by hashing `type.name` into the palette below. Hashing makes
  //      the palette deterministic: the same source type gets the same colour
  //      in every viewer (customer app, internal, any future replay), and
  //      regardless of whether the current view is the full graph or a focus
  //      subset. Insertion-order palette assignment (the previous behaviour)
  //      caused the same submission to look different in different apps.
  const OBJECT_EDGE_COLOR = '#f59e0b' // amber, matches object node border
  const edgeColors = [
    '#6366f1', // indigo
    '#10b981', // emerald
    '#ef4444', // red
    '#8b5cf6', // violet
    '#06b6d4', // cyan
    '#f97316', // orange
    '#ec4899', // pink
    '#14b8a6', // teal
    '#a855f7', // purple
  ]

  // Deterministic per-name colour from the palette: same source name always
  // maps to the same palette slot in every viewer, regardless of iteration
  // order or visible subset. Simple djb2-style hash — good distribution over
  // short strings, no crypto required.
  const colorForSource = (name: string): string => {
    let h = 5381
    for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) | 0
    return edgeColors[Math.abs(h) % edgeColors.length]
  }

  const edges: SchemaEdge[] = []

  types.forEach((type) => {
    type.fields.forEach((field) => {
      if (field.isCrossDatasetReference) return
      if (!field.isReference && !field.isInlineObject) return

      // Multi-target references emit one edge per target.
      const allTargets = field.referenceTargets && field.referenceTargets.length > 0
        ? field.referenceTargets
        : (field.referenceTo ? [field.referenceTo] : [])

      const visibleTargets = allTargets.filter((t) => typeNames.has(t))
      if (visibleTargets.length === 0) return

      const isInline = field.isInlineObject

      visibleTargets.forEach((target) => {
        // Colour rule: edges to object-kind targets are always amber (matches
        // the amber-bordered object nodes). Edges to document-kind targets
        // use a deterministic per-source-name palette colour.
        const isObjectTarget = typeKinds[target] === 'object'
        const color = isObjectTarget ? OBJECT_EDGE_COLOR : colorForSource(type.name)
        edges.push({
          id: `${type.name}-${field.name}->${target}`,
          source: type.name,
          target,
          sourceHandle: `ref-${field.name}`,
          targetHandle: 'target-left',
          type: 'floating',
          animated: false,
          label: field.name,
          markerEnd: {
            type: MarkerType.ArrowClosed,
            width: 15,
            height: 15,
            color,
          },
          style: {
            stroke: color,
            strokeWidth: 1.5,
            ...(isInline ? { strokeDasharray: '6 3' } : {}),
          },
          data: { isInlineObject: isInline, edgeStyle },
        })
      })
    })
  })

  // Floating edges calculate their own connection points, but we keep
  // targetHandle for React Flow's internal bookkeeping
  const incomingCount = new Map<string, number>()
  edges.forEach(e => incomingCount.set(e.target, (incomingCount.get(e.target) ?? 0) + 1))

  // Compute sibling indices for step-edge offset.
  // Group by source + exit side (left/right based on target position)
  // so edges exiting the same side fan out, but opposite-side edges don't interfere.
  const sourceExitGroups = new Map<string, number[]>()
  edges.forEach((e, i) => {
    // Determine exit side: compare source center X with target center X
    const sourceNode = nodes.find(n => n.id === e.source)
    const targetNode = nodes.find(n => n.id === e.target)
    if (!sourceNode || !targetNode) return
    const sourceCX = sourceNode.position.x + (sourceNode.measured?.width ?? 280) / 2
    const targetCX = targetNode.position.x + (targetNode.measured?.width ?? 280) / 2
    const side = targetCX >= sourceCX ? 'R' : 'L'
    const key = `${e.source}:${side}`
    const group = sourceExitGroups.get(key) || []
    group.push(i)
    sourceExitGroups.set(key, group)
  })
  sourceExitGroups.forEach((indices) => {
    indices.forEach((edgeIdx, siblingIdx) => {
      const e = edges[edgeIdx]
      e.data = { ...e.data, edgeIndex: siblingIdx, siblingCount: indices.length }
    })
  })

  // Mark nodes with connection info
  const hasIncoming = new Set(edges.map(e => e.target))
  const hasOutgoing = new Set(edges.map(e => e.source))
  nodes.forEach(node => {
    node.data.hasIncoming = hasIncoming.has(node.id)
    node.data.hasOutgoing = hasOutgoing.has(node.id)
    node.data.incomingEdgeCount = incomingCount.get(node.id) ?? 0
  })

  return { nodes, edges }
}

// ---------------------------------------------------------------------------
// Layout switcher component
// ---------------------------------------------------------------------------

function GraphControls({
  layout,
  onLayoutChange,
  edgeStyle,
  onEdgeStyleChange,
  spacing,
  onSpacingChange,
  onResetSpacing,
  hasOriginalPositions = false,
  disabled = false,
  curatedActive = false,
  expandObjects = false,
  expandArrays = false,
  onExpandObjectsChange,
  onExpandArraysChange,
}: {
  layout: LayoutType
  onLayoutChange: (layout: LayoutType) => void
  edgeStyle: EdgeStyle
  onEdgeStyleChange: (style: EdgeStyle) => void
  spacing: number
  onSpacingChange: (value: number) => void
  onResetSpacing: () => void
  hasOriginalPositions?: boolean
  disabled?: boolean
  /** When true, no algo tab is shown as selected — the app-level curated layout is in charge. */
  curatedActive?: boolean
  expandObjects?: boolean
  expandArrays?: boolean
  onExpandObjectsChange?: (value: boolean) => void
  onExpandArraysChange?: (value: boolean) => void
}) {
  const layouts: LayoutType[] = hasOriginalPositions
    ? ['original', 'dagre', 'layered', 'force', 'stress']
    : ['dagre', 'layered', 'force', 'stress']
  const edgeStyles: EdgeStyle[] = ['bezier', 'step', 'straight']

  return (
    <div className={`absolute top-3 right-3 z-10 flex flex-col items-end gap-2 bg-white/80 dark:bg-gray-900/80 backdrop-blur-sm rounded-lg p-2.5 transition-opacity ${disabled ? 'opacity-40 pointer-events-none' : ''}`}>
      <div className="flex gap-1 items-center">
        {layouts.map((l) => (
          <Tab
            key={l}
            id={`layout-tab-${l}`}
            label={layoutLabels[l]}
            selected={!curatedActive && layout === l}
            onClick={() => onLayoutChange(l)}
          />
        ))}
      </div>
      <div className="flex gap-1">
        {edgeStyles.map((s) => (
          <Tab
            key={s}
            id={`edge-tab-${s}`}
            label={edgeStyleLabels[s]}
            selected={edgeStyle === s}
            onClick={() => onEdgeStyleChange(s)}
          />
        ))}
      </div>
      <div className="grid grid-cols-[auto_1fr_auto] items-center gap-x-3 gap-y-3 px-1 mt-2 text-xs text-gray-500 dark:text-gray-400">
        {layout !== 'original' && (
          <>
            <span>Spacing</span>
            <input
              type="range"
              min="10"
              max="500"
              value={Math.round(spacing * 100)}
              onChange={(e) => onSpacingChange(Number(e.target.value) / 100)}
              className="w-32 h-1 accent-gray-700 justify-self-start"
            />
            <button
              onClick={onResetSpacing}
              className="text-gray-400 hover:text-gray-600 dark:text-gray-500 dark:hover:text-gray-300 transition-colors justify-self-end"
              title="Reset to default"
            >
              <RxReset className="text-xs" />
            </button>
          </>
        )}
        <span aria-hidden="true" />
        <label className="col-span-2 flex items-center gap-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={expandObjects}
            onChange={(e) => onExpandObjectsChange?.(e.target.checked)}
            className="w-3 h-3 accent-gray-700 cursor-pointer"
          />
          <span>Expand inline objects</span>
        </label>
        <span aria-hidden="true" />
        <label className="col-span-2 flex items-center gap-1 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={expandArrays}
            onChange={(e) => onExpandArraysChange?.(e.target.checked)}
            className="w-3 h-3 accent-gray-700 cursor-pointer"
          />
          <span>Expand inline arrays</span>
        </label>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Inner component (needs ReactFlowProvider ancestor for hooks)
// ---------------------------------------------------------------------------

interface SchemaGraphInnerProps {
  types: DiscoveredType[]
  initialPositions?: Record<string, { x: number; y: number }>
  initialEdgeStyle?: EdgeStyle
  initialExpandObjects?: boolean
  initialExpandArrays?: boolean
  initialTransientExpanded?: string[]
  onStateChange?: (state: SchemaGraphState) => void
  fitViewTrigger?: number
  initialFocusState?: { typeName: string; depth: 0 | 1 | 2 }
  onCrossDatasetNavigate?: (datasetName: string, typeName?: string, sourceTypeName?: string, projectId?: string) => void
  onMediaLibraryClick?: (fieldName: string, typeName: string) => void
  onInaccessibleClick?: (projectName: string, datasetName: string) => void
  accessibleProjectIds?: Set<string>
  pendingFocusType?: string | null
  pendingFocusDepth?: 0 | 1 | 2
  onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void
  restoreViewport?: { x: number; y: number; zoom: number } | null
  viewportNudge?: { dy: number; trigger: number } | null
  curatedActive?: SchemaGraphProps['curatedActive']
  curatedRestoreVersion?: number
  curatedEditable?: boolean
  /**
   * When true, curated mode is active but the layout is permanently locked
   * (e.g. read-only team-shared layout in the customer app). Suppresses the
   * "no-touch" cursor + the onLockedInteraction call — the graph behaves
   * like a normal pan/zoom canvas that just can't be edited. Nodes remain
   * non-draggable via curatedEditable=false.
   */
  curatedReadOnly?: boolean
  onCuratedDrag?: (positions: Record<string, {x: number; y: number}>) => void
  onCuratedExitForAlgo?: () => void
  /** When curated is active + locked, called if the user clicks/interacts with a node. Consumer typically opens an "unlock this layout?" dialog. */
  onLockedInteraction?: () => void
  /**
   * Imperative focus restore. Whenever restoreFocusVersion changes, the
   * graph applies `restoreFocus` — non-null enters focus on that (type,
   * depth); null exits focus. Used to reinstate a curated layout's
   * last-active focus on re-selection.
   */
  restoreFocus?: { typeName: string; depth: 0 | 1 | 2 } | null
  restoreFocusVersion?: number
}

function SchemaGraphInner({
  types,
  initialPositions,
  initialEdgeStyle,
  initialExpandObjects,
  initialExpandArrays,
  initialTransientExpanded,
  onStateChange,
  fitViewTrigger,
  initialFocusState,
  onCrossDatasetNavigate,
  onMediaLibraryClick,
  onInaccessibleClick,
  accessibleProjectIds,
  pendingFocusType,
  pendingFocusDepth = 0,
  onViewportChange,
  restoreViewport,
  viewportNudge,
  curatedActive,
  curatedRestoreVersion,
  curatedEditable,
  curatedReadOnly,
  onCuratedDrag,
  onCuratedExitForAlgo,
  onLockedInteraction,
  restoreFocus,
  restoreFocusVersion,
}: SchemaGraphInnerProps) {
  const isDark = useDarkMode()
  const { fitView, getViewport, setViewport } = useReactFlow()
  const nodesInitialized = useNodesInitialized()
  // DIAG: count firings per effect line, log every Nth firing to catch loops
  const __effCounts = useRef<Record<string, number>>({})
  const __effLog = (name: string) => {
    const n = (__effCounts.current[name] || 0) + 1
    __effCounts.current[name] = n
    if (n === 1 || n === 5 || n === 20 || n % 100 === 0) console.log('[SG.effect count]', name, '=', n)
  }

  const containerRef = useRef<HTMLDivElement>(null)

  // Smooth reframe when container resizes (e.g. collapsible nav)
  const fitViewTriggerRef = useRef(fitViewTrigger ?? 0)
  useEffect(() => {
    __effLog('line1026');
    if (fitViewTrigger != null && fitViewTrigger !== fitViewTriggerRef.current) {
      fitViewTriggerRef.current = fitViewTrigger
      // Small delay to let container finish resizing
      const timer = setTimeout(() => fitView({ padding: 0.22, duration: 300 }), 50)
      return () => clearTimeout(timer)
    }
  }, [fitViewTrigger, fitView])

  // Fix: React Flow's NodeWrapper adds 'nopan' to draggable nodes, which blocks
  // panOnScroll wheel events over nodes. We add a capture-phase listener that
  // re-dispatches wheel events from nodes directly on the .react-flow__renderer
  // element, bypassing the nopan check.
  useEffect(() => {
    __effLog('line1039');
    const container = containerRef.current
    if (!container) return

    const handler = (e: WheelEvent) => {
      const target = e.target as HTMLElement
      // Only intercept events on nodes (not on the pane/background itself)
      if (!target.closest('.react-flow__node')) return

      const renderer = container.querySelector('.react-flow__renderer')
      if (!renderer) return

      // Stop the original event from reaching d3's handler (which would be blocked by nopan)
      // and prevent browser's native pinch-zoom
      e.stopPropagation()
      e.preventDefault()

      // Dispatch a cloned event directly on the renderer element
      const cloned = new WheelEvent('wheel', {
        bubbles: true,
        cancelable: true,
        clientX: e.clientX,
        clientY: e.clientY,
        deltaX: e.deltaX,
        deltaY: e.deltaY,
        deltaZ: e.deltaZ,
        deltaMode: e.deltaMode,
        ctrlKey: e.ctrlKey,
        shiftKey: e.shiftKey,
        altKey: e.altKey,
        metaKey: e.metaKey,
      })
      renderer.dispatchEvent(cloned)
    }

    container.addEventListener('wheel', handler, { capture: true, passive: false })
    return () => container.removeEventListener('wheel', handler, { capture: true })
  }, [])
  const [layoutApplied, setLayoutApplied] = useState(false)
  const [layoutType, setLayoutType] = useState<LayoutType>(() => {
    // Default to 'original' if positions were provided
    if (initialPositions && Object.keys(initialPositions).length > 0) return 'original'
    try {
      const saved = localStorage.getItem('schema-mapper:layoutType')
      if (saved && ['original', 'dagre', 'layered', 'force', 'stress'].includes(saved)) {
        return saved as LayoutType
      }
    } catch {}
    return 'layered'
  })
  const [isLayouting, setIsLayouting] = useState(false)
  const [edgeStyle, setEdgeStyle] = useState<EdgeStyle>(() => {
    if (initialEdgeStyle) return initialEdgeStyle
    try {
      const saved = localStorage.getItem('schema-mapper:edgeStyle')
      if (saved && ['bezier', 'step', 'straight'].includes(saved)) return saved as EdgeStyle
    } catch {}
    return 'bezier'
  })

  const edgeStyleRef = useRef(edgeStyle)
  edgeStyleRef.current = edgeStyle

  // Full-schema kind lookup so orphan lozenges color correctly even when
  // the target isn't in the currently-rendered subset (focus mode). Built
  // from the full types prop; passed into every buildNodesAndEdges call
  // via extraNodeData.typeKinds.
  const fullTypeKinds = useMemo(() => {
    const map: Record<string, 'document' | 'object'> = {}
    for (const t of types) map[t.name] = t.kind || 'document'
    return map
  }, [types])

  // Expand-mode state — controls whether nested object/array fields render
  // inline (indented rows) vs collapsed to their parent row. Per-node
  // transient overrides live in `transientExpanded` (field paths that have
  // been individually toggled). See feature/expand-toggles for the full
  // spec.
  const [expandObjects, setExpandObjectsState] = useState<boolean>(() => {
    if (initialExpandObjects !== undefined) return initialExpandObjects
    try {
      const saved = localStorage.getItem('schema-mapper:expandObjects')
      if (saved !== null) return saved === 'true'
    } catch {}
    return false
  })
  const [expandArrays, setExpandArraysState] = useState<boolean>(() => {
    if (initialExpandArrays !== undefined) return initialExpandArrays
    try {
      const saved = localStorage.getItem('schema-mapper:expandArrays')
      if (saved !== null) return saved === 'true'
    } catch {}
    return false
  })
  const [transientExpanded, setTransientExpanded] = useState<string[]>(
    () => initialTransientExpanded ?? [],
  )

  const setExpandObjects = useCallback((v: boolean) => {
    setExpandObjectsState(v)
    try {
      localStorage.setItem('schema-mapper:expandObjects', String(v))
    } catch {}
    // Setting change is a "big change" — clear transient overrides.
    setTransientExpanded([])
  }, [])
  const setExpandArrays = useCallback((v: boolean) => {
    setExpandArraysState(v)
    try {
      localStorage.setItem('schema-mapper:expandArrays', String(v))
    } catch {}
    setTransientExpanded([])
  }, [])

  const expandObjectsRef = useRef(expandObjects)
  expandObjectsRef.current = expandObjects
  const expandArraysRef = useRef(expandArrays)
  expandArraysRef.current = expandArrays
  const transientExpandedRef = useRef(transientExpanded)
  transientExpandedRef.current = transientExpanded

  // Toggle a transient container expansion. Keys are `${typeName}::${fieldPath}`
  // so identically-named fields in different types don't collide. Toggling
  // adds the key if absent, removes it if present.
  const handleToggleTransient = useCallback((typeName: string, fieldPath: string) => {
    const key = `${typeName}::${fieldPath}`
    setTransientExpanded((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key)
      return [...prev, key]
    })
  }, [])

  // Stable Set instance for context — recomputed only when the underlying
  // array changes. Prevents re-renders in every SchemaNode on unrelated state.
  const transientExpandedSet = useMemo(
    () => new Set(transientExpanded),
    [transientExpanded],
  )

  const expandContextValue = useMemo<React.ContextType<typeof ExpandContext>>(
    () => ({
      expandObjects,
      expandArrays,
      transientExpanded: transientExpandedSet,
      onToggleTransient: handleToggleTransient,
    }),
    [expandObjects, expandArrays, transientExpandedSet, handleToggleTransient],
  )

  // Stable ref for onCrossDatasetNavigate to avoid rebuild cascades
  const onCrossDatasetNavigateRef = useRef(onCrossDatasetNavigate)
  onCrossDatasetNavigateRef.current = onCrossDatasetNavigate

  // Stable refs for media library and inaccessible project callbacks
  const onMediaLibraryClickRef = useRef(onMediaLibraryClick)
  onMediaLibraryClickRef.current = onMediaLibraryClick
  const onInaccessibleClickRef = useRef(onInaccessibleClick)
  onInaccessibleClickRef.current = onInaccessibleClick

  // Focus mode state
  const focusStateRef = useRef<{typeName: string; depth: 0 | 1 | 2} | null>(null)
  const [focusState, setFocusState] = useState<{
    typeName: string
    depth: 0 | 1 | 2
  } | null>(null)
  // Keep the focus ref in sync so ref-based readers (e.g. applyLayout via
  // resolveCuratedPositions) see the current focus without a re-render.
  focusStateRef.current = focusState
  // Search/filter state
  const [searchQuery, setSearchQuery] = useState('')
  const allTypesRef = useRef(types)
  allTypesRef.current = types
  const searchLayoutOverrideRef = useRef<{ layout: LayoutType; spacing: number } | null>(null)
  const preFocusLayoutRef = useRef<{ layout: LayoutType; spacing: number } | null>(null)

  // Cache focus state per schema so switching back restores it
  const focusCacheRef = useRef<Map<string, { typeName: string; depth: 1 | 2 }>>(new Map())
  const prevTypesKeyRef = useRef<string>(typesKey(types))

  const focusHistoryRef = useRef<string[]>([]) // stack of previous focusedType names

  // Handle programmatic focus from cross-dataset navigation
  const pendingFocusHandledRef = useRef<string | null>(null)
  const handleFocusRef = useRef<((typeName: string, depth: 0 | 1 | 2) => void) | null>(null)
  const handleExitFocusRef = useRef<(() => void) | null>(null)
  useEffect(() => {
    __effLog('line1224');
    if (!pendingFocusType || pendingFocusType === pendingFocusHandledRef.current) return
    // Special sentinel: clear focus and restore full graph
    if (pendingFocusType === '__clear__') {
      pendingFocusHandledRef.current = pendingFocusType
      handleExitFocusRef.current?.()
      return
    }
    // Wait for layout to complete before applying focus — otherwise fitView races with focus
    if (!layoutApplied) return
    // Check if the target type exists in current types
    const targetExists = types.some(t => t.name === pendingFocusType)
    if (targetExists && handleFocusRef.current) {
      pendingFocusHandledRef.current = pendingFocusType
      // Small delay for fitView animation to finish, then apply focus
      setTimeout(() => {
        handleFocusRef.current?.(pendingFocusType, pendingFocusDepth)
      }, 100)
    }
  }, [pendingFocusType, pendingFocusDepth, types, layoutApplied])

  // Restore viewport from back navigation
  // skipFitViewRef declared here (before synchronous check) to avoid TDZ error
  const skipFitViewRef = useRef(false)
  // Set skipFitView SYNCHRONOUSLY during render so it's true before any layout effect fires
  const restoreViewportHandledRef = useRef<string | null>(null)
  if (restoreViewport) {
    const key = `${restoreViewport.x},${restoreViewport.y},${restoreViewport.zoom}`
    if (key !== restoreViewportHandledRef.current) {
      skipFitViewRef.current = true
    }
  }
  useEffect(() => {
    __effLog('line1256');
    if (!restoreViewport) {
      skipFitViewRef.current = false
      return
    }
    const key = `${restoreViewport.x},${restoreViewport.y},${restoreViewport.zoom}`
    if (key === restoreViewportHandledRef.current) return
    restoreViewportHandledRef.current = key
    // Wait for layout to settle, then restore viewport
    setTimeout(() => {
      setViewport(restoreViewport, { duration: 300 })
      // Clear the flag after viewport is restored
      setTimeout(() => { skipFitViewRef.current = false }, 400)
    }, 500)
  }, [restoreViewport, setViewport])


  // Instant viewport nudge (for nav collapse/expand center compensation)
  const nudgeTriggerRef = useRef(0)
  useEffect(() => {
    __effLog('line1275');
    if (!viewportNudge || viewportNudge.trigger === nudgeTriggerRef.current) return
    nudgeTriggerRef.current = viewportNudge.trigger
    const vp = getViewport()
    setViewport({ x: vp.x, y: vp.y + viewportNudge.dy, zoom: vp.zoom }, { duration: 0 })
  }, [viewportNudge, getViewport, setViewport])
  const [contextMenu, setContextMenu] = useState<{
    x: number
    y: number
    typeName: string
  } | null>(null)
  const preFocusNodesRef = useRef<SchemaNode_RF[] | null>(null)
  const preFocusEdgesRef = useRef<SchemaEdge[] | null>(null)

  const { nodes: initialNodes, edges: initialEdges } = useMemo(
    () => buildNodesAndEdges(types, edgeStyleRef.current, { onCrossDatasetNavigate: onCrossDatasetNavigateRef.current, onMediaLibraryClick: onMediaLibraryClickRef.current, onInaccessibleClick: onInaccessibleClickRef.current, accessibleProjectIds, typeKinds: fullTypeKinds }),
    [types],
  )

  const [nodes, setNodes, onNodesChange] = useNodesState<SchemaNode_RF>(initialNodes)
  const [edges, setEdges, onEdgesChange] = useEdgesState<SchemaEdge>(initialEdges)

  const [spacingMap, setSpacingMap] = useState<Record<LayoutType, number>>(() => {
    const defaults: Record<LayoutType, number> = { dagre: 0.8, layered: 0.3, force: 0.2, stress: 1.3 }
    try {
      const saved = localStorage.getItem('schema-mapper:spacingMap')
      if (saved) {
        const parsed = JSON.parse(saved)
        Object.keys(defaults).forEach(k => {
          const key = k as LayoutType
          if (typeof parsed[key] === 'number') defaults[key] = parsed[key]
        })
      }
    } catch {}
    return defaults
  })
  const spacing = spacingMap[layoutType]

  const handleEdgeStyleChange = useCallback((style: EdgeStyle) => {
    setEdgeStyle(style)
    try { localStorage.setItem('schema-mapper:edgeStyle', style) } catch {}
    setEdges((eds) => eds.map(e => ({ ...e, type: 'floating', data: { ...e.data, edgeStyle: style } })))
  }, [setEdges])



  // Re-sync when types change (e.g. switching dataset/schema)
  useEffect(() => {
    __effLog('line1322');
    const newKey = typesKey(types)
    const oldKey = prevTypesKeyRef.current

    // Save current focus under old key
    if (focusState && oldKey !== newKey) {
      focusCacheRef.current.set(oldKey, { typeName: focusState.typeName, depth: focusState.depth })
    }

    setSearchQuery('')
    setContextMenu(null)
    preFocusNodesRef.current = null
    preFocusEdgesRef.current = null
    prevTypesKeyRef.current = newKey

    // Check if we have a cached focus for the new types
    const cached = focusCacheRef.current.get(newKey)
    if (cached) {
      // Verify the focused type still exists in the new types
      const typeExists = types.some(t => t.name === cached.typeName)
      if (typeExists) {
        setFocusState(cached)
        const included = getNeighbourhood(types, cached.typeName, cached.depth)
        const filteredTypes = types.filter(t => included.has(t.name))
        const visibleNames = new Set(filteredTypes.map(t => t.name))
        const { nodes: subsetNodes, edges: subsetEdges } = buildNodesAndEdges(filteredTypes, edgeStyleRef.current, {
          onReferenceClick: (ref: string) => handleReferenceNavigateRef.current(ref),
          onCrossDatasetNavigate: onCrossDatasetNavigateRef.current,
          onMediaLibraryClick: onMediaLibraryClickRef.current,
          onInaccessibleClick: onInaccessibleClickRef.current,
          accessibleProjectIds,
          visibleTypeNames: visibleNames,
          typeKinds: fullTypeKinds,
        })
        setNodes(subsetNodes)
        setEdges(subsetEdges)
        setLayoutApplied(false)
        return
      }
      focusCacheRef.current.delete(newKey)
    }

    setFocusState(null)
    const { nodes: newNodes, edges: newEdges } = buildNodesAndEdges(types, edgeStyleRef.current, { onCrossDatasetNavigate: onCrossDatasetNavigateRef.current, onMediaLibraryClick: onMediaLibraryClickRef.current, onInaccessibleClick: onInaccessibleClickRef.current, accessibleProjectIds, typeKinds: fullTypeKinds })
    setNodes(newNodes)
    setEdges(newEdges)
    setLayoutApplied(false)
  }, [types, setNodes, setEdges])

  // Search filter — rebuild graph with matching types
  const isSearching = searchQuery.trim().length > 0

  // Track viewport continuously for navigation save/restore
  const viewportRef = useRef<{ x: number; y: number; zoom: number }>({ x: 0, y: 0, zoom: 1 })
  const onViewportChangeRef = useRef<((v: { x: number; y: number; zoom: number }) => void) | null>(null)
  onViewportChangeRef.current = onViewportChange ?? null
  const handleMoveEnd = useCallback((_: any, viewport: { x: number; y: number; zoom: number }) => {
    viewportRef.current = viewport
    // Update parent's viewport ref without triggering full state change
    onViewportChangeRef.current?.(viewport)
  }, [])

  // Notify parent of state changes
  useEffect(() => {
    __effLog('line1385');
    onStateChange?.({
      focusedType: focusState?.typeName,
      focusDepth: focusState?.depth,
      isSearching,
      visibleTypeCount: nodes.length,
      viewport: viewportRef.current,
      edgeStyle,
      spacing,
      expandObjects,
      expandArrays,
      transientExpanded,
    })
  }, [focusState, isSearching, nodes.length, onStateChange, edgeStyle, spacing, expandObjects, expandArrays, transientExpanded])

  const handleSearchChange = useCallback((query: string) => {
    setSearchQuery(query)
    // Exit focus mode when searching
    if (focusState) {
      focusCacheRef.current.delete(typesKey(types))
      setFocusState(null)
      setContextMenu(null)
      preFocusNodesRef.current = null
      preFocusEdgesRef.current = null
    }
    if (!query.trim()) {
      // Restore full graph with user's layout
      searchLayoutOverrideRef.current = null
      const { nodes: newNodes, edges: newEdges } = buildNodesAndEdges(types, edgeStyleRef.current, { onCrossDatasetNavigate: onCrossDatasetNavigateRef.current, onMediaLibraryClick: onMediaLibraryClickRef.current, onInaccessibleClick: onInaccessibleClickRef.current, accessibleProjectIds, typeKinds: fullTypeKinds })
      setNodes(newNodes)
      setEdges(newEdges)
      setLayoutApplied(false)
      return
    }
    const q = query.toLowerCase()
    const filtered = types.filter(t =>
      t.name.toLowerCase().includes(q) ||
      (t.title && t.title.toLowerCase().includes(q)) ||
      t.fields.some(f => f.name.toLowerCase().includes(q))
    )
    const { nodes: subsetNodes, edges: subsetEdges } = buildNodesAndEdges(filtered, edgeStyleRef.current, { onCrossDatasetNavigate: onCrossDatasetNavigateRef.current, onMediaLibraryClick: onMediaLibraryClickRef.current, onInaccessibleClick: onInaccessibleClickRef.current, accessibleProjectIds, typeKinds: fullTypeKinds })
    setNodes(subsetNodes)
    setEdges(subsetEdges)
    // Force layered layout with default spacing for search results
    searchLayoutOverrideRef.current = { layout: 'layered', spacing: DEFAULT_SPACING.layered }
    setLayoutApplied(false)
  }, [types, focusState, setNodes, setEdges])

  const handleSearchClear = useCallback(() => {
    setSearchQuery('')
    searchLayoutOverrideRef.current = null
    const { nodes: newNodes, edges: newEdges } = buildNodesAndEdges(types, edgeStyleRef.current, { onCrossDatasetNavigate: onCrossDatasetNavigateRef.current, onMediaLibraryClick: onMediaLibraryClickRef.current, onInaccessibleClick: onInaccessibleClickRef.current, accessibleProjectIds, typeKinds: fullTypeKinds })
    setNodes(newNodes)
    setEdges(newEdges)
    setLayoutApplied(false)
  }, [types, setNodes, setEdges])

  // Apply ELK layout once nodes have been measured.
  //
  // "original" layout uses either curatedActive (when a curated layout is
  // active) or the outer initialPositions (Submitted). Curated wins.
  //
  // For curated: we read positions from curatedActive.views keyed by our
  // OWN internal focus state, so a focus change doesn't need a round-trip
  // through the parent to update positions.
  const curatedViews = curatedActive?.views
  const curatedViewsRef = useRef(curatedViews)
  curatedViewsRef.current = curatedViews
  // Assigned below once focusState is declared
  const curatedFallbackPositions = curatedActive?.positions
  const initialPositionsRef = useRef(initialPositions)
  initialPositionsRef.current = initialPositions
  const curatedFallbackPositionsRef = useRef(curatedFallbackPositions)
  curatedFallbackPositionsRef.current = curatedFallbackPositions
  const curatedActiveRef = useRef(curatedActive)
  curatedActiveRef.current = curatedActive

  // Legacy shape used by callers that don't set views (backwards compat)
  const effectiveOriginalPositions = curatedActive?.positions || initialPositions

  const effectivePositionsRef = useRef(effectiveOriginalPositions)
  effectivePositionsRef.current = effectiveOriginalPositions

  // Compute positions to use right now — internal focus state drives view
  // key selection when curatedActive.views is provided.
  const resolveCuratedPositions = useCallback((): Record<string, {x: number; y: number}> | undefined => {
    const active = curatedActiveRef.current
    if (!active) return initialPositionsRef.current
    const views = curatedViewsRef.current
    if (views) {
      const fs = focusStateRef.current
      const viewKey = fs ? `${fs.typeName}:${fs.depth}` : '__full'
      const v = views[viewKey]
      if (v) return v.nodePositions
      // No saved view for this focus — return empty so caller falls back to ELK
      return undefined
    }
    return curatedFallbackPositionsRef.current
  }, [])

  // Request counter — each applyLayout call takes a token, and only writes
  // its result back if the token still matches. Guards against async ELK
  // resolving AFTER a newer applyLayout has already set correct positions.
  const applyLayoutGenRef = useRef(0)

  const applyLayout = useCallback(async (
    currentNodes: SchemaNode_RF[],
    currentEdges: SchemaEdge[],
    layout: LayoutType,
    currentSpacing: number,
    skipAnimation = false,
  ) => {
    const myGen = ++applyLayoutGenRef.current
    setIsLayouting(true)
    try {
      let layoutedNodes: SchemaNode_RF[]
      // Read positions fresh — either from internal focus state via curated
      // views map, or from legacy effectivePositionsRef (Submitted / callers
      // without views). Keyed by our OWN focus state, so no lag.
      const originalPositions = resolveCuratedPositions() ?? effectivePositionsRef.current
      // When curated is active AND we have saved positions for the current
      // view, ALWAYS use them regardless of layoutType. The curated-active
      // effect fires setLayoutType('original') but effect ordering means
      // this applyLayout call can see a stale layoutType (e.g. 'force' from
      // a prior handleFocus). Gating on the curated intent directly is the
      // reliable path — a curated layout by definition means "use stored
      // positions verbatim", never re-layout.
      const useCuratedPositions = !!curatedActiveRef.current && originalPositions && Object.keys(originalPositions).length > 0
      if ((layout === 'original' || useCuratedPositions) && originalPositions && Object.keys(originalPositions).length > 0) {
        // When focused (either a live user focus, or the submitted initial
        // focus that hasn't been exited), filter the type set to that
        // neighbourhood before applying stored positions. Without this,
        // types outside the focus render with their existing (arbitrary)
        // positions and produce a visible re-layout — most obviously when
        // "Copy this view to a new layout" is invoked from a focused
        // Submitted view: the seeded positions only cover the subset, so
        // every other node would fall to a default arrangement.
        //
        // Precedence: live focusStateRef wins (user is focused). Else the
        // submission's initialFocusState applies ONLY when no curated view
        // is active (in curated mode, the view's own subset is authoritative
        // and initialFocusState is irrelevant).
        const focusForFilter =
          focusStateRef.current
            ?? (!curatedActiveRef.current ? initialFocusState : null)
            ?? null
        let nodesToLayout = currentNodes
        let edgesToSet = currentEdges
        if (focusForFilter) {
          const neighbourhood = getNeighbourhood(types, focusForFilter.typeName, focusForFilter.depth)
          nodesToLayout = currentNodes.filter(n => neighbourhood.has(n.id))
          edgesToSet = currentEdges.filter(e => neighbourhood.has(e.source) && neighbourhood.has(e.target))
          if (myGen !== applyLayoutGenRef.current) return
          setEdges(edgesToSet as any)
        }
        // Restore stored positions verbatim
        layoutedNodes = nodesToLayout.map(n => ({
          ...n,
          position: originalPositions[n.id] || n.position,
        }))
      } else if (layout === 'dagre') {
        const result = getDagreLayout(currentNodes, currentEdges, currentSpacing)
        layoutedNodes = result.nodes
      } else {
        const result = await getElkLayout(currentSpacing, currentNodes, currentEdges, layout)
        // Bail if a newer applyLayout has been kicked off while ELK was running.
        if (myGen !== applyLayoutGenRef.current) return
        layoutedNodes = result.nodes
      }
      if (myGen !== applyLayoutGenRef.current) return
      setNodes(layoutedNodes as any)
      setLayoutApplied(true)

      if (!skipFitViewRef.current) {
        window.requestAnimationFrame(() => {
          if (myGen !== applyLayoutGenRef.current) return
          fitView({ padding: 0.22, duration: skipAnimation ? 0 : 300 })
        })
      }
    } catch (err) {
      console.error('ELK layout failed:', err)
    } finally {
      if (myGen === applyLayoutGenRef.current) setIsLayouting(false)
    }
  }, [setNodes, setEdges, fitView, initialFocusState, types, resolveCuratedPositions])

  const debouncedApplyLayout = useMemo(
    () => debounce(
      (n: SchemaNode_RF[], e: SchemaEdge[], l: LayoutType, s: number) => applyLayout(n, e, l, s, true),
      25
    ),
    [applyLayout]
  )

  // Update edge types when style changes
  useEffect(() => {
    __effLog('line1580');
    setEdges((eds) => eds.map(e => ({ ...e, type: 'floating', data: { ...e.data, edgeStyle } })))
  }, [edgeStyle, setEdges])

  // Initial layout after nodes are measured
  useEffect(() => {
    console.log('[SG.initialLayout effect]', {nodesInitialized, layoutApplied, nodesCount: nodes.length})
    if (nodesInitialized && !layoutApplied) {
      const override = searchLayoutOverrideRef.current
      if (override) {
        applyLayout(nodes as SchemaNode_RF[], edges, override.layout, override.spacing)
      } else {
        applyLayout(nodes as SchemaNode_RF[], edges, layoutType, spacing)
      }
    }
  }, [nodesInitialized, layoutApplied, nodes, edges, layoutType, spacing, applyLayout])

  // ---- Curated layout: react to activation/deactivation and view changes ----
  //
  // When curatedActive is set (or changes id/viewKey), force layout='original'
  // and reset layoutApplied — the initial-layout effect re-runs, calling
  // applyLayout('original', ...) which reads effectiveOriginalPositions and
  // snaps to the curated positions. Same code path as Submitted.
  //
  // When curatedActive is cleared, restore the previously-selected algo
  // from localStorage (which the caller may have just written) or fall back
  // to a sensible default.
  const curatedActiveId = curatedActive?.id ?? null
  const curatedActiveViewKey = curatedActive?.viewKey ?? null
  const prevCuratedIdRef = useRef<string | null>(null)

  useEffect(() => {
    console.log('[SG.curatedActive effect]', {curatedActiveId, curatedActiveViewKey, curatedRestoreVersion, prev: prevCuratedIdRef.current})
    const prev = prevCuratedIdRef.current
    prevCuratedIdRef.current = curatedActiveId

    // Layout selection changed (either direction, or between two layouts) —
    // exit any active focus properly (rebuild full graph, restore pre-focus
    // layout). Just calling setFocusState(null) would clear the state var
    // but leave the subset nodes/edges rendered — half-exited limbo.
    //
    // EXCEPTION: null → <newLayoutId> is a fresh create/select from an algo
    // view. If the user was focused, that focus IS the sub-view we just
    // saved — exiting focus would clobber the current view and swap in an
    // empty __full view. Leave focus alone in that direction.
    if (prev !== curatedActiveId && prev !== null) {
      handleExitFocusRef.current?.()
    }

    if (curatedActive) {
      // Restore stored edge style if it differs.
      if (edgeStyleRef.current !== curatedActive.edgeStyle) {
        setEdgeStyle(curatedActive.edgeStyle)
        edgeStyleRef.current = curatedActive.edgeStyle
      }
      // Force 'original' + trigger re-layout via layoutApplied=false.
      setLayoutType('original')
      setLayoutApplied(false)
    } else if (prev) {
      // Curated cleared — pick the algo the caller wants us to run.
      let target: LayoutType = layoutType
      try {
        const saved = localStorage.getItem('schema-mapper:layoutType') as LayoutType | null
        if (saved && ['dagre', 'layered', 'force', 'stress'].includes(saved)) {
          target = saved
        }
      } catch {}
      if (target === 'original' && !(initialPositions && Object.keys(initialPositions).length > 0)) {
        target = 'force'
      }
      // Restore edge style based on target:
      // - Submitted (original): use the submission's initialEdgeStyle
      // - Algo (force/layered/dagre/stress): use the user's saved algo style
      // Falling back to localStorage-saved style either way.
      try {
        const savedStyle = localStorage.getItem('schema-mapper:edgeStyle') as EdgeStyle | null
        const preferred: EdgeStyle | null =
          target === 'original' && initialEdgeStyle
            ? initialEdgeStyle
            : savedStyle && ['bezier', 'step', 'straight'].includes(savedStyle)
              ? savedStyle
              : null
        if (preferred && preferred !== edgeStyleRef.current) {
          setEdgeStyle(preferred)
          edgeStyleRef.current = preferred
        }
      } catch {}
      setLayoutType(target)
      setLayoutApplied(false)
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curatedActiveId, curatedActiveViewKey, curatedRestoreVersion])

  // ---- Curated positions changed ----
  //
  // Re-apply layout when the underlying curated positions data changes.
  // With the views-map approach this fires when any saved view changes
  // (e.g. after save-back from a drag). Fingerprint covers all views so
  // we notice when the parent updates the layout doc after a save.
  const curatedFingerprint = curatedActive
    ? (curatedActive.views
        ? JSON.stringify(Object.keys(curatedActive.views).sort().map(k => [k, Object.keys(curatedActive.views![k].nodePositions).length]))
        : Object.keys(curatedActive.positions).length.toString())
    : ''
  const prevCuratedFingerprintRef = useRef(curatedFingerprint)
  useEffect(() => {
    __effLog('line1685');
    if (!curatedActive) {
      prevCuratedFingerprintRef.current = ''
      return
    }
    if (prevCuratedFingerprintRef.current === curatedFingerprint) return
    prevCuratedFingerprintRef.current = curatedFingerprint
    // Re-apply the layout so the fresh positions land.
    setLayoutType('original')
    setLayoutApplied(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [curatedFingerprint])

  // ---- Imperative focus restore (curated layout re-selection) ----
  //
  // When `restoreFocusVersion` changes, apply `restoreFocus`. This runs
  // AFTER the curated-active effect above has already exited any previous
  // focus, so we start from a clean full-graph state.
  const prevRestoreVersionRef = useRef<number | undefined>(undefined)
  useEffect(() => {
    console.log('[SG.restoreFocus effect]', {restoreFocusVersion, restoreFocus, prev: prevRestoreVersionRef.current})
    if (restoreFocusVersion === undefined) return
    if (prevRestoreVersionRef.current === restoreFocusVersion) return
    prevRestoreVersionRef.current = restoreFocusVersion
    if (restoreFocus && handleFocusRef.current) {
      // Small delay so any layout-selection re-layout can settle first.
      const t = setTimeout(() => {
        handleFocusRef.current?.(restoreFocus.typeName, restoreFocus.depth)
      }, 50)
      return () => clearTimeout(t)
    }
  }, [restoreFocusVersion, restoreFocus])

  // Re-layout when layout type changes
  const handleLayoutChange = useCallback((newLayout: LayoutType) => {
    // If the user has a live focus, exit it first. Applies to ANY layout switch —
    // algo→algo, focused-curated→Submitted, focused-algo→Submitted, etc.
    // handleExitFocus restores the pre-focus full graph and clears focusState so
    // the target layout renders the whole schema (or the initialFocusState
    // neighbourhood for Submitted, if set).
    if (focusState) {
      handleExitFocusRef.current?.()
    }
    // When a curated layout is active, tapping an algo tab (or Submitted) exits
    // the layout and applies the algo. (Simple + expected — users don't want a
    // prompt.)
    if (curatedActive && newLayout !== 'original' && onCuratedExitForAlgo) {
      onCuratedExitForAlgo()
      // Write the chosen algo so the curated-deactivation effect picks it up.
      try { localStorage.setItem('schema-mapper:layoutType', newLayout) } catch {}
      return
    }
    if (curatedActive && newLayout === 'original' && onCuratedExitForAlgo) {
      // Submitted from a curated layout — exit curated so the parent stops
      // treating it as active, and let the deactivation effect fall through
      // to 'original' (which serves Submitted positions).
      // Also restore the submission's initialEdgeStyle so Submitted always
      // renders with its own line type, not whatever the curated layout
      // was using.
      if (initialEdgeStyle && edgeStyleRef.current !== initialEdgeStyle) {
        setEdgeStyle(initialEdgeStyle)
        edgeStyleRef.current = initialEdgeStyle
      }
      onCuratedExitForAlgo()
      try { localStorage.setItem('schema-mapper:layoutType', 'original') } catch {}
      return
    }
    debouncedApplyLayout.cancel()
    setLayoutType(newLayout)
    try { localStorage.setItem('schema-mapper:layoutType', newLayout) } catch {}
    // Restore customer's edge style when switching to Submitted
    if (newLayout === 'original' && initialEdgeStyle) {
      setEdgeStyle(initialEdgeStyle)
      edgeStyleRef.current = initialEdgeStyle
      // Rebuild edges with the restored style so they render correctly
      const { nodes: rebuiltNodes, edges: rebuiltEdges } = buildNodesAndEdges(types, initialEdgeStyle, { onCrossDatasetNavigate: onCrossDatasetNavigateRef.current, onMediaLibraryClick: onMediaLibraryClickRef.current, onInaccessibleClick: onInaccessibleClickRef.current, accessibleProjectIds, typeKinds: fullTypeKinds })
      setNodes(rebuiltNodes)
      setEdges(rebuiltEdges)
      applyLayout(rebuiltNodes, rebuiltEdges, newLayout, spacingMap[newLayout])
      return
    }
    // When switching away from original+initialFocusState, rebuild full graph
    // BUT only if user hasn't manually focused a type (focusState is active user focus)
    if (newLayout !== 'original' && initialFocusState && !focusState) {
      const { nodes: fullNodes, edges: fullEdges } = buildNodesAndEdges(types, edgeStyleRef.current, { onCrossDatasetNavigate: onCrossDatasetNavigateRef.current, onMediaLibraryClick: onMediaLibraryClickRef.current, onInaccessibleClick: onInaccessibleClickRef.current, accessibleProjectIds, typeKinds: fullTypeKinds })
      setNodes(fullNodes)
      setEdges(fullEdges)
      applyLayout(fullNodes, fullEdges, newLayout, spacingMap[newLayout])
    } else {
      applyLayout(nodes as SchemaNode_RF[], edges, newLayout, spacingMap[newLayout])
    }
  }, [nodes, edges, spacingMap, applyLayout, debouncedApplyLayout, initialEdgeStyle, setEdgeStyle, initialFocusState, focusState, types, setNodes, setEdges, curatedActive, onCuratedExitForAlgo])

  const handleSpacingChange = useCallback((value: number) => {
    setSpacingMap(prev => {
      const next = { ...prev, [layoutType]: value }
      try { localStorage.setItem('schema-mapper:spacingMap', JSON.stringify(next)) } catch {}
      return next
    })
    debouncedApplyLayout(nodes as SchemaNode_RF[], edges, layoutType, value)
  }, [nodes, edges, layoutType, debouncedApplyLayout])

  const handleResetSpacing = useCallback(() => {
    const defaultVal = DEFAULT_SPACING[layoutType]
    handleSpacingChange(defaultVal)
  }, [layoutType, handleSpacingChange])

  // Focus mode handlers
  const handleFocus = useCallback((typeName: string, depth: 0 | 1 | 2) => {
    // Cancel any in-flight applyLayout — its late setNodes would clobber
    // the focused subset we're about to render. Race-critical on large
    // graphs where ELK takes longer than the focus-restore setTimeout.
    applyLayoutGenRef.current++
    // If searching, clear search and rebuild full graph first so pre-focus state is the full graph
    if (searchQuery.trim()) {
      setSearchQuery('')
      searchLayoutOverrideRef.current = null
      const { nodes: fullNodes, edges: fullEdges } = buildNodesAndEdges(types, edgeStyleRef.current, { onCrossDatasetNavigate: onCrossDatasetNavigateRef.current, onMediaLibraryClick: onMediaLibraryClickRef.current, onInaccessibleClick: onInaccessibleClickRef.current, accessibleProjectIds, typeKinds: fullTypeKinds })
      preFocusNodesRef.current = fullNodes
      preFocusEdgesRef.current = fullEdges as SchemaEdge[]
    } else if (!focusState) {
      // Save current state if not already focused
      preFocusNodesRef.current = nodes as SchemaNode_RF[]
      preFocusEdgesRef.current = edges as SchemaEdge[]
    }

    // Save current layout settings so we can restore on exit
    if (!focusState) {
      preFocusLayoutRef.current = { layout: layoutType, spacing: spacing }
    }
    // If on Submitted layout, switch to force for focus (positions don't apply to subsets)
    // EXCEPTION: when curated is active, curatedActive.positions is view-specific
    // (keyed by focus signature), so 'original' can restore the correct subset positions.
    if (layoutType === 'original' && !curatedActive) {
      setLayoutType('force')
      searchLayoutOverrideRef.current = { layout: 'force', spacing: DEFAULT_SPACING.force }
    }

    setFocusState({ typeName, depth })

    // Get neighbourhood
    const included = getNeighbourhood(types, typeName, depth)

    // Filter to subset
    const filteredTypes = types.filter(t => included.has(t.name))
    const visibleNames = new Set(filteredTypes.map(t => t.name))
    const { nodes: subsetNodes, edges: subsetEdges } = buildNodesAndEdges(filteredTypes, edgeStyleRef.current, {
      onReferenceClick: (ref: string) => handleReferenceNavigateRef.current(ref),
      onCrossDatasetNavigate: onCrossDatasetNavigateRef.current,
      onMediaLibraryClick: onMediaLibraryClickRef.current,
      onInaccessibleClick: onInaccessibleClickRef.current,
      accessibleProjectIds,
      visibleTypeNames: visibleNames,
          typeKinds: fullTypeKinds,
    })

    setNodes(subsetNodes)
    setEdges(subsetEdges)

    // Re-layout the subset
    setLayoutApplied(false)
  }, [types, nodes, edges, focusState, searchQuery, layoutType, spacing, setNodes, setEdges, curatedActive])
  handleFocusRef.current = handleFocus

  // Ref-stable callback for reference navigation (avoids circular deps)
  const handleReferenceNavigateRef = useRef<(referenceTo: string) => void>(() => {})

  // Navigate focus to a referenced type (from orphaned ref lozenge)
  const handleReferenceNavigate = useCallback((referenceTo: string) => {
    // Only works when focused
    if (!focusState) return
    // Verify the target type exists in the full type set
    if (!types.some(t => t.name === referenceTo)) return
    // Push current focus to history
    focusHistoryRef.current = [...focusHistoryRef.current, focusState.typeName]
    // Focus on the new type at depth 0 (isolated)
    handleFocus(referenceTo, 0)
  }, [focusState, types, handleFocus])

  // Keep ref in sync
  handleReferenceNavigateRef.current = handleReferenceNavigate

  // Go back in focus history
  const handleFocusBack = useCallback(() => {
    const history = focusHistoryRef.current
    if (history.length === 0) return
    const prev = history[history.length - 1]
    focusHistoryRef.current = history.slice(0, -1)
    handleFocus(prev, 0)
  }, [handleFocus])

  const handleExitFocus = useCallback(() => {
    // Clear cached focus and history for current types
    focusCacheRef.current.delete(typesKey(types))
    focusHistoryRef.current = []
    setFocusState(null)

    // Restore pre-focus layout settings
    if (preFocusLayoutRef.current) {
      setLayoutType(preFocusLayoutRef.current.layout)
      searchLayoutOverrideRef.current = null
    }
    preFocusLayoutRef.current = null

    // Restore pre-focus state and re-apply layout.
    //
    // Rebuild from `types` rather than trusting preFocusNodesRef —
    // that ref can hold a subset when the graph was mounted into a
    // subset context (e.g. Submitted with initialFocusState, or when
    // handleFocus imperatively fired before the graph ever showed the
    // full set). Rebuilding from `types` is the source of truth for
    // "the full graph."
    const { nodes: fullNodes, edges: fullEdges } = buildNodesAndEdges(types, edgeStyleRef.current, {
      onCrossDatasetNavigate: onCrossDatasetNavigateRef.current,
      onMediaLibraryClick: onMediaLibraryClickRef.current,
      onInaccessibleClick: onInaccessibleClickRef.current,
      accessibleProjectIds,
    })
    setNodes(fullNodes as any)
    setEdges(fullEdges as any)
    preFocusNodesRef.current = null
    preFocusEdgesRef.current = null

    // Trigger re-layout so the restored layout type is actually applied
    setLayoutApplied(false)
  }, [setNodes, setEdges, types, accessibleProjectIds])
  handleExitFocusRef.current = handleExitFocus

  const handleExpandDepth = useCallback(() => {
    if (!focusState) return
    const newDepth = Math.min(focusState.depth + 1, 2) as 0 | 1 | 2
    handleFocus(focusState.typeName, newDepth)
  }, [focusState, handleFocus])

  const handleFocusDepth = useCallback(() => {
    if (!focusState) return
    const newDepth = Math.max(focusState.depth - 1, 0) as 0 | 1 | 2
    handleFocus(focusState.typeName, newDepth)
  }, [focusState, handleFocus])

  // Escape key exits focus mode
  useEffect(() => {
    __effLog('line1926');
    if (!focusState) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') handleExitFocus()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [focusState, handleExitFocus])

  return (
    <ExpandContext.Provider value={expandContextValue}>
    <div ref={containerRef} className={`relative w-full h-full ${curatedActive && !curatedEditable && !curatedReadOnly ? 'schema-graph-locked' : ''} ${curatedActive && curatedReadOnly ? 'schema-graph-readonly' : ''}`}>
      <style>{`
        /* Locked curated layout: node body shows the "no-touch" cursor,
           but reference-link rows and cross-dataset/media/inaccessible
           lozenges keep their pointer cursor so navigation away from
           the type still works. */
        .schema-graph-locked .react-flow__node {
          cursor: not-allowed !important;
        }
        .schema-graph-locked .react-flow__node .schema-clickable,
        .schema-graph-locked .react-flow__node .schema-clickable *,
        .schema-graph-locked .react-flow__node .cursor-pointer,
        .schema-graph-locked .react-flow__node .cursor-pointer * {
          cursor: pointer !important;
        }
        /* Read-only curated layout (team-shared in customer app): nodes
           can't be dragged or clicked-for-focus, so they get the grab
           cursor like the pan canvas. Reference lozenges + clickables
           keep pointer so navigation still works. */
        .schema-graph-readonly .react-flow__node {
          cursor: grab !important;
        }
        .schema-graph-readonly .react-flow__node:active {
          cursor: grabbing !important;
        }
        .schema-graph-readonly .react-flow__node .schema-clickable,
        .schema-graph-readonly .react-flow__node .schema-clickable *,
        .schema-graph-readonly .react-flow__node .cursor-pointer,
        .schema-graph-readonly .react-flow__node .cursor-pointer * {
          cursor: pointer !important;
        }
      `}</style>
      <GraphControls layout={layoutType} onLayoutChange={handleLayoutChange} edgeStyle={edgeStyle} onEdgeStyleChange={handleEdgeStyleChange} spacing={spacing} onSpacingChange={handleSpacingChange} onResetSpacing={handleResetSpacing} hasOriginalPositions={!!initialPositions && Object.keys(initialPositions).length > 0} disabled={isSearching} curatedActive={!!curatedActive} expandObjects={expandObjects} expandArrays={expandArrays} onExpandObjectsChange={setExpandObjects} onExpandArraysChange={setExpandArrays} />
      {isLayouting && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-10 bg-white/90 dark:bg-gray-900/90 backdrop-blur-sm border rounded-md px-3 py-1 text-xs text-gray-500 dark:text-gray-400">
          Layouting…
        </div>
      )}
      {!focusState && !curatedActive && layoutType === 'original' && initialFocusState && (() => {
        const neighbourhood = getNeighbourhood(types, initialFocusState.typeName, initialFocusState.depth)
        const hiddenCount = types.length - neighbourhood.size
        return (
          <div className="absolute top-3 left-3 z-10 bg-blue-50 dark:bg-blue-900/30 text-blue-700 dark:text-blue-300 text-xs px-3 py-1.5 rounded-md">
            Submitted showing <span className="font-semibold text-blue-800 dark:text-blue-200">{initialFocusState.typeName}</span>{initialFocusState.depth > 0 ? ' and connected types' : ''} · <span className="font-semibold text-blue-800 dark:text-blue-200">{hiddenCount}</span> type{hiddenCount !== 1 ? 's' : ''} hidden
          </div>
        )
      })()}
      {focusState && (
        <FocusBar
          typeName={focusState.typeName}
          depth={focusState.depth}
          connectedCount={nodes.length - 1}
          canExpand={focusState.depth < 2 && getNeighbourhood(types, focusState.typeName, (focusState.depth + 1) as 0 | 1 | 2).size > getNeighbourhood(types, focusState.typeName, focusState.depth).size}
          canFocus={focusState.depth > 0}
          canGoBack={focusHistoryRef.current.length > 0}
          backTypeName={focusHistoryRef.current.length > 0 ? focusHistoryRef.current[focusHistoryRef.current.length - 1] : undefined}
          onClose={handleExitFocus}
          onExpandDepth={handleExpandDepth}
          onFocusDepth={handleFocusDepth}
          onBack={handleFocusBack}
        />
      )}
      {!focusState && (
        <SearchBox
          query={searchQuery}
          onChange={handleSearchChange}
          onClear={handleSearchClear}
          resultCount={nodes.length}
          totalCount={types.length}
          offsetTop={layoutType === 'original' && initialFocusState && !curatedActive ? true : false}
        />
      )}
      <ReactFlow
        nodes={nodes}
        edges={edges}
        onNodesChange={onNodesChange}
        onNodeDragStop={curatedActive && curatedEditable && onCuratedDrag ? () => {
          // Snapshot all current node positions after user finishes a drag.
          // Called once per drag-stop (React Flow guarantees this).
          const positions: Record<string, {x: number; y: number}> = {}
          for (const n of nodes) positions[n.id] = {x: n.position.x, y: n.position.y}
          onCuratedDrag(positions)
        } : undefined}
        nodesDraggable={curatedActive ? !!curatedEditable : true}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        colorMode={isDark ? 'dark' : 'light'}
        fitView
        fitViewOptions={{ padding: 0.22 }}
        panOnScroll
        zoomOnScroll={false}
        zoomOnPinch
        onMoveEnd={handleMoveEnd}
        noPanClassName="react-flow__nopan"
        proOptions={{ hideAttribution: true }}
        minZoom={0.1}
        maxZoom={2}
        defaultEdgeOptions={{
          type: 'floating',
          animated: false,
        }}
        onNodeClick={(event, node) => {
          // Curated layout is active but locked — clicking a node should
          // prompt to unlock instead of opening the focus menu.
          // Exception: curatedReadOnly (team-shared layout in the customer
          // app) — no unlock is possible, so a click is just a no-op.
          if (curatedActive && !curatedEditable && !curatedReadOnly && onLockedInteraction) {
            onLockedInteraction()
            return
          }
          if (curatedActive && !curatedEditable && curatedReadOnly) {
            // Read-only: swallow node clicks silently.
            return
          }
          const bounds = containerRef.current?.getBoundingClientRect()
          if (!bounds) return
          setContextMenu({
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
            typeName: node.id,
          })
        }}
        onNodeContextMenu={(event, node) => {
          event.preventDefault()
          if (curatedActive && !curatedEditable && !curatedReadOnly && onLockedInteraction) {
            onLockedInteraction()
            return
          }
          if (curatedActive && !curatedEditable && curatedReadOnly) {
            return
          }
          const bounds = containerRef.current?.getBoundingClientRect()
          if (!bounds) return
          setContextMenu({
            x: event.clientX - bounds.left,
            y: event.clientY - bounds.top,
            typeName: node.id,
          })
        }}
        onPaneClick={() => {
          setContextMenu(null)
        }}
      >
        <Background gap={16} size={1} color={isDark ? '#1e293b' : '#e2e8f0'} />
        <Controls showInteractive={false} />
        <MiniMap
          nodeStrokeWidth={3}
          nodeColor={isDark ? '#1e3a5f' : '#e0f2fe'}
          maskColor={isDark ? 'rgba(15, 15, 25, 0.7)' : 'rgba(240, 240, 240, 0.7)'}
          pannable
          zoomable
        />
      </ReactFlow>
      {contextMenu && (
        <NodeContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          typeName={contextMenu.typeName}
          onFocus={() => handleFocus(contextMenu.typeName, 0)}
          onExpand={() => handleFocus(contextMenu.typeName, 1)}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
    </ExpandContext.Provider>
  )
}

// ---------------------------------------------------------------------------
// Exported component — wraps with ReactFlowProvider
// ---------------------------------------------------------------------------

export interface SchemaGraphState {
  focusedType?: string
  focusDepth?: 0 | 1 | 2
  isSearching: boolean
  visibleTypeCount: number
  viewport?: { x: number; y: number; zoom: number }
  /** Current edge style — surfaced so consumers (e.g. curated-layout auto-save) can persist it */
  edgeStyle?: 'bezier' | 'step' | 'straight'
  /** Current spacing multiplier — surfaced for curated-layout auto-save */
  spacing?: number
  /** Whether objects render inline expanded (vs collapsed to parent row) */
  expandObjects?: boolean
  /** Whether arrays render inline expanded (vs collapsed to parent row) */
  expandArrays?: boolean
  /** Per-row transient overrides — field paths that have been toggled individually */
  transientExpanded?: string[]
}

export interface SchemaGraphProps {
  types: DiscoveredType[]
  initialPositions?: Record<string, { x: number; y: number }>
  initialEdgeStyle?: 'bezier' | 'step' | 'straight'
  /** Preload expand-objects toggle from persisted view/payload. Undefined = read localStorage default. */
  initialExpandObjects?: boolean
  /** Preload expand-arrays toggle from persisted view/payload. Undefined = read localStorage default. */
  initialExpandArrays?: boolean
  /** Preload per-row transient expansions (field paths). */
  initialTransientExpanded?: string[]
  onStateChange?: (state: SchemaGraphState) => void
  /** Increment to trigger a smooth fitView (e.g. after container resize) */
  fitViewTrigger?: number
  /** When set, the "Submitted" (original) layout shows only the focused neighbourhood */
  initialFocusState?: {
    typeName: string
    depth: 0 | 1 | 2
  }
  /** Callback when a cross-dataset reference lozenge is clicked */
  onCrossDatasetNavigate?: (datasetName: string, typeName?: string, sourceTypeName?: string, projectId?: string) => void
  /** Callback when a media library GDR lozenge is clicked */
  onMediaLibraryClick?: (fieldName: string, typeName: string) => void
  /** Callback when an inaccessible project GDR lozenge is clicked */
  onInaccessibleClick?: (projectName: string, datasetName: string) => void
  /** Set of project IDs the user can access — used to determine inaccessible GDR state */
  accessibleProjectIds?: Set<string>
  /** When set, programmatically focuses on this type (used for cross-dataset navigation) */
  pendingFocusType?: string | null
  /** Depth for pendingFocusType (default: 0) */
  pendingFocusDepth?: 0 | 1 | 2
  /** Called on every viewport change (pan/zoom end) — use for saving viewport without triggering re-renders */
  onViewportChange?: (viewport: { x: number; y: number; zoom: number }) => void
  /** When set, restores this viewport position (used for back navigation) */
  restoreViewport?: { x: number; y: number; zoom: number } | null
  /** Instant viewport Y nudge (for nav collapse/expand center compensation). Increment trigger to apply. */
  viewportNudge?: { dy: number; trigger: number } | null

  // --- Curated Layouts integration (schema-mapper app-level) ---
  /**
   * When set, the graph is displaying a stored curated layout. Positions
   * come from `curatedActive.positions` and are applied verbatim (no
   * algorithm). `viewKey` distinguishes the full-graph vs focused sub-views
   * within the same curated-layout doc.
   */
  curatedActive?: {
    id: string
    viewKey: string
    positions: Record<string, {x: number; y: number}>
    edgeStyle: 'bezier' | 'step' | 'straight'
    spacing: number
    /**
     * Full views map for the active layout, keyed by view key ("__full" or
     * "typeName:depth"). When provided, SchemaGraph reads positions from
     * this map keyed by its OWN internal focus state, side-stepping the
     * parent-emit → parent-recompute → prop-update lag that used to leave
     * layouts applied with stale (previous view's) positions.
     */
    views?: Record<string, {nodePositions: Record<string, {x: number; y: number}>; edgeStyle: 'bezier' | 'step' | 'straight'; spacing: number}>
  } | null
  /**
   * Version counter that consumers bump when they want the graph to
   * re-apply the current `curatedActive` snapshot (positions, edge style,
   * spacing). Used on unlock so that any drift while locked (edge style
   * changes, etc.) is discarded and the saved state is restored.
   */
  curatedRestoreVersion?: number
  /** When true (and curatedActive set), user can drag nodes; positions fire via onCuratedDrag. */
  curatedEditable?: boolean
  /**
   * When true, curated mode is active but the layout is permanently locked
   * (e.g. read-only team-shared layout in the customer app). Suppresses the
   * "no-touch" cursor + the onLockedInteraction call.
   */
  curatedReadOnly?: boolean
  /**
   * Fires (debounced upstream) when the user drags nodes on an editable
   * curated layout. Called with the current position map for ALL nodes on
   * screen. The caller writes it to the appropriate viewKey.
   */
  onCuratedDrag?: (positions: Record<string, {x: number; y: number}>) => void
  /**
   * When curatedActive is set and the user clicks an algorithm tab, this
   * fires INSTEAD of applying the algo. Caller shows a confirm dialog.
   */
  onCuratedExitForAlgo?: () => void
  /** When curated is active + locked, called if the user clicks/interacts with a node. Consumer typically opens an "unlock this layout?" dialog. */
  onLockedInteraction?: () => void
  /**
   * Imperative focus restore. Whenever restoreFocusVersion changes, the
   * graph applies restoreFocus — non-null enters focus on that (type,
   * depth); null exits focus.
   */
  restoreFocus?: { typeName: string; depth: 0 | 1 | 2 } | null
  restoreFocusVersion?: number
}

export function SchemaGraph(props: SchemaGraphProps) {
  if (props.types.length === 0) {
    return (
      <div className="flex items-center justify-center w-full h-full text-gray-400 text-sm">
        No schema types discovered yet.
      </div>
    )
  }

  return (
    <div style={{ width: '100%', height: '100%', minHeight: 500 }}>
      <ReactFlowProvider>
        <SchemaGraphInner {...props} />
      </ReactFlowProvider>
    </div>
  )
}

export default SchemaGraph
