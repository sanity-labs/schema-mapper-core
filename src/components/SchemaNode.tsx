import { Handle, Position, type NodeProps, type Node } from '@xyflow/react';
import { Badge } from './ui/badge';
import { ArrowRight } from 'lucide-react';
import { GoDatabase, GoImage, GoLock } from 'react-icons/go';
import React, { memo, useMemo } from 'react';
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
  hasIncoming?: boolean;
  hasOutgoing?: boolean;
  incomingEdgeCount?: number;
  onReferenceClick?: (referenceTo: string) => void;
  onCrossDatasetNavigate?: (datasetName: string, typeName?: string, sourceTypeName?: string, projectId?: string) => void;
  onMediaLibraryClick?: (fieldName: string, typeName: string) => void;
  onInaccessibleClick?: (projectName: string, datasetName: string) => void;
  accessibleProjectIds?: Set<string>;
  visibleTypeNames?: Set<string>;
};

export type SchemaNodeType = Node<SchemaNodeData, 'schema'>;

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
  sourceTypeName,
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
  sourceTypeName?: string;
}) {
  const isCrossDataset = field.isCrossDatasetReference === true;
  const isRef = !isCrossDataset && (field.isReference || field.type === 'reference');
  const isInline = field.isInlineObject === true;
  const style = fieldBadgeStyle(isInline ? 'object' : field.type);
  const even = index % 2 === 0;
  const isOrphaned = isRef && field.referenceTo && visibleTypeNames && !visibleTypeNames.has(field.referenceTo);

  return (
    <div
      className={`
        relative flex items-center justify-between gap-2 px-3 py-1.5 text-xs
        ${even ? 'bg-transparent' : 'bg-muted/40'}
        ${isRef ? 'bg-indigo-50/60 dark:bg-indigo-950/20' : ''}
      `}
      data-field-name={field.name}
      data-field-type={field.type}
      data-field-is-ref={field.isReference ? 'true' : undefined}
      data-field-is-inline={field.isInlineObject ? 'true' : undefined}
      data-field-is-array={field.isArray ? 'true' : undefined}
      data-field-ref-to={field.referenceTo || undefined}
      onClick={isRef && field.referenceTo && onReferenceClick ? (e: React.MouseEvent) => {
        e.stopPropagation();
        onReferenceClick(field.referenceTo!);
      } : undefined}
      style={isRef && field.referenceTo && onReferenceClick ? { cursor: 'pointer' } : undefined}
    >
      {/* Field name */}
      <span
        className={`truncate font-mono ${isRef || isInline ? 'font-medium text-indigo-700 dark:text-indigo-300' : 'text-card-foreground'}`}
        title={field.name}
      >
        {field.name}
      </span>

      {/* Type badge */}
      <Badge
        variant={style.variant}
        className={`shrink-0 px-1.5 py-0 text-[10px] leading-4 font-normal ${style.className}`}
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

      {/* Orphaned reference lozenge — shown when target type is not in current view */}
      {isOrphaned && onReferenceClick && (
        <button
          className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-[calc(100%+8px)] z-10 flex items-center gap-1 px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-700 dark:text-indigo-300 text-[10px] font-medium border border-indigo-200 dark:border-indigo-700 hover:bg-indigo-200 dark:hover:bg-indigo-800/50 transition-colors whitespace-nowrap shadow-sm"
          onClick={(e) => {
            e.stopPropagation();
            onReferenceClick(field.referenceTo!);
          }}
          title={`Focus on ${field.referenceTo}`}
        >
          <ArrowRight className="w-2.5 h-2.5" />
          {field.referenceTo}
        </button>
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
  const { typeName, documentCount, fields, onReferenceClick, onCrossDatasetNavigate, onMediaLibraryClick, onInaccessibleClick, accessibleProjectIds, visibleTypeNames } = data;

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
    return fields.some(f =>
      !f.isCrossDatasetReference &&
      (f.isReference || f.type === 'reference') &&
      f.referenceTo &&
      !visibleTypeNames.has(f.referenceTo)
    );
  }, [fields, visibleTypeNames, onReferenceClick]);

  // Check if any cross-dataset reference fields exist (need overflow for lozenges)
  const hasCrossDatasetRefs = useMemo(() => {
    return fields.some(f => f.isCrossDatasetReference && f.crossDatasetName);
  }, [fields]);

  return (
    <div className={"rounded-md border bg-card text-card-foreground min-w-[200px] max-w-[280px]" + (hasOrphanedRefs || hasCrossDatasetRefs ? " mr-[130px]" : "")} style={{ overflow: hasOrphanedRefs || hasCrossDatasetRefs ? 'visible' : 'hidden' }}>
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
      <div className="flex items-center justify-between gap-2 border-b bg-muted/70 px-3 py-2">
        <span className="truncate text-sm font-medium" title={typeName}>
          {typeName}
        </span>
        <Badge
          variant="secondary"
          className="shrink-0 tabular-nums text-[10px] px-1.5 py-0 leading-4 bg-white text-black dark:bg-gray-800 dark:text-gray-200"
        >
          {documentCount.toLocaleString()}
        </Badge>
      </div>

      {/* ---- Field list ---- */}
      <div className="nowheel">
        {fields.length === 0 && (
          <div className="px-3 py-2 text-xs text-muted-foreground italic">
            No fields discovered
          </div>
        )}
        {fields.map((field, i) => (
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
            sourceTypeName={typeName}
          />
        ))}
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
