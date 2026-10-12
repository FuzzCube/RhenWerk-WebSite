import json

OPENAI = {'openAiApi': {'id': 'qK86QY5Bm6EfR9Zz', 'name': 'OpenAI account 3'}}
MODEL = {'__rl': True, 'mode': 'list', 'value': 'gpt-4.1-mini', 'cachedResultName': 'GPT-4.1-MINI'}

def obj(properties):
    return {'type': 'object', 'properties': properties, 'required': list(properties), 'additionalProperties': False}

TEXT = {'type': 'string'}
NULL_TEXT = {'type': ['string', 'null']}
BOOL = {'type': 'boolean'}
STRINGS = {'type': 'array', 'items': TEXT}
ANALYSIS_SCHEMA = obj({
    'decision': {'type': 'string', 'enum': ['ready_for_planning', 'ask_customer', 'human_review']},
    'relevant': BOOL,
    'confidence': {'type': 'number', 'minimum': 0, 'maximum': 1},
    'service_kind': {'type': 'string', 'enum': ['inspection', 'scheduled_maintenance', 'diagnosis_repair']},
    'summary': TEXT,
    'missing_information': STRINGS,
    'clarification_draft': obj({'subject': TEXT, 'body_text': TEXT}),
    'equipment': obj({'manufacturer': NULL_TEXT, 'model': NULL_TEXT, 'machine_number': NULL_TEXT}),
    'safety_flag': BOOL,
    'contradictions': BOOL,
    'reasons': STRINGS,
})
DOCUMENT_SCHEMA = obj({
    'manufacturer': NULL_TEXT,
    'model': NULL_TEXT,
    'machine_number': NULL_TEXT,
    'equipment_type': {'type': ['string', 'null'], 'enum': ['compressor', 'pump', 'ventilation', None]},
    'fault_description': NULL_TEXT,
    'fault_codes': STRINGS,
    'safety_indicators': STRINGS,
    'contradictions': BOOL,
    'components': {'type': 'array', 'items': obj({'manufacturer': NULL_TEXT, 'model': NULL_TEXT, 'description': NULL_TEXT})},
    'readable': BOOL,
})

def response_params(messages, instructions, schema, name, max_tokens=2000):
    return {
        'resource': 'text', 'operation': 'response', 'modelId': MODEL,
        'responses': {'values': messages}, 'simplify': False, 'builtInTools': {'codeInterpreter': False},
        'options': {'instructions': instructions, 'maxTokens': max_tokens, 'temperature': 0.1,
                    'store': False, 'serviceTier': 'default',
                    'textFormat': {'textOptions': {'type': 'json_schema', 'name': name, 'schema': json.dumps(schema), 'strict': True}}},
    }

# OpenAI Responses API, previous Gemini responses and pinned legacy test outputs.
RESPONSE_TEXT = """const parts=Array.isArray(raw.output)?raw.output.flatMap(o=>o.content??[]):Array.isArray(raw.content)?raw.content:[];
const resultParts=parts.filter(p=>p.type==='output_text');
const responseObject=resultParts.find(p=>p.text&&typeof p.text==='object')?.text;
const responseText=resultParts.filter(p=>typeof p.text==='string').map(p=>p.text).join('');
const text=responseObject??(responseText||raw.output_text||raw.choices?.[0]?.message?.content||raw.content?.parts?.map(x=>x.text??'').join('')||raw.text||(typeof raw.output==='string'?raw.output:'')||'');"""
