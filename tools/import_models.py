"""Import the numeric LightGBM models and factor definitions from a desktop checkout."""
import argparse
import ast
import json
import math
from pathlib import Path
import re
import subprocess

out = Path(__file__).resolve().parents[1] / "app/src/main/assets/models"

def constants(file, keys):
    result = {}
    for n in ast.parse(file.read_text()).body:
        if isinstance(n, ast.Assign) and isinstance(n.targets[0], ast.Name) and n.targets[0].id in keys:
            value = ast.literal_eval(n.value)
            result[n.targets[0].id] = sorted(value) if isinstance(value, set) else value
    return result

def convert(file):
    content = file.read_text()
    names = re.search(r"^feature_names=(.+)$", content, re.M)[1].split()
    if "objective=binary sigmoid:1\n" not in content:
        raise ValueError("Unsupported model objective")
    trees = []
    for block in re.split(r"^Tree=\d+\n", content, flags=re.M)[1:]:
        data = dict(line.split("=", 1) for line in block.split("\n\n")[0].splitlines() if "=" in line)
        if int(data["num_cat"]) or int(data.get("is_linear", "0")):
            raise ValueError("Expected numerical trees with constant leaves")
        tree = {k: [typ(x) for x in data[k].split()] for k, typ in [
            ("split_feature", int), ("threshold", float), ("decision_type", int),
            ("left_child", int), ("right_child", int), ("leaf_value", float)]}
        if any(t not in (2, 8, 10) for t in tree["decision_type"]):
            raise ValueError("Unsupported missing-value encoding")
        tree["threshold"] = [v if math.isfinite(v) else ("Infinity" if v > 0 else "-Infinity")
                             for v in tree["threshold"]]
        trees.append(tree)
    if not trees:
        raise ValueError("No trees found")
    return dict(features=names, trees=trees)

def write(name, data):
    (out / name).write_text(json.dumps(data, ensure_ascii=False, separators=(",", ":"), allow_nan=False))

if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("desktop", type=Path)
    root = parser.parse_args().desktop.resolve()
    config = constants(root/"advisor/config.py", {"EXCLUDE_SYMBOLS", "EXCLUDE_NAME_WORDS", "NEWS_FEEDS"})
    config.update(constants(root/"advisor/factors.py", {"SHORT"}))
    config.update(constants(root/"advisor/news.py", {"EVENTS"}))
    config["revision"] = subprocess.check_output(["git", "-C", str(root), "rev-parse", "HEAD"], text=True).strip()
    write("config.json", config)
    for name in ("factors", "report"):
        write(name+".json", json.loads((root/"models"/(name+".json")).read_text()))
    for horizon in ("short", "medium", "long"):
        write(horizon+".json", convert(root/"models"/(horizon+".txt")))
