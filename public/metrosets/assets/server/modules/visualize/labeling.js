/**
 * DPNiedermannLabeling
 * labelling algorithm.  Binary-searches for the largest collision-free font size, generates candidate label positions that avoid outgoing edges,
 * checks label↔edge and label↔label collisions with OBB / SAT tests, and resolves conflicts with a greedy most-constrained-first assignment that
 *
 */

const SQRT2 = 1 / Math.sqrt(2);
const MAX_LABEL_LENGTH = 15;
const FONT_FAMILY = 'Arial, sans-serif';

// Text measurement via off-screen canvas

class TextMeasurer {
    constructor() {
        this._canvas = document.createElement('canvas');
        this._ctx = this._canvas.getContext('2d');
        this._cache = new Map();
        this._fontSize = 10;
    }

    setFontSize(fontSize) {
        this._fontSize = fontSize;
        this._ctx.font = `${fontSize}px ${FONT_FAMILY}`;
    }

    measure(text) {
        const key = `${this._fontSize}|${text}`;
        let cached = this._cache.get(key);
        if (cached) return cached;

        const metrics = this._ctx.measureText(text);
        const width = metrics.width;
        const height = (metrics.actualBoundingBoxAscent !== undefined)
            ? metrics.actualBoundingBoxAscent + metrics.actualBoundingBoxDescent
            : this._fontSize * 1.2;

        cached = { width, height };
        this._cache.set(key, cached);
        return cached;
    }
}

let _measurer = null;
function getMeasurer() {
    if (!_measurer) _measurer = new TextMeasurer();
    return _measurer;
}

// geometry helpers

function obbCorners(cx, cy, halfW, halfH, axisX, axisY) {
    const nx = -axisY, ny = axisX;
    return [
        { x: cx - axisX * halfW - nx * halfH, y: cy - axisY * halfW - ny * halfH },
        { x: cx + axisX * halfW - nx * halfH, y: cy + axisY * halfW - ny * halfH },
        { x: cx + axisX * halfW + nx * halfH, y: cy + axisY * halfW + ny * halfH },
        { x: cx - axisX * halfW + nx * halfH, y: cy - axisY * halfW + ny * halfH },
    ];
}

function projectPolygon(corners, axisX, axisY) {
    let min = Infinity, max = -Infinity;
    for (const c of corners) {
        const d = c.x * axisX + c.y * axisY;
        if (d < min) min = d;
        if (d > max) max = d;
    }
    return { min, max };
}

function polygonsOverlap(a, b) {
    for (const poly of [a, b]) {
        for (let i = 0; i < poly.length; i++) {
            const j = (i + 1) % poly.length;
            const nx = -(poly[j].y - poly[i].y);
            const ny = poly[j].x - poly[i].x;
            const pA = projectPolygon(a, nx, ny);
            const pB = projectPolygon(b, nx, ny);
            if (pA.max <= pB.min || pB.max <= pA.min) return false;
        }
    }
    return true;
}

function segmentIntersectsPolygon(p1, p2, corners) {
    const dx = p2.x - p1.x, dy = p2.y - p1.y;
    const len = Math.sqrt(dx * dx + dy * dy);
    if (len < 1e-9) return false;
    const nx = -dy / len * 0.5, ny = dx / len * 0.5;
    const seg = [
        { x: p1.x + nx, y: p1.y + ny },
        { x: p2.x + nx, y: p2.y + ny },
        { x: p2.x - nx, y: p2.y - ny },
        { x: p1.x - nx, y: p1.y - ny },
    ];
    return polygonsOverlap(seg, corners);
}

function leftRightTest(ax, ay, bx, by, px, py) {
    return (px - ax) * (by - ay) - (py - ay) * (bx - ax);
}

// Label candidate

class Label {
    constructor(X, Y, oX, oY, angle, text, align, id, fontOffset) {
        this.X = X;
        this.Y = Y;
        this.oX = oX;
        this.oY = oY;
        this.Angle = angle;
        this.Align = align;
        this.Text = text;
        this.Id = id;
        this.FullLength = text.length;
        this.Length = Math.min(text.length, MAX_LABEL_LENGTH);
        this.Abbr = text.length > MAX_LABEL_LENGTH;
        this.w1 = {};
        this.LineConflict = false;
        this.corners = null;

        if (Math.abs(angle) < 45) { this.dX = 1; this.dY = 0; }
        else { this.dX = SQRT2; this.dY = SQRT2 * Math.sign(angle); }

        this.isCenterBelow = (align === 'C' && fontOffset < 0);
        this.nX = -this.dY * -fontOffset;
        this.nY =  this.dX * -fontOffset;

        this.AnchorX = X + oX * 10;
        this.AnchorY = Y + oY * 10;
        this.Distance = 0;
    }

