"""Invoke a locally installed REA MCP server without changing agent configuration."""
import argparse
import json
from pathlib import Path
import queue
import subprocess
import threading

parser = argparse.ArgumentParser()
parser.add_argument('--entry', required=True, help='Path to rea-agents/scripts/rea.mjs')
parser.add_argument('--tool')
parser.add_argument('--arguments', help='Local JSON arguments file')
parser.add_argument('--output', default='evidence/private/rea-mcp.json')
parser.add_argument('--timeout', type=int, default=180)
args = parser.parse_args()
output = Path(args.output)
output.parent.mkdir(parents=True, exist_ok=True)
with output.with_suffix('.stderr.log').open('w', encoding='utf-8') as stderr:
    process = subprocess.Popen(['node', str(Path(args.entry).resolve()), '--mcp'],
                               stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                               stderr=stderr, text=True, encoding='utf-8')
    messages = queue.Queue()
    def read():
        for line in process.stdout:
            try:
                messages.put(json.loads(line))
            except json.JSONDecodeError:
                continue
        messages.put({'closed': True})
    threading.Thread(target=read, daemon=True).start()
    def send(value):
        process.stdin.write(json.dumps(value) + '\n')
        process.stdin.flush()
    def rpc(identifier, method, params):
        send({'jsonrpc': '2.0', 'id': identifier, 'method': method, 'params': params})
        while True:
            item = messages.get(timeout=args.timeout)
            if item.get('closed'):
                raise RuntimeError('REA exited; see private stderr log')
            if item.get('id') == identifier:
                if 'error' in item:
                    raise RuntimeError(str(item['error']))
                return item['result']
    try:
        initialize = rpc(1, 'initialize', {'protocolVersion': '2024-11-05',
            'capabilities': {}, 'clientInfo': {'name': 'ghcp-bridge-research', 'version': '0.0.0'}})
        send({'jsonrpc': '2.0', 'method': 'notifications/initialized'})
        catalog = rpc(2, 'tools/list', {})
        result = {'initialize': initialize, 'catalog': catalog}
        if args.tool:
            tool_args = json.loads(Path(args.arguments).read_text(encoding='utf-8-sig')) if args.arguments else {}
            result['call'] = rpc(3, 'tools/call', {'name': args.tool, 'arguments': tool_args})
        output.write_text(json.dumps(result, indent=2), encoding='utf-8')
        print(json.dumps({'output': str(output), 'server': initialize.get('serverInfo'),
            'toolCount': len(catalog.get('tools', [])),
            'analysisTools': [t['name'] for t in catalog.get('tools', []) if 'javascript_application' in t['name']],
            'callIsError': result.get('call', {}).get('isError', False)}))
    finally:
        process.terminate()
        try:
            process.wait(timeout=10)
        except subprocess.TimeoutExpired:
            process.kill()
