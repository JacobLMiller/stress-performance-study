/**
 * @file This file contains the JavaScript implementation of the metro line crossing minimization algorithm
 * described in http://jgaa.info/accepted/2010/ArgyriouBekosKaufmannSymvonis2010.14.1.pdf.
 */

/**
 * Calculates the orientation of the ordered triplet (p, q, r).
 * @param {object} p - The first point {x, y}.
 * @param {object} q - The second point {x, y}.
 * @param {object} r - The third point {x, y}.
 * @returns {number} 0 if collinear, 1 if clockwise, 2 if counterclockwise.
 */
function orientation(p, q, r) {
    const val = (q.y - p.y) * (r.x - q.x) - (q.x - p.x) * (r.y - q.y);
    if (Math.abs(val) < 1e-10) return 0; // Collinear
    return (val > 0) ? 1 : 2; // Clockwise or Counterclockwise
}

/**
 * Determines if line p1-p2 is "above" p1-p3 relative to p0-p1.
 * @param {object} p0 - Point defining the reference vector.
 * @param {object} p1 - The common vertex.
 * @param {object} p2 - Endpoint of the first line segment.
 * @param {object} p3 - Endpoint of the second line segment.
 * @returns {boolean} - True if p1-p2 is counter-clockwise to p1-p3.
 */
function above(p0, p1, p2, p3) {
    const p2_orient = orientation(p0, p1, p2);
    const p3_orient = orientation(p0, p1, p3);

    if (p2_orient > p3_orient) return true;
    if (p2_orient < p3_orient) return false;

    // Handle collinear cases
    if (p2_orient === p3_orient) {
        // Based on the Python implementation's logic for collinear cases
        return orientation(p1, p2, p3) === 2; // Counter-clockwise
    }
    return false;
}


/**
 * Finds all maximal common subpaths between two paths.
 * @param {Array<string>} path1 - The first path (an array of node IDs).
 * @param {Array<string>} path2 - The second path (an array of node IDs).
 * @returns {Array<Array<string>>} - An array of maximal common subpaths.
 */
function maximal_common_subpaths(path1, path2) {
    const edges2 = new Set();
    for (let i = 0; i < path2.length - 1; i++) {
        edges2.add(`${path2[i]}|${path2[i+1]}`);
    }

    const subpaths = [];
    let furthest = 0;

    for (let i = 0; i < path1.length - 1; i++) {
        if (i < furthest) continue;

        // Case 1: Same order
        if (edges2.has(`${path1[i]}|${path1[i+1]}`)) {
            let subpath = [];
            let j = path2.indexOf(path1[i]);
            if (j !== -1 && path2[j+1] === path1[i+1]) {
                 while (i < path1.length && j < path2.length && path1[i] === path2[j]) {
                    subpath.push(path1[i]);
                    furthest = i;
                    i++;
                    j++;
                }
                if (subpath.length > 1) subpaths.push(subpath);
                i--; // Decrement i to account for the loop's increment
            }
        }
        // Case 2: Opposite order
        else if (edges2.has(`${path1[i+1]}|${path1[i]}`)) {
            let subpath = [];
            let j = path2.indexOf(path1[i]);
            if (j !== -1 && path2[j-1] === path1[i+1]) {
                while (i < path1.length && j >= 0 && path1[i] === path2[j]) {
                    subpath.push(path1[i]);
                    furthest = i;
                    i++;
                    j--;
                }
                if (subpath.length > 1) subpaths.push(subpath);
                i--; // Decrement i to account for the loop's increment
            }
        }
    }
    return subpaths;
}

/**
 * Computes maximal common subpaths for all pairs of paths.
 * @param {object} paths - A dictionary mapping line labels to paths.
 * @returns {Map<string, Array<Array<string>>>} - A map from "line1|line2" to their MCS.
 */