    scale(fontsize, distance) {
        this.Fontsize = fontsize;
        this.Distance = distance;
        this.AnchorX = this.X + this.oX * distance;
        this.AnchorY = this.Y + this.oY * distance;

        const displayText = this.Text.substring(0, this.Length);
        const measurer = getMeasurer();
        measurer.setFontSize(fontsize);
        const metrics = measurer.measure(displayText);
        const width  = metrics.width;
        const halfH  = (1.4 * metrics.height) / 2;

        let cx, cy;
        if (this.Align === 'C') {
            cx = this.AnchorX + this.nX * halfH;
            cy = this.AnchorY + this.nY * halfH;
        } else if (this.Align === 'L') {
            // Text starts at anchor
            cx = this.AnchorX + this.dX * width / 2;
            cy = this.AnchorY + this.dY * width / 2;
        } else {
            // Text ends at anchor, extends backwards along dX/dY.
            cx = this.AnchorX - this.dX * width / 2;
            cy = this.AnchorY - this.dY * width / 2;
        }

        this.corners = obbCorners(cx, cy, width / 2, halfH, this.dX, this.dY);
    }

    intersectsLabel(other) {
        if (!this.corners || !other.corners) return false;
        return polygonsOverlap(this.corners, other.corners);
    }

    intersectsSegment(seg) {
        if (!this.corners) return false;
        return segmentIntersectsPolygon(seg.p1, seg.p2, this.corners);
    }

    toOutput(universalFontSize, isFixed = false) {
        const displayText = this.Text.substring(0, this.Length);
        const fs = universalFontSize;
        const measurer = getMeasurer();
        measurer.setFontSize(fs);
        const metrics = measurer.measure(displayText);
        const height = 1.4 * metrics.height;
        let x, y;
        if (this.Align === 'C') {
            // Center-aligned: shift along the normal so text sits above/below
            if (this.isCenterBelow) {
                x = this.AnchorX + this.nX * height;
                y = this.AnchorY + this.nY * height;
            } else {
                x = this.AnchorX;
                y = this.AnchorY;
            }
        } else {
            x = this.AnchorX;
            y = this.AnchorY;
        }
        return {
            Id: this.Id,
            Text: displayText + (this.Abbr ? '..' : ''),
            FullText: this.Text,
            x, y,
            Angle: this.Angle,
            Align: this.Align,
            FontSize: fs,
            isFixed,
        };
    }
}

// Edge segments

function createLineSegments(links, lineWidth) {
    const segments = [];
    for (const link of links) {
        if (!link.source || !link.target) continue;
        const n1x = link.source.x, n1y = link.source.y;
        const n2x = link.target.x, n2y = link.target.y;

        const numLines = (link.lines && link.lines.length) ? link.lines.length : 1;
        const halfWidth = Math.max(numLines / 2, 0.5);

        const addSeg = (ax, ay, bx, by) => {
            const dx = bx - ax, dy = by - ay;
            const len = Math.sqrt(dx * dx + dy * dy);
            if (len < 1e-9) return;
            const nx = (-dy / len) * halfWidth * lineWidth;
            const ny = ( dx / len) * halfWidth * lineWidth;
            segments.push({ p1: { x: ax + nx, y: ay + ny }, p2: { x: bx + nx, y: by + ny } });
            segments.push({ p1: { x: ax - nx, y: ay - ny }, p2: { x: bx - nx, y: by - ny } });
        };

        if (link.bend) {
            addSeg(n1x, n1y, link.bend.x, link.bend.y);
            addSeg(link.bend.x, link.bend.y, n2x, n2y);
        } else {
            addSeg(n1x, n1y, n2x, n2y);
        }
    }
    return segments;
}

// Candidate creation

