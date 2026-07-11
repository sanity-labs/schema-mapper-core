import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Badge } from './ui/badge';
import { ArrowRight } from 'lucide-react';
import { GoDatabase, GoImage, GoLock } from 'react-icons/go';
import React, { memo, useMemo, useState, useEffect, useRef, useCallback, useContext } from 'react';
import { Tooltip, Box, Text } from '@sanity/ui';
import type { DiscoveredField } from '../types';

// Bounce animation for cross-dataset lozenge arrow on hover
const crossDatasetStyles = `
@keyframes bounceRight {
  0%, 100% { transform: translateX(0); }
  50% { transform: translateX(2px); }
}
`;

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SchemaNodeData = {
  typeName: string;
  documentCount: number;
  fields: DiscoveredField[];
  /**
   * Whether this node represents a document type (default) or a named
   * object type. Object nodes use a different border tone + header pill
   * and don't show a document count.
   */
  kind?: 'document' | 'object';
  hasIncoming?: boolean;
  hasOutgoing?: boolean;
  incomingEdgeCount?: number;
  onReferenceClick?: (referenceTo: string) => void;
  onCrossDatasetNavigate?: (datasetName: string, typeName?: string, sourceTypeName?: string, projectId?: string) => void;
  onMediaLibraryClick?: (fieldName: string, typeName: string) => void;
  onInaccessibleClick?: (projectName: string, datasetName: string) => void;
  accessibleProjectIds?: Set<string>;
  visibleTypeNames?: Set<string>;
  /**
   * Kind lookup for all types in the current view — used by FieldRow to color
   * orphan-target lozenges according to the target's kind (amber for
   * named-object targets, indigo/purple for documents). Populated by
   * buildNodesAndEdges from the types array.
   */
  typeKinds?: Record<string, 'document' | 'object'>;
};

export type SchemaNodeType = Node<SchemaNodeData, 'schema'>;

/**
 * Context surfaced by SchemaGraph so every SchemaNode can read the current
 * expand-mode state without threading it through node.data (which would
 * require rebuilding nodes on every toggle). Nodes re-render when context
 * value changes.
 */
export type ExpandContextValue = {
  expandObjects: boolean;
  expandArrays: boolean;
  transientExpanded: Set<string>;
  onToggleTransient?: (typeName: string, fieldPath: string) => void;
};

export const ExpandContext = React.createContext<ExpandContextValue>({
  expandObjects: false,
  expandArrays: false,
  transientExpanded: new Set(),
});

// ---------------------------------------------------------------------------
// Helpers — field type → badge style
// ---------------------------------------------------------------------------

type BadgeStyle = {
  className: string;
  variant: 'default' | 'secondary' | 'outline' | 'destructive';
};

function fieldBadgeStyle(type: DiscoveredField['type']): BadgeStyle {
  switch (type) {
    case 'string':
    case 'text':
    case 'slug':
      return { className: 'bg-gray-100 text-gray-700 hover:bg-gray-100 border-gray-200 dark:bg-gray-800 dark:text-gray-300 dark:border-gray-700', variant: 'secondary' };
    case 'number':
    case 'boolean':
      return { className: 'bg-blue-100 text-blue-700 hover:bg-blue-100 border-blue-200 dark:bg-blue-900/50 dark:text-blue-300 dark:border-blue-800', variant: 'secondary' };
    case 'datetime':
      return { className: 'bg-purple-100 text-purple-700 hover:bg-purple-100 border-purple-200 dark:bg-purple-900/50 dark:text-purple-300 dark:border-purple-800', variant: 'secondary' };
    case 'image':
      return { className: 'bg-green-100 text-green-700 hover:bg-green-100 border-green-200 dark:bg-green-900/50 dark:text-green-300 dark:border-green-800', variant: 'secondary' };
    case 'reference':
      return { className: 'bg-indigo-100 text-indigo-700 hover:bg-indigo-100 border-indigo-200 dark:bg-indigo-900/50 dark:text-indigo-300 dark:border-indigo-800', variant: 'secondary' };
    case 'array':
      return { className: 'bg-orange-100 text-orange-700 hover:bg-orange-100 border-orange-200 dark:bg-orange-900/50 dark:text-orange-300 dark:border-orange-800', variant: 'secondary' };
    case 'object':
    case 'block':
      return { className: 'bg-amber-100 text-amber-700 hover:bg-amber-100 border-amber-200 dark:bg-amber-900/50 dark:text-amber-300 dark:border-amber-800', variant: 'secondary' };
    case 'url':
      return { className: 'bg-cyan-100 text-cyan-700 hover:bg-cyan-100 border-cyan-200 dark:bg-cyan-900/50 dark:text-cyan-300 dark:border-cyan-800', variant: 'secondary' };
    case 'unknown':
    default:
      return { className: 'text-gray-500 border-gray-300', variant: 'outline' };
  }
}