function all_pairs_mcs(paths) {
    const labels = Object.keys(paths);
    const all_pairs = new Map();
    for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
            const line1 = labels[i];
            const line2 = labels[j];
            const mcs = maximal_common_subpaths(paths[line1], paths[line2]);
            all_pairs.set(`${line1}|${line2}`, mcs);
            all_pairs.set(`${line2}|${line1}`, mcs);
        }
    }
    return all_pairs;
}

/**
 * Creates a crossing rule function for two lines and a shared subpath.
 * @param {string} g - Label of the first line.
 * @param {string} h - Label of the second line.
 * @param {Array<string>} path - The common subpath.
 * @returns {function(Set<string>): boolean} - A function that checks for a crossing.
 */
function crossing_rule(g, h, path) {
    const [init, scnd, pnlt, term] = [path[0], path[1], path[path.length - 2], path[path.length - 1]];
    // (g,h,u,v) is stored as a string "g|h|u|v"
    const cond1 = `${g}|${h}|${init}|${scnd}`;
    const cond2 = `${g}|${h}|${term}|${pnlt}`;
    const cond3 = `${h}|${g}|${init}|${scnd}`;
    const cond4 = `${h}|${g}|${term}|${pnlt}`;

    return (conditions) => (conditions.has(cond1) && conditions.has(cond2)) || (conditions.has(cond3) && conditions.has(cond4));
}

/**
 * Generates all possible crossing rules for the given paths.
 * @param {object} paths - A dictionary mapping line labels to paths.
 * @param {Map} all_pairs_subs - The pre-computed MCS for all pairs.
 * @returns {Set<function>} - A set of all crossing rule functions.
 */
function all_crossing_rules(paths, all_pairs_subs) {
    const labels = Object.keys(paths);
    const rules = new Set();
    for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
            const hyper1 = labels[i];
            const hyper2 = labels[j];
            const subpaths = all_pairs_subs.get(`${hyper1}|${hyper2}`);
            if (subpaths) {
                for (const sub of subpaths) {
                    if (sub.length > 1) {
                        rules.add(crossing_rule(hyper1, hyper2, sub));
                    }
                }
            }
        }
    }
    return rules;
}

const terminators = (path) => new Set([path[0], path[path.length - 1]]);
const is_terminal = (path, node) => terminators(path).has(node);

/**
 * Determines initial ordering conditions for non-terminating subpath ends.
 * @param {object} paths - Dictionary of lines and their node paths.
 * @param {Map<string, object>} layout - Map from node ID to {x, y} coordinates.
 * @param {Map} all_pairs_subs - Pre-computed MCS for all pairs.
 * @returns {Set<string>} - A set of initial ordering conditions.
 */
function initial_conditions(paths, layout, all_pairs_subs) {
    const hypers = Object.keys(paths);
    const conditions = new Set();

    for (let i = 0; i < hypers.length; i++) {
        for (let j = i + 1; j < hypers.length; j++) {
            const hyper1 = hypers[i];
            const hyper2 = hypers[j];
            const path1 = paths[hyper1];
            const path2 = paths[hyper2];
            const subpaths = all_pairs_subs.get(`${hyper1}|${hyper2}`);

            if (!subpaths) continue;

            for (const sub of subpaths) {
                if (sub.length < 2) continue;

                const init = sub[0];
                const scnd = sub[1];
                const pnlt = sub[sub.length - 2];
                const term = sub[sub.length - 1];

                const path1SubIndex = path1.indexOf(sub[0]);
                const path2SubIndex = path2.indexOf(sub[0]);
                const reversed = path1SubIndex !== -1 && path2SubIndex !== -1 && path1[path1SubIndex+1] !== path2[path2SubIndex+1];

                // Start of subpath
                if (!is_terminal(path1, init) && !is_terminal(path2, init)) {
                    const prec1 = path1[path1.indexOf(init) - 1];
                    const prec2 = path2[path2.indexOf(init) + (reversed ? 1 : -1)];
                    if(prec1 && prec2 && layout.has(scnd) && layout.has(init) && layout.has(prec1) && layout.has(prec2)) {
                        if (above(layout.get(scnd), layout.get(init), layout.get(prec1), layout.get(prec2))) {
                            conditions.add(`${hyper1}|${hyper2}|${init}|${scnd}`);
                        } else {
                            conditions.add(`${hyper2}|${hyper1}|${init}|${scnd}`);
                        }
                    }
                }

                // End of subpath
                if (!is_terminal(path1, term) && !is_terminal(path2, term)) {
                    const next1 = path1[path1.indexOf(term) + 1];
                    const next2 = path2[path2.indexOf(term) + (reversed ? -1 : 1)];
                     if(next1 && next2 && layout.has(pnlt) && layout.has(term) && layout.has(next1) && layout.has(next2)) {
                        if (above(layout.get(pnlt), layout.get(term), layout.get(next1), layout.get(next2))) {
                            conditions.add(`${hyper1}|${hyper2}|${term}|${pnlt}`);
                        } else {
                            conditions.add(`${hyper2}|${hyper1}|${term}|${pnlt}`);
                        }
                    }
                }
            }
        }
    }
    return conditions;
}