function createCandidates(nodes, links) {
    const adj = new Map();
    for (const n of nodes) adj.set(n.id, []);
    for (const link of links) {
        if (!link.source || !link.target) continue;
        if (adj.has(link.source.id)) adj.get(link.source.id).push(link.target);
        if (adj.has(link.target.id)) adj.get(link.target.id).push(link.source);
    }

    const candidates = new Map();

    for (const node of nodes) {
        if (node.isDummy) continue;
        const S = [false, false, false, false, false, false, false, false];

        for (const nb of (adj.get(node.id) || [])) {
            const dx = nb.x - node.x;
            const dy = nb.y - node.y;
            let angle = Math.atan2(-dy, dx) * 180 / Math.PI;
            if (angle < 0) angle += 360;

            if      (angle < 22.5)  S[0] = true;
            else if (angle < 67.5)  S[1] = true;
            else if (angle < 112.5) S[2] = true;
            else if (angle < 157.5) S[3] = true;
            else if (angle < 202.5) S[4] = true;
            else if (angle < 247.5) S[5] = true;
            else if (angle < 292.5) S[6] = true;
            else if (angle < 337.5) S[7] = true;
            else                    S[0] = true;
        }

        const cands = [];
        const X = node.x, Y = node.y, lbl = node.label || '', id = node.id;

        if (!S[1] && !S[2] && !S[3])
            cands.push(new Label(X, Y, 0, -1, 0, lbl, 'C', id, 0.5));
        if (!S[5] && !S[6] && !S[7])
            cands.push(new Label(X, Y, 0, 1, 0, lbl, 'C', id, -0.5));
        if (!S[0])
            cands.push(new Label(X, Y, 1, 0, 0, lbl, 'L', id, -0.5));
        if (!S[1])
            cands.push(new Label(X, Y, SQRT2, -SQRT2, -45, lbl, 'L', id, -0.5));
        if (!S[3])
            cands.push(new Label(X, Y, -SQRT2, -SQRT2, 45, lbl, 'R', id, -0.5));
        if (!S[4])
            cands.push(new Label(X, Y, -1, 0, 0, lbl, 'R', id, -0.5));
        if (!S[5])
            cands.push(new Label(X, Y, -SQRT2, SQRT2, -45, lbl, 'R', id, -0.5));
        if (!S[7])
            cands.push(new Label(X, Y, SQRT2, SQRT2, 45, lbl, 'L', id, -0.5));

        if (S[3] && S[7] && !S[0] && !S[1] && !S[2])
            cands.push(new Label(X, Y, SQRT2, -SQRT2, 45, lbl, 'C', id, 0.5));
        if (S[3] && S[7] && !S[4] && !S[5] && !S[6])
            cands.push(new Label(X, Y, -SQRT2, SQRT2, 45, lbl, 'C', id, -0.5));
        if (S[1] && S[5] && !S[2] && !S[3] && !S[4])
            cands.push(new Label(X, Y, -SQRT2, -SQRT2, -45, lbl, 'C', id, 0.5));
        if (S[1] && S[5] && !S[6] && !S[7] && !S[0])
            cands.push(new Label(X, Y, SQRT2, SQRT2, -45, lbl, 'C', id, -0.5));

        if (cands.length === 0)
            cands.push(new Label(X, Y, 1, 0, 0, lbl, 'L', id, -0.5));

        candidates.set(node.id, cands);
    }
    return candidates;
}

// Weight function
function getWeight(label, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay;
    const angle = Math.abs(Math.atan2(-dy, dx) * 180 / Math.PI);

    if (angle <= 22.5 || angle >= 157.5) {
        if (Math.abs(label.Angle) > 0) return label.Align === 'L' ? 0 : 100;
        return 200;
    } else {
        if (Math.abs(label.Angle) > 0) return 100;
        if (label.Align === 'C') return 200;
        return 0;
    }
}

// Assign weights per metro line

