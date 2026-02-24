export type EntityPositions = Record<string, { x: number; y: number }>;

function clonePositions(positions: EntityPositions): EntityPositions {
  const result: EntityPositions = {};
  for (const key in positions) {
    result[key] = { x: positions[key].x, y: positions[key].y };
  }
  return result;
}

export class HistoryManager {
  private stack: EntityPositions[] = [];
  private pointer = -1;
  private maxSize: number;

  constructor(maxSize = 50) {
    this.maxSize = maxSize;
  }

  init(positions: EntityPositions): void {
    this.stack = [clonePositions(positions)];
    this.pointer = 0;
  }

  push(positions: EntityPositions): void {
    // Discard any redo states
    this.stack.length = this.pointer + 1;
    this.stack.push(clonePositions(positions));
    this.pointer++;
    // Trim old history if exceeding maxSize
    if (this.stack.length > this.maxSize) {
      this.stack.shift();
      this.pointer--;
    }
  }

  undo(): EntityPositions | null {
    if (!this.canUndo) return null;
    this.pointer--;
    return clonePositions(this.stack[this.pointer]);
  }

  redo(): EntityPositions | null {
    if (!this.canRedo) return null;
    this.pointer++;
    return clonePositions(this.stack[this.pointer]);
  }

  get canUndo(): boolean {
    return this.pointer > 0;
  }

  get canRedo(): boolean {
    return this.pointer < this.stack.length - 1;
  }

  clear(): void {
    this.stack = [];
    this.pointer = -1;
  }
}