/**
 * Creates a dictionary mapping each edge to the lines that contain it.
 * @param {object} paths - Dictionary of lines and their node paths.
 * @returns {Map<string, Array<string>>} - Map from "u|v" to array of line labels.
 */
function edge_dict(paths) {
    const edgeMap = new Map();
    for (const label in paths) {
        const path = paths[label];
        for (let i = 0; i < path.length - 1; i++) {
            const u = path[i];
            const v = path[i+1];
            const key1 = `${u}|${v}`;
            const key2 = `${v}|${u}`;
            if (!edgeMap.has(key1)) edgeMap.set(key1, []);
            if (!edgeMap.has(key2)) edgeMap.set(key2, []);
            edgeMap.get(key1).push(label);
            edgeMap.get(key2).push(label);
        }
    }
    return edgeMap;
}

const count_crossings = (conditions, rules) => {
    let count = 0;
    for (const rule of rules) {
        if (rule(conditions)) {
            count++;
        }
    }
    return count;
};

/**
 * Greedily assigns positions for terminators to minimize crossings.
 * @param {object} paths - Dictionary of lines and their node paths.
 * @param {Map} layout - Map from node ID to {x, y} coordinates.
 * @param {Map} edgeOwners - Map from edge to lines.
 * @param {Set<string>} initialConditions - The initial set of conditions.
 * @param {Set<function>} rules - The set of crossing rules.
 * @returns {Set<string>} - The final set of conditions.
 */
function terminator_conditions(paths, layout, edgeOwners, initialConditions, rules) {
    let conditions = new Set(initialConditions);
    const terms = new Set();
    for (const line in paths) {
        terminators(paths[line]).forEach(node => terms.add(`${node}|${line}`));
    }

    while (terms.size > 0) {
        let max_cert = -Infinity;
        let max_term_info = null;

        for (const term of terms) {
            const [node, line] = term.split('|');
            const path = paths[line];
            const termPath = path[path.length - 1] === node ? path : [...path].reverse();
            const prec = termPath[termPath.length - 2];
            const edgeKey = `${prec}|${node}`;
            const other_lines = (edgeOwners.get(edgeKey) || []).filter(l => l !== line && !is_terminal(paths[l], node));

            // Certainty calculation
            const top_cons = new Set(other_lines.map(h => `${line}|${h}|${node}|${prec}`));
            const bot_cons = new Set(other_lines.map(h => `${h}|${line}|${node}|${prec}`));

            const unresolved = (edgeOwners.get(edgeKey) || []).filter(l => terms.has(`${node}|${l}`)).length;

            const top_crossings = count_crossings(new Set([...conditions, ...top_cons]), rules);
            const bot_crossings = count_crossings(new Set([...conditions, ...bot_cons]), rules);

            const cert = Math.abs(top_crossings - bot_crossings) - unresolved;
            const top_better = top_crossings <= bot_crossings;

            if (cert > max_cert) {
                max_cert = cert;
                max_term_info = { term, top_better, top_cons, bot_cons };
            }
        }

        if (max_term_info) {
            const { term, top_better, top_cons, bot_cons } = max_term_info;
            const to_add = top_better ? top_cons : bot_cons;
            for (const cond of to_add) {
                conditions.add(cond);
            }
            terms.delete(term);
        } else {
            // If no best option, break to avoid infinite loop
            break;
        }
    }
    return conditions;
}