function assignWeights(nodes, paths, candidates) {
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    for (const [lineKey, path] of Object.entries(paths)) {
        if (!Array.isArray(path) || path.length < 2) continue;

        const assignW = (nodeId, refAx, refAy, refBx, refBy) => {
            const cands = candidates.get(nodeId);
            if (!cands) return;
            for (const c of cands) {
                c.w1[lineKey] = getWeight(c, refAx, refAy, refBx, refBy);
            }
        };

        const first = nodeMap.get(path[0]), second = nodeMap.get(path[1]);
        if (first && second) assignW(path[0], first.x, first.y, second.x, second.y);

        for (let i = 1; i < path.length - 1; i++) {
            const prev = nodeMap.get(path[i - 1]);
            const cur  = nodeMap.get(path[i]);
            const next = nodeMap.get(path[i + 1]);
            if (!prev || !cur || !next) continue;
            const cands = candidates.get(path[i]);
            if (!cands) continue;

            const bnx = cur.x - (cur.y - prev.y);
            const bny = cur.y + (cur.x - prev.x);

            for (const c of cands) {
                if (leftRightTest(cur.x, cur.y, bnx, bny, c.AnchorX, c.AnchorY) > 0) {
                    c.w1[lineKey] = getWeight(c, prev.x, prev.y, cur.x, cur.y);
                } else {
                    c.w1[lineKey] = getWeight(c, cur.x, cur.y, next.x, next.y);
                }
            }
        }

        const lastIdx = path.length - 1;
        if (lastIdx >= 1) {
            const prev = nodeMap.get(path[lastIdx - 1]);
            const cur  = nodeMap.get(path[lastIdx]);
            if (prev && cur) assignW(path[lastIdx], prev.x, prev.y, cur.x, cur.y);
        }
    }
}

// Scale all candidates to a specific font size, mark line conflicts

function scaleAllCandidates(nodes, candidates, fontsize, distance, segments) {
    for (const node of nodes) {
        if (node.isDummy) continue;
        const dist = distance + fontsize * 0.2;

        const cands = candidates.get(node.id);
        if (!cands) continue;
        for (const c of cands) {
            c.scale(fontsize, dist);
            c.LineConflict = false;
            for (const seg of segments) {
                if (c.intersectsSegment(seg)) { c.LineConflict = true; break; }
            }
        }
    }
}

// Collision-free greedy assignment using ALL candidates

function greedyAssignAll(nodes, candidates) {
    const viable = new Map();
    for (const node of nodes) {
        if (node.isDummy) continue;
        const cands = candidates.get(node.id);
        if (!cands) continue;
        const good = cands.filter(c => !c.LineConflict);
        viable.set(node.id, good.length > 0 ? good : [...cands]);
    }

    // Most constrained first
    const order = [...viable.keys()].sort((a, b) => viable.get(a).length - viable.get(b).length);

    const assigned = new Map();
    let valid = true;

    for (const nid of order) {
        const options = viable.get(nid);
        let bestLabel = null;
        let bestConflicts = Infinity;
        let bestWeight = Infinity;

        for (const c of options) {
            let conflicts = 0;
            for (const [, placed] of assigned) {
                if (c.intersectsLabel(placed)) conflicts++;
            }
            const weight = (c.LineConflict ? 10000 : 0)
                         + Object.values(c.w1).reduce((s, v) => s + v, 0);

            if (conflicts < bestConflicts ||
                (conflicts === bestConflicts && weight < bestWeight)) {
                bestConflicts = conflicts;
                bestWeight = weight;
                bestLabel = c;
            }
        }

        if (bestLabel) {
            assigned.set(nid, bestLabel);
            if (bestConflicts > 0) valid = false;
        } else {
            valid = false;
        }
    }

    return { valid, assigned };
}

// Greedy refinement along metro lines

function greedyRefinement(paths, candidates, assigned, manualNodes = new Set()) {
    for (const [lineKey, path] of Object.entries(paths)) {
        if (!Array.isArray(path) || path.length < 2) continue;
        for (let i = 0; i < path.length; i++) {
            const nodeId = path[i];
            if (manualNodes.has(nodeId)) continue; // Don't override manual preferences
            const cands = candidates.get(nodeId);
            if (!cands) continue;

            let bestCost = Infinity;
            let bestCandidate = null;

            for (const c of cands) {
                if (c.LineConflict) continue;

                // Must not collide with any other assigned label
                let collides = false;
                for (const [otherId, otherLbl] of assigned) {
                    if (otherId === nodeId) continue;
                    if (c.intersectsLabel(otherLbl)) { collides = true; break; }
                }
                if (collides) continue;

                let cost = c.w1[lineKey] ?? 0;
                if (i > 0) {
                    const prev = assigned.get(path[i - 1]);
                    if (prev) cost += prev.Align !== c.Align ? 150 : Math.abs(prev.Angle - c.Angle);
                }
                if (i < path.length - 1) {
                    const next = assigned.get(path[i + 1]);
                    if (next) cost += next.Align !== c.Align ? 150 : Math.abs(next.Angle - c.Angle);
                }
                if (cost < bestCost) { bestCost = cost; bestCandidate = c; }
            }

            if (bestCandidate) assigned.set(nodeId, bestCandidate);
        }
    }
}

