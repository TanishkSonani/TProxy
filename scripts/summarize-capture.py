"""Create a structural local wire summary. Never export prompt/tool strings or credentials."""
import argparse
import hashlib
import json
from pathlib import Path

SAFE_HEADERS = {
    'content-type', 'accept', 'editor-version', 'editor-plugin-version',
    'copilot-integration-id', 'openai-intent', 'x-github-api-version',
    'x-initiator', 'x-interaction-type', 'copilot-vision-request',
    'anthropic-version', 'anthropic-beta', 'retry-after',
}
ENUMS = {'user', 'assistant', 'system', 'tool', 'agent', 'message', 'reasoning',
    'function_call', 'function_call_output', 'input_text', 'input_image',
    'output_text', 'tool_use', 'tool_result', 'text', 'image', 'enabled', 'adaptive',
    'response.create', 'response.created', 'response.in_progress', 'response.completed',
    'response.failed', 'response.incomplete', 'response.output_item.added',
    'response.output_item.done', 'response.content_part.added', 'response.content_part.done',
    'response.output_text.delta', 'response.output_text.done',
    'response.reasoning_summary_text.delta', 'response.reasoning_summary_text.done',
    'response.reasoning_summary_part.added', 'response.reasoning_summary_part.done',
    'response.function_call_arguments.delta', 'response.function_call_arguments.done',
    'message_start', 'message_delta', 'message_stop', 'content_block_start',
    'content_block_delta', 'content_block_stop', 'ping', 'error'}

def shape(value, key=''):
    if isinstance(value, dict):
        return {k: shape(v, k) for k, v in value.items()}
    if isinstance(value, list):
        return [shape(v) for v in value]
    if isinstance(value, str):
        if key in {'type', 'role', 'initiator'} and value in ENUMS:
            return value
        return {'stringLength': len(value)}
    return value

def headers(values):
    return {key.lower(): value if key.lower() in SAFE_HEADERS else '[redacted]'
            for key, value in values.items()}

def json_body(text):
    try:
        return json.loads(text)
    except (ValueError, TypeError):
        return None

def summarize(flow):
    body = json_body(flow.request.get_text(strict=False))
    result = {'method': flow.request.method, 'path': flow.request.path.split('?')[0],
        'headers': headers(flow.request.headers), 'requestShape': shape(body),
        'status': flow.response.status_code if flow.response else None,
        'responseHeaders': headers(flow.response.headers) if flow.response else {}}
    if flow.websocket:
        result['websocket'] = []
        for message in flow.websocket.messages:
            data = json_body(message.content)
            if data is not None:
                result['websocket'].append({'fromClient': message.from_client, 'shape': shape(data)})
    elif flow.response:
        text = flow.response.get_text(strict=False)
        if 'text/event-stream' in flow.response.headers.get('content-type', ''):
            events = [json_body(line[5:].strip()) for line in text.splitlines() if line.startswith('data:')]
            result['sse'] = [shape(event) for event in events if event is not None]
        else:
            result['responseShape'] = shape(json_body(text))
    return result

if __name__ == '__main__':
    from mitmproxy import io
    parser = argparse.ArgumentParser()
    parser.add_argument('capture')
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    capture = Path(args.capture)
    with capture.open('rb') as stream:
        flows = [summarize(flow) for flow in io.FlowReader(stream).stream()]
    report = {'captureSha256': hashlib.sha256(capture.read_bytes()).hexdigest(), 'flows': flows}
    Path(args.output).write_text(json.dumps(report, indent=2), encoding='utf-8')
    print(json.dumps({'flows': len(flows), 'output': args.output}))
