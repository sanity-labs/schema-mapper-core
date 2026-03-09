import {useState, useMemo, useCallback} from 'react'
import {Dialog, Box, Stack, Text, Flex, Button} from '@sanity/ui'
import { HiOutlineLink } from 'react-icons/hi'
import { GrDownload } from 'react-icons/gr'
import type {DiscoveredType, DiscoveredField} from '../types'

export interface SchemaCodeDialogProps {
  open: boolean
  onClose: () => void
  types: DiscoveredType[]
  projectName: string
  datasetName: string
}

/** Convert camelCase/snake_case to Title Case: firstName → First Name, created_at → Created At */
function camelToTitle(str: string): string {
  return str
    .replace(/_/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2')
    .split(' ')
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
}

/** Generate export variable name — avoids documentTypeType */
function typeVarName(name: string): string {
  return name.endsWith('Type') || name.endsWith('type') ? name : `${name}Type`
}

/** Generate the field definition code string for a single field */
function generateFieldCode(field: DiscoveredField, indent: string): string {
  const title = field.title || camelToTitle(field.name)
  const lines: string[] = []

  if (field.type === 'unknown') {
    lines.push(`${indent}defineField({`)
    lines.push(`${indent}  name: '${field.name}',`)
    lines.push(`${indent}  title: '${title}',`)
    lines.push(`${indent}  type: 'string', // TODO: unknown type, defaulting to string`)
    lines.push(`${indent}}),`)
    return lines.join('\n')
  }

  if (field.type === 'reference' && field.referenceTo) {
    lines.push(`${indent}defineField({`)
    lines.push(`${indent}  name: '${field.name}',`)
    lines.push(`${indent}  title: '${title}',`)
    lines.push(`${indent}  type: 'reference',`)
    lines.push(`${indent}  to: [{type: '${field.referenceTo}'}],`)
    lines.push(`${indent}}),`)
    return lines.join('\n')
  }

  if (field.type === 'array') {
    lines.push(`${indent}defineField({`)
    lines.push(`${indent}  name: '${field.name}',`)
    lines.push(`${indent}  title: '${title}',`)
    lines.push(`${indent}  type: 'array',`)
    if (field.isReference && field.referenceTo) {
      lines.push(`${indent}  of: [defineArrayMember({type: 'reference', to: [{type: '${field.referenceTo}'}]})],`)
    } else {
      lines.push(`${indent}  of: [{type: 'string'}],`)
    }
    lines.push(`${indent}}),`)
    return lines.join('\n')
  }

  if (field.type === 'object') {
    if (field.isInlineObject && field.referenceTo) {
      lines.push(`${indent}defineField({`)
      lines.push(`${indent}  name: '${field.name}',`)
      lines.push(`${indent}  title: '${title}',`)
      lines.push(`${indent}  type: 'reference',`)
      lines.push(`${indent}  to: [{type: '${field.referenceTo}'}],`)
      lines.push(`${indent}}),`)
    } else {
      lines.push(`${indent}defineField({`)
      lines.push(`${indent}  name: '${field.name}',`)
      lines.push(`${indent}  title: '${title}',`)
      lines.push(`${indent}  type: 'object',`)
      lines.push(`${indent}  fields: [],`)
      lines.push(`${indent}}),`)
    }
    return lines.join('\n')
  }

  // Simple types: string, number, boolean, text, url, datetime, image, slug, block
  lines.push(`${indent}defineField({`)
  lines.push(`${indent}  name: '${field.name}',`)
  lines.push(`${indent}  title: '${title}',`)
  lines.push(`${indent}  type: '${field.type}',`)
  lines.push(`${indent}}),`)
  return lines.join('\n')
}

/** Generate the full defineType code for a single type */
function generateTypeCode(type: DiscoveredType): string {
  const varName = typeVarName(type.name)
  const title = type.title || camelToTitle(type.name)
  const lines: string[] = []

  lines.push(`export const ${varName} = defineType({`)
  lines.push(`  name: '${type.name}',`)
  lines.push(`  title: '${title}',`)
  lines.push(`  type: 'document',`)
  lines.push(`  fields: [`)

  for (const field of type.fields) {
    lines.push(generateFieldCode(field, '    '))
  }

  lines.push(`  ],`)
  lines.push(`})`)

  return lines.join('\n')
}

/** Generate the full file content with all types */
function generateFullFile(types: DiscoveredType[]): string {
  const lines: string[] = []
  lines.push(`import {defineType, defineField, defineArrayMember} from 'sanity'`)
  lines.push('')

  for (const type of types) {
    lines.push(generateTypeCode(type))
    lines.push('')
  }

  const varNames = types.map((t) => typeVarName(t.name))
  lines.push(`export const schemaTypes = [${varNames.join(', ')}]`)
  lines.push('')

  return lines.join('\n')
}

/** Collect all type names that are referenced by other types */
function getReferencedTypeNames(types: DiscoveredType[]): Set<string> {
  const referenced = new Set<string>()
  const typeNames = new Set(types.map((t) => t.name))
  for (const type of types) {
    for (const field of type.fields) {
      if (field.isReference && field.referenceTo && typeNames.has(field.referenceTo)) {
        referenced.add(field.referenceTo)
      }
    }
  }
  return referenced
}

// ---- Syntax highlighting helpers ----

type CodeSegment = {
  text: string
  className?: string
  onClick?: () => void
}

function highlightCode(
  code: string,
  typeNames: Set<string>,
  currentType: string,
  onNavigate: (typeName: string) => void,
): CodeSegment[][] {
  const lines = code.split('\n')
  return lines.map((line) => highlightLine(line, typeNames, currentType, onNavigate))
}

function highlightLine(
  line: string,
  typeNames: Set<string>,
  currentType: string,
  onNavigate: (typeName: string) => void,
): CodeSegment[] {
  const segments: CodeSegment[] = []

  // Check for comment
  const commentIdx = line.indexOf('//')
  let mainPart = line
  let commentPart = ''
  if (commentIdx >= 0) {
    mainPart = line.slice(0, commentIdx)
    commentPart = line.slice(commentIdx)
  }

  // Tokenize the main part
  const tokenRegex = /(export|const|import|from)|(defineType|defineField|defineArrayMember)|('(?:[^'\\\\]|\\\\.)*')|(\b(?:name|title|type|fields|to|of)\b(?=\s*:))/g

  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = tokenRegex.exec(mainPart)) !== null) {
    if (match.index > lastIndex) {
      const before = mainPart.slice(lastIndex, match.index)
      segments.push({text: before})
    }

    if (match[1]) {
      segments.push({text: match[0], className: 'schema-code-keyword'})
    } else if (match[2]) {
      segments.push({text: match[0], className: 'schema-code-function'})
    } else if (match[3]) {
      const strContent = match[3].slice(1, -1)
      if (typeNames.has(strContent) && strContent !== currentType) {
        segments.push({text: "'", className: 'schema-code-string'})
        segments.push({
          text: strContent,
          className: 'schema-code-link',
          onClick: () => onNavigate(strContent),
        })
        segments.push({text: "'", className: 'schema-code-string'})
      } else {
        segments.push({text: match[0], className: 'schema-code-string'})
      }
    } else if (match[4]) {
      segments.push({text: match[0], className: 'schema-code-property'})
    }

    lastIndex = match.index + match[0].length
  }

  if (lastIndex < mainPart.length) {
    segments.push({text: mainPart.slice(lastIndex)})
  }

  if (commentPart) {
    segments.push({text: commentPart, className: 'schema-code-comment'})
  }

  return segments
}