// ---------------------------------------------------------------------------
// Multi-target reference toggle — collapses 3+ orphan targets into a single
// "→ N types" lozenge that expands to show all of them as stacked lozenge
// pairs (rows of 2), tightly coupled to the toggle so it reads as one unit.
// ---------------------------------------------------------------------------

function MultiTargetPopover({
  targets,
  fieldName,
  onSelect,
  onOpenChange,
}: {
  targets: string[]; // orphan targets (off-canvas) — what we can navigate to
  fieldName: string;
  onSelect: (target: string) => void;
  onOpenChange?: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Notify parent so it can bump the SchemaNode's z-index above siblings.
  useEffect(() => {
    onOpenChange?.(open);
  }, [open, onOpenChange]);

  // Outside-click / Escape to close. Detect against the wrapper ref so a click
  // anywhere outside the lozenge cluster (including on other field rows in
  // the same node, or other nodes) closes the expansion.
  //
  // Uses capture-phase listeners because React Flow's pane handler can
  // intercept bubbling mousedown/pointerdown events on the canvas. Capture
  // fires before any node-tree handler.
  useEffect(() => {
    if (!open) return;
    const onDocDown = (e: Event) => {
      const target = e.target as unknown as globalThis.Node;
      if (!wrapperRef.current?.contains(target)) setOpen(false);
    };
    const onEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    // Defer one tick so the click that opened doesn't immediately close
    const t = setTimeout(() => {
      document.addEventListener('mousedown', onDocDown, true);
      document.addEventListener('pointerdown', onDocDown, true);
      document.addEventListener('keydown', onEsc, true);
    }, 0);
    return () => {
      clearTimeout(t);
      document.removeEventListener('mousedown', onDocDown, true);
      document.removeEventListener('pointerdown', onDocDown, true);
      document.removeEventListener('keydown', onEsc, true);
    };
  }, [open]);

  // Group targets into pairs for the stacked-rows-of-2 layout.
  const pairs: string[][] = [];
  for (let i = 0; i < targets.length; i += 2) {
    pairs.push(targets.slice(i, i + 2));
  }

  return (
    <div
      ref={wrapperRef}
      // Anchor the wrapper so the *toggle* (the first child) stays vertically
      // centered on the field row regardless of whether the expansion is open.
      // Toggle is ~20px tall → offset by half that from the row center.
      // We don't use top-1/2 -translate-y-1/2 because that re-centers the
      // *entire* wrapper (toggle + expanded list) and drifts the toggle off
      // the row when the list grows.
      className="absolute right-0 translate-x-[calc(100%+8px)] flex flex-col items-start gap-1.5"
      style={{ top: 'calc(50% - 10px)', zIndex: open ? 50 : 10 }}
    >
      <button
        className={`flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-[10px] font-medium border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-200 dark:hover:bg-indigo-800/50 transition-colors whitespace-nowrap shadow-sm ${open ? 'ring-1 ring-indigo-400' : ''}`}
        onClick={(e) => {
          e.stopPropagation();
          setOpen(o => !o);
        }}
        title={`${fieldName} → ${targets.length} types${open ? ' (click to collapse)' : ''}`}
      >
        <ArrowRight className={`w-2.5 h-2.5 transition-transform ${open ? 'rotate-90' : ''}`} />
        {targets.length} types
      </button>
      {open && (
        <div
          // Faded backdrop: large rounded corners, blocks bleed-through of
          // edges/lozenges underneath. `nopan nodrag` keep React Flow from
          // panning the canvas while interacting with the cluster.
          className="nopan nodrag flex flex-col gap-1.5 ml-4 p-1.5 rounded-2xl bg-white/85 dark:bg-gray-900/85 backdrop-blur-sm border border-indigo-100 dark:border-indigo-800/60 shadow-md"
          onClick={(e) => e.stopPropagation()}
          onMouseDown={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
        >
          {pairs.map((pair, rowIdx) => (
            <div key={rowIdx} className="flex items-center gap-1.5">
              {pair.map((target) => (
                <button
                  key={target}
                  className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-[10px] font-medium border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-200 dark:hover:bg-indigo-800/50 transition-colors whitespace-nowrap shadow-sm"
                  onClick={(e) => {
                    e.stopPropagation();
                    onSelect(target);
                  }}
                  title={`Focus on ${target}`}
                >
                  <ArrowRight className="w-2.5 h-2.5" />
                  {target}
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Field Row
// ---------------------------------------------------------------------------

function FieldRow({
  field,
  index,
  totalRefs,
  refIndex,
  onReferenceClick,
  onCrossDatasetNavigate,
  onMediaLibraryClick,
  onInaccessibleClick,
  accessibleProjectIds,
  visibleTypeNames,
  typeKinds,
  sourceTypeName,
  onMultiTargetOpenChange,
  indentLevel = 0,
  isContainer = false,
  isOpen = false,
  onToggleContainer,
  hiddenChildRefs,
}: {
  field: DiscoveredField;
  index: number;
  totalRefs: number;
  refIndex: number; // -1 if not a reference
  onReferenceClick?: (referenceTo: string) => void;
  onCrossDatasetNavigate?: (datasetName: string, typeName?: string, sourceTypeName?: string, projectId?: string) => void;
  onMediaLibraryClick?: (fieldName: string, typeName: string) => void;
  onInaccessibleClick?: (projectName: string, datasetName: string) => void;
  accessibleProjectIds?: Set<string>;
  visibleTypeNames?: Set<string>;
  typeKinds?: Record<string, 'document' | 'object'>;
  sourceTypeName?: string;
  /** Notify parent SchemaNode when this row's multi-target lozenge expands,
   *  so the node can bump its z-index to render above sibling nodes. */
  onMultiTargetOpenChange?: (fieldName: string, open: boolean) => void;
  /** Indentation level (0 = top-level). Each level indents by ~4 chars worth. */
  indentLevel?: number;
  /** True if this row is a container stub (object/array parent). */
  isContainer?: boolean;
  /** For container stub rows: whether the children are currently rendered. */
  isOpen?: boolean;
  /** Called when the user clicks the chevron on a container stub row. */
  onToggleContainer?: () => void;
  /** For container stub rows: names of hidden child ref fields whose
   *  source handles should render invisibly at this row's position so
   *  edges can still connect. */
  hiddenChildRefs?: string[];
}) {
  const isCrossDataset = field.isCrossDatasetReference === true;
  const isRef = !isCrossDataset && (field.isReference || field.type === 'reference');
  const isInline = field.isInlineObject === true;
  // Inline object rows referencing a named object type behave like refs for
  // navigation: clicking the row should focus the target, and out-of-focus
  // targets should render as navigable orphan lozenges. This matters most
  // for named-object arrays deep in a chain (e.g. plainThread.entries[] →
  // plainEntry) where the target isn't on-canvas at shallow focus depths.
  const isRefLike = isRef || (isInline && !!field.referenceTo);
  const style = fieldBadgeStyle(isInline ? 'object' : field.type);
  const even = index % 2 === 0;

  // All reference targets (handles multi-target refs)
  const allTargets: string[] = isRefLike
    ? (field.referenceTargets && field.referenceTargets.length > 0
        ? field.referenceTargets
        : (field.referenceTo ? [field.referenceTo] : []))
    : [];
  // Orphaned targets — ones the user can't see on the current canvas
  const orphanedTargets = visibleTypeNames
    ? allTargets.filter(t => !visibleTypeNames.has(t))
    : [];
  // For row-level click: focus the first target by default
  const primaryTarget = allTargets[0];

  return (
    <div
      className={`
        relative flex items-center gap-2 px-3 py-1.5 text-xs
        ${even ? 'bg-transparent' : 'bg-muted/40'}
        ${isRef || isContainer ? 'bg-indigo-50/60 dark:bg-indigo-950/20' : ''}
        ${isRefLike && primaryTarget && onReferenceClick ? 'schema-clickable' : ''}
      `}
      data-field-name={field.name}
      data-field-type={field.type}
      data-field-is-ref={field.isReference ? 'true' : undefined}
      data-field-is-inline={field.isInlineObject ? 'true' : undefined}
      data-field-is-array={field.isArray ? 'true' : undefined}
      data-field-ref-to={field.referenceTo || undefined}
      data-field-ref-targets={allTargets.length > 1 ? allTargets.join(',') : undefined}
      onClick={isRefLike && primaryTarget && onReferenceClick ? (e: React.MouseEvent) => {
        e.stopPropagation();
        onReferenceClick(primaryTarget);
      } : (isContainer && onToggleContainer ? (e: React.MouseEvent) => {
        e.stopPropagation();
        onToggleContainer();
      } : undefined)}
      onMouseDown={isRefLike && primaryTarget && onReferenceClick ? (e: React.MouseEvent) => e.stopPropagation() : (isContainer && onToggleContainer ? (e: React.MouseEvent) => e.stopPropagation() : undefined)}
      onPointerDown={isRefLike && primaryTarget && onReferenceClick ? (e: React.PointerEvent) => e.stopPropagation() : (isContainer && onToggleContainer ? (e: React.PointerEvent) => e.stopPropagation() : undefined)}
      style={{
        ...(isRefLike && primaryTarget && onReferenceClick ? { cursor: 'pointer' } : {}),
        ...(isContainer && onToggleContainer ? { cursor: 'pointer' } : {}),
        ...(indentLevel > 0 ? { paddingLeft: `${12 + indentLevel * 24}px` } : {}),
      }}
    >
      {/* Chevron for container stub rows */}
      {isContainer && (
        <span
          className="shrink-0 text-lg leading-none text-indigo-600 dark:text-indigo-400 select-none font-semibold"
          aria-hidden="true"
        >
          {isOpen ? '▾' : '▸'}
        </span>
      )}

      {/* Nested-row indicator: leaves and non-container rows inside a
          container get a subtle ↳ prefix to signal ownership. Containers
          themselves already have the chevron. */}
      {indentLevel > 0 && !isContainer && (
        <span
          className="shrink-0 text-gray-400 dark:text-gray-600 select-none font-mono text-sm leading-none"
          aria-hidden="true"
        >
          ↳
        </span>
      )}

      {/* Field name — indented rows show last path segment; container arrays get [] stripped */}
      <span
        className={`flex-1 min-w-0 truncate text-left font-mono ${isRef || isInline ? 'font-medium text-indigo-700 dark:text-indigo-300' : isContainer ? 'font-medium text-indigo-700 dark:text-indigo-300' : 'text-card-foreground'}`}
        title={field.name}
      >
        {indentLevel > 0 || isContainer
          ? (() => {
              const segments = field.name.split('.');
              const last = segments[segments.length - 1];
              // Array containers: strip trailing [] on the segment and let the
              // badge convey array-ness. Cleaner display in the row.
              return last.endsWith('[]') ? last.slice(0, -2) : last;
            })()
          : field.name}
      </span>

      {/* Type badge */}
      <Badge
        variant={style.variant}
        className={`shrink-0 px-1.5 py-0 text-[10px] leading-4 font-normal ${style.className}`}
        title={isRef && allTargets.length > 1 ? `Accepts: ${allTargets.join(', ')}` : undefined}
      >
        {isRef && <ArrowRight className="mr-0.5 h-2.5 w-2.5" />}
        {isInline ? field.referenceTo : field.type}
        {field.isArray && '[]'}
      </Badge>

      {/* Source handle for reference and inline object fields — tiny but positioned for edge routing */}
      {(isRef || isInline) && (
        <Handle
          type="source"
          position={Position.Right}
          id={`ref-${field.name}`}
          className="!absolute !right-0 !top-1/2 !-translate-y-1/2 !translate-x-1/2 !w-[1px] !h-[1px] !border-0 !bg-transparent !min-w-0 !min-h-0"
        />
      )}

      {/* Fallback source handles for hidden children — when a container is
          collapsed, the collapsed children's ref handles need to exist SOMEWHERE
          in the DOM so React Flow can attach edges. We stash them at this
          container row's right edge, invisible. */}
      {isContainer && !isOpen && hiddenChildRefs && hiddenChildRefs.map((childName) => (
        <Handle
          key={childName}
          type="source"
          position={Position.Right}
          id={`ref-${childName}`}
          className="!absolute !right-0 !top-1/2 !-translate-y-1/2 !translate-x-1/2 !w-[1px] !h-[1px] !border-0 !bg-transparent !min-w-0 !min-h-0"
        />
      ))}

      {/* Orphaned reference lozenge(s) — target types not on the current canvas.
          ≤2 orphans: render inline.
          3+ orphans: collapse into a single "+N targets" lozenge with a
          popover listing all of them, to avoid sprawling rows on heavy
          multi-target fields (e.g. 19-target sales playbook refs). */}
      {orphanedTargets.length > 0 && onReferenceClick && (
        orphanedTargets.length <= 2 ? (
          <div className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-[calc(100%+8px)] z-10 flex items-center gap-1">
            {orphanedTargets.map((target) => {
              const isObjectTarget = typeKinds?.[target] === 'object';
              const pillClass = isObjectTarget
                ? "flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-700 dark:text-amber-300 text-[10px] font-medium border border-amber-200 dark:border-amber-700 hover:bg-amber-200 dark:hover:bg-amber-800/50 transition-colors whitespace-nowrap shadow-sm"
                : "flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-[10px] font-medium border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-200 dark:hover:bg-indigo-800/50 transition-colors whitespace-nowrap shadow-sm";
              return (
                <button
                  key={target}
                  className={pillClass}
                  onClick={(e) => {
                    e.stopPropagation();
                    onReferenceClick(target);
                  }}
                  title={`Focus on ${target}`}
                >
                  <ArrowRight className="w-2.5 h-2.5" />
                  {target}
                </button>
              );
            })}
          </div>
        ) : (
          <MultiTargetPopover
            targets={orphanedTargets}
            fieldName={field.name}
            onSelect={onReferenceClick}
            onOpenChange={(open) => onMultiTargetOpenChange?.(field.name, open)}
          />
        )
      )}

      {/* Cross-dataset reference lozenge — shown for fields referencing another dataset/project */}
      {isCrossDataset && field.crossDatasetName && (() => {
        const isMediaLibrary = field.crossDatasetResourceType === 'media-library';
        const isInaccessible = !isMediaLibrary && field.isGlobalReference && field.crossDatasetProjectId && accessibleProjectIds && !accessibleProjectIds.has(field.crossDatasetProjectId);

        return (
          <>
            <style dangerouslySetInnerHTML={{ __html: crossDatasetStyles }} />
            <Tooltip
              content={
                <Box padding={2}>
                  <Text size={1}>
                    {isMediaLibrary ? (
                      <span>Media Library reference</span>
                    ) : field.crossDatasetTooltip ? (
                      <span dangerouslySetInnerHTML={{ __html: field.crossDatasetTooltip }} />
                    ) : field.crossDatasetName}
                  </Text>
                </Box>
              }
              placement="top"
              portal
            >
              {isMediaLibrary ? (
                <button
                  className="group/xds absolute right-0 top-1/2 -translate-y-1/2 translate-x-[calc(100%+8px)] z-10 flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed text-[10px] font-medium border-gray-400 dark:border-gray-500 bg-gray-100 dark:bg-gray-800/50 text-gray-600 dark:text-gray-400"
                  onClick={(e) => { e.stopPropagation(); onMediaLibraryClick?.(field.name, sourceTypeName || ''); }}
                >
                  <GoImage className="w-2.5 h-2.5" />
                  <span>Media Library</span>
                </button>
              ) : isInaccessible ? (
                <button
                  className="group/xds absolute right-0 top-1/2 -translate-y-1/2 translate-x-[calc(100%+8px)] z-10 flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed text-[10px] font-medium border-purple-400 dark:border-purple-500 bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300"
                  onClick={(e) => { e.stopPropagation(); onInaccessibleClick?.(field.crossDatasetName || '', field.crossDatasetProjectId || ''); }}
                >
                  <GoDatabase className="w-2.5 h-2.5" />
                  <GoLock className="w-2.5 h-2.5" />
                  <span>{field.crossDatasetName}</span>
                </button>
              ) : (
                <button
                  className={"group/xds absolute right-0 top-1/2 -translate-y-1/2 translate-x-[calc(100%+8px)] z-10 flex items-center gap-1 px-2.5 py-1 rounded-full border border-dashed text-[10px] font-medium transition-colors whitespace-nowrap cursor-pointer " + (field.isGlobalReference ? "border-purple-400 dark:border-purple-500 bg-purple-100 dark:bg-purple-900/50 text-purple-700 dark:text-purple-300 hover:bg-purple-200 dark:hover:bg-purple-800/50" : "border-teal-400 dark:border-teal-500 bg-teal-100 dark:bg-teal-900/50 text-teal-700 dark:text-teal-300 hover:bg-teal-200 dark:hover:bg-teal-800/50")}
                  onClick={(e) => {
                    e.stopPropagation();
                    onCrossDatasetNavigate?.(field.crossDatasetName!, field.referenceTo, sourceTypeName, field.crossDatasetProjectId);
                  }}
                >
                  <GoDatabase className="w-2.5 h-2.5" />
                  <ArrowRight className="w-2 h-2 group-hover/xds:animate-[bounceRight_1s_ease-in-out_infinite]" />
                  <span>{field.crossDatasetName}</span>
                </button>
              )}
            </Tooltip>
          </>
        );
      })()}
    </div>
  );
}

// ---------------------------------------------------------------------------
// SchemaNode
// ---------------------------------------------------------------------------

function SchemaNode({ data }: NodeProps<SchemaNodeType>) {
  const { typeName, documentCount, fields, kind, onReferenceClick, onCrossDatasetNavigate, onMediaLibraryClick, onInaccessibleClick, accessibleProjectIds, visibleTypeNames, typeKinds } = data;
  const isObjectNode = kind === 'object';
  const expandCtx = useContext(ExpandContext);
  const expandObjects = expandCtx.expandObjects;
  const expandArrays = expandCtx.expandArrays;
  // Transient overrides use composite keys `${typeName}::${fieldPath}` so
  // fields with the same name in different types don't collide.
  const isFieldOverridden = useCallback(
    (fieldPath: string) => expandCtx.transientExpanded.has(`${typeName}::${fieldPath}`),
    [expandCtx.transientExpanded, typeName],
  );
  const onToggleTransient = expandCtx.onToggleTransient
    ? (fieldPath: string) => expandCtx.onToggleTransient!(typeName, fieldPath)
    : undefined;

  // Compute which container paths are "open" (children rendered).
  // A container is open when:
  //   1. its global flag is on (expandObjects for object containers,
  //      expandArrays for array containers), AND user hasn't overridden it OFF
  //   OR
  //   2. its global flag is off but user has overridden it ON via chevron
  // The transientExpanded set holds paths that DIFFER from the default —
  // so it's a XOR against the container's default.
  const openPaths = useMemo(() => {
    const open = new Set<string>();
    for (const f of fields) {
      if (!f.containerKind) continue;
      const defaultOpen =
        f.containerKind === 'object' ? !!expandObjects : !!expandArrays;
      const overridden = isFieldOverridden(f.name);
      // Default-open XOR override → open. Default-closed XOR override → open when override present.
      const isOpen = defaultOpen !== overridden;
      if (isOpen) open.add(f.name);
    }
    return open;
  }, [fields, expandObjects, expandArrays, isFieldOverridden]);

  // A field is visible if either it's top-level (no parentPath) OR every
  // ancestor container in its parentPath is open. Ancestors are derived
  // from the parentPath by walking the dot/[] segments.
  //
  // Note: children of array containers have parentPath ending in `[]`
  // (e.g. `modules[]` for direct children, `modules[].item` deeper). The
  // container itself is emitted with the un-suffixed name (`modules`),
  // so we strip trailing `[]` on each segment before matching openPaths.
  const isFieldVisible = useCallback(
    (f: DiscoveredField): boolean => {
      if (!f.parentPath) return true;
      const parts = f.parentPath.split('.');
      let acc = '';
      for (const part of parts) {
        const bare = part.endsWith('[]') ? part.slice(0, -2) : part;
        acc = acc ? `${acc}.${bare}` : bare;
        if (!openPaths.has(acc)) return false;
      }
      return true;
    },
    [openPaths],
  );

  const visibleFields = useMemo(() => fields.filter(isFieldVisible), [fields, isFieldVisible]);

  // For hidden ref/inline fields, we still need to render their source
  // handles so React Flow can draw edges. We stash them under the nearest
  // ANCESTOR that IS visible (the closest collapsed container in the chain).
  const hiddenRefHandles = useMemo(() => {
    // Map: container field name → array of hidden ref field names whose
    // handles should render at that container's row position.
    const map = new Map<string, string[]>();
    for (const f of fields) {
      if (!f.parentPath) continue;
      if (isFieldVisible(f)) continue;
      // Only ref-bearing fields need handles.
      if (!(f.isReference || f.isInlineObject || f.isCrossDatasetReference || f.type === 'reference')) continue;
      // Find the nearest ancestor container that's visible (either it's
      // top-level, or all ITS ancestors are open). Strip trailing `[]` on
      // each segment when matching container field names, since array
      // containers are stored as `modules` but children reference them
      // as `modules[]` in parentPath.
      const parts = f.parentPath.split('.');
      let container: string | null = null;
      let acc = '';
      for (const part of parts) {
        const bare = part.endsWith('[]') ? part.slice(0, -2) : part;
        acc = acc ? `${acc}.${bare}` : bare;
        const containerField = fields.find(x => x.name === acc);
        if (!containerField) continue;
        if (isFieldVisible(containerField)) {
          container = acc;
          break;
        }
      }
      if (!container) continue;
      const list = map.get(container) ?? [];
      list.push(f.name);
      map.set(container, list);
    }
    return map;
  }, [fields, isFieldVisible]);

  // Pre-compute reference indices for handle positioning
  const refFields = useMemo(
    () =>
      fields.reduce<Record<string, number>>((acc, f, _i) => {
        if (f.isCrossDatasetReference) return acc;
        if (f.isReference || f.isInlineObject || f.type === 'reference') {
          acc[f.name] = Object.keys(acc).length;
        }
        return acc;
      }, {}),
    [fields],
  );

  const totalRefs = Object.keys(refFields).length;

  // Check if any reference fields point to types not in the current view
  const hasOrphanedRefs = useMemo(() => {
    if (!visibleTypeNames || !onReferenceClick) return false;
    return fields.some(f => {
      if (f.isCrossDatasetReference) return false;
      // Include both real reference fields AND inline-object rows that point
      // to a named object type — both render orphan lozenges when their
      // target isn't on canvas.
      const isRefRow = f.isReference || f.type === 'reference';
      const isInlineRefRow = f.isInlineObject && !!f.referenceTo;
      if (!isRefRow && !isInlineRefRow) return false;
      const targets = f.referenceTargets && f.referenceTargets.length > 0
        ? f.referenceTargets
        : (f.referenceTo ? [f.referenceTo] : []);
      // A row has an orphan lozenge if ANY of its targets are off-canvas
      return targets.some(t => !visibleTypeNames.has(t));
    });
  }, [fields, visibleTypeNames, onReferenceClick]);

  // Check if any cross-dataset reference fields exist (need overflow for lozenges)
  const hasCrossDatasetRefs = useMemo(() => {
    return fields.some(f => f.isCrossDatasetReference && f.crossDatasetName);
  }, [fields]);

  // Track which field rows have their multi-target lozenge cluster expanded.
  // When any are open, bump this node's z-index so the expansion renders
  // above sibling nodes/edges (React Flow stacks nodes via inline z-index).
  const [openMultiTargets, setOpenMultiTargets] = useState<Set<string>>(new Set());
  const handleMultiTargetOpenChange = useMemo(
    () => (fieldName: string, open: boolean) => {
      setOpenMultiTargets(prev => {
        const next = new Set(prev);
        if (open) next.add(fieldName);
        else next.delete(fieldName);
        return next;
      });
    },
    [],
  );
  const anyMultiTargetOpen = openMultiTargets.size > 0;

  return (
    <div
      className={
        "rounded-md border bg-card text-card-foreground min-w-[200px] max-w-[280px]" +
        (isObjectNode ? " border-amber-300 dark:border-amber-700" : "") +
        (hasOrphanedRefs || hasCrossDatasetRefs ? " mr-[130px]" : "")
      }
      style={{
        overflow: hasOrphanedRefs || hasCrossDatasetRefs ? 'visible' : 'hidden',
        position: 'relative',
        // Lift this node above siblings when a multi-target lozenge cluster
        // is expanded. React Flow renders node containers with relative
        // positioning, so a positive z-index here puts everything (node body
        // + escaping lozenges) above other nodes/edges.
        ...(anyMultiTargetOpen ? { zIndex: 1000 } : {}),
      }}
    >
      {/* ---- Invisible handles on all 4 sides for floating edge connections ---- */}
      <Handle
        type="target"
        position={Position.Left}
        id="target-left"
        className="!w-0 !h-0 !border-0 !bg-transparent !min-w-0 !min-h-0"
        style={{ top: '50%', opacity: 0 }}
      />
      <Handle
        type="target"
        position={Position.Right}
        id="target-right"
        className="!w-0 !h-0 !border-0 !bg-transparent !min-w-0 !min-h-0"
        style={{ top: '50%', opacity: 0 }}
      />
      <Handle
        type="target"
        position={Position.Top}
        id="target-top"
        className="!w-0 !h-0 !border-0 !bg-transparent !min-w-0 !min-h-0"
        style={{ left: '50%', opacity: 0 }}
      />
      <Handle
        type="target"
        position={Position.Bottom}
        id="target-bottom"
        className="!w-0 !h-0 !border-0 !bg-transparent !min-w-0 !min-h-0"
        style={{ left: '50%', opacity: 0 }}
      />

      {/* ---- Header ---- */}
      <div
        className={
          "flex items-center justify-between gap-2 border-b px-3 py-2 " +
          (isObjectNode ? "bg-amber-50 dark:bg-amber-950/30" : "bg-muted/70")
        }
      >
        <span className="truncate text-sm font-medium" title={typeName}>
          {typeName}
        </span>
        {isObjectNode ? (
          <Badge
            variant="secondary"
            className="shrink-0 text-[10px] px-1.5 py-0 leading-4 bg-amber-100 text-amber-900 dark:bg-amber-900/50 dark:text-amber-100 font-normal"
          >
            OBJECT
          </Badge>
        ) : (
          <Badge
            variant="secondary"
            className="shrink-0 text-[10px] px-1.5 py-0 leading-4 bg-white text-black dark:bg-gray-800 dark:text-gray-200 font-normal"
          >
            <span className="opacity-60 mr-1">DOC</span>
            <span className="tabular-nums">{documentCount.toLocaleString()}</span>
          </Badge>
        )}
      </div>

      {/* ---- Field list ---- */}
      <div className="nowheel">
        {fields.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground italic">
            No fields discovered
          </div>
        )}
        {visibleFields.map((field, i) => {
          const depth = field.parentPath ? field.parentPath.split('.').length : 0;
          const isContainer = !!field.containerKind;
          const containerOpen = isContainer ? openPaths.has(field.name) : false;
          return (
            <FieldRow
              key={field.name}
              field={field}
              index={i}
              totalRefs={totalRefs}
              refIndex={refFields[field.name] ?? -1}
              onReferenceClick={onReferenceClick}
              onCrossDatasetNavigate={onCrossDatasetNavigate}
              onMediaLibraryClick={onMediaLibraryClick}
              onInaccessibleClick={onInaccessibleClick}
              accessibleProjectIds={accessibleProjectIds}
              visibleTypeNames={visibleTypeNames}
              typeKinds={typeKinds}
              sourceTypeName={typeName}
              onMultiTargetOpenChange={handleMultiTargetOpenChange}
              indentLevel={depth}
              isContainer={isContainer}
              isOpen={containerOpen}
              onToggleContainer={isContainer && onToggleTransient ? () => onToggleTransient(field.name) : undefined}
              hiddenChildRefs={isContainer && !containerOpen ? hiddenRefHandles.get(field.name) : undefined}
            />
          );
        })}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

/** Use this key when registering with React Flow's `nodeTypes` */
export const SCHEMA_NODE_TYPE = 'schema' as const;

export default memo(SchemaNode);
