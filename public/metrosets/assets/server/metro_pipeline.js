import preprocess from './modules/preprocess.js';
import layout from './modules/layout.js';
import schematize from './modules/schematize/index.js';
import support from './modules/support.js'; 
import postprocess from './modules/postprocess.js';
import expand from './modules/expand.js';
import { InfeasibleSolutionError } from './modules/schematize/linear-programming.js';

const steps = [
  preprocess,
  support,
  expand,
  layout,
  schematize,
  postprocess
];

export default async function runPipeline(input) {
  let data = input;
  console.log('Pipeline starting with:', data);

  // Initialize port selection state
  data.portSelections = data.portSelections || new Map();
  data.fixedAssignments = data.fixedAssignments || new Map();

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i];
    console.log(`Running step ${i + 1}: ${step.name}`);
    try {
      data = await step(data);
      console.log(`Step ${i + 1} completed, data:`, data);
    } catch (error) {
      console.error(`Step ${i + 1} failed:`, error);
      break;
    }
  }
  return data;
}

// Function to re-run schematize step with updated port selections
export async function updateSchematizeWithPortSelections(data, runForceLayout = true) {
  console.log('Re-running schematize with updated port selections');
  try {
    const schematizeModule = await import('./modules/schematize/index.js');
    data = await schematizeModule.default(data);


    console.log('Schematize update completed');
    return data;
  } catch (error) {
    // Re-throw InfeasibleSolutionError so it can be handled by the caller
    if (error instanceof InfeasibleSolutionError) {
      throw error;
    }
    console.error('Schematize update failed:', error);
    return data;
  }
}


/*

Description of the datastructure:

before preprocess:

data =
{
  sets: [set1, set2, ...],
  nodes: [node1, node2, ...],
}

set = {
  id,
  label,
  elements: [node1, node2]
}

node = {
  id,
  label,
  sets: [set1, set2],
}

after preprocess:


*/