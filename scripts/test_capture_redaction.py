import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location('capture_summary', Path(__file__).with_name('summarize-capture.py'))
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

class RedactionTests(unittest.TestCase):
    def test_auth_cookie_auto_session_and_unknown_headers_never_export_values(self):
        values = {'Authorization':'Bearer SUPER_SECRET', 'Cookie':'SESSION_SECRET',
            'Copilot-Session-Token':'AUTO_SECRET', 'x-new-secret':'UNKNOWN_SECRET',
            'X-Initiator':'agent'}
        result = module.headers(values)
        self.assertEqual(result['x-initiator'], 'agent')
        self.assertTrue(all(result[key] == '[redacted]' for key in
            ['authorization','cookie','copilot-session-token','x-new-secret']))

    def test_nested_prompts_images_tool_arguments_and_tokens_are_structural_only(self):
        value = {'system':'SYSTEM_SECRET', 'messages':[{'role':'user','content':[
            {'type':'image','source':{'data':'BASE64_SECRET'}},
            {'type':'tool_result','content':'TOOL_SECRET'}]}],
            'token':'TOKEN_SECRET','session_token':'AUTO_SECRET','usage':{'input_tokens':123}}
        result = module.shape(value)
        self.assertEqual(result['messages'][0]['role'], 'user')
        self.assertEqual(result['usage']['input_tokens'],123)
        self.assertNotIn('SECRET',str(result))

    def test_unrecognized_type_is_not_treated_as_a_safe_enum(self):
        self.assertEqual(module.shape({'type':'SECRET_TOKEN'})['type'], {'stringLength':12})

if __name__ == '__main__':
    unittest.main()
