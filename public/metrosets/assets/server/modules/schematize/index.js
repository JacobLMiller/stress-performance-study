/**
 * Main schematize module - orchestrates the octilinear layout process
 */

import { createPorts } from './port.js';
import { assignPorts } from './port-assignment.js';
import { runLinearProgramming } from './linear-programming.js';

export default async function schematize(input) {
    console.log("Running schematize module");

    let parsedData = input;

    // Step 1: Create ports for all nodes
    createPorts(parsedData);
    
    // Step 2: Assign ports to edges based on angles and constraints
    assignPorts(parsedData);
    
    // Step 3: Run linear programming optimization
    await runLinearProgramming(parsedData);

    return parsedData;
}
