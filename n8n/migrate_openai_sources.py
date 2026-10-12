import pathlib

p = pathlib.Path('generate_workflows.py')
s = p.read_text()
s = s.replace('import pathlib\n', 'import pathlib\nfrom openai_config import OPENAI, MODEL, ANALYSIS_SCHEMA, DOCUMENT_SCHEMA, response_params, RESPONSE_TEXT\n', 1)
s = '\n'.join(line for line in s.splitlines() if not line.startswith('GEMINI = ') and not line.startswith('MODEL = ')) + '\n'
a = s.index('for key, resource, label in [("doc"')
b = s.index('file_nodes.append(code("extract"', a)
s = s[:a] + '''for key, file_type, label in [("doc", "file", "PDF auswerten"), ("img", "image", "Foto und Typenschild auswerten")]:
    message = {"type": file_type, "role": "user", "binaryPropertyName": "data"}
    if file_type == "file":
        message.update(fileType="base64", fileName=e("{{ $json.file_name ?? $json.attachment?.file_name ?? 'document.pdf' }}"))
    else:
        message.update(imageType="base64", imageDetail="high")
    params = response_params([{"type": "text", "role": "user", "content": file_prompt}, message], file_prompt, DOCUMENT_SCHEMA, "rheinwerk_document")
    file_nodes.append(node(key, label, "@n8n/n8n-nodes-langchain.openAi", 2.3, params, OPENAI, settings={"onError": "continueRegularOutput"}))
''' + s[b:]
s = s.replace("let text=raw.content?.parts?.map(x=>x.text??'').join('')??raw.text??raw.output??raw.content??'';", 'RESPONSE_TEXT_HERE')
s = s.replace('""", {"extracted": {"readable": True}}))', '""".replace("RESPONSE_TEXT_HERE", RESPONSE_TEXT), {"extracted": {"readable": True}}))')
a = s.index('analysis_nodes.append(node("ai",')
b = s.index('\nmatcher = ', a)
s = s[:a] + '''analysis_nodes.append(node("ai", "Serviceanfrage inhaltlich prüfen", "@n8n/n8n-nodes-langchain.openAi", 2.3,
    response_params([{"type":"text","role":"user","content":e("{{ JSON.stringify($json.input) }}")}], system_prompt, ANALYSIS_SCHEMA, "rheinwerk_analysis", 3000),
    OPENAI, settings={"onError":"continueRegularOutput"}))''' + s[b:]
s = s.replace("const text=raw.content?.parts?.map(x=>x.text??'').join('')??raw.text??raw.output??raw.content??'';let a;", 'RESPONSE_TEXT_HERE\nlet a;')
s = s.replace('error_text:raw.error?.message??', "error_text:(typeof raw.error==='string'?raw.error:raw.error?.message)??")
s = s.replace('.replace("CATALOG", json.dumps', '.replace("RESPONSE_TEXT_HERE", RESPONSE_TEXT).replace("CATALOG", json.dumps')
p.write_text(s)