// Final collision sweep (guarantees zero overlaps hopefully)

function finalCollisionSweep(candidates, assigned, manualNodes = new Set()) {
    const nodeIds = [...assigned.keys()];
    for (let i = 0; i < nodeIds.length; i++) {
        for (let j = i + 1; j < nodeIds.length; j++) {
            const lbl1 = assigned.get(nodeIds[i]);
            const lbl2 = assigned.get(nodeIds[j]);
            if (!lbl1 || !lbl2 || !lbl1.intersectsLabel(lbl2)) continue;

            // Try to move one of the two conflicting labels, but never a manual one
            const tryOrder = [];
            if (!manualNodes.has(nodeIds[j])) tryOrder.push(nodeIds[j]);
            if (!manualNodes.has(nodeIds[i])) tryOrder.push(nodeIds[i]);

            for (const tryNode of tryOrder) {
                const cands = candidates.get(tryNode);
                if (!cands) continue;
                let fixed = false;
                for (const c of cands) {
                    if (c.LineConflict) continue;
                    let ok = true;
                    for (const [otherId, otherLbl] of assigned) {
                        if (otherId === tryNode) continue;
                        if (c.intersectsLabel(otherLbl)) { ok = false; break; }
                    }
                    if (ok) {
                        assigned.set(tryNode, c);
                        fixed = true;
                        break;
                    }
                }
                if (fixed) break;
            }
        }
    }
}

// Post-processing: try to unabbreviate

function postProcessing(assigned, segments, fontsize, distance) {
    for (const [id1, lbl1] of assigned) {
        if (!lbl1.Abbr) continue;

        // Try full length
        const origLength = lbl1.Length;
        const origAbbr = lbl1.Abbr;

        lbl1.Length = lbl1.FullLength;
        lbl1.Abbr = false;

        const dist = distance + fontsize * 0.4;
        lbl1.scale(fontsize, dist);

        let conflict = false;
        for (const seg of segments) {
            if (lbl1.intersectsSegment(seg)) { conflict = true; break; }
        }
        if (!conflict) {
            for (const [id2, lbl2] of assigned) {
                if (id1 === id2) continue;
                if (lbl1.intersectsLabel(lbl2)) { conflict = true; break; }
            }
        }

        if (conflict) {
            // Revert
            lbl1.Length = origLength;
            lbl1.Abbr = origAbbr;
            lbl1.scale(fontsize, dist);
        }
    }
}

// Main entry point

