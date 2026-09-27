/* QTI Pocket Check — original implementation, MIT. */
'use strict';
(() => {
  const VERSION = '0.1.0';
  const MiB = 1024 * 1024;
  const LIMITS = Object.freeze({zipBytes:25*MiB, expandedBytes:100*MiB, xmlBytes:8*MiB, entries:1000, diagnostics:1000, idsPerFile:200});
  const $ = id => document.getElementById(id);
  let currentReport = null;
  let running = false;
  const short = (value, max=512) => String(value ?? '').replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '\ufffd').slice(0,max);

  class InspectionError extends Error {
    constructor(code, message) { super(message); this.code=code; }
  }

  function add(report, severity, code, message, path='', elementId='') {
    if (report.diagnostics.length >= LIMITS.diagnostics) { report.diagnostics_truncated=true; return; }
    const finding = {severity,code,message};
    if (path) finding.path=short(path);
    if (elementId) finding.element_id=short(elementId,200);
    report.diagnostics.push(finding);
  }

  // Inspect declared sizes before asking a ZIP library to expand anything.
  // ZIP64, spanning, encryption and unusual compression are outside this MVP.
  function inspectDirectory(buffer) {
    const view = new DataView(buffer);
    const length = buffer.byteLength;
    if (length<22) throw new InspectionError('ZIP_INVALID','This is not a complete ZIP archive.');
    let end=-1;
    for(let p=length-22;p>=Math.max(0,length-65557);p--) {
      if(view.getUint32(p,true)===0x06054b50 && p+22+view.getUint16(p+20,true)===length) {end=p;break;}
    }
    if(end<0) throw new InspectionError('ZIP_INVALID','The ZIP directory could not be found. Re-download or re-export the archive.');
    const disk=view.getUint16(end+4,true), startDisk=view.getUint16(end+6,true);
    const onDisk=view.getUint16(end+8,true), count=view.getUint16(end+10,true);
    const size=view.getUint32(end+12,true), offset=view.getUint32(end+16,true);
    if(count===65535 || size===0xffffffff || offset===0xffffffff) throw new InspectionError('ZIP64_UNSUPPORTED','ZIP64 archives are outside this small-file checker.');
    if(disk || startDisk || onDisk!==count) throw new InspectionError('ZIP_SPANNED_UNSUPPORTED','Multi-part ZIP archives are not supported.');
    if(count>LIMITS.entries) throw new InspectionError('ZIP_ENTRY_LIMIT','The archive has more than 1,000 entries. Check a smaller package.');
    if(offset+size>end) throw new InspectionError('ZIP_DIRECTORY_INVALID','The ZIP directory points outside the archive.');
    let position=offset, total=0;
    for(let i=0;i<count;i++) {
      if(position+46>offset+size || view.getUint32(position,true)!==0x02014b50) throw new InspectionError('ZIP_DIRECTORY_INVALID','A ZIP directory entry is incomplete or invalid.');
      const flags=view.getUint16(position+8,true), method=view.getUint16(position+10,true);
      const compressed=view.getUint32(position+20,true), expanded=view.getUint32(position+24,true);
      const nameLength=view.getUint16(position+28,true), extraLength=view.getUint16(position+30,true), commentLength=view.getUint16(position+32,true);
      const localOffset=view.getUint32(position+42,true);
      if(expanded===0xffffffff || compressed===0xffffffff || localOffset===0xffffffff) throw new InspectionError('ZIP64_UNSUPPORTED','ZIP64 entries are not supported.');
      if(flags&1) throw new InspectionError('ZIP_ENCRYPTED_UNSUPPORTED','Encrypted ZIP archives cannot be inspected.');
      if(method!==0 && method!==8) throw new InspectionError('ZIP_COMPRESSION_UNSUPPORTED','The ZIP uses a compression method this checker does not support.');
      if(view.getUint16(position+34,true)!==0) throw new InspectionError('ZIP_SPANNED_UNSUPPORTED','Multi-part ZIP archives are not supported.');
      if(localOffset+30>offset || view.getUint32(localOffset,true)!==0x04034b50) throw new InspectionError('ZIP_LOCAL_HEADER_INVALID','A file entry points to an invalid ZIP file header.');
      const localNameLength=view.getUint16(localOffset+26,true), localExtraLength=view.getUint16(localOffset+28,true);
      if(localOffset+30+localNameLength+localExtraLength+compressed>offset) throw new InspectionError('ZIP_LOCAL_HEADER_INVALID','A ZIP file entry extends outside its data area.');
      total+=expanded;
      if(total>LIMITS.expandedBytes) throw new InspectionError('ZIP_EXPANDED_LIMIT','The archive declares more than 100 MiB of uncompressed files. Check a smaller package.');
      position+=46+nameLength+extraLength+commentLength;
      if(position>offset+size) throw new InspectionError('ZIP_DIRECTORY_INVALID','A ZIP directory entry extends outside the directory.');
    }
    if(position!==offset+size) throw new InspectionError('ZIP_DIRECTORY_INVALID','The ZIP directory has an unsupported or inconsistent layout.');
    return {entries:count, declared_uncompressed_bytes:total};
  }

  // Stop reading XML after a fixed output limit, including archives whose
  // size declarations lie. No attachments are decompressed by this checker.
  function readXmlBytes(entry) {
    return new Promise((resolve,reject) => {
      let total=0, finished=false;
      const chunks=[];
      const stream=entry.internalStream('uint8array');
      stream.on('data', chunk => {
        if(finished) return;
        total+=chunk.length;
        if(total>LIMITS.xmlBytes) {
          finished=true;stream.pause();chunks.length=0;
          reject(new InspectionError('XML_SIZE_LIMIT','This XML file expands beyond the 8 MiB reading limit. It was not parsed.'));
          return;
        }
        chunks.push(chunk);
      });
      stream.on('error', () => {
        if(!finished) {finished=true;reject(new InspectionError('ZIP_ENTRY_READ_FAILED','This XML entry could not be decompressed. The archive may be damaged.'));}
      });
      stream.on('end', () => {
        if(finished) return;
        finished=true;
        const bytes=new Uint8Array(total);let offset=0;
        for(const chunk of chunks) {bytes.set(chunk,offset);offset+=chunk.length;}
        resolve(bytes);
      });
      stream.resume();
    });
  }

  function decodeXml(bytes) {
    let encoding='utf-8';
    if((bytes[0]===0xff && bytes[1]===0xfe) || (bytes[0]===0x3c && bytes[1]===0 && bytes[2]===0x3f && bytes[3]===0)) encoding='utf-16le';
    else if((bytes[0]===0xfe && bytes[1]===0xff) || (bytes[0]===0 && bytes[1]===0x3c && bytes[2]===0 && bytes[3]===0x3f)) encoding='utf-16be';
    else {
      const head=new TextDecoder('latin1').decode(bytes.subarray(0,512));
      const declaration=head.match(/^\s*<\?xml\s[^?]*encoding\s*=\s*["']([^"']+)["']/i);
      if(declaration) encoding=declaration[1];
    }
    try {return new TextDecoder(encoding,{fatal:true}).decode(bytes);}
    catch {throw new InspectionError('XML_ENCODING_UNSUPPORTED','This XML file could not be decoded using its declared encoding.');}
  }

  function parseXml(text) {
    // Deliberately conservative: this also refuses declarations in comments.
    if(/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(text)) throw new InspectionError('XML_DTD_REJECTED','DTD or entity declarations are not allowed. This XML file was not parsed.');
    const documentXml=new DOMParser().parseFromString(text,'application/xml');
    if(!documentXml.documentElement || documentXml.getElementsByTagName('parsererror').length || documentXml.getElementsByTagNameNS('http://www.mozilla.org/newlayout/xml/parsererror.xml','parsererror').length) throw new InspectionError('XML_NOT_WELL_FORMED','This file is not well-formed XML. Check the file with your export provider.');
    return documentXml;
  }

  function familyOf(doc) {
    const root=doc.documentElement;
    const name=root.localName;
    const ns=root.namespaceURI || '';
    if(/ims_qtiasiv1p2(?:\b|$)/i.test(ns)) return {family:'QTI 1.x',label:'QTI 1.2 namespace'};
    if(name==='questestinterop' || /ims_qtiasiv1p1(?:\b|$)/i.test(ns)) return {family:'QTI 1.x',label:'QTI 1.x / 1.2-style (exact version not established)'};
    const version=ns.match(/imsqti_v2p(\d+)/i);
    if(version) return {family:'QTI 2.x',label:`QTI 2.${version[1]} namespace`};
    if(name==='assessmentItem' || name==='assessmentTest') return {family:'QTI 2.x',label:'QTI 2.x-style (namespace not established)'};
    return null;
  }

  function inspectQti(doc,path,report) {
    const family=familyOf(doc);
    if(!family) return;
    const elements=Array.from(doc.getElementsByTagName('*'));
    const rootNamespace=doc.documentElement.namespaceURI || '';
    const own=element => (element.namespaceURI || '')===rootNamespace;
    const items=elements.filter(element=>own(element) && element.localName===(family.family==='QTI 1.x'?'item':'assessmentItem'));
    const refs=family.family==='QTI 2.x'?elements.filter(element=>own(element) && element.localName==='assessmentItemRef'):[];
    const ids=items.slice(0,LIMITS.idsPerFile).map(item=>short(item.getAttribute(family.family==='QTI 1.x'?'ident':'identifier') || '(missing ID)',200));
    report.files.push({path:short(path),format:family.label,item_count:items.length,item_reference_count:refs.length,item_ids:ids,item_ids_truncated:items.length>ids.length});
    report.formats=Array.from(new Set([...report.formats,family.label]));
    report.summary.item_definitions+=items.length;
    report.summary.item_references+=refs.length;
    if(family.family==='QTI 1.x') {
      for(const response of elements.filter(element=>own(element) && element.localName==='response_lid')) {
        if(response.hasAttribute('rcardinality') && response.getAttribute('rcardinality').trim()) continue;
        let parent=response.parentElement;
        while(parent && parent.localName!=='item') parent=parent.parentElement;
        const itemId=parent?.getAttribute('ident') || '(missing item ID)';
        const responseId=response.getAttribute('ident') || '(missing response ID)';
        add(report,'warning','QTI1_RESPONSE_CARDINALITY_MISSING','Compatibility notice: a response_lid field has no explicit rcardinality value. QTI 1.2 allows omission with a default of Single, but some importers have been reported to reject it. Ask the exporter to review compatibility; no value is inferred or written.',path,`${itemId} / ${responseId}`);
      }
    }
  }

  function resolveLocal(manifestPath, element, href) {
    for(let ancestor=element;ancestor;ancestor=ancestor.parentElement) {
      if(ancestor.hasAttributeNS('http://www.w3.org/XML/1998/namespace','base') || ancestor.hasAttribute('xml:base')) return {skip:'xml:base'};
    }
    const raw=href.trim();
    if(/^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith('//')) return {skip:'remote'};
    let relative;
    try {relative=decodeURIComponent(raw.split(/[?#]/,1)[0]);}
    catch {return {error:'REFERENCE_ENCODING_INVALID'};}
    if(!relative) return {skip:'fragment'};
    if(relative.includes('\\') || relative.startsWith('/') || relative.includes('\0')) return {error:'REFERENCE_PATH_UNSUPPORTED'};
    const parts=manifestPath.split('/').slice(0,-1);
    for(const part of relative.split('/')) {
      if(!part || part==='.') continue;
      if(part==='..') {if(!parts.length)return {error:'REFERENCE_OUTSIDE_ARCHIVE'};parts.pop();}
      else parts.push(part);
    }
    return {path:parts.join('/')};
  }

  function inspectManifest(doc,path,names,report) {
    if(doc.documentElement.localName!=='manifest') {
      add(report,'error','MANIFEST_ROOT_INVALID','The file is named imsmanifest.xml but its XML root is not manifest.',path);
      return;
    }
    const checked=new Set();
    let skipped=0;
    for(const element of Array.from(doc.getElementsByTagName('*'))) {
      if(!['resource','file'].includes(element.localName) || !element.hasAttribute('href')) continue;
      const href=element.getAttribute('href');
      const resolved=resolveLocal(path,element,href);
      if(resolved.skip) {skipped++;continue;}
      if(resolved.error) {
        add(report,'warning',resolved.error,'A manifest reference could not be safely interpreted as a local file path.',path,element.getAttribute('identifier'));
        continue;
      }
      if(checked.has(resolved.path))continue;
      checked.add(resolved.path);
      if(!names.has(resolved.path)) {
        const caseMatch=Array.from(names).some(name=>name.toLowerCase()===resolved.path.toLowerCase());
        add(report,'error','MANIFEST_FILE_MISSING',caseMatch?'A referenced file exists only with different letter casing. ZIP reference matching is case-sensitive.':'A local file referenced by the manifest is missing from the ZIP.',resolved.path,element.getAttribute('identifier'));
      }
    }
    if(skipped) add(report,'info','MANIFEST_REFERENCES_SKIPPED',`${skipped} reference(s) use a remote/non-file URI, xml:base, or only a fragment. They were not checked or fetched.`,path);
  }

  function finish(report) {
    for(const severity of ['error','warning','info']) report.summary[`${severity}s`]=report.diagnostics.filter(item=>item.severity===severity).length;
    report.summary.qti_files=report.files.length;
    report.complete=!report.inspection_stopped && !report.diagnostics_truncated && report.summary.xml_files_failed===0;
    return report;
  }

  async function check(file) {
    const report={tool:'QTI Pocket Check',version:VERSION,checked_at:new Date().toISOString(),input:{name:short(file.name),compressed_bytes:file.size},limits:LIMITS,formats:[],files:[],diagnostics:[],summary:{xml_files_scanned:0,xml_files_failed:0,item_definitions:0,item_references:0,qti_files:0,errors:0,warnings:0,infos:0},limitations:['Read-only preflight, not a schema validation or an LMS import guarantee.','Item definitions are counted, not a deduplicated question bank.','Only .xml and .qti files are parsed. Non-XML assets are not decompressed.','Remote/non-file references and references affected by xml:base are not checked.','Only the first 200 item IDs per file are retained.','No question text is included in this report. File names and IDs may still be sensitive.']};
    try {
      if(file.size>LIMITS.zipBytes) throw new InspectionError('ZIP_SIZE_LIMIT','The ZIP exceeds the 25 MiB compressed-file limit. Check a smaller package.');
      if(!file.size) throw new InspectionError('ZIP_EMPTY','The selected file is empty.');
      const buffer=await file.arrayBuffer();
      Object.assign(report.input,inspectDirectory(buffer));
      let zip;
      try {zip=await JSZip.loadAsync(buffer,{checkCRC32:false,createFolders:false});}
      catch {throw new InspectionError('ZIP_INVALID','The ZIP could not be opened. It may be damaged or use an unsupported layout.');}
      const entries=Object.values(zip.files).filter(entry=>!entry.dir);
      const names=new Set(entries.map(entry=>entry.name));
      for(const entry of entries) {
        const original=entry.unsafeOriginalName || entry.name;
        if(original!==entry.name || /(^|\/)\.\.(\/|$)|\\|^\/|^[a-z]:|\0/i.test(original)) throw new InspectionError('ZIP_UNSAFE_PATH','The ZIP contains an unsafe or ambiguous entry path. No XML was inspected.');
      }
      const manifests=entries.filter(entry=>entry.name.split('/').pop()==='imsmanifest.xml');
      if(!manifests.length) add(report,'warning','MANIFEST_MISSING','No imsmanifest.xml was found. Check whether your LMS expects a content-package manifest.');
      else if(!names.has('imsmanifest.xml')) add(report,'warning','MANIFEST_NESTED','The manifest is inside a folder, not at the ZIP root. A wrapper folder can prevent some LMS imports.',manifests[0].name);
      if(manifests.length>1) add(report,'info','MULTIPLE_MANIFESTS',`${manifests.length} manifests were found. Each manifest is checked relative to its own folder.`);
      let expandedRead=0;
      for(const entry of entries.filter(item=>/\.(?:xml|qti)$/i.test(item.name))) {
        try {
          const bytes=await readXmlBytes(entry);
          expandedRead+=bytes.length;
          if(expandedRead>LIMITS.expandedBytes) throw new InspectionError('XML_TOTAL_SIZE_LIMIT','The total XML reading limit was reached. Remaining XML files were not checked.');
          const doc=parseXml(decodeXml(bytes));
          report.summary.xml_files_scanned++;
          if(entry.name.split('/').pop()==='imsmanifest.xml') inspectManifest(doc,entry.name,names,report);
          inspectQti(doc,entry.name,report);
        } catch(error) {
          report.summary.xml_files_failed++;
          add(report,'error',error.code || 'XML_CHECK_FAILED',error instanceof InspectionError?error.message:'This XML file could not be inspected. No file content is included in this error.',entry.name);
          if(error.code==='XML_TOTAL_SIZE_LIMIT') {report.inspection_stopped=true;break;}
        }
      }
      if(report.summary.item_definitions===0) add(report,'warning','NO_ITEM_DEFINITIONS','No recognizable QTI 1.x or 2.x item definitions were counted. The package may contain references only, use another format, or contain XML that could not be read.');
      if(!report.summary.xml_files_scanned && !report.summary.xml_files_failed) add(report,'warning','NO_XML_FILES','No .xml or .qti files were found in this ZIP.');
    } catch(error) {
      report.inspection_stopped=true;
      add(report,'error',error.code || 'CHECK_FAILED',error instanceof InspectionError?error.message:'The archive could not be inspected. Try re-exporting it as a standard ZIP.');
    }
    return finish(report);
  }

  function element(tag,className,text) {const node=document.createElement(tag);if(className)node.className=className;if(text!==undefined)node.textContent=text;return node;}
  function render(report) {
    $('results').hidden=false;
    $('archive-name').textContent=report.input.name;
    $('item-count').textContent=String(report.summary.item_definitions);
    $('xml-count').textContent=String(report.summary.xml_files_scanned);
    $('issue-count').textContent=`${report.summary.errors} / ${report.summary.warnings}`;
    $('format-summary').textContent=report.formats.length?`${report.formats.join(' · ')}. ${report.summary.item_references} item reference(s) counted separately.`:'No recognizable QTI 1.x or 2.x XML identified.';
    $('result-summary').textContent=!report.complete?'The check is incomplete. Review the reading errors before relying on the counts.':report.summary.errors?'Some package references or structure need attention.':report.summary.warnings?'There are compatibility clues to review.':'No issues found in these limited checks. This does not guarantee an LMS import.';
    $('diagnostics').replaceChildren();
    const sorted=[...report.diagnostics].sort((a,b)=>({error:0,warning:1,info:2}[a.severity]-{error:0,warning:1,info:2}[b.severity]));
    for(const finding of sorted) {
      const card=element('div',`finding ${finding.severity}`);
      card.append(element('div','severity',finding.severity),element('p','',finding.message));
      card.append(element('div','location',[finding.path,finding.element_id].filter(Boolean).join(' · ') || finding.code));
      $('diagnostics').append(card);
    }
    if(!sorted.length) $('diagnostics').append(element('p','quiet','No findings in the checks performed.'));
    if(report.diagnostics_truncated) $('diagnostics').append(element('p','quiet','Only the first 1,000 diagnostics are included. The report is incomplete.'));
    $('inventory').replaceChildren();
    for(const file of report.files) {
      const row=element('div','inventory-file');
      row.append(element('strong','',file.path),element('p','',`${file.format} · ${file.item_count} item definition(s) · ${file.item_reference_count} item reference(s)`));
      if(file.item_ids.length)row.append(element('p','',`Item IDs: ${file.item_ids.join(', ')}${file.item_ids_truncated?' (first 200 only)':''}`));
      $('inventory').append(row);
    }
    if(!report.files.length)$('inventory').append(element('p','quiet','No question file inventory is available.'));
  }

  async function run(file) {
    if(running)return null;
    running=true;
    currentReport=null;
    $('results').hidden=true;
    $('status').textContent='Reading the ZIP locally and checking its XML…';
    for(const id of ['zip-file','sample-good','sample-bad','download-report'])$(id).disabled=true;
    try {currentReport=await check(file);render(currentReport);$('status').textContent='Check finished. No archive content was uploaded or changed.';return JSON.parse(JSON.stringify(currentReport));}
    finally {running=false;for(const id of ['zip-file','sample-good','sample-bad','download-report'])$(id).disabled=false;}
  }

  async function runSynthetic(name='good') {
    if(running)return null;
    const fixture=window.QtiSyntheticFixtures[name];
    if(!fixture)throw new Error('Unknown synthetic fixture.');
    const zip=new JSZip();
    for(const [path,text] of Object.entries(fixture))zip.file(path,text);
    const blob=await zip.generateAsync({type:'blob',compression:'DEFLATE'});
    return run(new File([blob],`synthetic-${name}.zip`,{type:'application/zip'}));
  }

  $('zip-file').addEventListener('change',event=>{if(event.target.files[0])run(event.target.files[0]);});
  $('sample-good').addEventListener('click',()=>runSynthetic('good'));
  $('sample-bad').addEventListener('click',()=>runSynthetic('bad'));
  $('download-report').addEventListener('click',()=>{
    if(!currentReport)return;
    const blob=new Blob([JSON.stringify(currentReport,null,2)],{type:'application/json'});
    const url=URL.createObjectURL(blob);
    const link=document.createElement('a');link.href=url;link.download='qti-pocket-check-report.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  });
  // Deliberately limited integration surface: no question text, DOMs or files.
  window.QTIPocketCheck=Object.freeze({version:VERSION,runSynthetic,getReport:()=>currentReport?JSON.parse(JSON.stringify(currentReport)):null,isRunning:()=>running});
})();
