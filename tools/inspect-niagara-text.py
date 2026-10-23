#!/usr/bin/env python3
"""Bounded, syntax-only inspection of Unreal text exports (T3D)."""
from __future__ import annotations
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import sys

MAX_BYTES = 32 * 1024 * 1024
# Niagara's text exporter includes 2 MiB texture-source lines in this bounded pilot.
# Keep a finite line cap while accepting the real source export without truncation.
MAX_LINE = 4 * 1024 * 1024
MAX_DEPTH = 64
MAX_NODES = 10_000
HEADER_RE = re.compile(r'^\s*Begin Object(?:\s+(.*))?\s*$')
END_RE = re.compile(r'^\s*End Object\s*$')
ASSIGN_RE = re.compile(r'^\s*([^=\s]+)\s*=\s*(.*)$')

class ParseError(ValueError):
    pass

def fields(text: str, delimiter: str = ',') -> list[str]:
    """Split at top level, respecting quoted strings and nested ()[]{}, without evaluating."""
    out=[]; start=0; stack=[]; quote=False; escape=False
    pairs={')':'(', ']':'[', '}':'{'}
    for i,ch in enumerate(text):
        if quote:
            if escape: escape=False
            elif ch == '\\': escape=True
            elif ch == '"': quote=False
            continue
        if ch == '"': quote=True
        elif ch in '([{': stack.append(ch)
        elif ch in ')]}':
            if not stack or stack[-1] != pairs[ch]: raise ParseError('unbalanced nested field delimiters')
            stack.pop()
        elif ch == delimiter and not stack:
            out.append(text[start:i].strip()); start=i+1
    if quote: raise ParseError('unterminated quoted field')
    if stack: raise ParseError('unbalanced nested field delimiters')
    out.append(text[start:].strip())
    return out

def parse_assignments(text: str) -> dict[str,str]:
    result={}
    for field in fields(text):
        if not field: continue
        m=ASSIGN_RE.match(field)
        if m: result[m.group(1)] = m.group(2)
        else: result[field] = ''
    return result

def embedded_value(text: str, name: str) -> str | None:
    """Return a nested named value as raw syntax, without interpreting it."""
    match=re.search(r'(?<![A-Za-z0-9_])'+re.escape(name)+r'\s*=\s*',text)
    if not match: return None
    start=match.end()
    if start>=len(text): return ''
    if text[start] in '([{':
        opener=text[start]; closer={"(":")","[":"]","{":"}"}[opener]
        depth=0; quote=False; escape=False
        for i in range(start,len(text)):
            ch=text[i]
            if quote:
                if escape: escape=False
                elif ch=='\\': escape=True
                elif ch=='"': quote=False
                continue
            if ch=='"': quote=True
            elif ch==opener: depth+=1
            elif ch==closer:
                depth-=1
                if depth==0: return text[start:i+1]
        raise ParseError(f'unbalanced nested value for {name}')
    end=start
    while end<len(text) and text[end] not in ',)': end+=1
    return text[start:end].strip()

def parse_header(text: str) -> dict[str,str]:
    # Header atoms are whitespace-separated, except quoted values.
    out={}; i=0; n=len(text)
    while i<n:
        while i<n and text[i].isspace(): i+=1
        if i>=n: break
        eq=text.find('=',i)
        if eq<0:
            token=text[i:].strip()
            if token: out[token]=''
            break
        key=text[i:eq].strip()
        if not key or any(c.isspace() for c in key): raise ParseError('invalid Begin Object header')
        i=eq+1
        if i<n and text[i]=='"':
            start=i; i+=1; esc=False
            while i<n:
                c=text[i]
                if esc: esc=False
                elif c=='\\': esc=True
                elif c=='"': i+=1; break
                i+=1
            else: raise ParseError('unterminated quoted Begin Object header value')
            out[key]=text[start:i]
        else:
            start=i
            while i<n and not text[i].isspace(): i+=1
            out[key]=text[start:i]
    return out

