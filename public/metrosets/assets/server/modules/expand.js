export default function expand(input) {

    console.log("Running expand module");
    let parsedData = input

    expand_merged(parsedData);
    attach_removed(parsedData);

    console.log("Expanded data:", parsedData);

    return parsedData;
}

function expand_merged(data) {
    const { set_order, merge_dict = {}, sets_o, elements, elements_o, elem_dict } = data;
    const new_order = {};

    // Initialize new_order with all original sets
    for (const key in sets_o) {
        new_order[key] = [];
    }

    // Expand merged elements from the calculated set_order
    if (set_order) {
        for (const key in set_order) {
            if (new_order[key]) {
                set_order[key].forEach((elem) => {
                    new_order[key].push(elem);
                    if (merge_dict[elem]) {
                        new_order[key].push(...merge_dict[elem]);
                    }
                });
            }
        }
    }

    // Identify and add back single-set elements that were filtered out
    const processed_elements = new Set(elements);
    if (merge_dict) {
        Object.values(merge_dict).flat().forEach(e => processed_elements.add(e));
    }

    const single_set_elements = elements_o.filter(e => !processed_elements.has(e));

    single_set_elements.forEach(elem => {
        const sets_of_elem = elem_dict[elem] || [];
        sets_of_elem.forEach(set_name => {
            if (new_order[set_name] && !new_order[set_name].includes(elem)) {
                new_order[set_name].push(elem);
            }
        });
    });

    data.set_order = new_order;
}


function attach_removed(data) {
    const unpositioned = data.nodes.filter(n => n.x === 0 && n.y === 0);
    if (unpositioned.length === 0) return;

    const positioned = new Map();
    data.nodes.forEach(n => {
        if (n.x !== 0 || n.y !== 0) {
            positioned.set(n.id, n);
        }
    });

    // Position nodes near a neighbor in the same set
    unpositioned.forEach(node => {
        const sets = data.elem_dict[node.id] || [];
        let neighbor = null;

        for (const setKey of sets) {
            const setElements = data.set_order[setKey] || [];
            for (const other_elem of setElements) {
                if (other_elem !== node.id && positioned.has(other_elem)) {
                    neighbor = positioned.get(other_elem);
                    break;
                }
            }
            if (neighbor) break;
        }

        if (neighbor) {
            const angle = Math.random() * 2 * Math.PI;
            const distance = 40;
            node.x = neighbor.x + Math.cos(angle) * distance;
            node.y = neighbor.y + Math.sin(angle) * distance;
            positioned.set(node.id, node); // Add to positioned map for subsequent nodes
        }
    });
}
