# Edge Routing Improvements

## Current Implementation (v1)

### Port Distribution
- Connections to the same entity edge are distributed evenly along the edge
- Ports are sorted by peer entity center coordinate for intuitive ordering
- Minimum padding from edge corners ensures visual clarity

### Mid-path Offset
- Edges sharing the same entity side and side pattern get offset mid-segments
- Prevents vertical/horizontal segment overlap in orthogonal routing
- `SPREAD_SPACING = 20px` between adjacent edge mid-segments

---

## Future Improvement Ideas

### 1. Congestion-based Side Selection
Instead of choosing the connection side purely by relative position (dx vs dy), factor in how many connections already use each side. Prefer less congested sides to distribute load more evenly.

**Approach:**
- Count existing connections per entity side
- Weight side selection: `score = positionScore - congestionPenalty`
- Iterate until stable (may require multiple passes)

### 2. Sweep Line Edge Crossing Minimization
Use a sweep line algorithm to detect and minimize edge crossings. After initial port assignment, swap port positions within each entity side group to reduce total crossings.

**Approach:**
- Build a list of all edge segments
- Sweep vertically (or horizontally) to detect crossings
- For each pair of crossing edges on the same entity side, try swapping their ports
- Accept swaps that reduce total crossings

### 3. Edge Bundling
Group edges that travel in similar directions and bundle them together, splitting only near their endpoints. This reduces visual clutter in dense diagrams.

**Approach:**
- Cluster edges by direction and proximity
- Route bundled edges through shared intermediate waypoints
- Fan out near entity connections

### 4. Bezier Curve Routing
Replace orthogonal (right-angle) routing with smooth Bezier curves. This can make diagrams more readable when many edges overlap.

**Approach:**
- Use cubic Bezier curves with control points based on connection side
- Control point distance proportional to entity separation
- Avoids sharp corners, looks more natural

### 5. Obstacle-aware Routing
Route edges around entities they don't connect to, preventing lines from crossing over entity boxes.

**Approach:**
- Build an obstacle map from entity rectangles
- Use A* or visibility graph for pathfinding
- Fall back to orthogonal routing when no obstacles are in the way