export function SchemaCodeDialog({open, onClose, types, projectName, datasetName}: SchemaCodeDialogProps) {
  const [selectedType, setSelectedType] = useState<string>(types[0]?.name ?? '')

  const referencedTypeNames = useMemo(() => getReferencedTypeNames(types), [types])
  const allTypeNames = useMemo(() => new Set(types.map((t) => t.name)), [types])

  const selectedTypeData = useMemo(
    () => types.find((t) => t.name === selectedType),
    [types, selectedType],
  )

  const schemaSource = `${projectName}/${datasetName}`

  const handleNavigate = useCallback(
    (typeName: string) => {
      if (allTypeNames.has(typeName)) {
        setSelectedType(typeName)
      }
    },
    [allTypeNames],
  )

  const codeForSelectedType = useMemo(() => {
    if (!selectedTypeData) return ''
    return generateTypeCode(selectedTypeData)
  }, [selectedTypeData])

  const highlightedLines = useMemo(
    () => highlightCode(codeForSelectedType, allTypeNames, selectedType, handleNavigate),
    [codeForSelectedType, allTypeNames, selectedType, handleNavigate],
  )

  const handleDownload = useCallback(() => {
    const content = generateFullFile(types)
    const blob = new Blob([content], {type: 'text/typescript'})
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `schema-${projectName}-${datasetName}.ts`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
  }, [types, projectName, datasetName])

  if (!open) return null

  return (
    <>
      <style>{`
        .schema-code-keyword { color: #569cd6; }
        .schema-code-function { color: #dcdcaa; }
        .schema-code-string { color: #ce9178; }
        .schema-code-property { color: #9cdcfe; }
        .schema-code-comment { color: #6a9955; font-style: italic; }
        .schema-code-link {
          color: #4ec9b0;
          text-decoration: underline;
          text-decoration-color: #4ec9b0;
          text-underline-offset: 2px;
          cursor: pointer;
          transition: color 0.15s;
        }
        .schema-code-link:hover {
          color: #6ad8c2;
          text-decoration-color: #6ad8c2;
        }
      `}</style>
      <div className="fixed inset-0 z-[99] backdrop-blur-[2px]" onClick={onClose} />
      <Dialog
        id="schema-code-dialog"
        header={<span className="text-xl font-normal">Schema code</span>}
        onClose={onClose}
        width={2}
        animate
      >
        <Box padding={4}>
          <Stack space={4}>
            <Text size={1} muted>
              These Sanity schema definitions are generated from <strong>{schemaSource}</strong>. Paste
              them into a Studio project&apos;s schema folder for testing. Features like custom inputs,
              validation, conditional fields, and fieldsets are not included.
            </Text>

            <Flex gap={3} style={{height: 'calc(80vh - 160px)', minHeight: 400}}>
              <div
                className="flex-shrink-0 overflow-y-auto rounded-lg border border-gray-200 dark:border-gray-700"
                style={{width: 220}}
              >
                <div className="py-1">
                  {types.map((type) => {
                    const isSelected = type.name === selectedType
                    const isReferenced = referencedTypeNames.has(type.name)
                    return (
                      <button
                        key={type.name}
                        className={`w-full text-left px-3 py-2 transition-colors ${isSelected ? 'bg-blue-50 dark:bg-blue-950' : 'hover:bg-gray-50 dark:hover:bg-gray-800'}`}
                        onClick={() => setSelectedType(type.name)}
                      >
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <div className={`text-[13px] leading-snug ${isSelected ? 'font-medium text-gray-900 dark:text-gray-100' : 'text-gray-700 dark:text-gray-300'}`}>
                              {type.name}
                            </div>
                            <div className="text-[11px] text-gray-400 dark:text-gray-500 mt-0.5">
                              {type.fields.length} field{type.fields.length !== 1 ? 's' : ''}
                            </div>
                          </div>
                          {isReferenced && (
                            <HiOutlineLink
                              className="flex-shrink-0 text-blue-400"
                              title="Referenced by other types"
                              size={12}
                            />
                          )}
                        </div>
                      </button>
                    )
                  })}
                </div>
              </div>

              <div className="flex-1 min-w-0 flex flex-col">
                <div className="rounded-lg p-4 overflow-auto text-sm font-mono flex-1" style={{backgroundColor: '#1f1f1f', color: '#d4d4d4'}}>
                  <pre className="m-0 whitespace-pre">
                    <code>
                      {highlightedLines.map((lineSegments, lineIdx) => (
                        <span key={lineIdx}>
                          {lineSegments.map((seg, segIdx) =>
                            seg.onClick ? (
                              <span
                                key={segIdx}
                                className={seg.className}
                                onClick={seg.onClick}
                                role="button"
                                tabIndex={0}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') seg.onClick?.()
                                }}
                              >
                                {seg.text}
                              </span>
                            ) : (
                              <span key={segIdx} className={seg.className}>
                                {seg.text}
                              </span>
                            ),
                          )}
                          {lineIdx < highlightedLines.length - 1 ? '\n' : ''}
                        </span>
                      ))}
                    </code>
                  </pre>
                </div>
              </div>
            </Flex>

            <Flex justify="flex-end">
              <Button
                icon={GrDownload}
                text={`Download All (${types.length} types)`}
                tone="primary"
                onClick={handleDownload}
              />
            </Flex>
          </Stack>
        </Box>
      </Dialog>
    </>
  )
}
