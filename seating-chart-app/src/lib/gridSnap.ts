// An invisible alignment grid for dragging tables and venue elements on
// the canvas: no grid lines are ever drawn, but a dragged shape's position
// snaps to this spacing as it moves, so shapes naturally line up with each
// other without the user having to eyeball pixel positions. Applied via
// each shape's onDragMove (see TableCircle/ElementRect), operating on the
// node's own local x/y — the same logical units shape.x/shape.y are
// stored in — so the grid stays a fixed size regardless of zoom or pan.
export const GRID_SIZE = 20;

export function snapToGrid(value: number): number {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}
