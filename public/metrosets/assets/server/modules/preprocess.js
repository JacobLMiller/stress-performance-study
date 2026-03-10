import * as d3 from "https://cdn.jsdelivr.net/npm/d3@7/+esm";


/**
 * TODO: Remove single-set elements.
 * 
 * @param {*} input 
 * @returns 
 */

export default function preprocess(input) {

    console.log("Running preprocess module");

    return simplify(input);
}


/**
 * TODO: Detecting Illegal data. (Too many elements, too many sets, empty sets after simplification, connected component)
 * 
 * @param {*} data 
 * @returns 
 */
function simplify(data) {

    data.elements_o = data.elements.slice();
    data.sets_o = structuredClone(data.sets);
    

    var new_elements = [];
    var new_sets = {};

    var merge_dict = {};
    var is_merged = new Set();

    const n = data.elements_o.length;

    Object.keys(data.sets).forEach(key => {
        new_sets[key] = [];
    });

    // Filter out single-set elements first
    const multi_set_elements = new Set();
    data.elements.forEach(elem => {
        if (data.elem_dict[elem] && data.elem_dict[elem].length > 1) {
            multi_set_elements.add(elem);
        }
    });



    for (let i = 0; i < n; i++) {
        var e1 = data.elements[i];
        merge_dict[e1] = [];

        if (is_merged.has(e1)) {
            continue; // Skip if already merged
        }

        // Only process elements that are in more than one set
        if (multi_set_elements.has(e1)) {
            new_elements.push(e1);
            var sets = data.elem_dict[e1];
            sets.forEach(set => {
                new_sets[set].push(e1);
            });
        } else {
            // This element is in one set or zero sets, so we mark it as "merged"
            // so it gets filtered from the main processing, but can be added back in expand.
            is_merged.add(e1);
            continue;
        }


        for (let j = i + 1; j < n; j++) {
            const e2 = data.elements[j];

            // Only consider merging elements that are also in multiple sets
            if (!multi_set_elements.has(e2)) {
                continue;
            }

            const s1 = new Set(data.elem_dict[e1]);
            const s2 = new Set(data.elem_dict[e2]);

            if (eqSet(s1, s2)) {
                merge_dict[e1].push(e2);
                is_merged.add(e2); 
            } 
        }
    }

    data.nodes = [];
    
    data.elements.forEach(elem => {
        const node = {
            id: elem,
            label: elem,
            sets: data.elem_dict[elem],
            x: 0,
            y: 0};

        data.nodes.push(node);
    });

    data.elements = new_elements;
    data.sets = new_sets;
    data.merge_dict = merge_dict;

    console.log(data);

    return data;
}

export function parse_data(data) {
    if (!data || data.length === 0) {
        return {
            sets: {},
            elements: [],
            elem_dict: {}
        };
    }

    // Use data.columns (provided by d3.csvParse) to get columns in their original
    // order. Object.keys() sorts numeric-looking keys (e.g. "0","1","2","3") before
    // alphabetic ones, which breaks parsing when metro line names are numbers.
    var keys = data.columns ? Array.from(data.columns) : Object.keys(data[0]);
    var elementKey = keys[0];
    keys = keys.slice(1);

    var sets = {};
    keys.forEach(key => {
        sets[key] = [];
    });

    var elements = [];
    var elem_dict = {};

    // Pass 1: Populate all data to establish connectivity
    data.forEach(row => {
        var elem = row[elementKey];
        if (!elem) return; // Skip if element name is undefined or empty

        elements.push(elem);
        elem_dict[elem] = [];

        keys.forEach(key => {
            if (row[key] === '1') {
                sets[key].push(elem);
                elem_dict[elem].push(key);
            }
        });
    });

    // Pass 2: Filter isolated nodes (degree < 1)
    var validElements = [];
    var validElemDict = {};

    elements.forEach(elem => {
        var mySets = elem_dict[elem];

        // Connected if in any set that has > 1 element
        var isConnected = mySets.some(key => sets[key].length > 1);

        if (isConnected) {
            validElements.push(elem);
            validElemDict[elem] = mySets;
        } else {
            console.log(`[parse_data] Skipping isolated node: '${elem}'`);
        }
    });

    // Pass 3: Keep only the Largest Connected Component (LCC)
    if (validElements.length > 0) {
        var visitedElements = new Set();
        var components = [];

        validElements.forEach(startNode => {
            if (visitedElements.has(startNode)) return;

            var component = [];
            var queue = [startNode];
            visitedElements.add(startNode);
            var visitedSets = new Set();

            var head = 0;
            while(head < queue.length) {
                var u = queue[head++];
                component.push(u);

                var uSets = validElemDict[u];
                uSets.forEach(sKey => {
                    if (visitedSets.has(sKey)) return;
                    visitedSets.add(sKey);

                    var neighbors = sets[sKey];
                    neighbors.forEach(v => {
                        if (!visitedElements.has(v) && validElemDict[v]) {
                            visitedElements.add(v);
                            queue.push(v);
                        }
                    });
                });
            }
            components.push(component);
        });

        if (components.length > 0) {
            components.sort((a, b) => b.length - a.length);
            var largest = components[0];
            if (components.length > 1) {
                console.log(`[parse_data] Components found: ${components.length}. Filtering to keep largest (${largest.length} elements). Dropping others.`);
            }
            validElements = largest;
        }
    }

    // Final reconstruction
    var finalSets = {};
    var finalElemDict = {};
    keys.forEach(key => finalSets[key] = []);

    validElements.forEach(elem => {
        finalElemDict[elem] = validElemDict[elem];
        finalElemDict[elem].forEach(sKey => {
            finalSets[sKey].push(elem);
        });
    });

    return {
        sets: finalSets,
        elements: validElements,
        elem_dict: finalElemDict
    };
}

export async function load_data(path) {
    const response = await fetch(path);
    const text = await response.text();

    if (response.ok && !text.trim().startsWith("<!DOCTYPE html") && !text.trim().startsWith("<html")) {
        const data = d3.csvParse(text);
        return parse_data(data);
    } else {
        throw new Error(`Failed to load data from ${path}. Response was not CSV.`);
    }
}


/**
 * Helper functions
 */

const eqSet = (xs, ys) =>
    xs.size === ys.size &&
    [...xs].every((x) => ys.has(x));