def parse(path: Path) -> dict:
    size=path.stat().st_size
    if size>MAX_BYTES: raise ParseError(f'input exceeds {MAX_BYTES} byte limit ({size})')
    data=path.read_bytes()
    if len(data)>MAX_BYTES: raise ParseError(f'input exceeds {MAX_BYTES} byte limit')
    try: source=data.decode('utf-8-sig')
    except UnicodeDecodeError as e: raise ParseError(f'input is not valid UTF-8: {e}') from e
    lines=source.splitlines()
    if any(len(line.encode('utf-8'))>MAX_LINE for line in lines): raise ParseError(f'line exceeds {MAX_LINE} byte limit')
    roots=[]; stack=[]; nodes=[]
    for number,line in enumerate(lines,1):
        bm=HEADER_RE.match(line)
        if bm:
            if len(stack)>=MAX_DEPTH: raise ParseError(f'line {number}: nesting exceeds {MAX_DEPTH}')
            if len(nodes)>=MAX_NODES: raise ParseError(f'line {number}: object count exceeds {MAX_NODES}')
            attrs=parse_header(bm.group(1) or '')
            node={'class':attrs.get('Class'), 'name':attrs.get('Name'), 'exportPath':attrs.get('ExportPath'), 'header':attrs, 'ownerIndex':stack[-1]['_index'] if stack else None, 'children':[], 'properties':{}}
            node['_index']=len(nodes); nodes.append(node)
            if stack: stack[-1]['children'].append(node['_index'])
            else: roots.append(node['_index'])
            stack.append(node); continue
        if END_RE.match(line):
            if not stack: raise ParseError(f'line {number}: unmatched End Object')
            stack.pop(); continue
        if stack:
            stripped=line.strip()
            # Custom export records are properties without a conventional key=value prefix.
            if stripped.startswith('CustomProperties Pin '):
                stack[-1]['properties'].setdefault('CustomProperties',[]).append({'line':number,'raw':stripped[len('CustomProperties '):]})
                continue
            m=ASSIGN_RE.match(line)
            if m:
                key,value=m.group(1),m.group(2).strip()
                try: fields(value, '\0')
                except ParseError as e: raise ParseError(f'line {number}: {e}') from e
                stack[-1]['properties'].setdefault(key,[]).append({'line':number,'raw':value})
    if stack: raise ParseError(f'unmatched Begin Object at depth {len(stack)}')
    # Resolve repeated reference declarations by stable export path; never merge different owners.
    defs={}
    for n in nodes:
        if n['class'] and n['exportPath']:
            defs.setdefault(n['exportPath'],[]).append(n['_index'])
    for n in nodes:
        matches=defs.get(n['exportPath'],[]) if n['exportPath'] else []
        n['classDefinitionsAtExportPath']=matches
        if n['class'] is None and len(matches)==1: n['resolvedClass']=nodes[matches[0]]['class']
        else: n['resolvedClass']=n['class']
    def stripidx(n):
        return {k:v for k,v in n.items() if k!='_index'}
    serialized=[stripidx(n) for n in nodes]
    # Focused indexes preserve source records and label graph order as unknown.
    pins=[]; functions=[]; scripts=[]; curves=[]; materials=[]; opaque=[]
    for n in nodes:
        cls=n['resolvedClass'] or ''
        for key,records in n['properties'].items():
            for rec in records:
                raw=rec['raw']
                if key=='CustomProperties' and raw.startswith('Pin '):
                    pinraw=raw[4:].strip()
                    if pinraw.startswith('(') and pinraw.endswith(')'):
                        pin=parse_assignments(pinraw[1:-1]); pin.update({'ownerIndex':n['_index'],'ownerClass':cls,'ownerName':n['name'],'ownerExportPath':n['exportPath'],'line':rec['line'],'raw':raw,'executionOrder':'unknown'})
                        pins.append(pin)
                if key in ('FunctionScript','FunctionName'):
                    functions.append({'field':key,'raw':raw,'ownerIndex':n['_index'],'ownerClass':cls,'ownerName':n['name'],'ownerExportPath':n['exportPath'],'line':rec['line']})
                if key=='SortedParameterOffsets': scripts.append({'field':key,'raw':raw,'ownerIndex':n['_index'],'ownerClass':cls,'ownerName':n['name'],'opaque':True,'line':rec['line']})
                nested=embedded_value(raw,'SortedParameterOffsets')
                if nested is not None: scripts.append({'field':'SortedParameterOffsets','raw':nested,'ownerIndex':n['_index'],'ownerClass':cls,'ownerName':n['name'],'opaque':True,'line':rec['line']})
                for opaque_name in ('RawBytes','ScriptData','Bytecode','ByteCode','ParameterData'):
                    opaque_raw=embedded_value(raw,opaque_name)
                    if opaque_raw is not None:
                        opaque.append({'field':opaque_name,'ownerIndex':n['_index'],'ownerClass':cls,'ownerName':n['name'],'rawLength':len(opaque_raw),'sha256':hashlib.sha256(opaque_raw.encode()).hexdigest(),'opaque':True,'line':rec['line']})
                if 'Curve' in cls and any(x in key.lower() for x in ('keys','curve','default')): curves.append({'field':key,'raw':raw,'ownerIndex':n['_index'],'ownerClass':cls,'ownerName':n['name'],'line':rec['line']})
        if cls.startswith('/Script/Engine.MaterialExpression'):
            links=[]
            for key,records in n['properties'].items():
                links.extend({'field':key,'raw':r['raw'],'line':r['line'],'edgeCandidate':'Expression=' in r['raw']} for r in records)
            materials.append({'ownerIndex':n['_index'],'class':cls,'name':n['name'],'exportPath':n['exportPath'],'properties':links})
    root_emitters=[]
    for ix in roots:
        n=nodes[ix]
        if n['resolvedClass']=='/Script/Niagara.NiagaraSystem':
            handles=[{'property':key,'records':records} for key,records in n['properties'].items() if key=='EmitterHandles' or key.startswith('EmitterHandles(')]
            root_emitters.append({'rootIndex':ix,'name':n['name'],'exportPath':n['exportPath'],'EmitterHandles':handles})
    for n in nodes:
        for key,records in n['properties'].items():
            if key.lower() in ('rawbytes','scriptdata','bytecode','parameterdata','texturesourcedata'):
                for rec in records:
                    opaque.append({'field':key,'ownerIndex':n['_index'],'ownerClass':n['resolvedClass'],'ownerName':n['name'],'rawLength':len(rec['raw']),'sha256':hashlib.sha256(rec['raw'].encode()).hexdigest(),'opaque':True,'line':rec['line']})
    return {'format':'unreal-t3d-syntax-inspection-v1','input':str(path),'inputBytes':len(data),'inputSha256':hashlib.sha256(data).hexdigest(),'limits':{'bytes':MAX_BYTES,'lineBytes':MAX_LINE,'depth':MAX_DEPTH,'nodes':MAX_NODES},'counts':{'objects':len(nodes),'roots':len(roots),'pins':len(pins),'functionFields':len(functions),'sortedParameterOffsets':len(scripts),'curveLiterals':len(curves),'materialNodes':len(materials),'opaqueByteFields':len(opaque)},'roots':roots,'objects':serialized,'niagara':{'exactRootSystems':root_emitters,'pins':pins,'functionFields':functions,'sortedParameterOffsets':scripts,'opaqueByteFields':opaque,'curveLiterals':curves,'materialNodes':materials,'graphOrder':'unknown; no execution order inferred from object or array order'},'limitations':['Text syntax only; no Unreal deserialization or semantic evaluation.','Raw property values remain strings.','Class references resolve only when a unique class declaration has the exact same ExportPath; owner context is retained and never used as a merge key.','Script raw byte fields are opaque; RegisteredTypeIndex and offsets receive no inferred type/index semantics.','Graph links are reported verbatim; execution traversal/order is not inferred.']}

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('input',type=Path)
    ap.add_argument('--output',type=Path,required=True)
    args=ap.parse_args()
    try:
        result=parse(args.input)
        out=args.output
        if out.exists(): raise ParseError(f'refusing to overwrite existing output: {out}')
        out.parent.mkdir(parents=True,exist_ok=True)
        payload=(json.dumps(result,ensure_ascii=False,indent=2)+'\n').encode('utf-8')
        # Exclusive creation protects against a race and guarantees fresh output.
        with out.open('xb') as f: f.write(payload)
        print(json.dumps({'input':str(args.input),'output':str(out),'sha256':hashlib.sha256(payload).hexdigest(),'counts':result['counts']},ensure_ascii=False))
    except (OSError,ParseError) as e:
        print(f'error: {e}',file=sys.stderr); return 2
    return 0
if __name__=='__main__': raise SystemExit(main())
