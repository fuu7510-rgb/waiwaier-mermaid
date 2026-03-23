import { z } from 'zod';

const canvasSchema = z.object({
  panX: z.number(),
  panY: z.number(),
  zoom: z.number(),
});

const entityPositionSchema = z.object({
  x: z.number(),
  y: z.number(),
});

export const layoutDataSchema = z.object({
  version: z.number(),
  diagramFile: z.string(),
  contentHash: z.string(),
  canvas: canvasSchema,
  entities: z.record(z.string(), entityPositionSchema),
  labels: z.record(z.string(), z.string()).optional(),
  compactEntities: z.record(z.string(), entityPositionSchema).optional(),
  compactCanvas: canvasSchema.optional(),
  groups: z.record(z.string(), z.object({
    color: z.string(),
    entities: z.array(z.string()),
  })).optional(),
}).strip();