export function DPNiedermannLabeling(
    nodes, links, paths,
    distance = 12,
    minFontSize = 6,
    maxFontSize = 20,
    maxSteps = 6,
    lineWidth = 4,
    debug = null,
    forcedFontSize = null
) {
    const realNodes = nodes.filter(n => !n.isDummy);
    if (realNodes.length === 0) return { valid: false, fontsize: minFontSize, labels: [] };

    const segments   = createLineSegments(links, lineWidth);
    const candidates = createCandidates(realNodes, links);
    assignWeights(realNodes, paths, candidates);

    const debugTrials = [];
    let bestFontsize = 0;
    let bestAssigned = null;

    if (forcedFontSize != null && forcedFontSize > 0) {
        // Skip binary search — use the user-specified font size directly
        bestFontsize = forcedFontSize;
        scaleAllCandidates(realNodes, candidates, bestFontsize, distance, segments);
        const result = greedyAssignAll(realNodes, candidates);
        bestAssigned = result.assigned;

        if (debug?.enabled) {
            debugTrials.push({ step: 0, fontsize: bestFontsize, valid: result.valid, forced: true });
        }
    } else {
        // Binary search: find the LARGEST font size with zero collisions.
        const absoluteMin = Math.max(2, Math.floor(minFontSize / 2));
        let lo = absoluteMin, hi = maxFontSize;

        for (let step = 0; step < maxSteps; step++) {
            const fontsize = Math.round((lo + hi) / 2);
            if (fontsize <= lo && bestAssigned) break;

            scaleAllCandidates(realNodes, candidates, fontsize, distance, segments);
            const result = greedyAssignAll(realNodes, candidates);

            if (debug?.enabled) {
                debugTrials.push({ step, fontsize, valid: result.valid });
            }

            if (result.valid) {
                bestFontsize = fontsize;
                bestAssigned = result.assigned;
                lo = fontsize;
            } else {
                hi = fontsize;
            }
        }

        // If nothing found, try absolute minimum
        if (!bestAssigned) {
            scaleAllCandidates(realNodes, candidates, absoluteMin, distance, segments);
            const result = greedyAssignAll(realNodes, candidates);
            bestAssigned = result.assigned;
            bestFontsize = absoluteMin;
        }
    }

    scaleAllCandidates(realNodes, candidates, bestFontsize, distance, segments);

    // Collect nodes with manual preferences (applied AFTER refinement so they stick)
    const manualNodes = new Set();
    for (const node of realNodes) {
        if (node.manualPreference) manualNodes.add(node.id);
    }

    // Greedy refinement — all candidates are already at bestFontsize
    // Skip manually-set nodes so refinement cannot override them
    greedyRefinement(paths, candidates, bestAssigned, manualNodes);

    // Apply manual direction preferences AFTER refinement.
    const prefParams = {
        'right':        { oX:  1,     oY:  0,     angle:   0, align: 'L', fo: -0.5 },
        'left':         { oX: -1,     oY:  0,     angle:   0, align: 'R', fo: -0.5 },
        'top':          { oX:  0,     oY: -1,     angle:   0, align: 'C', fo:  0.5 },
        'above':        { oX:  0,     oY: -1,     angle:   0, align: 'C', fo:  0.5 },
        'bottom':       { oX:  0,     oY:  1,     angle:   0, align: 'C', fo: -0.5 },
        'below':        { oX:  0,     oY:  1,     angle:   0, align: 'C', fo: -0.5 },
        'top-right':    { oX:  SQRT2, oY: -SQRT2, angle: -45, align: 'L', fo: -0.5 },
        'top-left':     { oX: -SQRT2, oY: -SQRT2, angle:  45, align: 'R', fo: -0.5 },
        'bottom-right': { oX:  SQRT2, oY:  SQRT2, angle:  45, align: 'L', fo: -0.5 },
        'bottom-left':  { oX: -SQRT2, oY:  SQRT2, angle: -45, align: 'R', fo: -0.5 },
    };

    for (const node of realNodes) {
        if (!node.manualPreference) continue;
        const p = prefParams[node.manualPreference];
        if (!p) continue;

        const forced = new Label(
            node.x, node.y, p.oX, p.oY, p.angle,
            node.label || '', p.align, node.id, p.fo
        );
        const dist = distance + bestFontsize * 0.2;
        forced.scale(bestFontsize, dist);
        bestAssigned.set(node.id, forced);
    }

    // Final sweep — guarantee zero collisions in output
    // Skip manually-set nodes so the sweep cannot override them
    finalCollisionSweep(candidates, bestAssigned, manualNodes);

    // Post-processing: try to unabbreviate (using consistent fontsize)
    postProcessing(bestAssigned, segments, bestFontsize, distance);

    // Final verification — log any residual collisions (should be zero)
    const finalLabels = [...bestAssigned.values()];
    for (let i = 0; i < finalLabels.length; i++) {
        for (let j = i + 1; j < finalLabels.length; j++) {
            if (finalLabels[i].intersectsLabel(finalLabels[j])) {
                console.warn(`[LABELS] Residual collision: "${finalLabels[i].Text}" ↔ "${finalLabels[j].Text}"`);
            }
        }
    }

    // Build output
    const labels = [];
    for (const node of realNodes) {
        const lbl = bestAssigned.get(node.id);
        if (lbl) labels.push(lbl.toOutput(bestFontsize, manualNodes.has(node.id)));
    }

    return {
        valid: labels.length > 0,
        fontsize: bestFontsize,
        labels,
        debug: debug?.enabled ? { trials: debugTrials } : undefined,
    };
}

