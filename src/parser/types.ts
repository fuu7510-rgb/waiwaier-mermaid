export interface ERDiagram {
  entities: Map<string, Entity>;
  relationships: Relationship[];
}

export interface Entity {
  name: string;
  label: string;
  attributes: Attribute[];
}

export interface Attribute {
  type: string;
  name: string;
  keys: string[];
  comment: string;
}

export interface Relationship {
  entityA: string;
  entityB: string;
  cardinalityA: Cardinality;
  cardinalityB: Cardinality;
  identifying: boolean;
  label: string;
}

export interface Cardinality {
  min: 'zero' | 'one';
  max: 'one' | 'many';
}

export interface LayoutData {
  version: number;
  diagramFile: string;
  contentHash: string;
  canvas: {
    panX: number;
    panY: number;
    zoom: number;
  };
  entities: Record<string, { x: number; y: number }>;
  labels?: Record<string, string>;
}

export interface ERDiagramJSON {
  entities: Record<string, Entity>;
  relationships: Relationship[];
}
