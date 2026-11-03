#!/bin/bash
# Capture from a fresh copy. The Unity source project is only read.
set -euo pipefail
project_root="$(cd "$(dirname "$0")/../.." && pwd)"
source_project="${1:-$project_root/../Super Bunny}"
editor="${UNITY_EDITOR:-/Applications/Unity/Hub/Editor/6000.6.7f1/Unity.app/Contents/MacOS/Unity}"
capture_dir="$(mktemp -d /tmp/super-bunny-port-XXXXXX)"
export SUPER_BUNNY_PORT_OUTPUT="$capture_dir"
rsync -a "$source_project/Assets" "$source_project/Packages" "$source_project/ProjectSettings" "$capture_dir/"
cp "$project_root/tools/unity-reference/PortSceneExport.cs" "$capture_dir/Assets/_Project/Scripts/Editor/"
cp "$project_root/tools/unity-reference/PortBaselineTests.cs" "$capture_dir/Assets/_Project/Tests/PlayMode/"
"$editor" -batchmode -nographics -mute -quit -projectPath "$capture_dir" -executeMethod SuperBunny.EditorTools.PortSceneExport.Run -logFile "$capture_dir/export.log"
"$editor" -batchmode -nographics -mute -projectPath "$capture_dir" -runTests -testPlatform PlayMode -testFilter SuperBunny.Tests.PortBaselineTests -testResults "$capture_dir/results.xml" -logFile "$capture_dir/capture.log"
python3 - "$capture_dir/results.xml" <<'PY'
import sys,xml.etree.ElementTree as ET
root=ET.parse(sys.argv[1]).getroot()
assert root.get('failed')=='0', 'Unity reference capture failed; inspect the temporary capture logs'
PY
cp "$capture_dir/port-baseline.json" "$project_root/reference/unity-runtime/current.json"
cp "$capture_dir/arenas.json" "$project_root/src/config/arenas.json"
cp "$capture_dir/PhysicsLab-scenery.json" "$project_root/public/assets/world/physics-lab.json"
cp "$capture_dir/DM_Flat-scenery.json" "$project_root/public/assets/world/dm-flat.json"
cp "$capture_dir/DM_Meadow-scenery.json" "$project_root/public/assets/world/dm-meadow.json"
python3 - "$source_project" "$project_root/reference/unity-runtime/current.source.json" <<'PY'
import sys,json,hashlib,datetime
from pathlib import Path
source=Path(sys.argv[1]);target=Path(sys.argv[2]);meta=json.loads(target.read_text())
meta['hashes']={name:hashlib.sha256((source/name).read_bytes()).hexdigest() for name in meta['hashes']}
meta['capturedAtUtc']=datetime.datetime.now(datetime.timezone.utc).isoformat()
target.write_text(json.dumps(meta,indent=2)+'\n')
PY
printf 'Reference captured. Logs: %s\n' "$capture_dir"
printf 'Review measured mass data before updating src/config/unityMass.ts.\n'
