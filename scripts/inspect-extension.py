"""Static evidence only: never read credential values or execute extension code."""
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import sys

discovery = Path(__file__).with_name('discover-copilot.ts')
result = subprocess.run(['bun', str(discovery), *sys.argv[1:]], capture_output=True, text=True)
if result.returncode:
    raise SystemExit(result.stderr)
installations = json.loads(result.stdout)
explicit = [item for item in installations if 'explicit extension path' in item['sources']]
if ('--extension-path' in sys.argv or os.environ.get('GHCP_COPILOT_PATH')) and not explicit:
    raise SystemExit('Explicit path does not contain a GitHub.copilot-chat extension')
candidates = explicit or installations
if len(candidates) != 1:
    print(json.dumps(candidates, indent=2))
    raise SystemExit('Select one installation with --extension-path <extension root>; no unambiguous installation selected.')
root = Path(candidates[0]['path'])
package = json.loads((root / 'package.json').read_text(encoding='utf-8'))
bundle = (root / candidates[0]['main']).resolve()
if not bundle.is_relative_to(root.resolve()):
    raise SystemExit('Manifest entry point escapes the extension directory')
if not bundle.is_file():
    bundle = Path(str(bundle) + '.js')
raw = bundle.read_bytes()
code = raw.decode('utf-8')
patterns = [
    'copilot_internal/v2/token', 'copilot_internal/user', 'endpoints.api',
    'api.githubcopilot.com', 'ghe.com', 'Copilot-Integration-Id',
    'copilot-integration-id', 'Editor-Version', 'editor-version',
    'Editor-Plugin-Version', 'X-Initiator', 'x-initiator',
    'Copilot-Vision-Request', 'copilot-vision-request',
    '/v1/messages', 'count_tokens', 'max_output_tokens',
    'interleaved-thinking', 'getSession(', 'getSessions(', 'github-enterprise',
]
findings = []
for pattern in patterns:
    hits = list(re.finditer(re.escape(pattern), code))
    findings.append({'pattern': pattern, 'count': len(hits), 'examples': [
        {'offset': h.start(), 'context': code[max(0, h.start()-220):h.end()+350]}
        for h in hits[:4]
    ]})
report = {'root': str(root), 'identity': {k: package[k] for k in ('publisher', 'name', 'version')},
          'bundleSha256': hashlib.sha256(raw).hexdigest(), 'bundleBytes': len(raw),
          'selection': candidates[0]['sources'], 'runningGuiBuildConfirmed': False, 'findings': findings}
Path('evidence/private').mkdir(parents=True, exist_ok=True)
Path('evidence/private/extension-static.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps(report, indent=2))