/**
 * Expands the conditions to create a total ordering on all shared edges.
 * @param {object} paths - Dictionary of lines and their node paths.
 * @param {Map} mcs - Pre-computed MCS for all pairs.
 * @param {Set<string>} conditions - The current set of conditions.
 * @returns {Set<string>} - The expanded set of conditions.
 */
function expand_conditions(paths, mcs, conditions) {
    const labels = Object.keys(paths);
    let newConditions = new Set(conditions);

    const left_of = (line1, line2, subpath, conds) => {
        return conds.has(`${line2}|${line1}|${subpath[subpath.length-1]}|${subpath[subpath.length-2]}`) ||
               conds.has(`${line1}|${line2}|${subpath[0]}|${subpath[1]}`);
    };

    for (let i = 0; i < labels.length; i++) {
        for (let j = i + 1; j < labels.length; j++) {
            const line1 = labels[i];
            const line2 = labels[j];
            const subpaths = mcs.get(`${line1}|${line2}`);
            if (!subpaths) continue;

            for (const path of subpaths) {
                if (path.length < 2) continue;
                const is_left = left_of(line1, line2, path, newConditions);
                for (let l = 0; l < path.length - 1; l++) {
                    const u = path[l], v = path[l+1];
                    if (is_left) {
                        newConditions.add(`${line1}|${line2}|${u}|${v}`);
                        newConditions.add(`${line2}|${line1}|${v}|${u}`);
                    } else {
                        newConditions.add(`${line2}|${line1}|${u}|${v}`);
                        newConditions.add(`${line1}|${line2}|${v}|${u}`);
                    }
                }
            }
        }
    }
    return newConditions;
}

/**
 * Main function to get the line order for all edges.
 * @param {object} paths - Dictionary of lines (e.g., { "Line A": ["n1", "n2", "n3"] }).
 * @param {Map<string, object>} layout - Map from node ID to {x, y} coordinates.
 * @returns {Map<string, Array<string>>} - A map from edge key "u|v" to an ordered array of line labels.
 */
export function get_line_order(paths, layout) {
    // 1. Pre-computation
    const all_pairs = all_pairs_mcs(paths);
    const rules = all_crossing_rules(paths, all_pairs);
    const edgeOwners = edge_dict(paths);

    // 2. Initial conditions
    let conditions = initial_conditions(paths, layout, all_pairs);

    // 3. Terminator conditions
    conditions = terminator_conditions(paths, layout, edgeOwners, conditions, rules);

    // 4. Expand conditions for a total order
    conditions = expand_conditions(paths, all_pairs, conditions);

    // 5. Build the final order for each edge
    const edge_orders = new Map();
    for (const edgeKey of edgeOwners.keys()) {
        const lines = edgeOwners.get(edgeKey);
        if (!lines || lines.length < 2) {
            edge_orders.set(edgeKey, lines || []);
            continue;
        }

        const [u, v] = edgeKey.split('|');
        let orderedLines = [];
        for (const line of lines) {
            let i = 0;
            while(i < orderedLines.length && !conditions.has(`${line}|${orderedLines[i]}|${u}|${v}`)) {
                i++;
            }
            orderedLines.splice(i, 0, line);
        }
        edge_orders.set(edgeKey, orderedLines);
    }

    return edge_orders;
}

