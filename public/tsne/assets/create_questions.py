#!/usr/bin/env python3
"""
Generate one question per dataset JSON file in a directory.

Each dataset file must contain a JSON list.
For each dataset, we choose 5 random valid indices and a random shape in {0,1,2,3}.
All questions are written to a single JSON dictionary keyed by filename (no .json).
"""

import argparse
import json
import random
from pathlib import Path
from typing import Any, Dict, List


def load_json_list(path: Path) -> List[Any]:
    """Load a JSON file and ensure it contains a list."""
    with path.open("r", encoding="utf-8") as f:
        data = json.load(f)
    if not isinstance(data, list):
        raise ValueError(f"{path} does not contain a JSON list.")
    return data


def make_question(dataset_len: int, k: int = 5) -> Dict[str, Any]:
    """Create a question with k unique random indices and a random shape."""
    if dataset_len < k:
        raise ValueError(f"Dataset length {dataset_len} is too small for {k} unique indices.")
    return {
        "shape": random.randint(0, 3),
        "points": random.sample(range(dataset_len), k),
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate questions for dataset JSON files.")
    parser.add_argument("dataset_dir", type=str, help="Directory containing dataset JSON files.")
    parser.add_argument("-o", "--output", type=str, default="questions.json", help="Output JSON filename.")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for reproducibility.")
    parser.add_argument("--recursive", action="store_true", help="Search directory recursively.")
    parser.add_argument("--k", type=int, default=5, help="Number of random indices per dataset.")
    args = parser.parse_args()

    dataset_dir = Path(args.dataset_dir).expanduser().resolve()
    if not dataset_dir.is_dir():
        raise SystemExit(f"Not a directory: {dataset_dir}")

    if args.seed is not None:
        random.seed(args.seed)

    files = (
        sorted(dataset_dir.rglob("*.json"))
        if args.recursive
        else sorted(dataset_dir.glob("*.json"))
    )

    if not files:
        raise SystemExit("No .json files found.")

    questions: Dict[str, Dict[str, Any]] = {}
    errors: Dict[str, str] = {}

    for fp in files:
        key = fp.stem  # filename without .json
        try:
            data = load_json_list(fp)
            questions[key] = make_question(len(data), k=args.k)
        except Exception as e:
            errors[key] = str(e)

    output = {
        "questions": questions,
        "errors": errors,
    }

    out_path = Path(args.output).expanduser().resolve()
    with out_path.open("w", encoding="utf-8") as f:
        json.dump(questions, f, indent=2)

    print(f"Wrote {len(questions)} questions to {out_path}")
    if errors:
        print(f"Skipped {len(errors)} dataset(s) due to errors.")


if __name__ == "__main__":
    main()
