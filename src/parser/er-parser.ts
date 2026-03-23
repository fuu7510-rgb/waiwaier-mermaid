import type { ERDiagram, Entity, Attribute, Relationship, Cardinality } from './types.js';

// Relationship pattern: ENTITY_A CARDINALITY--CARDINALITY ENTITY_B : "label"
// Cardinality symbols: ||  o|  |{  o{  }|  }o
// Line style: -- (identifying/solid), .. (non-identifying/dashed)
const RELATIONSHIP_RE =
  /^\s*(\w+)\s+([o|}{]{1,2})\s*(-{2}|\.{2})\s*([o|}{]{1,2})\s+(\w+)\s*:\s*"?([^"]*)"?\s*$/;

// Entity block start: ENTITY { or ENTITY["label"] {
const ENTITY_START_RE = /^\s*(\w+)(?:\["([^"]*)"\])?\s*\{\s*$/;

// Attribute line: type name PK,FK "comment"
const ATTRIBUTE_RE =
  /^\s+(\w+)\s+(\w+)\s*(?:((?:PK|FK|UK)(?:\s*,\s*(?:PK|FK|UK))*))?(?:\s+"([^"]*)")?\s*$/;

// erDiagram directive
const ER_DIAGRAM_RE = /^\s*erDiagram\s*$/;

// Comment or empty
const SKIP_RE = /^\s*(?:%%.*)?$/;

export function parseCardinality(sym: string): Cardinality {
  const s = sym.trim();

  switch (s) {
    case '||':
      return { min: 'one', max: 'one' };
    case 'o|':
    case '|o':
      return { min: 'zero', max: 'one' };
    case '|{':
    case '}|':
      return { min: 'one', max: 'many' };
    case 'o{':
    case '}o':
      return { min: 'zero', max: 'many' };
    default:
      return { min: 'one', max: 'one' };
  }
}

export function parseERDiagram(source: string): ERDiagram {
  const entities = new Map<string, Entity>();
  const relationships: Relationship[] = [];
  const lines = source.split('\n');

  let currentEntity: Entity | null = null;
  let insideErDiagram = false;

  for (const line of lines) {
    // Skip comments and empty lines
    if (SKIP_RE.test(line)) continue;

    // Detect erDiagram keyword
    if (ER_DIAGRAM_RE.test(line)) {
      insideErDiagram = true;
      continue;
    }

    if (!insideErDiagram) continue;

    // Inside entity block - closing brace
    if (currentEntity && /^\s*\}\s*$/.test(line)) {
      entities.set(currentEntity.name, currentEntity);
      currentEntity = null;
      continue;
    }

    // Inside entity block - attribute line
    if (currentEntity) {
      const attrMatch = line.match(ATTRIBUTE_RE);
      if (attrMatch) {
        const keys = attrMatch[3]
          ? attrMatch[3].split(/\s*,\s*/).map((k) => k.trim())
          : [];
        currentEntity.attributes.push({
          type: attrMatch[1],
          name: attrMatch[2],
          keys,
          comment: attrMatch[4] || '',
        });
      }
      continue;
    }

    // Entity block start
    const entityMatch = line.match(ENTITY_START_RE);
    if (entityMatch) {
      currentEntity = {
        name: entityMatch[1],
        label: entityMatch[2] || '',
        attributes: [],
      };
      continue;
    }

    // Relationship line
    const relMatch = line.match(RELATIONSHIP_RE);
    if (relMatch) {
      const entityA = relMatch[1];
      const cardSymA = relMatch[2];
      const lineStyle = relMatch[3];
      const cardSymB = relMatch[4];
      const entityB = relMatch[5];
      const label = relMatch[6].trim();

      if (!entities.has(entityA)) {
        entities.set(entityA, { name: entityA, label: '', attributes: [] });
      }
      if (!entities.has(entityB)) {
        entities.set(entityB, { name: entityB, label: '', attributes: [] });
      }

      relationships.push({
        entityA,
        entityB,
        cardinalityA: parseCardinality(cardSymA),
        cardinalityB: parseCardinality(cardSymB),
        identifying: lineStyle === '--',
        label,
      });
      continue;
    }

    // Standalone entity name (no block, no relationship)
    const standaloneMatch = line.match(/^\s*(\w+)\s*$/);
    if (standaloneMatch && standaloneMatch[1] !== 'erDiagram') {
      const name = standaloneMatch[1];
      if (!entities.has(name)) {
        entities.set(name, { name, label: '', attributes: [] });
      }
    }
  }

  if (currentEntity) {
    entities.set(currentEntity.name, currentEntity);
  }

  return { entities, relationships };
}
