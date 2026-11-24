"""Build offline draft dictionaries with a local MIT-licensed M2M100 model.

Existing translations (including human edits) win. A failed numeric/markup check leaves the
message in English for review. Never use this tool to translate regulations or user content.
"""
import argparse
import json
import re
from pathlib import Path
import ctranslate2
import sentencepiece

assets=Path(__file__).resolve().parents[1]/"app/src/main/assets"
args=argparse.ArgumentParser()
args.add_argument("--model",type=Path,required=True)
args.add_argument("languages",nargs="+")
cfg=args.parse_args()
translator=ctranslate2.Translator(str(cfg.model),device="cpu",compute_type="int8",intra_threads=7)
sp=sentencepiece.SentencePieceProcessor(model_file=str(cfg.model/"sentencepiece.bpe.model"))
vocabulary=set(json.loads((cfg.model/"shared_vocabulary.json").read_text()))
for language in cfg.languages:
    token=f"__{language}__"
    if token not in vocabulary: raise ValueError("Unsupported target "+language)
    path=assets/f"strings-{language}.json"
    existing=json.loads(path.read_text()) if path.exists() else {}
    source=json.loads((assets/"strings-cs.json").read_text())
    keys=sorted((k for k in source if k not in existing and k.strip()),key=len)
    for i in range(0,len(keys),48):
        chunk=keys[i:i+48]
        encoded=[["__en__"]+sp.encode(k.strip(),out_type=str)+["</s>"] for k in chunk]
        results=translator.translate_batch(encoded,target_prefix=[[token] for _ in chunk],beam_size=1,
                max_decoding_length=min(250,max(len(s) for s in encoded)*2+12),repetition_penalty=1.08)
        for key,res in zip(chunk,results):
            value=sp.decode(res.hypotheses[0][1:]).strip()
            if not value or any(c in value for c in "<>") or sorted(re.findall(r"\d+",key))!=sorted(re.findall(r"\d+",value)): continue
            existing[key]=(" " if key.startswith(" ") else "")+value+(" " if key.endswith(" ") else "")
    tmp=path.with_suffix(".tmp")
    tmp.write_text(json.dumps(existing,ensure_ascii=False,sort_keys=True,indent=1)+"\n")
    tmp.replace(path)
    print(language,len(existing),flush=True)
