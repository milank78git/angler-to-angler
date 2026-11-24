"""Build offline regional-language UI drafts using the Apache-licensed OPUS-MT en-mul release.

Convert the original OPUS archive with CTranslate2's OpusMTConverter. Pass its int8 directory
and the release's SentencePiece files. Preserve human edits and reject changed numeric values.
"""
import argparse
import json
import re
from pathlib import Path
import ctranslate2
import sentencepiece

args = argparse.ArgumentParser()
args.add_argument('--model', type=Path, required=True)
args.add_argument('--tokenizers', type=Path, required=True)
args.add_argument('pairs', nargs='+', help='BCP47=OPUS language token, e.g. mt=mlt')
cfg = args.parse_args()
assets = Path(__file__).resolve().parents[1]/'app/src/main/assets'
source = json.loads((assets/'strings-cs.json').read_text())
translator = ctranslate2.Translator(str(cfg.model), device='cpu', intra_threads=6)
sp = sentencepiece.SentencePieceProcessor(model_file=str(cfg.tokenizers/'source.spm'))
target = sentencepiece.SentencePieceProcessor(model_file=str(cfg.tokenizers/'target.spm'))
vocab = set(json.loads((cfg.model/'shared_vocabulary.json').read_text()))
for pair in cfg.pairs:
    lang, model_code = pair.split('=')
    token = '>>'+model_code+'<<'
    if token not in vocab: raise ValueError(token)
    path = assets/('strings-'+lang+'.json')
    existing = json.loads(path.read_text()) if path.exists() else {}
    keys = sorted((s for s in source if s not in existing),key=len)
    for i in range(0,len(keys),32):
        chunk = keys[i:i+32]
        inputs = [[token]+sp.encode(s.strip(), out_type=str) for s in chunk]
        results = translator.translate_batch(inputs,beam_size=2,max_decoding_length=min(215,max(map(len,inputs))*2+12),repetition_penalty=1.1)
        for key,res in zip(chunk,results):
            value = target.decode(res.hypotheses[0]).strip()
            if not value or any(c in value for c in '<>') or sorted(re.findall(r'\d+',key)) != sorted(re.findall(r'\d+',value)): continue
            existing[key] = (' ' if key.startswith(' ') else '')+value+(' ' if key.endswith(' ') else '')
    path.write_text(json.dumps(existing,ensure_ascii=False,sort_keys=True,indent=1)+'\n')
    print(lang,len(existing),flush=True)
